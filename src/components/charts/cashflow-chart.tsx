'use client';

import { useEffect, useRef } from 'react';
import { Chart } from 'primereact/chart';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { MonthlyProjection, Currency } from '@/types';

interface CashflowChartProps {
    data: MonthlyProjection[];
    currency: Currency;
}

export function CashflowChart({ data, currency }: CashflowChartProps) {
    const chartRef = useRef<Chart>(null);

    // Take first 12 months for a cleaner view, or all if less
    const displayData = data.slice(0, Math.min(12, data.length));

    const chartData = {
        labels: displayData.map(m => formatYearMonth(m.yearMonth)),
        datasets: [
            {
                type: 'bar' as const,
                label: 'Starting Balance',
                data: displayData.map(m => m.startingBalance),
                backgroundColor: 'rgba(59, 130, 246, 0.7)', // blue
                borderColor: 'rgb(59, 130, 246)',
                borderWidth: 1,
                order: 3,
            },
            {
                type: 'bar' as const,
                label: 'Income',
                data: displayData.map(m => m.totalIncome),
                backgroundColor: 'rgba(34, 197, 94, 0.7)', // green
                borderColor: 'rgb(34, 197, 94)',
                borderWidth: 1,
                order: 2,
            },
            {
                type: 'bar' as const,
                label: 'Expenses',
                data: displayData.map(m => -m.totalExpenses), // Negative for visual effect
                backgroundColor: 'rgba(239, 68, 68, 0.7)', // red
                borderColor: 'rgb(239, 68, 68)',
                borderWidth: 1,
                order: 1,
            },
            {
                type: 'line' as const,
                label: 'Ending Balance',
                data: displayData.map(m => m.endingBalance),
                borderColor: 'rgb(147, 51, 234)', // purple
                backgroundColor: 'rgba(147, 51, 234, 0.2)',
                borderWidth: 3,
                fill: false,
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                order: 0,
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
                    padding: 15,
                },
            },
            tooltip: {
                callbacks: {
                    label: function (context: { dataset: { label: string }, parsed: { y: number } }) {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y;
                        // Handle negative expenses display
                        const displayValue = label === 'Expenses' ? Math.abs(value) : value;
                        return `${label}: ${formatCurrency(displayValue, currency)}`;
                    },
                },
            },
        },
        scales: {
            x: {
                stacked: false,
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
                            return formatCurrency(Math.abs(value), currency);
                        }
                        return value;
                    },
                },
            },
        },
    };

    // Force chart update when data changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.getChart()?.update();
        }
    }, [data, currency]);

    if (displayData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No projection data available. Add some income or expenses to see the chart.
            </div>
        );
    }

    return (
        <div style={{ height: '400px' }}>
            <Chart ref={chartRef} type="bar" data={chartData} options={chartOptions} height='400px' />
        </div>
    );
}
