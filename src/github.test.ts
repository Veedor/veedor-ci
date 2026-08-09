import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOctokitFromEnv,
  listJobsForRun,
  listWorkflowRuns,
  type GitHubClient,
} from './github.js';

function makeOctokitError(status: number, headers: Record<string, string> = {}): Error & {
  status: number;
  response: { headers: Record<string, string> };
} {
  const error = new Error(`HTTP ${status}`) as Error & {
    status: number;
    response: { headers: Record<string, string> };
  };
  error.status = status;
  error.response = { headers };
  return error;
}

function createRunFixture(id: number) {
  return {
    id,
    name: 'CI',
    head_sha: `sha-${id}`,
    run_attempt: 1,
    conclusion: 'success',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:05:00Z',
  };
}

function createRunFixtures(count: number, startId = 1) {
  return Array.from({ length: count }, (_, i) => createRunFixture(startId + i));
}

describe('createOctokitFromEnv', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('throws a clear error when GITHUB_TOKEN is not set', () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => createOctokitFromEnv()).toThrow(/GITHUB_TOKEN environment variable is not set/);
  });

  it('creates an Octokit instance when a token is provided explicitly', () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => createOctokitFromEnv({ token: 'test-token' })).not.toThrow();
  });

  it('creates an Octokit instance when GITHUB_TOKEN is set', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    expect(() => createOctokitFromEnv()).not.toThrow();
  });
});

describe('listWorkflowRuns', () => {
  it('maps run fields and computes duration', async () => {
    const listWorkflowRunsForRepo = vi.fn().mockResolvedValue({
      data: { workflow_runs: [createRunFixture(1)] },
    });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    const runs = await listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 });

    expect(runs).toEqual([
      {
        id: 1,
        name: 'CI',
        headSha: 'sha-1',
        runAttempt: 1,
        conclusion: 'success',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:05:00Z',
        durationMs: 5 * 60 * 1000,
      },
    ]);
    expect(listWorkflowRunsForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world', per_page: 10, page: 1 }),
    );
  });

  it('uses the workflow-scoped endpoint when a workflow is given', async () => {
    const listWorkflowRuns_ = vi.fn().mockResolvedValue({ data: { workflow_runs: [createRunFixture(1)] } });
    const client: GitHubClient = {
      rest: {
        actions: {
          listWorkflowRunsForRepo: vi.fn(),
          listWorkflowRuns: listWorkflowRuns_,
          listJobsForWorkflowRun: vi.fn(),
        },
      },
    };

    await listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10, workflow: 'ci.yml' });

    expect(listWorkflowRuns_).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world', workflow_id: 'ci.yml' }),
    );
  });

  it('paginates across multiple pages up to the limit', async () => {
    const listWorkflowRunsForRepo = vi
      .fn()
      .mockResolvedValueOnce({ data: { workflow_runs: createRunFixtures(100, 1) } })
      .mockResolvedValueOnce({ data: { workflow_runs: createRunFixtures(50, 101) } });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    const runs = await listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 150 });

    expect(runs).toHaveLength(150);
    expect(listWorkflowRunsForRepo).toHaveBeenCalledTimes(2);
    expect(listWorkflowRunsForRepo).toHaveBeenNthCalledWith(1, expect.objectContaining({ per_page: 100, page: 1 }));
    expect(listWorkflowRunsForRepo).toHaveBeenNthCalledWith(2, expect.objectContaining({ per_page: 50, page: 2 }));
  });

  it('stops early when GitHub returns fewer runs than requested', async () => {
    const listWorkflowRunsForRepo = vi.fn().mockResolvedValue({ data: { workflow_runs: createRunFixtures(2) } });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    const runs = await listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 });

    expect(runs).toHaveLength(2);
    expect(listWorkflowRunsForRepo).toHaveBeenCalledTimes(1);
  });

  it('retries once on a rate limit error, then succeeds', async () => {
    const rateLimitError = makeOctokitError(403, { 'x-ratelimit-remaining': '0', 'retry-after': '0' });
    const listWorkflowRunsForRepo = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ data: { workflow_runs: [createRunFixture(1)] } });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    const runs = await listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 });

    expect(runs).toHaveLength(1);
    expect(listWorkflowRunsForRepo).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries on a persistent rate limit', async () => {
    const rateLimitError = makeOctokitError(403, { 'x-ratelimit-remaining': '0', 'retry-after': '0' });
    const listWorkflowRunsForRepo = vi.fn().mockRejectedValue(rateLimitError);
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    await expect(listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 })).rejects.toThrow(
      /rate limit exceeded/,
    );
    expect(listWorkflowRunsForRepo).toHaveBeenCalledTimes(4);
  });

  it('raises a clear error for a missing repository (404)', async () => {
    const listWorkflowRunsForRepo = vi.fn().mockRejectedValue(makeOctokitError(404));
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    await expect(
      listWorkflowRuns(client, { owner: 'octocat', repo: 'missing', limit: 10 }),
    ).rejects.toThrow(/"octocat\/missing" was not found/);
  });

  it('raises a clear error for an unauthenticated request (401)', async () => {
    const listWorkflowRunsForRepo = vi.fn().mockRejectedValue(makeOctokitError(401));
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    await expect(
      listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 }),
    ).rejects.toThrow(/authentication failed/);
  });

  it('raises a clear error for insufficient permissions (403, not rate limited)', async () => {
    const listWorkflowRunsForRepo = vi.fn().mockRejectedValue(makeOctokitError(403, {}));
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo, listWorkflowRuns: vi.fn(), listJobsForWorkflowRun: vi.fn() } },
    };

    await expect(
      listWorkflowRuns(client, { owner: 'octocat', repo: 'hello-world', limit: 10 }),
    ).rejects.toThrow(/was denied/);
  });
});

describe('listJobsForRun', () => {
  it('maps jobs and steps with durations', async () => {
    const listJobsForWorkflowRun = vi.fn().mockResolvedValue({
      data: {
        jobs: [
          {
            id: 1,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-08-01T00:00:00Z',
            completed_at: '2026-08-01T00:02:00Z',
            steps: [
              {
                name: 'Checkout',
                number: 1,
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-08-01T00:00:00Z',
                completed_at: '2026-08-01T00:00:10Z',
              },
            ],
          },
        ],
      },
    });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
    };

    const jobs = await listJobsForRun(client, { owner: 'octocat', repo: 'hello-world', runId: 42 });

    expect(jobs).toEqual([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        startedAt: '2026-08-01T00:00:00Z',
        completedAt: '2026-08-01T00:02:00Z',
        durationMs: 2 * 60 * 1000,
        steps: [
          {
            name: 'Checkout',
            number: 1,
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-08-01T00:00:00Z',
            completedAt: '2026-08-01T00:00:10Z',
            durationMs: 10 * 1000,
          },
        ],
      },
    ]);
    expect(listJobsForWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'octocat', repo: 'hello-world', run_id: 42 }),
    );
  });

  it('leaves duration null for a step that has not completed', async () => {
    const listJobsForWorkflowRun = vi.fn().mockResolvedValue({
      data: {
        jobs: [
          {
            id: 1,
            name: 'build',
            status: 'in_progress',
            conclusion: null,
            started_at: '2026-08-01T00:00:00Z',
            completed_at: null,
            steps: [
              {
                name: 'Checkout',
                number: 1,
                status: 'in_progress',
                conclusion: null,
                started_at: '2026-08-01T00:00:00Z',
                completed_at: null,
              },
            ],
          },
        ],
      },
    });
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
    };

    const jobs = await listJobsForRun(client, { owner: 'octocat', repo: 'hello-world', runId: 42 });

    expect(jobs[0]?.durationMs).toBeNull();
    expect(jobs[0]?.steps[0]?.durationMs).toBeNull();
  });

  it('raises a clear error for a missing repository (404)', async () => {
    const listJobsForWorkflowRun = vi.fn().mockRejectedValue(makeOctokitError(404));
    const client: GitHubClient = {
      rest: { actions: { listWorkflowRunsForRepo: vi.fn(), listWorkflowRuns: vi.fn(), listJobsForWorkflowRun } },
    };

    await expect(
      listJobsForRun(client, { owner: 'octocat', repo: 'missing', runId: 42 }),
    ).rejects.toThrow(/"octocat\/missing" was not found/);
  });
});
