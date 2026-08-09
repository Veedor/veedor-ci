import type { OutputFormat, RawScanOptions, ScanOptions } from './types.js';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['table', 'json', 'markdown'];

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo);
}

export function isValidFormat(format: string): format is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(format);
}

export function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: "${value}". Must be a positive integer.`);
  }
  return parsed;
}

export function buildScanOptions(raw: RawScanOptions): ScanOptions {
  if (!isValidRepo(raw.repo)) {
    throw new Error(`Invalid repo: "${raw.repo}". Expected format "owner/name".`);
  }
  if (!isValidFormat(raw.format)) {
    throw new Error(`Invalid format: "${raw.format}". Expected one of ${OUTPUT_FORMATS.join(', ')}.`);
  }

  return {
    repo: raw.repo,
    workflow: raw.workflow,
    limit: parseLimit(raw.limit),
    format: raw.format,
  };
}

export type { OutputFormat, RawScanOptions, ScanOptions };
