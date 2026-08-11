import { Octokit } from '@octokit/rest';
import type { JobStepSummary, JobSummary, WorkflowRunSummary } from './types.js';

/**
 * Narrow structural type instead of the full Octokit surface, so tests can
 * pass a plain mock without constructing a real Octokit instance.
 */
export interface GitHubClient {
  rest: {
    actions: {
      listWorkflowRunsForRepo: Octokit['rest']['actions']['listWorkflowRunsForRepo'];
      listWorkflowRuns: Octokit['rest']['actions']['listWorkflowRuns'];
      listJobsForWorkflowRun: Octokit['rest']['actions']['listJobsForWorkflowRun'];
    };
  };
}

export interface CreateOctokitOptions {
  token?: string;
}

export function createOctokitFromEnv(options: CreateOctokitOptions = {}): Octokit {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN environment variable is not set. Set it to a GitHub token with "actions:read" access to the target repository.',
    );
  }
  return new Octokit({ auth: token });
}

interface OctokitErrorLike {
  status: number;
  message: string;
  response?: {
    headers?: Record<string, string | undefined>;
  };
}

function isOctokitErrorLike(error: unknown): error is OctokitErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  );
}

function isRateLimitError(error: unknown): error is OctokitErrorLike {
  if (!isOctokitErrorLike(error)) {
    return false;
  }
  if (error.status === 429) {
    return true;
  }
  if (error.status === 403) {
    return error.response?.headers?.['x-ratelimit-remaining'] === '0';
  }
  return false;
}

function getRetryDelayMs(error: OctokitErrorLike, attempt: number): number {
  const retryAfter = error.response?.headers?.['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const resetAt = error.response?.headers?.['x-ratelimit-reset'];
  if (resetAt !== undefined) {
    const resetMs = Number(resetAt) * 1000 - Date.now();
    if (Number.isFinite(resetMs) && resetMs > 0) {
      return resetMs;
    }
  }

  return Math.min(2 ** attempt * 500, 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_MAX_RETRIES = 3;

async function withRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = DEFAULT_MAX_RETRIES): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries || !isRateLimitError(error)) {
        throw error;
      }
      await sleep(getRetryDelayMs(error, attempt));
    }
  }
}

function translateError(error: unknown, repo: string): Error {
  if (isOctokitErrorLike(error)) {
    switch (error.status) {
      case 401:
        return new Error('GitHub authentication failed. Check that GITHUB_TOKEN is set to a valid, non-expired token.');
      case 404:
        return new Error(`Repository "${repo}" was not found, or GITHUB_TOKEN does not have access to it.`);
      case 403:
        if (error.response?.headers?.['x-ratelimit-remaining'] === '0') {
          return new Error(
            'GitHub API rate limit exceeded and retries were exhausted. Wait a few minutes and try again, or use a token with a higher rate limit.',
          );
        }
        return new Error(
          `Access to "${repo}" was denied. GITHUB_TOKEN may lack the required permissions (e.g. "actions:read").`,
        );
      case 429:
        return new Error(
          'GitHub API secondary rate limit was hit and retries were exhausted. Wait a few minutes and try again.',
        );
      default:
        return new Error(`GitHub API request failed with status ${error.status}: ${error.message}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function toWorkflowRunSummary(run: {
  id: number;
  name?: string | null;
  head_sha: string;
  head_branch?: string | null;
  run_attempt?: number;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  head_commit?: { author?: { email?: string | null; name?: string | null } | null } | null;
  actor?: { login?: string | null } | null;
}): WorkflowRunSummary {
  const createdAt = run.created_at;
  const updatedAt = run.updated_at;
  return {
    id: run.id,
    name: run.name ?? '',
    headSha: run.head_sha,
    headBranch: run.head_branch ?? null,
    authorId: run.head_commit?.author?.email ?? run.actor?.login ?? null,
    runAttempt: run.run_attempt ?? 1,
    conclusion: run.conclusion,
    createdAt,
    updatedAt,
    durationMs: Math.max(0, new Date(updatedAt).getTime() - new Date(createdAt).getTime()),
  };
}

function durationBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) {
    return null;
  }
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function toJobStepSummary(step: {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}): JobStepSummary {
  return {
    name: step.name,
    number: step.number,
    status: step.status,
    conclusion: step.conclusion,
    startedAt: step.started_at ?? null,
    completedAt: step.completed_at ?? null,
    durationMs: durationBetween(step.started_at, step.completed_at),
  };
}

function toJobSummary(job: {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  run_attempt?: number;
  labels?: string[];
  steps?: Array<{
    name: string;
    number: number;
    status: string;
    conclusion: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  }>;
}): JobSummary {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at,
    durationMs: durationBetween(job.started_at, job.completed_at),
    runAttempt: job.run_attempt ?? 1,
    labels: job.labels ?? [],
    steps: (job.steps ?? []).map(toJobStepSummary),
  };
}

const PER_PAGE = 100;

export interface ListWorkflowRunsParams {
  owner: string;
  repo: string;
  limit: number;
  workflow?: string;
}

export async function listWorkflowRuns(
  client: GitHubClient,
  params: ListWorkflowRunsParams,
): Promise<WorkflowRunSummary[]> {
  const { owner, repo, limit, workflow } = params;
  const repoSlug = `${owner}/${repo}`;
  const runs: WorkflowRunSummary[] = [];

  try {
    let page = 1;
    while (runs.length < limit) {
      const perPage = Math.min(PER_PAGE, limit - runs.length);

      const response = await withRateLimitRetry(() =>
        workflow
          ? client.rest.actions.listWorkflowRuns({
              owner,
              repo,
              workflow_id: workflow,
              per_page: perPage,
              page,
            })
          : client.rest.actions.listWorkflowRunsForRepo({
              owner,
              repo,
              per_page: perPage,
              page,
            }),
      );

      const pageRuns = response.data.workflow_runs;
      for (const run of pageRuns) {
        runs.push(toWorkflowRunSummary(run));
        if (runs.length >= limit) {
          break;
        }
      }

      if (pageRuns.length < perPage) {
        break;
      }
      page += 1;
    }
  } catch (error) {
    throw translateError(error, repoSlug);
  }

  return runs;
}

export interface ListJobsForRunParams {
  owner: string;
  repo: string;
  runId: number;
  /** Include jobs from every attempt of the run, not just the latest. */
  allAttempts?: boolean;
}

export async function listJobsForRun(client: GitHubClient, params: ListJobsForRunParams): Promise<JobSummary[]> {
  const { owner, repo, runId, allAttempts = false } = params;
  const repoSlug = `${owner}/${repo}`;
  const jobs: JobSummary[] = [];

  try {
    let page = 1;
    for (;;) {
      const response = await withRateLimitRetry(() =>
        client.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: runId,
          filter: allAttempts ? 'all' : 'latest',
          per_page: PER_PAGE,
          page,
        }),
      );

      for (const job of response.data.jobs) {
        jobs.push(toJobSummary(job));
      }

      if (response.data.jobs.length < PER_PAGE) {
        break;
      }
      page += 1;
    }
  } catch (error) {
    throw translateError(error, repoSlug);
  }

  return jobs;
}
