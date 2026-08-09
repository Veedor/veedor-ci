import { listJobsForRun, type GitHubClient } from './github.js';
import type { FlakyJobStat, JobSummary, RunnerOs, WorkflowRunSummary } from './types.js';

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
