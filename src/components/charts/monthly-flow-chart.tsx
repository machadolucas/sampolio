'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTheme } from '@/components/providers/theme-provider';
import { formatCurrency } from '@/lib/constants';
import type { MonthFlowData, CashflowItem } from '@/types';

echarts.use([SankeyChart, TooltipComponent, CanvasRenderer]);

interface MonthlyFlowChartProps {
    data: MonthFlowData;
    height?: string;
    onClickItem?: (item: CashflowItem) => void;
    onClickStart?: () => void;
    onClickEnd?: () => void;
}

interface NodeMeta {
    items: CashflowItem[];
    side: 'left' | 'center' | 'right';
}

export function MonthlyFlowChart({
    data,
    height = '400px',
    onClickItem,
}: MonthlyFlowChartProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const chartRef = useRef<ReactEChartsCore>(null);
    const [nodeMetaMap] = useState<Map<string, NodeMeta>>(() => new Map());

    const GREEN = '#22c55e';
    const RED = '#ef4444';
    const BLUE = '#3b82f6';
    const AMBER = '#f59e0b';

    const { nodes, links, metaMap } = useMemo(() => {
        const nodes: Array<{ name: string; itemStyle: { color: string; borderColor: string }; depth?: number }> = [];
        const links: Array<{ source: string; target: string; value: number; lineStyle?: { color: string; opacity: number } }> = [];
        const meta = new Map<string, NodeMeta>();

        const netChange = data.totalInflows - data.totalOutflows;
        const hasSavings = netChange > 0;
        const hasDeficit = netChange < 0;

        // Center node: "Budget"
        const centerNodeName = 'Budget';
        nodes.push({
            name: centerNodeName,
            itemStyle: { color: BLUE, borderColor: BLUE },
            depth: 1,
        });
        meta.set(centerNodeName, { items: [], side: 'center' });

        // Income nodes (depth 0) — individual items, no grouping
        data.inflows.forEach(item => {
            const nodeName = `Income: ${item.name}`;
            // Handle duplicate names by appending id if needed
            const existingNode = nodes.find(n => n.name === nodeName);
            const uniqueName = existingNode ? `Income: ${item.name} (${item.id.slice(-4)})` : nodeName;
            nodes.push({
                name: uniqueName,
                itemStyle: { color: GREEN, borderColor: GREEN },
                depth: 0,
            });
            links.push({
                source: uniqueName,
                target: centerNodeName,
                value: item.amount,
                lineStyle: { color: GREEN, opacity: 0.3 },
            });
            meta.set(uniqueName, { items: [item], side: 'left' });
        });

        // Expense categories (depth 2) + individual items (depth 3)
        const expensesByCategory = new Map<string, CashflowItem[]>();
        data.outflows.forEach(item => {
            const key = item.category || 'Other';
            if (!expensesByCategory.has(key)) expensesByCategory.set(key, []);
            expensesByCategory.get(key)!.push(item);
        });

        const sortedCategories = Array.from(expensesByCategory.entries())
            .map(([cat, items]) => ({
                category: cat,
                items,
                total: items.reduce((s, i) => s + i.amount, 0),
            }))
            .sort((a, b) => b.total - a.total);

        sortedCategories.forEach(({ category, items, total }) => {
            const catNodeName = `Category: ${category}`;
            nodes.push({
                name: catNodeName,
                itemStyle: { color: RED, borderColor: RED },
                depth: 2,
            });
            links.push({
                source: centerNodeName,
                target: catNodeName,
                value: total,
                lineStyle: { color: RED, opacity: 0.3 },
            });
            meta.set(catNodeName, { items, side: 'right' });

            // Individual expense items (depth 3) — always expand
            items
                .sort((a, b) => b.amount - a.amount)
                .forEach(item => {
                    const itemNodeName = `Expense: ${item.name}`;
                    const existingNode = nodes.find(n => n.name === itemNodeName);
                    const uniqueName = existingNode ? `Expense: ${item.name} (${item.id.slice(-4)})` : itemNodeName;
                    nodes.push({
                        name: uniqueName,
                        itemStyle: { color: '#f87171', borderColor: '#f87171' },
                        depth: 3,
                    });
                    links.push({
                        source: catNodeName,
                        target: uniqueName,
                        value: item.amount,
                        lineStyle: { color: '#f87171', opacity: 0.2 },
                    });
                    meta.set(uniqueName, { items: [item], side: 'right' });
                });
        });

        // Savings or Deficit node
        if (hasSavings) {
            const savingsCatName = 'Savings';
            nodes.push({
                name: savingsCatName,
                itemStyle: { color: GREEN, borderColor: GREEN },
                depth: 2,
            });
            links.push({
                source: centerNodeName,
                target: savingsCatName,
                value: netChange,
                lineStyle: { color: GREEN, opacity: 0.3 },
            });
            meta.set(savingsCatName, { items: [], side: 'right' });

            // Extend to depth 3
            const savingsItemName = 'Net Savings';
            nodes.push({
                name: savingsItemName,
                itemStyle: { color: GREEN, borderColor: GREEN },
                depth: 3,
            });
            links.push({
                source: savingsCatName,
                target: savingsItemName,
                value: netChange,
                lineStyle: { color: GREEN, opacity: 0.3 },
            });
            meta.set(savingsItemName, { items: [], side: 'right' });
        } else if (hasDeficit) {
            const deficitName = 'From Previous Balance';
            nodes.push({
                name: deficitName,
                itemStyle: { color: AMBER, borderColor: AMBER },
                depth: 0,
            });
            links.push({
                source: deficitName,
                target: centerNodeName,
                value: Math.abs(netChange),
                lineStyle: { color: AMBER, opacity: 0.3 },
            });
            meta.set(deficitName, { items: [], side: 'left' });
        }

        return { nodes, links, metaMap: meta };
    }, [data, GREEN, RED, BLUE, AMBER]);

    // Sync metaMap to ref-stable map for event handlers
    useEffect(() => {
        nodeMetaMap.clear();
        metaMap.forEach((v, k) => nodeMetaMap.set(k, v));
    }, [metaMap, nodeMetaMap]);

    const option = useMemo(() => {
        const cleanNodeName = (name: string) => name.replace(/^(Income|Expense|Category): /, '').replace(/ \([a-f0-9]{4}\)$/, '');

        return {
            tooltip: {
                trigger: 'item' as const,
                formatter: (params: Record<string, unknown>) => {
                    if (params.dataType === 'node') {
                        const name = params.name as string;
                        const value = params.value as number;
                        const m = metaMap.get(name);
                        let html = `<strong>${cleanNodeName(name)}</strong><br/>${formatCurrency(value, 'EUR')}`;
                        if (m && m.items.length > 1) {
                            html += '<br/><br/>';
                            m.items.slice(0, 8).forEach(item => {
                                html += `${item.name}: ${formatCurrency(item.amount, 'EUR')}<br/>`;
                            });
                            if (m.items.length > 8) {
                                html += `+${m.items.length - 8} more`;
                            }
                        }
                        return html;
                    }
                    if (params.dataType === 'edge') {
                        const d = params.data as { source: string; target: string; value: number };
                        return `${cleanNodeName(d.source)} → ${cleanNodeName(d.target)}<br/>${formatCurrency(d.value, 'EUR')}`;
                    }
                    return '';
                },
            },
            series: [
                {
                    type: 'sankey',
                    layoutIterations: 0,
                    nodeGap: 10,
                    nodeWidth: 16,
                    left: 40,
                    right: 40,
                    top: 40,
                    bottom: 20,
                    data: nodes,
                    links,
                    orient: 'horizontal',
                    draggable: false,
                    label: {
                        show: true,
                        position: 'outside',
                        formatter: (params: { name: string; value: number }) => {
                            const clean = cleanNodeName(params.name);
                            const truncated = clean.length > 18 ? clean.slice(0, 16) + '…' : clean;
                            return `${truncated}\n${formatCurrency(params.value, 'EUR')}`;
                        },
                        fontSize: 10,
                        color: isDark ? '#d1d5db' : '#374151',
                    },
                    emphasis: {
                        focus: 'adjacency',
                        lineStyle: {
                            opacity: 0.6,
                        },
                    },
                    lineStyle: {
                        curveness: 0.5,
                    },
                },
            ],
        };
    }, [nodes, links, isDark, metaMap]);

    const onEvents = useMemo(() => ({
        click: (params: Record<string, unknown>) => {
            if (!onClickItem) return;
            const name = params.name as string | undefined;
            if (!name) return;
            const m = nodeMetaMap.get(name);
            if (m && m.items.length === 1) {
                onClickItem(m.items[0]);
            }
            // Category nodes with multiple items — no action (they expand to individual items)
        },
    }), [onClickItem, nodeMetaMap]);

    return (
        <div className="relative">
            {/* Summary header */}
            <div className="flex items-center justify-between mb-2 px-1 text-sm">
                <span className="text-green-500 font-semibold">
                    Income: +{formatCurrency(data.totalInflows, 'EUR')}
                </span>
                <span className={`font-semibold ${data.netChange >= 0 ? 'text-green-600' : 'text-amber-500'}`}>
                    Net: {data.netChange >= 0 ? '+' : ''}{formatCurrency(data.netChange, 'EUR')}
                </span>
                <span className="text-red-500 font-semibold">
                    Expenses: −{formatCurrency(data.totalOutflows, 'EUR')}
                </span>
            </div>

            <ReactEChartsCore
                ref={chartRef}
                echarts={echarts}
                option={option}
                style={{ height, width: '100%' }}
                notMerge
                onEvents={onEvents}
                theme={isDark ? 'dark' : undefined}
                opts={{ renderer: 'canvas' }}
            />

            {/* Balance footer */}
            <div className={`flex items-center justify-between px-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <span>Start: {formatCurrency(data.startingBalance, 'EUR')}</span>
                <span>End: {formatCurrency(data.endingBalance, 'EUR')}</span>
            </div>
        </div>
    );
}
