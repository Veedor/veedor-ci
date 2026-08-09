import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, renderReport, renderTable } from './report.js';
import type { ScanReport } from './types.js';

const REPORT_WITH_JOBS: ScanReport = {
  repo: 'octocat/hello-world',
  workflow: 'ci.yml',
  generatedAt: '2026-08-09T12:00:00.000Z',
  runsAnalyzed: 200,
  dateRange: { from: '2026-07-10T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' },
  jobs: [
    {
      jobName: 'unit-tests',
      runnerOs: 'linux',
      flakyRuns: 12,
      sampleSize: 20,
      flakinessRate: 0.6,
      wastedMinutes: 62.5,
      pricePerMinuteUsd: 0.008,
      costUsd: 0.5,
    },
    {
      jobName: 'e2e-safari',
      runnerOs: 'macos',
      flakyRuns: 3,
      sampleSize: 10,
      flakinessRate: 0.3,
      wastedMinutes: 18,
      pricePerMinuteUsd: 0.08,
      costUsd: 1.44,
    },
    {
      jobName: 'windows-integration',
      runnerOs: 'windows',
      flakyRuns: 2,
      sampleSize: 15,
      flakinessRate: 0.1333,
      wastedMinutes: 9,
      pricePerMinuteUsd: 0.016,
      costUsd: 0.14,
    },
    {
      jobName: 'self-hosted-load-tests',
      runnerOs: 'self-hosted',
      flakyRuns: 1,
      sampleSize: 4,
      flakinessRate: 0.25,
      wastedMinutes: 40,
      pricePerMinuteUsd: 0.002,
      costUsd: 0.08,
    },
    {
      jobName: 'lint',
      runnerOs: 'linux',
      flakyRuns: 1,
      sampleSize: 30,
      flakinessRate: 0.0333,
      wastedMinutes: 2.1,
      pricePerMinuteUsd: 0.008,
      costUsd: 0.02,
    },
    {
      jobName: 'docs-build',
      runnerOs: 'linux',
      flakyRuns: 1,
      sampleSize: 30,
      flakinessRate: 0.0333,
      wastedMinutes: 1,
      pricePerMinuteUsd: 0.008,
      costUsd: 0.01,
    },
  ],
  totalWastedMinutes: 132.6,
  totalCostUsd: 2.19,
  analyzedDays: 30,
  projectedMonthlyCostUsd: 2.19,
};

const EMPTY_REPORT: ScanReport = {
  repo: 'octocat/quiet-repo',
  generatedAt: '2026-08-09T12:00:00.000Z',
  runsAnalyzed: 5,
  dateRange: { from: '2026-08-08T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' },
  jobs: [],
  totalWastedMinutes: 0,
  totalCostUsd: 0,
  analyzedDays: 1,
  projectedMonthlyCostUsd: 0,
};

describe('renderTable', () => {
  it('matches the snapshot for a report with flaky jobs', () => {
    expect(renderTable(REPORT_WITH_JOBS)).toMatchSnapshot();
  });

  it('matches the snapshot for a report with no flaky jobs', () => {
    expect(renderTable(EMPTY_REPORT)).toMatchSnapshot();
  });
});

describe('renderJson', () => {
  it('matches the snapshot for a report with flaky jobs', () => {
    expect(renderJson(REPORT_WITH_JOBS)).toMatchSnapshot();
  });

  it('matches the snapshot for a report with no flaky jobs', () => {
    expect(renderJson(EMPTY_REPORT)).toMatchSnapshot();
  });

  it('is valid, round-trippable JSON', () => {
    expect(JSON.parse(renderJson(REPORT_WITH_JOBS))).toEqual(REPORT_WITH_JOBS);
  });
});

describe('renderMarkdown', () => {
  it('matches the snapshot for a report with flaky jobs, capped at the top 5', () => {
    expect(renderMarkdown(REPORT_WITH_JOBS)).toMatchSnapshot();
  });

  it('matches the snapshot for a report with no flaky jobs', () => {
    expect(renderMarkdown(EMPTY_REPORT)).toMatchSnapshot();
  });
});

describe('renderReport', () => {
  it('dispatches to the format-specific renderer', () => {
    expect(renderReport(REPORT_WITH_JOBS, 'table')).toBe(renderTable(REPORT_WITH_JOBS));
    expect(renderReport(REPORT_WITH_JOBS, 'json')).toBe(renderJson(REPORT_WITH_JOBS));
    expect(renderReport(REPORT_WITH_JOBS, 'markdown')).toBe(renderMarkdown(REPORT_WITH_JOBS));
  });
});
