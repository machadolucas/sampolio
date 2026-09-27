'use client';

import { useMemo } from 'react';
import { Card } from 'primereact/card';
import { useTheme } from '@/components/providers/theme-provider';
import { formatCurrency, MONTHS } from '@/lib/constants';
import { isZeroMoney, type HeroSummary } from '@/lib/overview-hero';
import type { Currency } from '@/types';

interface StatusHeroCardProps {
    userName: string;
    /**
     * This month's real cash numbers (see `deriveHeroSummary` in
     * `src/lib/overview-hero.ts`), or null when there is no current-month
     * forecast yet. `trend` null ⇒ the "vs last month" row is hidden.
     */
    summary: HeroSummary | null;
    currency: Currency;
}

type Sentiment = 'positive' | 'caution' | 'negative';

function getSentiment(
    netChange: number,
    totalIncome: number
): Sentiment {
    if (netChange < 0) return 'negative';
    if (totalIncome > 0 && netChange < totalIncome * 0.1) return 'caution';
    return 'positive';
}

const SENTIMENT_COLORS: Record<Sentiment, { bg: string; text: string; border: string }> = {
    positive: {
        bg: 'bg-green-50 dark:bg-green-900/20',
        text: 'text-green-700 dark:text-green-400',
        border: 'border-green-200 dark:border-green-800',
    },
    caution: {
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        text: 'text-yellow-700 dark:text-yellow-400',
        border: 'border-yellow-200 dark:border-yellow-800',
    },
    negative: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-700 dark:text-red-400',
        border: 'border-red-200 dark:border-red-800',
    },
};

export function StatusHeroCard({
    userName,
    summary,
    currency,
}: StatusHeroCardProps) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const monthName = useMemo(() => {
        const now = new Date();
        return MONTHS[now.getMonth()];
    }, []);

    const firstName = userName.split(' ')[0] || userName;

    const netChange = summary?.netChange ?? 0;
    const trend = summary?.trend ?? null;
    // Never render a zero-delta arrow: no comparison data, or a delta that
    // rounds to €0,00, hides the row entirely.
    const showTrend = trend !== null && !isZeroMoney(trend);

    const sentiment = getSentiment(netChange, summary?.totalIncome ?? 0);
    const colors = SENTIMENT_COLORS[sentiment];

    // Plain render-time strings (no useMemo): formatCurrency reads the
    // demo-mode mask flag, so a memo keyed only on the numbers would keep
    // showing real amounts after Demo mode is switched on (docs/features.md §10).
    const summaryText = !summary
        ? 'Add your income and bills to see how this month is shaping up'
        : isZeroMoney(netChange)
            ? 'Income and expenses are balanced this month'
            : netChange > 0
                ? `You're projected to save ${formatCurrency(netChange, currency)} this month`
                : `Expenses exceed income by ${formatCurrency(Math.abs(netChange), currency)}`;

    return (
        <Card className={`border ${colors.border} ${colors.bg}`}>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className={`text-xl font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        Hi {firstName}, here&apos;s your {monthName} overview
                    </h2>
                    <p className={`text-lg mt-1 ${colors.text} font-medium`}>
                        {summaryText}
                    </p>
                </div>

                {summary && (
                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Projected end balance
                        </p>
                        <p className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                            {formatCurrency(summary.endBalance, currency)}
                        </p>
                        {showTrend && trend !== null && (
                            <div className="flex items-center gap-1 justify-end">
                                <span className={trend > 0 ? 'text-green-500' : 'text-red-500'} aria-hidden>
                                    {trend > 0 ? '\u25B2' : '\u25BC'}
                                </span>
                                <span className={`text-sm ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {trend > 0 ? '+' : '\u2212'}{formatCurrency(Math.abs(trend), currency)} vs last month
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                )}
            </div>
        </Card>
    );
}
