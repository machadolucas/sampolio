// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import type { SplitInsights } from '@/lib/split-insights';

// Capture the ECharts option instead of rendering a canvas.
const captured: { option?: Record<string, unknown> } = {};
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    captured.option = props.option;
    return null;
  },
}));

import { SplitSpendChart } from './split-spend-chart';

const XSS = '<img src=x onerror="alert(1)">';

const insights: SplitInsights = {
  months: ['2026-08'],
  groups: [{ id: 'g1', name: 'Flat', currency: 'EUR' }],
  members: [
    { userId: 'alex', name: 'Alex' },
    { userId: 'sam', name: XSS },
  ],
  currencies: ['EUR'],
  spendByGroup: { '2026-08': { g1: 3000 } },
  paidByMember: { '2026-08': { alex: 1000, sam: 2000 } },
  spendByCategory: { '2026-08': { [XSS]: 3000 } },
  categories: [XSS],
  viewerNetByMonth: { '2026-08': 0 },
  viewerNetBaseline: 0,
};

type Formatter = (params: Array<Record<string, unknown>>) => string;

function tooltipHtml(seriesName: string): string {
  const tooltip = captured.option?.tooltip as { formatter: Formatter };
  return tooltip.formatter([
    { axisValue: 'Aug 2026', seriesName, value: 2000, marker: '', dataIndex: 0 },
  ]);
}

describe('SplitSpendChart tooltip', () => {
  it.each(['member', 'category'] as const)('escapes user-controlled series names (%s mode)', (mode) => {
    renderWithProviders(<SplitSpendChart insights={insights} mode={mode} currency="EUR" />);
    const html = tooltipHtml(XSS);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});
