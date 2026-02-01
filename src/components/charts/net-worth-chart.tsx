'use client';

import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { WealthProjectionMonth, Currency } from '@/types';

interface NetWorthChartProps {
    data: WealthProjectionMonth[];
    currency: Currency;
    maxMonths?: number;
}

export function NetWorthChart({ data, currency, maxMonths = 60 }: NetWorthChartProps) {
    const displayData = data.slice(0, Math.min(maxMonths, data.length));

    if (displayData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No wealth projection data available.
            </div>
        );
    }

    const labels = displayData.map(m => formatYearMonth(m.yearMonth));

    // Find min/max for scaling
    const netWorths = displayData.map(m => m.netWorth);
    const minNetWorth = Math.min(...netWorths);
    const maxNetWorth = Math.max(...netWorths);

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Net Worth',
                data: netWorths,
                borderColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
                    gradient.addColorStop(0, 'rgb(34, 197, 94)');
                    gradient.addColorStop(1, 'rgb(22, 163, 74)');
                    return gradient;
                },
                backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D, chartArea: { top: number, bottom: number } } }) => {
                    const ctx = context.chart.ctx;
                    const chartArea = context.chart.chartArea;
                    if (!chartArea) return 'rgba(34, 197, 94, 0.3)';

                    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
                    gradient.addColorStop(1, 'rgba(34, 197, 94, 0.05)');
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 6,
                borderWidth: 3,
            },
            // Zero line reference
            {
                label: 'Zero Line',
                data: displayData.map(() => 0),
                borderColor: 'rgba(239, 68, 68, 0.5)',
                borderDash: [5, 5],
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index' as const,
            intersect: false,
        },
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                callbacks: {
                    title: function (context: { label: string }[]) {
                        return context[0]?.label || '';
                    },
                    label: function (context: { datasetIndex: number, raw: number, dataIndex: number }) {
                        if (context.datasetIndex === 1) return null; // Skip zero line
                        const month = displayData[context.dataIndex];
                        return [
                            `Net Worth: ${formatCurrency(context.raw, currency)}`,
                            `---`,
                            `Cash: ${formatCurrency(month.cashAccountsTotal, currency)}`,
                            `Investments: ${formatCurrency(month.investmentsTotal, currency)}`,
                            `Receivables: ${formatCurrency(month.receivablesTotal, currency)}`,
                            `Debts: -${formatCurrency(month.debtsTotal, currency)}`,
                        ];
                    },
                },
            },
        },
        scales: {
            x: {
                grid: {
                    display: false,
                },
                ticks: {
                    maxRotation: 45,
                    minRotation: 45,
                    maxTicksLimit: 12,
                },
            },
            y: {
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)',
                },
                min: minNetWorth < 0 ? minNetWorth * 1.1 : 0,
                max: maxNetWorth > 0 ? maxNetWorth * 1.1 : 100,
                ticks: {
                    callback: function (value: number | string) {
                        if (typeof value === 'number') {
                            return formatCurrency(value, currency);
                        }
                        return value;
                    },
                },
            },
        },
    };

    return (
        <div style={{ height: '400px' }}>
            <Chart type="line" data={chartData} options={chartOptions} height='400px' />
        </div>
    );
}
