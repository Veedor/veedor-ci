import { describe, expect, it } from 'vitest';
import { resolvePullRequestNumber } from './action.js';

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
