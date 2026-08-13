import { listJobsForRun, type GitHubClient } from './github.js';
import type { FlakyJobStat, JobSummary, LikelyFlakyDetectionResult, RunnerOs, WorkflowRunSummary } from './types.js';

/**
 * Infers the runner OS from a job's labels (e.g. ["ubuntu-latest"],
 * ["windows-latest"], ["self-hosted", "linux", "x64"]). "self-hosted" wins
 * over any OS label since GitHub always includes it for self-hosted jobs;
 * unmatched labels default to "linux", the most common GitHub-hosted case.
 */
export function inferRunnerOs(labels: string[]): RunnerOs {
  const normalized = labels.map((label) => label.toLowerCase());
  if (normalized.includes('self-hosted')) {
    return 'self-hosted';
  }
  if (normalized.some((label) => label.includes('windows'))) {
    return 'windows';
  }
  if (normalized.some((label) => label.includes('macos'))) {
    return 'macos';
  }
  return 'linux';
}

interface FlakyJobAccumulator {
  runnerOs: RunnerOs;
  flakyRuns: number;
  sampleSize: number;
  wastedMinutes: number;
}

function accumulateRunJobs(jobs: JobSummary[], accumulators: Map<string, FlakyJobAccumulator>): void {
  const byName = new Map<string, JobSummary[]>();
  for (const job of jobs) {
    const group = byName.get(job.name);
    if (group) {
      group.push(job);
    } else {
      byName.set(job.name, [job]);
    }
  }

  for (const [name, attempts] of byName) {
    attempts.sort((a, b) => a.runAttempt - b.runAttempt);

    let accumulator = accumulators.get(name);
    if (!accumulator) {
      accumulator = {
        runnerOs: inferRunnerOs(attempts[0]?.labels ?? []),
        flakyRuns: 0,
        sampleSize: 0,
        wastedMinutes: 0,
      };
      accumulators.set(name, accumulator);
    }
    accumulator.sampleSize += 1;

    const failedAttempts = attempts.filter((job) => job.conclusion === 'failure');
    const finalSucceeded = attempts.at(-1)?.conclusion === 'success';

    if (failedAttempts.length > 0 && finalSucceeded) {
      accumulator.flakyRuns += 1;
      for (const failed of failedAttempts) {
        accumulator.wastedMinutes += (failed.durationMs ?? 0) / 60000;
      }
    }
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface DetectFlakyJobsParams {
  owner: string;
  repo: string;
  runs: WorkflowRunSummary[];
}

/**
 * Detects flaky jobs: a job that failed on an earlier attempt of a run and
 * later succeeded on a later attempt of the *same* run (same commit, zero
 * code changes). Only runs GitHub itself marked as re-run (run_attempt > 1)
 * are fetched in detail, since a first-attempt-only run cannot show this
 * pattern — this keeps API usage proportional to actual re-run activity.
 */
export async function detectFlakyJobs(client: GitHubClient, params: DetectFlakyJobsParams): Promise<FlakyJobStat[]> {
  const { owner, repo, runs } = params;
  const accumulators = new Map<string, FlakyJobAccumulator>();

  const rerunRuns = runs.filter((run) => run.runAttempt > 1);
  for (const run of rerunRuns) {
    const jobs = await listJobsForRun(client, { owner, repo, runId: run.id, allAttempts: true });
    accumulateRunJobs(jobs, accumulators);
  }

  const stats: FlakyJobStat[] = Array.from(accumulators.entries()).map(([jobName, acc]) => ({
    jobName,
    runnerOs: acc.runnerOs,
    flakyRuns: acc.flakyRuns,
    sampleSize: acc.sampleSize,
    flakinessRate: acc.sampleSize > 0 ? roundTo(acc.flakyRuns / acc.sampleSize, 4) : 0,
    wastedMinutes: roundTo(acc.wastedMinutes, 2),
  }));

  stats.sort((a, b) => b.wastedMinutes - a.wastedMinutes || a.jobName.localeCompare(b.jobName));

  return stats;
}

export const DEFAULT_RETRY_WINDOW_MINUTES = 60;
export const MAX_RETRY_WINDOW_MINUTES = 240;

interface JobTimelineEntry {
  workflowName: string;
  branch: string;
  jobName: string;
  runnerOs: RunnerOs;
  headSha: string;
  authorId: string | null;
  conclusion: string | null;
  createdAt: string;
  durationMs: number | null;
}

function groupKey(entry: Pick<JobTimelineEntry, 'workflowName' | 'jobName' | 'branch'>): string {
  return JSON.stringify([entry.workflowName, entry.jobName, entry.branch]);
}

/**
 * Collapses consecutive same-SHA entries in an already time-sorted timeline
 * into one, keeping the most recent run's conclusion — the "final" state a
 * developer actually saw for that commit. A single commit can produce
 * multiple job runs (e.g. a `push` and a `pull_request` trigger firing
 * moments apart) that disagree with each other; without collapsing, a
 * same-SHA success sitting right after a same-SHA failure occupies the
 * adjacency slot the pairing loop below relies on, hiding a real
 * push-to-retry pattern against the *next distinct* commit.
 */
function collapseSameShaRuns(sortedEntries: JobTimelineEntry[]): JobTimelineEntry[] {
  const collapsed: JobTimelineEntry[] = [];
  for (const entry of sortedEntries) {
    const last = collapsed.at(-1);
    if (last && last.headSha === entry.headSha) {
      collapsed[collapsed.length - 1] = entry;
    } else {
      collapsed.push(entry);
    }
  }
  return collapsed;
}

export interface DetectLikelyFlakyJobsParams {
  owner: string;
  repo: string;
  runs: WorkflowRunSummary[];
  retryWindowMinutes: number;
}

/**
 * Detects "likely flaky" jobs via the push-to-retry pattern: a job fails on
 * one commit and the next commit pushed to the *same branch, by the same
 * author* passes, within a configurable time window. This is invisible to
 * detectFlakyJobs, which only sees same-SHA re-runs (run_attempt > 1) —
 * push-to-retry always produces a new head SHA, since the developer pushed
 * a new commit instead of clicking "re-run".
 *
 * The author check (commit author email, falling back to the triggering
 * actor's login — whichever the API gives us) is what makes this a causal
 * signal rather than a coincidence: on a busy shared branch, someone else's
 * unrelated commit can easily pass right after your commit failed, and
 * without matching authors that would be misread as a fix. A pair with an
 * unknown author on either side is not counted, erring toward fewer false
 * positives.
 *
 * Confirmed incidents don't leak into this detector: a run that recovered
 * via a same-SHA re-run has a *final* job conclusion of "success" (we only
 * look at each run's latest attempt), so it can never serve as the
 * "failure" side of a likely pair — confirmed cases are structurally
 * excluded, not filtered out after the fact.
 *
 * Only strictly adjacent entries in a job's per-branch timeline are
 * compared, so a failure is never paired with a success that isn't the very
 * next result for that job — this is what keeps the "no jumping over other
 * runs in between" rule (and prevents one failure from being double-counted
 * against two different later successes).
 *
 * Before pairing, consecutive same-SHA entries are collapsed into one (see
 * collapseSameShaRuns), keeping the most recent run's conclusion. A single
 * commit can trigger more than one run of the same job (e.g. `push` and
 * `pull_request` firing moments apart) that disagree; left uncollapsed, a
 * same-SHA success landing right after a same-SHA failure would occupy the
 * one adjacency slot available and mask a genuine failure on the *next*
 * distinct commit.
 */
export async function detectLikelyFlakyJobs(
  client: GitHubClient,
  params: DetectLikelyFlakyJobsParams,
): Promise<LikelyFlakyDetectionResult> {
  const { owner, repo, runs, retryWindowMinutes } = params;

  const runsWithConclusion = runs.filter((run) => run.conclusion === 'success' || run.conclusion === 'failure');
  const finishedRuns = runsWithConclusion.filter((run) => Boolean(run.headBranch));
  const excludedRunsMissingBranch = runsWithConclusion.length - finishedRuns.length;

  const entries: JobTimelineEntry[] = [];
  for (const run of finishedRuns) {
    const jobs = await listJobsForRun(client, { owner, repo, runId: run.id });
    for (const job of jobs) {
      if (job.conclusion !== 'success' && job.conclusion !== 'failure') {
        continue;
      }
      entries.push({
        workflowName: run.name,
        branch: run.headBranch as string,
        jobName: job.name,
        runnerOs: inferRunnerOs(job.labels),
        headSha: run.headSha,
        authorId: run.authorId,
        conclusion: job.conclusion,
        createdAt: run.createdAt,
        durationMs: job.durationMs,
      });
    }
  }

  const groups = new Map<string, JobTimelineEntry[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const windowMs = retryWindowMinutes * 60_000;
  const accumulators = new Map<string, FlakyJobAccumulator>();

  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const collapsed = collapseSameShaRuns(group);

    const jobName = collapsed[0]!.jobName;
    let accumulator = accumulators.get(jobName);
    if (!accumulator) {
      accumulator = { runnerOs: collapsed[0]!.runnerOs, flakyRuns: 0, sampleSize: 0, wastedMinutes: 0 };
      accumulators.set(jobName, accumulator);
    }
    accumulator.sampleSize += collapsed.length;

    for (let i = 1; i < collapsed.length; i += 1) {
      const prev = collapsed[i - 1]!;
      const curr = collapsed[i]!;
      if (prev.conclusion !== 'failure' || curr.conclusion !== 'success' || prev.headSha === curr.headSha) {
        continue;
      }
      if (prev.authorId === null || curr.authorId === null || prev.authorId !== curr.authorId) {
        continue;
      }
      const gapMs = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
      if (gapMs < 0 || gapMs > windowMs) {
        continue;
      }
      accumulator.flakyRuns += 1;
      accumulator.wastedMinutes += (prev.durationMs ?? 0) / 60000;
    }
  }

  const stats: FlakyJobStat[] = Array.from(accumulators.entries()).map(([jobName, acc]) => ({
    jobName,
    runnerOs: acc.runnerOs,
    flakyRuns: acc.flakyRuns,
    sampleSize: acc.sampleSize,
    flakinessRate: acc.sampleSize > 0 ? roundTo(acc.flakyRuns / acc.sampleSize, 4) : 0,
    wastedMinutes: roundTo(acc.wastedMinutes, 2),
  }));

  stats.sort((a, b) => b.wastedMinutes - a.wastedMinutes || a.jobName.localeCompare(b.jobName));

  return { stats, excludedRunsMissingBranch };
}
