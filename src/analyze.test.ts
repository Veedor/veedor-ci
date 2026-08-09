import { describe, expect, it, vi } from 'vitest';
import { detectFlakyJobs, inferRunnerOs } from './analyze.js';
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
