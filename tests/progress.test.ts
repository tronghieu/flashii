import { describe, expect, it } from 'vitest';
import { computeStreak, daysLeft, targetPerDay } from '../src/core/progress.js';

describe('computeStreak', () => {
  it('returns 0/0 for an empty day list', () => {
    expect(computeStreak([], '2026-04-21')).toEqual({ current: 0, longest: 0 });
  });

  it('today-only → current 1, longest 1', () => {
    expect(computeStreak(['2026-04-21'], '2026-04-21')).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('today missing → current 0, longest spans prior run', () => {
    const days = ['2026-04-18', '2026-04-19', '2026-04-20'];
    expect(computeStreak(days, '2026-04-21')).toEqual({
      current: 0,
      longest: 3,
    });
  });

  it('gap breaks current streak; longest captures the longer pre-gap run', () => {
    // Longest run = Apr 10,11,12,13 (4 days); current = Apr 20,21 (2 days)
    const days = [
      '2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13',
      '2026-04-20', '2026-04-21',
    ];
    expect(computeStreak(days, '2026-04-21')).toEqual({
      current: 2,
      longest: 4,
    });
  });

  it('longest can span multiple gaps', () => {
    // Runs: [Apr 1,2] (2), [Apr 5,6,7,8,9] (5), [Apr 21] (1 — today)
    const days = [
      '2026-04-01', '2026-04-02',
      '2026-04-05', '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09',
      '2026-04-21',
    ];
    expect(computeStreak(days, '2026-04-21')).toEqual({
      current: 1,
      longest: 5,
    });
  });

  it('walks back from today across month boundary', () => {
    const days = ['2026-03-30', '2026-03-31', '2026-04-01'];
    expect(computeStreak(days, '2026-04-01')).toEqual({
      current: 3,
      longest: 3,
    });
  });
});

describe('daysLeft', () => {
  it('null deadline → null', () => {
    expect(daysLeft(null, new Date('2026-04-21T00:00:00Z'))).toBeNull();
  });

  it('unparseable deadline → null', () => {
    expect(daysLeft('not-a-date', new Date('2026-04-21T00:00:00Z'))).toBeNull();
  });

  it('past deadline → 0 (clamped)', () => {
    expect(
      daysLeft('2026-04-01', new Date('2026-04-21T00:00:00Z')),
    ).toBe(0);
  });

  it('future deadline → ceil days difference', () => {
    // 2026-07-21 - 2026-04-21 = 91 days
    expect(
      daysLeft('2026-07-21', new Date('2026-04-21T00:00:00Z')),
    ).toBe(91);
  });

  it('same-day deadline → 0', () => {
    expect(
      daysLeft('2026-04-21', new Date('2026-04-21T00:00:00Z')),
    ).toBe(0);
  });
});

describe('targetPerDay', () => {
  it('null chunks → null', () => {
    expect(targetPerDay(null, 0, 30)).toBeNull();
  });

  it('null daysLeft → null', () => {
    expect(targetPerDay(1500, 340, null)).toBeNull();
  });

  it('zero daysLeft → null', () => {
    expect(targetPerDay(1500, 340, 0)).toBeNull();
  });

  it('normal case ceils (chunks - created) / daysLeft', () => {
    // (1500 - 340) / 91 = 12.747… → 13
    expect(targetPerDay(1500, 340, 91)).toBe(13);
  });

  it('clamps at zero when already past target', () => {
    expect(targetPerDay(100, 150, 30)).toBe(0);
  });
});
