'use client';

import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { MonthlyProjection, Currency } from '@/types';

interface MonthlyWaterfallChartProps {
    data: MonthlyProjection[];
    currency: Currency;
    maxMonths?: number;
}

export function MonthlyWaterfallChart({ data, currency, maxMonths = 12 }: MonthlyWaterfallChartProps) {
    const displayData = data.slice(0, Math.min(maxMonths, data.length));

    if (displayData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No projection data available.
            </div>
        );
    }

    // Create a stacked visualization showing starting -> +income -> -expenses -> ending
    const labels = displayData.map(m => formatYearMonth(m.yearMonth));

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Starting Balance',
                data: displayData.map(m => m.startingBalance),
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderRadius: 4,
                stack: 'stack0',
            },
            {
                label: 'Income',
                data: displayData.map(m => m.totalIncome),
                backgroundColor: 'rgba(34, 197, 94, 0.8)',
                borderRadius: 4,
                stack: 'stack1',
            },
            {
                label: 'Expenses',
                data: displayData.map(m => m.totalExpenses),
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderRadius: 4,
                stack: 'stack2',
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
                labels: {
                    usePointStyle: true,
                    padding: 15,
                },
            },
            tooltip: {
                callbacks: {
                    label: function (context: { dataset: { label: string }, raw: number }) {
                        const label = context.dataset.label || '';
                        return `${label}: ${formatCurrency(context.raw, currency)}`;
                    },
                    afterBody: function (context: { dataIndex: number }[]) {
                        const idx = context[0]?.dataIndex;
                        if (idx !== undefined && displayData[idx]) {
                            const month = displayData[idx];
                            return [
                                '',
                                `Net Change: ${month.netChange >= 0 ? '+' : ''}${formatCurrency(month.netChange, currency)}`,
                                `Ending: ${formatCurrency(month.endingBalance, currency)}`,
                            ];
                        }
                        return [];
                    },
                },
            },
        },
        scales: {
            x: {
                grid: {
                    display: false,
                },
            },
            y: {
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)',
                },
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
        <div className="h-100">
            <Chart type="bar" data={chartData} options={chartOptions} height='400px' />
        </div>
    );
}
