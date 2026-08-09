import { describe, expect, it, vi } from 'vitest';
import { buildScanOptions, isValidFormat, isValidRepo, parseLimit, runScan } from './index.js';
import type { GitHubClient } from './github.js';

describe('buildScanOptions', () => {
  it('builds a valid scan configuration', () => {
    const config = buildScanOptions({
      repo: 'octocat/hello-world',
      limit: '200',
      format: 'table',
    });

    expect(config).toEqual({
      repo: 'octocat/hello-world',
      workflow: undefined,
      limit: 200,
      format: 'table',
    });
  });

  it('rejects an invalid repo', () => {
    expect(() => buildScanOptions({ repo: 'not-a-repo', limit: '200', format: 'table' })).toThrow(
      /Invalid repo/,
    );
  });

  it('rejects an invalid format', () => {
    expect(() =>
      buildScanOptions({ repo: 'octocat/hello-world', limit: '200', format: 'yaml' }),
    ).toThrow(/Invalid format/);
  });

  it('rejects a non-positive limit', () => {
    expect(() =>
      buildScanOptions({ repo: 'octocat/hello-world', limit: '0', format: 'table' }),
    ).toThrow(/Invalid limit/);
  });

  it('parses a --price-per-minute override when given', () => {
    const config = buildScanOptions({
      repo: 'octocat/hello-world',
      limit: '200',
      format: 'table',
      pricePerMinute: 'linux=0.01',
    });

    expect(config.priceOverrides).toEqual({ linux: 0.01 });
  });

  it('leaves priceOverrides undefined when --price-per-minute is not given', () => {
    const config = buildScanOptions({ repo: 'octocat/hello-world', limit: '200', format: 'table' });
    expect(config.priceOverrides).toBeUndefined();
  });

  it('rejects an invalid --price-per-minute value', () => {
    expect(() =>
      buildScanOptions({ repo: 'octocat/hello-world', limit: '200', format: 'table', pricePerMinute: 'nope' }),
    ).toThrow(/--price-per-minute/);
  });
});

describe('isValidRepo', () => {
  it('accepts owner/name', () => {
    expect(isValidRepo('octocat/hello-world')).toBe(true);
  });

  it('rejects missing slash', () => {
    expect(isValidRepo('octocat')).toBe(false);
  });
});

describe('isValidFormat', () => {
  it('accepts known formats', () => {
    expect(isValidFormat('json')).toBe(true);
  });

  it('rejects unknown formats', () => {
    expect(isValidFormat('yaml')).toBe(false);
  });
});

describe('parseLimit', () => {
  it('parses a positive integer', () => {
    expect(parseLimit('42')).toBe(42);
  });

  it('throws on non-integer input', () => {
    expect(() => parseLimit('abc')).toThrow();
  });
});

function makeScanClient(): GitHubClient {
  const listWorkflowRunsForRepo = vi.fn().mockResolvedValue({
    data: {
      workflow_runs: [
        {
          id: 100,
          name: 'CI',
          head_sha: 'sha-100',
          run_attempt: 1,
          conclusion: 'success',
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:05:00Z',
        },
        {
          id: 101,
          name: 'CI',
          head_sha: 'sha-101',
          run_attempt: 2,
          conclusion: 'success',
          created_at: '2026-08-05T00:00:00Z',
          updated_at: '2026-08-05T00:05:00Z',
        },
      ],
    },
  });

  const listJobsForWorkflowRun = vi.fn().mockImplementation(({ run_id }: { run_id: number }) => {
    if (run_id !== 101) {
      return Promise.resolve({ data: { jobs: [] } });
    }
    return Promise.resolve({
      data: {
        jobs: [
          {
            id: 1,
            name: 'flaky-test',
            status: 'completed',
            conclusion: 'failure',
            started_at: '2026-08-05T00:00:00Z',
            completed_at: '2026-08-05T00:03:00Z',
            run_attempt: 1,
            labels: ['ubuntu-latest'],
          },
          {
            id: 2,
            name: 'flaky-test',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-08-05T00:10:00Z',
            completed_at: '2026-08-05T00:12:00Z',
            run_attempt: 2,
            labels: ['ubuntu-latest'],
          },
        ],
      },
    });
  });

  return {
    rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
  };
}

describe('runScan', () => {
  it('connects github, analyze, and cost into a single report', async () => {
    const client = makeScanClient();
    const options = buildScanOptions({ repo: 'octocat/hello-world', limit: '10', format: 'table' });

    const report = await runScan(options, { client });

    expect(report.repo).toBe('octocat/hello-world');
    expect(report.runsAnalyzed).toBe(2);
    expect(report.dateRange).toEqual({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-05T00:00:00.000Z' });
    expect(report.analyzedDays).toBe(4);
    expect(report.jobs).toEqual([
      {
        jobName: 'flaky-test',
        runnerOs: 'linux',
        flakyRuns: 1,
        sampleSize: 1,
        flakinessRate: 1,
        wastedMinutes: 3,
        pricePerMinuteUsd: 0.008,
        costUsd: 0.024,
      },
    ]);
    expect(report.totalCostUsd).toBe(0.024);
    expect(report.projectedMonthlyCostUsd).toBe(0.18);

    const spy = client.rest.actions.listJobsForWorkflowRun as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ run_id: 101, filter: 'all' }));
  });

  it('applies price overrides end to end', async () => {
    const client = makeScanClient();
    const options = buildScanOptions({
      repo: 'octocat/hello-world',
      limit: '10',
      format: 'table',
      pricePerMinute: 'linux=1',
    });

    const report = await runScan(options, { client });

    expect(report.jobs[0]?.pricePerMinuteUsd).toBe(1);
    expect(report.jobs[0]?.costUsd).toBe(3);
  });
});
