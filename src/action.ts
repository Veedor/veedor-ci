import { readFileSync } from 'node:fs';
import * as core from '@actions/core';
import { buildScanOptions, runScan } from './index.js';
import { createOctokitFromEnv } from './github.js';
import { renderMarkdown, renderReport } from './report.js';
import { upsertPrComment } from './pr-comment.js';

const PR_EVENT_NAMES = new Set(['pull_request', 'pull_request_target']);

export function resolvePullRequestNumber(eventPayload: unknown): number | undefined {
  if (typeof eventPayload !== 'object' || eventPayload === null) {
    return undefined;
  }
  const pullRequest = (eventPayload as { pull_request?: { number?: unknown } }).pull_request;
  return typeof pullRequest?.number === 'number' ? pullRequest.number : undefined;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: "${repo}". Expected "owner/name".`);
  }
  return { owner, repo: name };
}

export async function run(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is not set. This action must run inside a GitHub Actions workflow.');
  }

  const options = buildScanOptions({
    repo,
    workflow: core.getInput('workflow') || undefined,
    limit: core.getInput('limit') || '200',
    format: core.getInput('format') || 'table',
  });

  const client = createOctokitFromEnv();
  const report = await runScan(options, { client });
  core.info(renderReport(report, options.format));

  const commentOnPr = core.getBooleanInput('comment-on-pr');
  if (!commentOnPr) {
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!eventName || !PR_EVENT_NAMES.has(eventName)) {
    core.info(
      `comment-on-pr is enabled, but this run was triggered by "${eventName ?? 'an unknown event'}", not a pull request; skipping the comment.`,
    );
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is not set; cannot determine the pull request number.');
  }

  const eventPayload = JSON.parse(readFileSync(eventPath, 'utf8')) as unknown;
  const issueNumber = resolvePullRequestNumber(eventPayload);
  if (issueNumber === undefined) {
    throw new Error('Could not determine the pull request number from the event payload.');
  }

  const { owner, repo: repoName } = splitRepo(repo);
  await upsertPrComment(client, { owner, repo: repoName, issueNumber, body: renderMarkdown(report) });
  core.info(`Posted/updated the report comment on pull request #${issueNumber}.`);
}
