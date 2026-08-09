import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_PER_MINUTE_USD,
  buildCostReport,
  computeJobCosts,
  parsePricePerMinuteFlag,
  projectMonthlyCost,
  resolvePriceTable,
  sumCostUsd,
} from './cost.js';
import type { WastedJobMinutes } from './types.js';

describe('DEFAULT_PRICE_PER_MINUTE_USD', () => {
  it('matches the published per-minute rates', () => {
    expect(DEFAULT_PRICE_PER_MINUTE_USD).toEqual({
      linux: 0.008,
      windows: 0.016,
      macos: 0.08,
      'self-hosted': 0.002,
    });
  });
});

describe('resolvePriceTable', () => {
  it('returns the defaults when no overrides are given', () => {
    expect(resolvePriceTable()).toEqual(DEFAULT_PRICE_PER_MINUTE_USD);
  });

  it('overrides only the specified runner types', () => {
    const table = resolvePriceTable({ linux: 0.01 });
    expect(table).toEqual({ ...DEFAULT_PRICE_PER_MINUTE_USD, linux: 0.01 });
  });

  it('throws on a negative override', () => {
    expect(() => resolvePriceTable({ macos: -1 })).toThrow(/non-negative/);
  });

  it('throws on a non-finite override', () => {
    expect(() => resolvePriceTable({ windows: Number.NaN })).toThrow(/non-negative/);
  });
});

describe('parsePricePerMinuteFlag', () => {
  it('applies a flat rate to every runner type', () => {
    expect(parsePricePerMinuteFlag('0.01')).toEqual({
      linux: 0.01,
      windows: 0.01,
      macos: 0.01,
      'self-hosted': 0.01,
    });
  });

  it('parses per-os overrides', () => {
    expect(parsePricePerMinuteFlag('linux=0.01,macos=0.09')).toEqual({
      linux: 0.01,
      macos: 0.09,
    });
  });

  it('trims whitespace around pairs', () => {
    expect(parsePricePerMinuteFlag(' linux = 0.01 , windows = 0.02 ')).toEqual({
      linux: 0.01,
      windows: 0.02,
    });
  });

  it('throws on an empty value', () => {
    expect(() => parsePricePerMinuteFlag('  ')).toThrow(/expected a number/i);
  });

  it('throws on a negative flat rate', () => {
    expect(() => parsePricePerMinuteFlag('-1')).toThrow(/non-negative/);
  });

  it('throws on an unknown runner os', () => {
    expect(() => parsePricePerMinuteFlag('solaris=0.01')).toThrow(/Invalid --price-per-minute runner/);
  });

  it('throws on a malformed pair', () => {
    expect(() => parsePricePerMinuteFlag('=0.01')).toThrow(/Invalid --price-per-minute entry/);
  });

  it('throws on a non-numeric price', () => {
    expect(() => parsePricePerMinuteFlag('linux=abc')).toThrow(/Must be a non-negative number/);
  });
});

describe('computeJobCosts', () => {
  it('computes cost per job using the price table', () => {
    const jobs: WastedJobMinutes[] = [
      { jobId: 1, jobName: 'test-linux', runnerOs: 'linux', wastedMinutes: 10 },
      { jobId: 2, jobName: 'test-windows', runnerOs: 'windows', wastedMinutes: 5 },
      { jobId: 3, jobName: 'test-macos', runnerOs: 'macos', wastedMinutes: 2 },
      { jobId: 4, jobName: 'test-self-hosted', runnerOs: 'self-hosted', wastedMinutes: 100 },
    ];

    const costs = computeJobCosts(jobs, DEFAULT_PRICE_PER_MINUTE_USD);

    expect(costs).toEqual([
      { jobId: 1, jobName: 'test-linux', runnerOs: 'linux', wastedMinutes: 10, pricePerMinuteUsd: 0.008, costUsd: 0.08 },
      { jobId: 2, jobName: 'test-windows', runnerOs: 'windows', wastedMinutes: 5, pricePerMinuteUsd: 0.016, costUsd: 0.08 },
      { jobId: 3, jobName: 'test-macos', runnerOs: 'macos', wastedMinutes: 2, pricePerMinuteUsd: 0.08, costUsd: 0.16 },
      {
        jobId: 4,
        jobName: 'test-self-hosted',
        runnerOs: 'self-hosted',
        wastedMinutes: 100,
        pricePerMinuteUsd: 0.002,
        costUsd: 0.2,
      },
    ]);
  });

  it('uses an overridden price table', () => {
    const jobs: WastedJobMinutes[] = [{ jobId: 1, jobName: 'test', runnerOs: 'linux', wastedMinutes: 10 }];
    const costs = computeJobCosts(jobs, resolvePriceTable({ linux: 0.5 }));
    expect(costs[0]?.costUsd).toBe(5);
  });

  it('returns an empty array for no wasted jobs', () => {
    expect(computeJobCosts([], DEFAULT_PRICE_PER_MINUTE_USD)).toEqual([]);
  });
});

describe('sumCostUsd', () => {
  it('sums job costs', () => {
    const jobs = computeJobCosts(
      [
        { jobId: 1, jobName: 'a', runnerOs: 'linux', wastedMinutes: 10 },
        { jobId: 2, jobName: 'b', runnerOs: 'macos', wastedMinutes: 2 },
      ],
      DEFAULT_PRICE_PER_MINUTE_USD,
    );
    expect(sumCostUsd(jobs)).toBe(0.24);
  });

  it('returns 0 for an empty list', () => {
    expect(sumCostUsd([])).toBe(0);
  });
});

describe('projectMonthlyCost', () => {
  it('extrapolates a simple monthly projection from the analyzed range', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-11T00:00:00Z');

    const projection = projectMonthlyCost(100, { from, to });

    expect(projection).toEqual({
      analyzedDays: 10,
      totalCostUsd: 100,
      projectedMonthlyCostUsd: 300,
    });
  });

  it('respects a custom days-per-month', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-02T00:00:00Z');

    const projection = projectMonthlyCost(10, { from, to }, 31);
    expect(projection.projectedMonthlyCostUsd).toBe(310);
  });

  it('clamps a zero-width range to one day', () => {
    const same = new Date('2026-08-01T00:00:00Z');
    const projection = projectMonthlyCost(10, { from: same, to: same });
    expect(projection.analyzedDays).toBe(1);
    expect(projection.projectedMonthlyCostUsd).toBe(300);
  });

  it('throws when "to" is before "from"', () => {
    const from = new Date('2026-08-11T00:00:00Z');
    const to = new Date('2026-08-01T00:00:00Z');
    expect(() => projectMonthlyCost(10, { from, to })).toThrow(/Invalid date range/);
  });
});

describe('buildCostReport', () => {
  it('combines per-job costs, total, and projection', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-06T00:00:00Z');
    const wastedJobs: WastedJobMinutes[] = [
      { jobId: 1, jobName: 'flaky-unit-tests', runnerOs: 'linux', wastedMinutes: 25 },
      { jobId: 2, jobName: 'flaky-e2e', runnerOs: 'macos', wastedMinutes: 4 },
    ];

    const report = buildCostReport({ wastedJobs, dateRange: { from, to } });

    expect(report.jobs).toHaveLength(2);
    expect(report.totalCostUsd).toBe(roundedSum(report.jobs));
    expect(report.projection.analyzedDays).toBe(5);
    expect(report.projection.totalCostUsd).toBe(report.totalCostUsd);
    expect(report.projection.projectedMonthlyCostUsd).toBeCloseTo((report.totalCostUsd / 5) * 30, 4);
  });

  it('applies price overrides end to end', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-02T00:00:00Z');
    const wastedJobs: WastedJobMinutes[] = [{ jobId: 1, jobName: 'job', runnerOs: 'linux', wastedMinutes: 10 }];

    const report = buildCostReport({
      wastedJobs,
      dateRange: { from, to },
      priceOverrides: { linux: 1 },
    });

    expect(report.jobs[0]?.pricePerMinuteUsd).toBe(1);
    expect(report.jobs[0]?.costUsd).toBe(10);
    expect(report.totalCostUsd).toBe(10);
  });

  function roundedSum(jobs: { costUsd: number }[]): number {
    return Math.round(jobs.reduce((sum, job) => sum + job.costUsd, 0) * 10000) / 10000;
  }
});
