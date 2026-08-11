import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETRY_WINDOW_MINUTES,
  detectFlakyJobs,
  detectLikelyFlakyJobs,
  inferRunnerOs,
} from './analyze.js';
import type { GitHubClient } from './github.js';
import type { WorkflowRunSummary } from './types.js';

describe('inferRunnerOs', () => {
  it('detects self-hosted regardless of other labels', () => {
    expect(inferRunnerOs(['self-hosted', 'linux', 'x64'])).toBe('self-hosted');
  });

  it('detects windows', () => {
    expect(inferRunnerOs(['windows-latest'])).toBe('windows');
  });

  it('detects macos', () => {
    expect(inferRunnerOs(['macos-14'])).toBe('macos');
  });

  it('defaults to linux for ubuntu labels', () => {
    expect(inferRunnerOs(['ubuntu-latest'])).toBe('linux');
  });

  it('defaults to linux for no labels', () => {
    expect(inferRunnerOs([])).toBe('linux');
  });

  it('is case-insensitive', () => {
    expect(inferRunnerOs(['Windows-Latest'])).toBe('windows');
  });
});

function makeRun(id: number, runAttempt: number): WorkflowRunSummary {
  return {
    id,
    name: 'CI',
    headSha: `sha-${id}`,
    headBranch: 'main',
    authorId: 'dev@example.com',
    runAttempt,
    conclusion: runAttempt > 1 ? 'success' : 'failure',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:05:00Z',
    durationMs: 5 * 60 * 1000,
  };
}

interface RawJobFixture {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  run_attempt: number;
  labels: string[];
}

function makeJob(overrides: Partial<RawJobFixture> & { name: string; run_attempt: number; conclusion: string | null }): RawJobFixture {
  return {
    id: overrides.run_attempt * 1000 + Math.floor(Math.random() * 1000),
    status: 'completed',
    started_at: '2026-08-01T00:00:00Z',
    completed_at: '2026-08-01T00:02:00Z',
    labels: ['ubuntu-latest'],
    ...overrides,
  };
}

function clientWithJobsByRun(jobsByRunId: Record<number, RawJobFixture[]>): GitHubClient {
  const listJobsForWorkflowRun = vi.fn().mockImplementation(({ run_id }: { run_id: number }) =>
    Promise.resolve({ data: { jobs: jobsByRunId[run_id] ?? [] } }),
  );
  return {
    rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
  };
}

describe('detectFlakyJobs', () => {
  it('skips runs that were never re-run', async () => {
    const client = clientWithJobsByRun({});
    const spy = client.rest.actions.listJobsForWorkflowRun as ReturnType<typeof vi.fn>;

    const stats = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs: [makeRun(1, 1)] });

    expect(spy).not.toHaveBeenCalled();
    expect(stats).toEqual([]);
  });

  it('counts a fail-then-pass job as flaky and sums the wasted attempt duration', async () => {
    const client = clientWithJobsByRun({
      1: [
        makeJob({
          name: 'unit-tests',
          run_attempt: 1,
          conclusion: 'failure',
          started_at: '2026-08-01T00:00:00Z',
          completed_at: '2026-08-01T00:03:00Z',
        }),
        makeJob({
          name: 'unit-tests',
          run_attempt: 2,
          conclusion: 'success',
          started_at: '2026-08-01T00:10:00Z',
          completed_at: '2026-08-01T00:12:00Z',
        }),
      ],
    });

    const stats = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs: [makeRun(1, 2)] });

    expect(stats).toEqual([
      {
        jobName: 'unit-tests',
        runnerOs: 'linux',
        flakyRuns: 1,
        sampleSize: 1,
        flakinessRate: 1,
        wastedMinutes: 3,
      },
    ]);
  });

  it('does not count a job that failed on every attempt', async () => {
    const client = clientWithJobsByRun({
      1: [
        makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'failure' }),
        makeJob({ name: 'unit-tests', run_attempt: 2, conclusion: 'failure' }),
      ],
    });

    const stats = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs: [makeRun(1, 2)] });

    expect(stats).toEqual([
      {
        jobName: 'unit-tests',
        runnerOs: 'linux',
        flakyRuns: 0,
        sampleSize: 1,
        flakinessRate: 0,
        wastedMinutes: 0,
      },
    ]);
  });

  it('sums multiple failed attempts before an eventual pass, but counts one flaky run', async () => {
    const client = clientWithJobsByRun({
      1: [
        makeJob({
          name: 'e2e',
          run_attempt: 1,
          conclusion: 'failure',
          started_at: '2026-08-01T00:00:00Z',
          completed_at: '2026-08-01T00:04:00Z',
        }),
        makeJob({
          name: 'e2e',
          run_attempt: 2,
          conclusion: 'failure',
          started_at: '2026-08-01T00:10:00Z',
          completed_at: '2026-08-01T00:12:00Z',
        }),
        makeJob({
          name: 'e2e',
          run_attempt: 3,
          conclusion: 'success',
          started_at: '2026-08-01T00:20:00Z',
          completed_at: '2026-08-01T00:22:00Z',
        }),
      ],
    });

    const stats = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs: [makeRun(1, 3)] });

    expect(stats).toEqual([
      {
        jobName: 'e2e',
        runnerOs: 'linux',
        flakyRuns: 1,
        sampleSize: 1,
        flakinessRate: 1,
        wastedMinutes: 6,
      },
    ]);
  });

  it('aggregates the same job across multiple re-run runs', async () => {
    const client = clientWithJobsByRun({
      1: [
        makeJob({ name: 'flaky', run_attempt: 1, conclusion: 'failure' }),
        makeJob({ name: 'flaky', run_attempt: 2, conclusion: 'success' }),
      ],
      2: [
        makeJob({ name: 'flaky', run_attempt: 1, conclusion: 'failure' }),
        makeJob({ name: 'flaky', run_attempt: 2, conclusion: 'success' }),
      ],
    });

    const stats = await detectFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs: [makeRun(1, 2), makeRun(2, 2)],
    });

    expect(stats).toHaveLength(1);
    expect(stats[0]?.flakyRuns).toBe(2);
    expect(stats[0]?.sampleSize).toBe(2);
    expect(stats[0]?.flakinessRate).toBe(1);
    expect(stats[0]?.wastedMinutes).toBe(4);
  });

  it('infers runner os from job labels and sorts by wasted minutes descending', async () => {
    const client = clientWithJobsByRun({
      1: [
        makeJob({
          name: 'windows-tests',
          run_attempt: 1,
          conclusion: 'failure',
          labels: ['windows-latest'],
          started_at: '2026-08-01T00:00:00Z',
          completed_at: '2026-08-01T00:01:00Z',
        }),
        makeJob({ name: 'windows-tests', run_attempt: 2, conclusion: 'success', labels: ['windows-latest'] }),
        makeJob({
          name: 'linux-tests',
          run_attempt: 1,
          conclusion: 'failure',
          labels: ['ubuntu-latest'],
          started_at: '2026-08-01T00:00:00Z',
          completed_at: '2026-08-01T00:05:00Z',
        }),
        makeJob({ name: 'linux-tests', run_attempt: 2, conclusion: 'success', labels: ['ubuntu-latest'] }),
      ],
    });

    const stats = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs: [makeRun(1, 2)] });

    expect(stats.map((s) => s.jobName)).toEqual(['linux-tests', 'windows-tests']);
    expect(stats[0]?.runnerOs).toBe('linux');
    expect(stats[1]?.runnerOs).toBe('windows');
  });
});

function makePushRun(overrides: {
  id: number;
  sha: string;
  branch?: string;
  author?: string | null;
  conclusion: 'success' | 'failure';
  createdAt: string;
  runAttempt?: number;
}): WorkflowRunSummary {
  return {
    id: overrides.id,
    name: 'CI',
    headSha: overrides.sha,
    headBranch: overrides.branch ?? 'main',
    authorId: overrides.author === undefined ? 'dev@example.com' : overrides.author,
    runAttempt: overrides.runAttempt ?? 1,
    conclusion: overrides.conclusion,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
    durationMs: 3 * 60 * 1000,
  };
}

function clientWithLatestJobByRun(jobsByRunId: Record<number, RawJobFixture>): GitHubClient {
  const listJobsForWorkflowRun = vi
    .fn()
    .mockImplementation(({ run_id, filter }: { run_id: number; filter: string }) => {
      expect(filter).toBe('latest');
      const job = jobsByRunId[run_id];
      return Promise.resolve({ data: { jobs: job ? [job] : [] } });
    });
  return {
    rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
  };
}

describe('detectLikelyFlakyJobs', () => {
  it('counts a clean push-to-retry pair: fail on one SHA, pass on the next, within the window', async () => {
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', conclusion: 'failure', createdAt: '2026-08-01T00:00:00Z' }),
      makePushRun({ id: 2, sha: 'sha-B', conclusion: 'success', createdAt: '2026-08-01T00:30:00Z' }),
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'failure',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:04:00Z',
      }),
      2: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'success',
        started_at: '2026-08-01T00:30:00Z',
        completed_at: '2026-08-01T00:32:00Z',
      }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: DEFAULT_RETRY_WINDOW_MINUTES,
    });

    expect(result.stats).toEqual([
      {
        jobName: 'unit-tests',
        runnerOs: 'linux',
        flakyRuns: 1,
        sampleSize: 2,
        flakinessRate: 0.5,
        wastedMinutes: 4,
      },
    ]);
    expect(result.excludedRunsMissingBranch).toBe(0);
  });

  it('does not count a fail-then-pass pair when the pass falls outside the retry window', async () => {
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', conclusion: 'failure', createdAt: '2026-08-01T00:00:00Z' }),
      makePushRun({ id: 2, sha: 'sha-B', conclusion: 'success', createdAt: '2026-08-01T01:30:00Z' }),
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'failure',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:04:00Z',
      }),
      2: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'success',
        started_at: '2026-08-01T01:30:00Z',
        completed_at: '2026-08-01T01:32:00Z',
      }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(result.stats).toEqual([
      { jobName: 'unit-tests', runnerOs: 'linux', flakyRuns: 0, sampleSize: 2, flakinessRate: 0, wastedMinutes: 0 },
    ]);
  });

  it('does not create a second incident when a later, non-adjacent success follows an already-resolved failure', async () => {
    // fail(A) -> success(B) -> success(C): B correctly closes A (1 incident).
    // C is just another later success and must not spawn a duplicate incident
    // for A, nor pair with it by "jumping over" B.
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', conclusion: 'failure', createdAt: '2026-08-01T00:00:00Z' }),
      makePushRun({ id: 2, sha: 'sha-B', conclusion: 'success', createdAt: '2026-08-01T00:10:00Z' }),
      makePushRun({ id: 3, sha: 'sha-C', conclusion: 'success', createdAt: '2026-08-01T00:20:00Z' }),
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'failure',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:04:00Z',
      }),
      2: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'success' }),
      3: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'success' }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(result.stats).toHaveLength(1);
    expect(result.stats[0]?.flakyRuns).toBe(1);
    expect(result.stats[0]?.sampleSize).toBe(3);
    expect(result.stats[0]?.wastedMinutes).toBe(4);
  });

  it('does not count a fail-then-pass pair when the commit authors differ', async () => {
    // Same job, same branch, same moment, well within the window — but a
    // different author's commit passing right after another author's
    // failure is not evidence of a fix; it's coincidence on a busy branch.
    const runs = [
      makePushRun({
        id: 1,
        sha: 'sha-A',
        author: 'alice@example.com',
        conclusion: 'failure',
        createdAt: '2026-08-01T00:00:00Z',
      }),
      makePushRun({
        id: 2,
        sha: 'sha-B',
        author: 'bob@example.com',
        conclusion: 'success',
        createdAt: '2026-08-01T00:05:00Z',
      }),
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({
        name: 'unit-tests',
        run_attempt: 1,
        conclusion: 'failure',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:04:00Z',
      }),
      2: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'success' }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(result.stats).toEqual([
      { jobName: 'unit-tests', runnerOs: 'linux', flakyRuns: 0, sampleSize: 2, flakinessRate: 0, wastedMinutes: 0 },
    ]);
  });

  it('does not count a pair when either side has no known author', async () => {
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', author: null, conclusion: 'failure', createdAt: '2026-08-01T00:00:00Z' }),
      makePushRun({ id: 2, sha: 'sha-B', conclusion: 'success', createdAt: '2026-08-01T00:05:00Z' }),
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'failure' }),
      2: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'success' }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(result.stats[0]?.flakyRuns).toBe(0);
  });

  it('counts finished runs missing head_branch as excluded, not silently dropped', async () => {
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', branch: 'main', conclusion: 'failure', createdAt: '2026-08-01T00:00:00Z' }),
      { ...makePushRun({ id: 2, sha: 'sha-B', conclusion: 'success', createdAt: '2026-08-01T00:05:00Z' }), headBranch: null },
      { ...makePushRun({ id: 3, sha: 'sha-C', conclusion: 'failure', createdAt: '2026-08-01T00:10:00Z' }), headBranch: null },
    ];
    const client = clientWithLatestJobByRun({
      1: makeJob({ name: 'unit-tests', run_attempt: 1, conclusion: 'failure' }),
    });

    const result = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(result.excludedRunsMissingBranch).toBe(2);
    const spy = client.rest.actions.listJobsForWorkflowRun as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ run_id: 1 }));
  });

  it('mixes with detectFlakyJobs on the same job without double-counting: confirmed and likely stay separate', async () => {
    // Run 1 (sha-A, run_attempt 2): recovered via a same-SHA re-run — confirmed.
    // Run 2 (sha-B): fails and is never retried in place.
    // Run 3 (sha-C): a different commit that passes within the window — likely fix for run 2.
    const runs = [
      makePushRun({ id: 1, sha: 'sha-A', conclusion: 'success', createdAt: '2026-08-01T00:00:00Z', runAttempt: 2 }),
      makePushRun({ id: 2, sha: 'sha-B', conclusion: 'failure', createdAt: '2026-08-01T01:00:00Z' }),
      makePushRun({ id: 3, sha: 'sha-C', conclusion: 'success', createdAt: '2026-08-01T01:30:00Z' }),
    ];

    const listJobsForWorkflowRun = vi
      .fn()
      .mockImplementation(({ run_id, filter }: { run_id: number; filter: string }) => {
        if (run_id === 1 && filter === 'all') {
          return Promise.resolve({
            data: {
              jobs: [
                makeJob({
                  name: 'e2e',
                  run_attempt: 1,
                  conclusion: 'failure',
                  started_at: '2026-08-01T00:00:00Z',
                  completed_at: '2026-08-01T00:04:00Z',
                }),
                makeJob({
                  name: 'e2e',
                  run_attempt: 2,
                  conclusion: 'success',
                  started_at: '2026-08-01T00:10:00Z',
                  completed_at: '2026-08-01T00:12:00Z',
                }),
              ],
            },
          });
        }
        if (run_id === 1 && filter === 'latest') {
          return Promise.resolve({
            data: {
              jobs: [
                makeJob({
                  name: 'e2e',
                  run_attempt: 2,
                  conclusion: 'success',
                  started_at: '2026-08-01T00:10:00Z',
                  completed_at: '2026-08-01T00:12:00Z',
                }),
              ],
            },
          });
        }
        if (run_id === 2) {
          return Promise.resolve({
            data: {
              jobs: [
                makeJob({
                  name: 'e2e',
                  run_attempt: 1,
                  conclusion: 'failure',
                  started_at: '2026-08-01T01:00:00Z',
                  completed_at: '2026-08-01T01:05:00Z',
                }),
              ],
            },
          });
        }
        if (run_id === 3) {
          return Promise.resolve({
            data: { jobs: [makeJob({ name: 'e2e', run_attempt: 1, conclusion: 'success' })] },
          });
        }
        return Promise.resolve({ data: { jobs: [] } });
      });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
    };

    const confirmed = await detectFlakyJobs(client, { owner: 'octocat', repo: 'hello-world', runs });
    const likely = await detectLikelyFlakyJobs(client, {
      owner: 'octocat',
      repo: 'hello-world',
      runs,
      retryWindowMinutes: 60,
    });

    expect(confirmed).toEqual([
      { jobName: 'e2e', runnerOs: 'linux', flakyRuns: 1, sampleSize: 1, flakinessRate: 1, wastedMinutes: 4 },
    ]);
    expect(likely.stats).toEqual([
      { jobName: 'e2e', runnerOs: 'linux', flakyRuns: 1, sampleSize: 3, flakinessRate: 0.3333, wastedMinutes: 5 },
    ]);
    // The confirmed incident's wasted minutes (4) and the likely incident's (5)
    // are disjoint — neither run's wasted time is counted in both categories.
    expect(confirmed[0]!.wastedMinutes + likely.stats[0]!.wastedMinutes).toBe(9);
  });
});
