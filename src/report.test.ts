import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, renderReport, renderTable } from './report.js';
import type { ScanReport } from './types.js';

const REPORT_WITH_JOBS: ScanReport = {
  repo: 'octocat/hello-world',
  workflow: 'ci.yml',
  generatedAt: '2026-08-09T12:00:00.000Z',
  runsAnalyzed: 200,
  dateRange: { from: '2026-07-10T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' },
  retryWindowMinutes: 60,
  jobs: [
    {
      jobName: 'unit-tests',
      runnerOs: 'linux',
      confidence: 'confirmed',
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
      confidence: 'confirmed',
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
      confidence: 'confirmed',
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
      confidence: 'likely',
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
      confidence: 'likely',
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
      confidence: 'likely',
      flakyRuns: 1,
      sampleSize: 30,
      flakinessRate: 0.0333,
      wastedMinutes: 1,
      pricePerMinuteUsd: 0.008,
      costUsd: 0.01,
    },
  ],
  confirmed: { wastedMinutes: 89.5, costUsd: 2.08 },
  likely: { wastedMinutes: 43.1, costUsd: 0.11 },
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
  retryWindowMinutes: 60,
  jobs: [],
  confirmed: { wastedMinutes: 0, costUsd: 0 },
  likely: { wastedMinutes: 0, costUsd: 0 },
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

  it('separates confirmed and likely rows into their own sections with their own totals', () => {
    const output = renderTable(REPORT_WITH_JOBS);
    const confirmedIndex = output.indexOf('Confirmed flaky');
    const likelyIndex = output.indexOf('Likely flaky');

    expect(confirmedIndex).toBeGreaterThanOrEqual(0);
    expect(likelyIndex).toBeGreaterThan(confirmedIndex);
    expect(output).toContain('unit-tests');
    expect(output.indexOf('unit-tests')).toBeLessThan(likelyIndex);
    expect(output).toContain('self-hosted-load-tests');
    expect(output.indexOf('self-hosted-load-tests')).toBeGreaterThan(likelyIndex);
    expect(output).toContain('Confirmed flaky total: 89.50 min — $2.08');
    expect(output).toContain('Likely flaky total: 43.10 min — $0.11');
    expect(output).toContain('Combined total wasted: 132.60 min — $2.19');
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
  it('matches the snapshot for a report with flaky jobs, capped at the top 5 per category', () => {
    expect(renderMarkdown(REPORT_WITH_JOBS)).toMatchSnapshot();
  });

  it('matches the snapshot for a report with no flaky jobs', () => {
    expect(renderMarkdown(EMPTY_REPORT)).toMatchSnapshot();
  });

  it('explains what each confidence level means', () => {
    const output = renderMarkdown(REPORT_WITH_JOBS);
    expect(output).toContain('Confidence levels');
    expect(output).toMatch(/Confirmed.*same commit was retried and passed/);
    expect(output).toMatch(/Likely.*next.*commit pushed to the same branch/);
    expect(output).toContain('60 min');
  });

  it('shows separate sections and totals for each category, plus a combined total', () => {
    const output = renderMarkdown(REPORT_WITH_JOBS);
    expect(output).toContain('### Confirmed flaky');
    expect(output).toContain('### Likely flaky');
    expect(output).toContain('**Combined: $2.19** (132.60 min) across both categories.');
  });
});

describe('renderReport', () => {
  it('dispatches to the format-specific renderer', () => {
    expect(renderReport(REPORT_WITH_JOBS, 'table')).toBe(renderTable(REPORT_WITH_JOBS));
    expect(renderReport(REPORT_WITH_JOBS, 'json')).toBe(renderJson(REPORT_WITH_JOBS));
    expect(renderReport(REPORT_WITH_JOBS, 'markdown')).toBe(renderMarkdown(REPORT_WITH_JOBS));
  });
});
