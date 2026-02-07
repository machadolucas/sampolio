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
    groupByCategory?: boolean;
}

interface NodeMeta {
    items: CashflowItem[];
    side: 'left' | 'center' | 'right';
}

export function MonthlyFlowChart({
    data,
    height = '400px',
    onClickItem,
    groupByCategory = true,
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

        // Group items
        const groupItems = (items: CashflowItem[]): { label: string; amount: number; items: CashflowItem[] }[] => {
            if (!groupByCategory) {
                return items.map(item => ({
                    label: item.name,
                    amount: item.amount,
                    items: [item],
                }));
            }
            const groups = new Map<string, CashflowItem[]>();
            items.forEach(item => {
                const key = item.category || item.name;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(item);
            });
            return Array.from(groups.entries())
                .map(([cat, catItems]) => ({
                    label: cat,
                    amount: catItems.reduce((s, i) => s + i.amount, 0),
                    items: catItems,
                }))
                .sort((a, b) => b.amount - a.amount);
        };

        const incomeGroups = groupItems(data.inflows);
        const expenseGroups = groupItems(data.outflows);

        // Center node: "Budget"
        const centerNodeName = 'Budget';
        nodes.push({
            name: centerNodeName,
            itemStyle: { color: BLUE, borderColor: BLUE },
            depth: 1,
        });
        meta.set(centerNodeName, { items: [], side: 'center' });

        // Income nodes (depth 0)
        incomeGroups.forEach(group => {
            const nodeName = `Income: ${group.label}`;
            nodes.push({
                name: nodeName,
                itemStyle: { color: GREEN, borderColor: GREEN },
                depth: 0,
            });
            links.push({
                source: nodeName,
                target: centerNodeName,
                value: group.amount,
                lineStyle: { color: GREEN, opacity: 0.3 },
            });
            meta.set(nodeName, { items: group.items, side: 'left' });
        });

        // Expense nodes (depth 2)
        expenseGroups.forEach(group => {
            const nodeName = `Expense: ${group.label}`;
            nodes.push({
                name: nodeName,
                itemStyle: { color: RED, borderColor: RED },
                depth: 2,
            });
            links.push({
                source: centerNodeName,
                target: nodeName,
                value: group.amount,
                lineStyle: { color: RED, opacity: 0.3 },
            });
            meta.set(nodeName, { items: group.items, side: 'right' });
        });

        // Savings or Deficit node
        if (hasSavings) {
            const savingsName = 'Savings';
            nodes.push({
                name: savingsName,
                itemStyle: { color: GREEN, borderColor: GREEN },
                depth: 2,
            });
            links.push({
                source: centerNodeName,
                target: savingsName,
                value: netChange,
                lineStyle: { color: GREEN, opacity: 0.3 },
            });
            meta.set(savingsName, { items: [], side: 'right' });
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
    }, [data, groupByCategory, GREEN, RED, BLUE, AMBER]);

    // Sync metaMap to ref-stable map for event handlers
    useEffect(() => {
        nodeMetaMap.clear();
        metaMap.forEach((v, k) => nodeMetaMap.set(k, v));
    }, [metaMap, nodeMetaMap]);

    const option = useMemo(() => ({
        tooltip: {
            trigger: 'item' as const,
            formatter: (params: Record<string, unknown>) => {
                if (params.dataType === 'node') {
                    const name = params.name as string;
                    const value = params.value as number;
                    const m = metaMap.get(name);
                    let html = `<strong>${name.replace(/^(Income|Expense): /, '')}</strong><br/>${formatCurrency(value, 'EUR')}`;
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
                    return `${d.source.replace(/^(Income|Expense): /, '')} → ${d.target.replace(/^(Income|Expense): /, '')}<br/>${formatCurrency(d.value, 'EUR')}`;
                }
                return '';
            },
        },
        series: [
            {
                type: 'sankey',
                layoutIterations: 0,
                nodeGap: 12,
                nodeWidth: 20,
                left: 160,
                right: 160,
                top: 30,
                bottom: 20,
                data: nodes,
                links,
                orient: 'horizontal',
                draggable: false,
                label: {
                    show: true,
                    position: 'outside',
                    formatter: (params: { name: string; value: number }) => {
                        const cleanName = params.name.replace(/^(Income|Expense): /, '');
                        return `${cleanName}\n${formatCurrency(params.value, 'EUR')}`;
                    },
                    fontSize: 11,
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
    }), [nodes, links, isDark, metaMap]);

    const onEvents = useMemo(() => ({
        click: (params: Record<string, unknown>) => {
            if (!onClickItem) return;
            const name = params.name as string | undefined;
            if (!name) return;
            const m = nodeMetaMap.get(name);
            if (m && m.items.length === 1) {
                onClickItem(m.items[0]);
            } else if (m && m.items.length > 1) {
                // Click on a group — open the first item for editing
                onClickItem(m.items[0]);
            }
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
