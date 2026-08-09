import type { Octokit } from '@octokit/rest';

/**
 * Narrow structural type (mirrors GitHubClient in github.ts) so tests can
 * pass a plain mock instead of constructing a real Octokit instance.
 */
export interface IssueCommentClient {
  rest: {
    issues: {
      listComments: Octokit['rest']['issues']['listComments'];
      createComment: Octokit['rest']['issues']['createComment'];
      updateComment: Octokit['rest']['issues']['updateComment'];
    };
  };
}

export const REPORT_COMMENT_MARKER = '<!-- veedor-ci:report -->';

const PER_PAGE = 100;

function isReportComment(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.includes(REPORT_COMMENT_MARKER);
}

export interface FindReportCommentParams {
  owner: string;
  repo: string;
  issueNumber: number;
}

/**
 * Finds this action's previous report comment on the PR, if any, by
 * looking for a hidden marker instead of matching on comment author or
 * exact text — avoids duplicating a comment on every run.
 */
export async function findReportComment(
  client: IssueCommentClient,
  params: FindReportCommentParams,
): Promise<number | undefined> {
  const { owner, repo, issueNumber } = params;
  let page = 1;

  for (;;) {
    const response = await client.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: PER_PAGE,
      page,
    });

    const match = response.data.find((comment) => isReportComment(comment.body));
    if (match) {
      return match.id;
    }
    if (response.data.length < PER_PAGE) {
      return undefined;
    }
    page += 1;
  }
}

export interface UpsertPrCommentParams {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

/**
 * Publishes the report as a PR comment, editing the previous report
 * comment in place (if one exists) instead of posting a new one each run.
 */
export async function upsertPrComment(client: IssueCommentClient, params: UpsertPrCommentParams): Promise<void> {
  const { owner, repo, issueNumber, body } = params;
  const markedBody = `${REPORT_COMMENT_MARKER}\n${body}`;

  const existingCommentId = await findReportComment(client, { owner, repo, issueNumber });

  if (existingCommentId !== undefined) {
    await client.rest.issues.updateComment({ owner, repo, comment_id: existingCommentId, body: markedBody });
  } else {
    await client.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body: markedBody });
  }
}
