export type OutputFormat = 'table' | 'json' | 'markdown';

export interface ScanOptions {
  repo: string;
  workflow?: string;
  limit: number;
  format: OutputFormat;
}

export interface RawScanOptions {
  repo: string;
  workflow?: string;
  limit: string;
  format: string;
}
