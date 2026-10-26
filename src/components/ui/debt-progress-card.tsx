'use client';

import type { Debt } from '@/types';
import type { DebtPayoffInfo } from '@/lib/debt-utils';
import { formatCurrency, formatYearMonth } from '@/lib/constants';
import { useTheme } from '@/components/providers/theme-provider';

interface DebtProgressCardProps {
  debt: Debt;
  payoffInfo: DebtPayoffInfo;
  isSimpleMode?: boolean;
}

function getProgressColor(percentPaid: number, isDark: boolean): string {
  if (percentPaid > 50) {
    return 'bg-green-500';
  }
  if (percentPaid >= 25) {
    return 'bg-yellow-500';
  }
  return isDark ? 'bg-blue-400' : 'bg-blue-500';
}

function getProgressTrackColor(): string {
  return 'bg-muted';
}

export function DebtProgressCard({ debt, payoffInfo, isSimpleMode }: DebtProgressCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const progressColor = getProgressColor(payoffInfo.percentPaid, isDark);
  const trackColor = getProgressTrackColor();

  const displayPercent = Math.round(payoffInfo.percentPaid * 10) / 10;

  return (
    <div
      className="rounded-xl border p-4 border-border bg-card"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-base font-semibold text-foreground"
        >
          {debt.name}
        </h3>
        {!isSimpleMode && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
          >
            {debt.debtType === 'amortized' ? 'Amortized' : 'Fixed installment'}
            {debt.interestModelType === 'variable' && ' · Variable rate'}
            {debt.interestModelType === 'fixed' && ' · Fixed rate'}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className={`h-3 w-full overflow-hidden rounded-full ${trackColor}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${progressColor}`}
          style={{ width: `${Math.min(100, Math.max(0, payoffInfo.percentPaid))}%` }}
        />
      </div>

      {/* Progress text */}
      <p
        className="mt-2 text-sm text-muted-foreground"
      >
        <span className="font-medium">{displayPercent}% paid off</span>
        {' · '}
        {formatCurrency(payoffInfo.remaining, debt.currency)} remaining of{' '}
        {formatCurrency(payoffInfo.principalBase, debt.currency)}
      </p>

      {/* Details row */}
      <div
        className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground"
      >
        {payoffInfo.monthlyPayment > 0 && (
          <span>
            Monthly payment: {formatCurrency(payoffInfo.monthlyPayment, debt.currency)}
          </span>
        )}
        {payoffInfo.estimatedPayoffDate && (
          <span>
            Payoff: {formatYearMonth(payoffInfo.estimatedPayoffDate)}
          </span>
        )}
      </div>
    </div>
  );
}
