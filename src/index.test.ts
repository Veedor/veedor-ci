import { describe, expect, it } from 'vitest';
import { buildScanOptions, isValidFormat, isValidRepo, parseLimit } from './index.js';

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
