'use client';

import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { WealthProjectionMonth, Currency } from '@/types';

interface WealthChartProps {
    data: WealthProjectionMonth[];
    currency: Currency;
    maxMonths?: number;
}

export function WealthChart({ data, currency, maxMonths = 60 }: WealthChartProps) {
    const displayData = data.slice(0, Math.min(maxMonths, data.length));

    if (displayData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No wealth projection data available.
            </div>
        );
    }

    const labels = displayData.map(m => formatYearMonth(m.yearMonth));

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Cash Accounts',
                data: displayData.map(m => m.cashAccountsTotal),
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                borderColor: 'rgb(59, 130, 246)',
                borderWidth: 1,
                stack: 'assets',
            },
            {
                label: 'Investments',
                data: displayData.map(m => m.investmentsTotal),
                backgroundColor: 'rgba(34, 197, 94, 0.7)',
                borderColor: 'rgb(34, 197, 94)',
                borderWidth: 1,
                stack: 'assets',
            },
            {
                label: 'Receivables',
                data: displayData.map(m => m.receivablesTotal),
                backgroundColor: 'rgba(168, 85, 247, 0.7)',
                borderColor: 'rgb(168, 85, 247)',
                borderWidth: 1,
                stack: 'assets',
            },
            {
                label: 'Debts',
                data: displayData.map(m => -m.debtsTotal),
                backgroundColor: 'rgba(239, 68, 68, 0.7)',
                borderColor: 'rgb(239, 68, 68)',
                borderWidth: 1,
                stack: 'liabilities',
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
                position: 'top' as const,
                labels: {
                    usePointStyle: true,
                    padding: 20,
                },
            },
            tooltip: {
                callbacks: {
                    title: function (context: { label: string }[]) {
                        return context[0]?.label || '';
                    },
                    label: function (context: { dataset: { label: string }, raw: number }) {
                        const value = Math.abs(context.raw);
                        return `${context.dataset.label}: ${formatCurrency(value, currency)}`;
                    },
                    footer: function (context: { dataIndex: number }[]) {
                        const month = displayData[context[0].dataIndex];
                        return `Net Worth: ${formatCurrency(month.netWorth, currency)}`;
                    },
                },
            },
        },
        scales: {
            x: {
                stacked: true,
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
                stacked: true,
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
        <div style={{ height: '400px' }}>
            <Chart type="bar" data={chartData} options={chartOptions} height='400px' />
        </div>
    );
}
