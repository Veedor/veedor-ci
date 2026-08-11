import { describe, expect, it } from 'vitest';
import { resolveGitHubToken, resolvePullRequestNumber } from './action.js';

describe('resolvePullRequestNumber', () => {
  it('extracts the PR number from a pull_request event payload', () => {
    expect(resolvePullRequestNumber({ pull_request: { number: 42 } })).toBe(42);
  });

  it('returns undefined when there is no pull_request field', () => {
    expect(resolvePullRequestNumber({ ref: 'refs/heads/main' })).toBeUndefined();
  });

  it('returns undefined when the number is missing or not a number', () => {
    expect(resolvePullRequestNumber({ pull_request: {} })).toBeUndefined();
    expect(resolvePullRequestNumber({ pull_request: { number: '42' } })).toBeUndefined();
  });

  it('returns undefined for non-object payloads', () => {
    expect(resolvePullRequestNumber(null)).toBeUndefined();
    expect(resolvePullRequestNumber('not json')).toBeUndefined();
    expect(resolvePullRequestNumber(undefined)).toBeUndefined();
  });
});

describe('resolveGitHubToken', () => {
  it('uses the github-token input when it is set, even if GITHUB_TOKEN is also set', () => {
    expect(resolveGitHubToken('input-token', 'env-token')).toBe('input-token');
  });

  it('falls back to the GITHUB_TOKEN env var when the input is absent', () => {
    expect(resolveGitHubToken('', 'env-token')).toBe('env-token');
  });

  it('returns undefined when neither the input nor the env var is set', () => {
    expect(resolveGitHubToken('', undefined)).toBeUndefined();
  });
});
