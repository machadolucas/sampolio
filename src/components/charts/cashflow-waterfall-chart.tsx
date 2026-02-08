'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, CandlestickChart } from 'echarts/charts';
import {
    TooltipComponent,
    GridComponent,
    LegendComponent,
    DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '@/components/providers/theme-provider';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import type { MonthlyProjection, Currency } from '@/types';

echarts.use([
    CandlestickChart,
    BarChart,
    LineChart,
    TooltipComponent,
    GridComponent,
    LegendComponent,
    DataZoomComponent,
    CanvasRenderer,
]);

interface CashflowWaterfallChartProps {
    data: MonthlyProjection[];
    currency: Currency;
    height?: string;
}

/**
 * Cashflow waterfall chart that shows:
 * - Candlestick-style bars: open = startingBalance, close = endingBalance,
 *   high = startingBalance + totalIncome, low = endingBalance (or startingBalance whichever is lower)
 *   Green when endingBalance >= startingBalance, red otherwise.
 * - Overlaid transparent income (green) and expense (red) indicator bars
 * - Balance line tracking the ending balance over time
 */
export function CashflowWaterfallChart({ data, currency, height = '420px' }: CashflowWaterfallChartProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const option = useMemo(() => {
        const months = data.map(m => formatYearMonth(m.yearMonth));

        // For each month, build the candlestick data:
        // ECharts candlestick format: [open, close, low, high]
        // We use: open = startingBalance, close = endingBalance
        //         low = min(startingBalance, endingBalance)
        //         high = startingBalance + totalIncome (peak before expenses)
        const candlestickData = data.map(m => {
            const open = m.startingBalance;
            const close = m.endingBalance;
            const peak = m.startingBalance + m.totalIncome;
            const low = Math.min(open, close);
            const high = Math.max(peak, open, close);
            return [open, close, low, high];
        });

        // Income bars (stacked on top of starting balance)
        const incomeData = data.map(m => m.totalIncome);

        // Expense bars (shown as negative from the peak)
        const expenseData = data.map(m => m.totalExpenses);

        // Balance line
        const balanceLine = data.map(m => m.endingBalance);

        const textColor = isDark ? '#e5e7eb' : '#374151';
        const gridLineColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderColor: isDark ? '#374151' : '#e5e7eb',
                textStyle: { color: textColor },
                formatter: (params: Array<{ seriesName: string; value: number | number[]; dataIndex: number; marker: string }>) => {
                    const idx = params[0]?.dataIndex ?? 0;
                    const m = data[idx];
                    if (!m) return '';
                    const lines = [
                        `<strong>${formatYearMonth(m.yearMonth)}</strong>`,
                        `Starting: ${formatCurrency(m.startingBalance, currency)}`,
                        `<span style="color:#22c55e">▲ Income: +${formatCurrency(m.totalIncome, currency)}</span>`,
                        `<span style="color:#ef4444">▼ Expenses: -${formatCurrency(m.totalExpenses, currency)}</span>`,
                        `<span style="color:${m.netChange >= 0 ? '#22c55e' : '#ef4444'}">Net: ${m.netChange >= 0 ? '+' : ''}${formatCurrency(m.netChange, currency)}</span>`,
                        `<strong>Ending: ${formatCurrency(m.endingBalance, currency)}</strong>`,
                    ];
                    return lines.join('<br/>');
                },
            },
            legend: {
                data: ['Income', 'Expenses', 'Balance'],
                top: 0,
                textStyle: { color: textColor },
            },
            grid: {
                left: 80,
                right: 30,
                top: 40,
                bottom: data.length > 12 ? 80 : 50,
            },
            dataZoom: data.length > 12 ? [
                {
                    type: 'slider',
                    start: 0,
                    end: Math.min(100, (12 / data.length) * 100),
                    bottom: 10,
                    textStyle: { color: textColor },
                },
            ] : [],
            xAxis: {
                type: 'category',
                data: months,
                axisLabel: {
                    color: textColor,
                    rotate: data.length > 8 ? 45 : 0,
                    fontSize: 11,
                },
                axisLine: { lineStyle: { color: gridLineColor } },
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    color: textColor,
                    formatter: (v: number) => {
                        if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`;
                        return v.toString();
                    },
                },
                splitLine: { lineStyle: { color: gridLineColor } },
            },
            series: [
                // Stack 1: Income — transparent base at startingBalance, then income going up
                {
                    name: '_baseIncome',
                    type: 'bar',
                    stack: 'income',
                    silent: true,
                    itemStyle: { borderColor: 'transparent', color: 'transparent' },
                    emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
                    data: data.map(m => m.startingBalance),
                },
                {
                    name: 'Income',
                    type: 'bar',
                    stack: 'income',
                    barGap: '-100%',
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(34, 197, 94, 0.85)' },
                            { offset: 1, color: 'rgba(34, 197, 94, 0.45)' },
                        ]),
                        borderRadius: [2, 2, 0, 0],
                    },
                    data: incomeData,
                },
                // Stack 2: Expenses — transparent base at endingBalance, then expenses going up to the peak
                {
                    name: '_baseExpense',
                    type: 'bar',
                    stack: 'expense',
                    silent: true,
                    itemStyle: { borderColor: 'transparent', color: 'transparent' },
                    emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
                    barGap: '-100%',
                    data: data.map(m => m.endingBalance),
                },
                {
                    name: 'Expenses',
                    type: 'bar',
                    stack: 'expense',
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(239, 68, 68, 0.5)' },
                            { offset: 1, color: 'rgba(239, 68, 68, 0.85)' },
                        ]),
                        borderRadius: [2, 2, 0, 0],
                    },
                    data: expenseData,
                },
                // Balance line
                {
                    name: 'Balance',
                    type: 'line',
                    data: balanceLine,
                    smooth: 0.3,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: {
                        width: 3,
                        color: '#8b5cf6',
                    },
                    itemStyle: {
                        color: '#8b5cf6',
                        borderWidth: 2,
                        borderColor: isDark ? '#1f2937' : '#ffffff',
                    },
                    z: 10,
                },
            ],
        };
    }, [data, currency, isDark]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No projection data available.
            </div>
        );
    }

    return (
        <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ height, width: '100%' }}
            notMerge
            lazyUpdate
        />
    );
}
