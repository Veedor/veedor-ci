import { describe, expect, it, vi } from 'vitest';
import { REPORT_COMMENT_MARKER, findReportComment, upsertPrComment, type IssueCommentClient } from './pr-comment.js';

function makeClient(overrides: Partial<IssueCommentClient['rest']['issues']> = {}): IssueCommentClient {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockResolvedValue({ data: {} }),
        updateComment: vi.fn().mockResolvedValue({ data: {} }),
        ...overrides,
      },
    },
  };
}

describe('findReportComment', () => {
  it('returns undefined when no comment has the marker', async () => {
    const client = makeClient({
      listComments: vi.fn().mockResolvedValue({
        data: [
          { id: 1, body: 'just a regular comment' },
          { id: 2, body: null },
        ],
      }),
    });

    const id = await findReportComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42 });
    expect(id).toBeUndefined();
  });

  it('finds the marked comment among others', async () => {
    const client = makeClient({
      listComments: vi.fn().mockResolvedValue({
        data: [
          { id: 1, body: 'unrelated' },
          { id: 2, body: `${REPORT_COMMENT_MARKER}\nold report` },
        ],
      }),
    });

    const id = await findReportComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42 });
    expect(id).toBe(2);
  });

  it('paginates until it finds the marked comment', async () => {
    const listComments = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'noise' })) })
      .mockResolvedValueOnce({ data: [{ id: 200, body: `${REPORT_COMMENT_MARKER}\nreport` }] });
    const client = makeClient({ listComments });

    const id = await findReportComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42 });

    expect(id).toBe(200);
    expect(listComments).toHaveBeenCalledTimes(2);
    expect(listComments).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
  });

  it('stops once a short page is returned with no match', async () => {
    const listComments = vi.fn().mockResolvedValue({ data: [{ id: 1, body: 'noise' }] });
    const client = makeClient({ listComments });

    const id = await findReportComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42 });

    expect(id).toBeUndefined();
    expect(listComments).toHaveBeenCalledTimes(1);
  });
});

describe('upsertPrComment', () => {
  it('creates a new comment when none exists yet', async () => {
    const createComment = vi.fn().mockResolvedValue({ data: {} });
    const client = makeClient({ createComment });

    await upsertPrComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42, body: 'report body' });

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octocat',
        repo: 'hello-world',
        issue_number: 42,
        body: `${REPORT_COMMENT_MARKER}\nreport body`,
      }),
    );
  });

  it('updates the existing report comment instead of creating a new one', async () => {
    const listComments = vi.fn().mockResolvedValue({
      data: [{ id: 99, body: `${REPORT_COMMENT_MARKER}\nold report` }],
    });
    const createComment = vi.fn();
    const updateComment = vi.fn().mockResolvedValue({ data: {} });
    const client = makeClient({ listComments, createComment, updateComment });

    await upsertPrComment(client, { owner: 'octocat', repo: 'hello-world', issueNumber: 42, body: 'new report body' });

    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octocat',
        repo: 'hello-world',
        comment_id: 99,
        body: `${REPORT_COMMENT_MARKER}\nnew report body`,
      }),
    );
  });
});
