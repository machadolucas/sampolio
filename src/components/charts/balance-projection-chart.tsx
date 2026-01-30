'use client';

import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { MonthlyProjection, Currency } from '@/types';

interface BalanceProjectionChartProps {
    data: MonthlyProjection[];
    currency: Currency;
    maxMonths?: number;
}

export function BalanceProjectionChart({ data, currency, maxMonths = 24 }: BalanceProjectionChartProps) {
    const displayData = data.slice(0, Math.min(maxMonths, data.length));

    if (displayData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No projection data available.
            </div>
        );
    }

    const labels = displayData.map(m => formatYearMonth(m.yearMonth));

    // Find min balance to determine if we need to show a warning zone
    const minBalance = Math.min(...displayData.map(m => m.endingBalance));
    const maxBalance = Math.max(...displayData.map(m => m.endingBalance));

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Ending Balance',
                data: displayData.map(m => m.endingBalance),
                borderColor: 'rgb(147, 51, 234)',
                backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D, chartArea: { top: number, bottom: number } } }) => {
                    const ctx = context.chart.ctx;
                    const chartArea = context.chart.chartArea;
                    if (!chartArea) return 'rgba(147, 51, 234, 0.3)';

                    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, 'rgba(147, 51, 234, 0.4)');
                    gradient.addColorStop(1, 'rgba(147, 51, 234, 0.05)');
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 3,
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
                            `Balance: ${formatCurrency(context.raw, currency)}`,
                            `Income: +${formatCurrency(month.totalIncome, currency)}`,
                            `Expenses: -${formatCurrency(month.totalExpenses, currency)}`,
                            `Net: ${month.netChange >= 0 ? '+' : ''}${formatCurrency(month.netChange, currency)}`,
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
                },
            },
            y: {
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)',
                },
                min: minBalance < 0 ? minBalance * 1.1 : 0,
                max: maxBalance * 1.1,
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
