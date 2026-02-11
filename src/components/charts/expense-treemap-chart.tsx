'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { TreemapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '@/components/providers/theme-provider';
import { MdBarChart } from 'react-icons/md';
import { formatCurrency } from '@/lib/constants';
import type { ProjectionLineItem, Currency } from '@/types';

echarts.use([TreemapChart, TooltipComponent, CanvasRenderer]);

interface ExpenseTreemapChartProps {
    expenses: ProjectionLineItem[];
    currency: Currency;
    height?: string;
    onClickItem?: (item: ProjectionLineItem) => void;
}

// Warm-to-hot color palette for expenses
const TREEMAP_COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#f59e0b', // amber
    '#ec4899', // pink
    '#e11d48', // rose
    '#dc2626', // red darker
    '#ea580c', // orange darker
    '#d97706', // amber darker
    '#db2777', // pink darker
    '#be123c', // rose darker
    '#b91c1c', // red darkest
    '#c2410c', // orange darkest
];

/**
 * Treemap chart showing expense breakdown by category or individual item.
 * Groups expenses by category, with individual items as children.
 */
export function ExpenseTreemapChart({ expenses, currency, height = '350px', onClickItem }: ExpenseTreemapChartProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const option = useMemo(() => {
        if (expenses.length === 0) return null;

        // Group by category
        const categoryMap = new Map<string, { total: number; items: ProjectionLineItem[] }>();
        for (const exp of expenses) {
            const cat = exp.category || 'Uncategorized';
            const entry = categoryMap.get(cat) || { total: 0, items: [] };
            entry.total += exp.amount;
            entry.items.push(exp);
            categoryMap.set(cat, entry);
        }

        // Build treemap data
        const treemapData = Array.from(categoryMap.entries())
            .sort((a, b) => b[1].total - a[1].total)
            .map(([category, { total, items }], idx) => {
                const color = TREEMAP_COLORS[idx % TREEMAP_COLORS.length];
                if (items.length === 1) {
                    return {
                        name: items[0].name,
                        value: total,
                        itemStyle: { color },
                        itemId: items[0].itemId,
                        source: items[0].source,
                    };
                }
                return {
                    name: category,
                    value: total,
                    itemStyle: { color },
                    children: items
                        .sort((a, b) => b.amount - a.amount)
                        .map(item => ({
                            name: item.name,
                            value: item.amount,
                            itemId: item.itemId,
                            source: item.source,
                        })),
                };
            });

        const textColor = isDark ? '#e5e7eb' : '#374151';

        return {
            tooltip: {
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderColor: isDark ? '#374151' : '#e5e7eb',
                textStyle: { color: textColor },
                formatter: (params: { name: string; value: number; treePathInfo: Array<{ name: string }> }) => {
                    const path = params.treePathInfo
                        ?.filter(p => p.name)
                        .map(p => p.name)
                        .join(' › ');
                    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
                    const pct = totalExpenses > 0 ? ((params.value / totalExpenses) * 100).toFixed(1) : '0';
                    return `<strong>${path || params.name}</strong><br/>${formatCurrency(params.value, currency)}<br/>${pct}% of total expenses`;
                },
            },
            series: [
                {
                    type: 'treemap',
                    data: treemapData,
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    roam: false,
                    nodeClick: false,
                    breadcrumb: { show: false },
                    emphasis: {
                        itemStyle: {
                            borderColor: '#fff',
                            borderWidth: 2,
                        },
                    },
                    label: {
                        show: true,
                        formatter: (params: { name: string; value: number }) => {
                            const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
                            const pct = totalExpenses > 0 ? ((params.value / totalExpenses) * 100).toFixed(0) : '0';
                            return `{name|${params.name}}\n{value|${formatCurrency(params.value, currency)}}\n{pct|${pct}%}`;
                        },
                        rich: {
                            name: {
                                fontSize: 13,
                                fontWeight: 'bold' as const,
                                color: '#fff',
                                lineHeight: 20,
                                textShadowColor: 'rgba(0,0,0,0.3)',
                                textShadowBlur: 2,
                            },
                            value: {
                                fontSize: 11,
                                color: 'rgba(255,255,255,0.9)',
                                lineHeight: 18,
                            },
                            pct: {
                                fontSize: 10,
                                color: 'rgba(255,255,255,0.7)',
                                lineHeight: 16,
                            },
                        },
                    },
                    itemStyle: {
                        borderColor: isDark ? '#1f2937' : '#ffffff',
                        borderWidth: 2,
                        gapWidth: 2,
                    },
                    levels: [
                        {
                            // Category level
                            itemStyle: {
                                borderColor: isDark ? '#111827' : '#f3f4f6',
                                borderWidth: 3,
                                gapWidth: 3,
                            },
                        },
                        {
                            // Item level
                            itemStyle: {
                                borderColor: isDark ? '#1f2937' : '#ffffff',
                                borderWidth: 1,
                                gapWidth: 1,
                            },
                            label: {
                                show: true,
                                formatter: (params: { name: string; value: number }) => {
                                    return `{name|${params.name}}\n{value|${formatCurrency(params.value, currency)}}`;
                                },
                                rich: {
                                    name: {
                                        fontSize: 11,
                                        color: '#fff',
                                        lineHeight: 16,
                                    },
                                    value: {
                                        fontSize: 10,
                                        color: 'rgba(255,255,255,0.8)',
                                        lineHeight: 14,
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        };
    }, [expenses, currency, isDark]);

    if (expenses.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 opacity-50">
                <div className="text-center">
                    <MdBarChart size={30} className="mb-2" />
                    <p className="text-sm">No expenses this month</p>
                </div>
            </div>
        );
    }

    if (!option) return null;

    // Build a click handler that maps treemap nodes back to expense items
    const onEvents = useMemo(() => {
        if (!onClickItem) return undefined;
        return {
            click: (params: { data?: { itemId?: string; source?: string } }) => {
                const data = params.data;
                if (data?.itemId && data?.source) {
                    const item = expenses.find(e => e.itemId === data.itemId);
                    if (item) onClickItem(item);
                }
            },
        };
    }, [onClickItem, expenses]);

    return (
        <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ height, width: '100%' }}
            onEvents={onEvents}
            notMerge
            lazyUpdate
        />
    );
}
