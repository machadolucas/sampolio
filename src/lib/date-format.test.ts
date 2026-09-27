import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatDayMonth } from './constants';

describe('shared date formatters (fi-FI)', () => {
  it('formats a bare YYYY-MM-DD as a local fi-FI date without a UTC day shift', () => {
    expect(formatDate('2026-09-01')).toBe('1.9.2026');
    expect(formatDate('2026-12-31')).toBe('31.12.2026');
  });

  it('formats Date objects and ISO timestamps', () => {
    expect(formatDate(new Date(2026, 8, 27))).toBe('27.9.2026');
    expect(formatDateTime(new Date(2026, 8, 27, 14, 5))).toBe('27.9.2026 14.05');
  });

  it('returns unparseable input unchanged', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDateTime('nope')).toBe('nope');
    expect(formatDayMonth('nope')).toBe('nope');
  });

  it('formats prose day+month with the app month names', () => {
    const d = new Date(2026, 2, 15);
    expect(formatDayMonth(d)).toBe('15 March');
    expect(formatDayMonth(d, { year: true })).toBe('15 March 2026');
    expect(formatDayMonth(d, { short: true, year: true })).toBe('15 Mar 2026');
  });
});
