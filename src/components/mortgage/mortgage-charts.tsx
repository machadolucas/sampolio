'use client';

/**
 * Mortgage visualizations (Chart.js via PrimeReact). Each chart takes an already
 * time-windowed slice of the projection and renders with plain-language titles
 * and tooltips. Colors follow the app convention: liability red, equity/asset
 * green, "you" blue, partner purple, neutral gray.
 */

import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonthShort, formatRate } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { SharedMortgage, MortgageProjectionMonth, Currency } from '@/types';

const RED = 'rgb(239, 68, 68)';
const GREEN = 'rgb(34, 197, 94)';
const BLUE = 'rgb(59, 130, 246)';
const PURPLE = 'rgb(168, 85, 247)';
const AMBER = 'rgb(245, 158, 11)';
const GRAY = 'rgb(148, 163, 184)';
const MEMBER_COLORS = [BLUE, PURPLE, AMBER, GREEN];

function EmptyState({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">{label}</div>;
}

/** Index of the current month within a month slice (−1 if not in range). */
function todayIndexOf(months: MortgageProjectionMonth[]): number {
  const cur = getCurrentYearMonth();
  const exact = months.findIndex((m) => m.yearMonth === cur);
  if (exact >= 0) return exact;
  // Fall back to the last elapsed month (e.g. when the slice starts after today).
  let last = -1;
  for (let i = 0; i < months.length; i++) if (months[i].isHistorical) last = i;
  return last;
}

/**
 * A Chart.js inline plugin that draws a dashed vertical "Today" line on a
 * category x-axis at the given index. No-op when index < 0.
 */
function todayLinePlugin(index: number) {
  return {
    id: 'todayLine',
    afterDatasetsDraw(chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number };
      scales: { x?: { getPixelForValue: (v: number) => number } };
    }) {
      if (index < 0) return;
      const x = chart.scales.x;
      if (!x) return;
      const px = x.getPixelForValue(index);
      if (px == null || Number.isNaN(px)) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(120,120,120,0.8)';
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      // "Today" pill near the top of the line.
      ctx.setLineDash([]);
      ctx.font = '600 10px sans-serif';
      const label = 'Today';
      const tw = ctx.measureText(label).width;
      const boxW = tw + 8;
      ctx.fillStyle = 'rgba(120,120,120,0.9)';
      ctx.beginPath();
      ctx.roundRect(px - boxW / 2, chartArea.top + 2, boxW, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px, chartArea.top + 9);
      ctx.restore();
    },
  };
}

const baseOptions = (currency: Currency) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, maxTicksLimit: 12 } },
    y: {
      grid: { color: 'rgba(128,128,128,0.12)' },
      ticks: {
        callback: (v: number | string) => (typeof v === 'number' ? formatCurrency(v, currency) : v),
      },
    },
  },
});

// ── (a) Balance over time: the two loans melting to zero ───────────────────
export function MortgageBalanceChart({ months, mortgage, currency }: { months: MortgageProjectionMonth[]; mortgage: SharedMortgage; currency: Currency }) {
  if (months.length === 0) return <EmptyState label="No schedule to show yet." />;
  const labels = months.map((m) => formatYearMonthShort(m.yearMonth));
  const colors = [RED, AMBER, PURPLE];
  const data = {
    labels,
    datasets: mortgage.loans.map((loan, i) => ({
      label: loan.label,
      data: months.map((m) => m.loans.find((l) => l.loanId === loan.id)?.endingPrincipal ?? 0),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length].replace('rgb', 'rgba').replace(')', ', 0.25)'),
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
    })),
  };
  const options = {
    ...baseOptions(currency),
    plugins: {
      legend: { display: true, position: 'top' as const },
      tooltip: {
        callbacks: {
          label: (c: { dataset: { label?: string }; raw: number }) => `${c.dataset.label}: ${formatCurrency(c.raw, currency)}`,
        },
      },
    },
    scales: { ...baseOptions(currency).scales, y: { ...baseOptions(currency).scales.y, stacked: true }, x: { ...baseOptions(currency).scales.x, stacked: true } },
  };
  return <div style={{ height: '320px' }}><Chart type="line" data={data} options={options} plugins={[todayLinePlugin(todayIndexOf(months))]} style={{ height: '100%' }} /></div>;
}

// ── (b) Ownership progress to the target split ─────────────────────────────
export function OwnershipProgressChart({ months, mortgage, currency }: { months: MortgageProjectionMonth[]; mortgage: SharedMortgage; currency: Currency }) {
  void currency;
  if (months.length === 0) return <EmptyState label="No ownership data yet." />;
  const labels = months.map((m) => formatYearMonthShort(m.yearMonth));
  const distinctTargets = [...new Set(mortgage.members.map((m) => Math.round(m.ownershipTargetPercent * 1000) / 10))];
  const data = {
    labels,
    datasets: [
      ...mortgage.members.map((mem, i) => ({
        label: mem.name,
        data: months.map((m) => (m.members.find((p) => p.userId === mem.userId)?.ownershipPercent ?? 0) * 100),
        borderColor: MEMBER_COLORS[i % MEMBER_COLORS.length],
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2.5,
      })),
      ...distinctTargets.map((target) => ({
        label: `${target}% target`,
        data: months.map(() => target),
        borderColor: GRAY,
        borderDash: [6, 6],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      })),
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: true, position: 'top' as const },
      tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: number }) => `${c.dataset.label}: ${c.raw.toFixed(1)}%` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, maxTicksLimit: 12 } },
      y: { grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { callback: (v: number | string) => `${v}%` } },
    },
  };
  return <div style={{ height: '320px' }}><Chart type="line" data={data} options={options} plugins={[todayLinePlugin(todayIndexOf(months))]} style={{ height: '100%' }} /></div>;
}

// ── (c) Where each payment goes: principal vs interest (yearly buckets) ────
export function PrincipalInterestChart({ months, currency }: { months: MortgageProjectionMonth[]; currency: Currency }) {
  if (months.length === 0) return <EmptyState label="No payments to show yet." />;
  const byYear = new Map<number, { principal: number; interest: number }>();
  for (const m of months) {
    const acc = byYear.get(m.year) ?? { principal: 0, interest: 0 };
    // principalPaidTotal is cumulative; use per-month principal via cumulative delta is complex,
    // so derive from per-loan principalPaid summed.
    const principal = m.loans.reduce((s, l) => s + l.principalPaid + l.extraPayment, 0);
    acc.principal += principal;
    acc.interest += m.totalInterest;
    byYear.set(m.year, acc);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const data = {
    labels: years.map(String),
    datasets: [
      { label: 'Principal (builds equity)', data: years.map((y) => byYear.get(y)!.principal), backgroundColor: GREEN, stack: 's' },
      { label: 'Interest (cost of borrowing)', data: years.map((y) => byYear.get(y)!.interest), backgroundColor: RED, stack: 's' },
    ],
  };
  const options = {
    ...baseOptions(currency),
    plugins: {
      legend: { display: true, position: 'top' as const },
      tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: number }) => `${c.dataset.label}: ${formatCurrency(c.raw, currency)}` } },
    },
    scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { callback: (v: number | string) => (typeof v === 'number' ? formatCurrency(v, currency) : v) } } },
  };
  return <div style={{ height: '320px' }}><Chart type="bar" data={data} options={options} style={{ height: '100%' }} /></div>;
}

// ── (d) Cumulative cost: interest vs principal paid to date ────────────────
export function CumulativeCostChart({ months, currency }: { months: MortgageProjectionMonth[]; currency: Currency }) {
  if (months.length === 0) return <EmptyState label="Nothing paid yet." />;
  const labels = months.map((m) => formatYearMonthShort(m.yearMonth));
  const data = {
    labels,
    datasets: [
      { label: 'Principal paid', data: months.map((m) => m.cumPrincipalPaid), borderColor: GREEN, backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 2 },
      { label: 'Interest paid', data: months.map((m) => m.cumInterestPaid), borderColor: RED, backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 2 },
    ],
  };
  const options = {
    ...baseOptions(currency),
    plugins: { legend: { display: true, position: 'top' as const }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: number }) => `${c.dataset.label}: ${formatCurrency(c.raw, currency)}` } } },
  };
  return <div style={{ height: '320px' }}><Chart type="line" data={data} options={options} plugins={[todayLinePlugin(todayIndexOf(months))]} style={{ height: '100%' }} /></div>;
}

// ── (e) Interest-rate history (stepped) ────────────────────────────────────
export function RateHistoryChart({ months, mortgage }: { months: MortgageProjectionMonth[]; mortgage: SharedMortgage }) {
  if (months.length === 0) return <EmptyState label="No rate history yet." />;
  const firstLoanId = mortgage.loans[0]?.id;
  const labels = months.map((m) => formatYearMonthShort(m.yearMonth));
  const data = {
    labels,
    datasets: [
      {
        label: 'Interest rate',
        data: months.map((m) => m.loans.find((l) => l.loanId === firstLoanId)?.effectiveAnnualRate ?? 0),
        borderColor: BLUE,
        backgroundColor: 'rgba(59,130,246,0.15)',
        stepped: true,
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: number }) => formatRate(c.raw) } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, maxTicksLimit: 12 } },
      y: { grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { callback: (v: number | string) => `${v}%` } },
    },
  };
  return <div style={{ height: '300px' }}><Chart type="line" data={data} options={options} plugins={[todayLinePlugin(todayIndexOf(months))]} style={{ height: '100%' }} /></div>;
}

// ── (f) This month's payment, broken down ──────────────────────────────────
export function PaymentBreakdownChart({ month, currency }: { month: MortgageProjectionMonth | undefined; currency: Currency }) {
  if (!month) return <EmptyState label="No payment this month." />;
  const principal = month.loans.reduce((s, l) => s + l.principalPaid + l.extraPayment, 0);
  const segments = [
    { label: 'Principal', value: principal, color: GREEN },
    { label: 'Interest', value: month.totalInterest, color: RED },
    { label: 'Insurance', value: month.totalInsurance, color: AMBER },
    { label: 'Fees', value: month.invoicingFee + month.serviceFee, color: GRAY },
  ].filter((s) => s.value > 0.005);
  const data = {
    labels: segments.map((s) => s.label),
    datasets: [{ data: segments.map((s) => s.value), backgroundColor: segments.map((s) => s.color), borderWidth: 0 }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    plugins: {
      legend: { display: true, position: 'bottom' as const },
      tooltip: { callbacks: { label: (c: { label: string; raw: number }) => `${c.label}: ${formatCurrency(c.raw, currency)}` } },
    },
  };
  return <div style={{ height: '300px' }}><Chart type="doughnut" data={data} options={options} style={{ height: '100%' }} /></div>;
}

// ── (g) Equity build-up per member ─────────────────────────────────────────
export function EquityBuildupChart({ months, mortgage, currency }: { months: MortgageProjectionMonth[]; mortgage: SharedMortgage; currency: Currency }) {
  if (months.length === 0) return <EmptyState label="No equity data yet." />;
  const labels = months.map((m) => formatYearMonthShort(m.yearMonth));
  const data = {
    labels,
    datasets: mortgage.members.map((mem, i) => ({
      label: mem.name,
      data: months.map((m) => m.members.find((p) => p.userId === mem.userId)?.equity ?? 0),
      borderColor: MEMBER_COLORS[i % MEMBER_COLORS.length],
      backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length].replace('rgb', 'rgba').replace(')', ', 0.25)'),
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
    })),
  };
  const options = {
    ...baseOptions(currency),
    plugins: { legend: { display: true, position: 'top' as const }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: number }) => `${c.dataset.label}: ${formatCurrency(c.raw, currency)}` } } },
    scales: { ...baseOptions(currency).scales, y: { ...baseOptions(currency).scales.y, stacked: true }, x: { ...baseOptions(currency).scales.x, stacked: true } },
  };
  return <div style={{ height: '320px' }}><Chart type="line" data={data} options={options} plugins={[todayLinePlugin(todayIndexOf(months))]} style={{ height: '100%' }} /></div>;
}
