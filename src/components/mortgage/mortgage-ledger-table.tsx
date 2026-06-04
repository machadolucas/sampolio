'use client';

import { useEffect, useMemo, useRef } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { InputSwitch } from 'primereact/inputswitch';
import { Tooltip } from 'primereact/tooltip';
import { Tag } from 'primereact/tag';
import { formatCurrency, formatYearMonthShort, formatRate } from '@/lib/constants';
import { getCurrentYearMonth } from '@/lib/projection';
import type { SharedMortgage, MortgageProjectionMonth, Currency } from '@/types';

interface LedgerRow {
  yearMonth: string;
  label: string;
  isHistorical: boolean;
  isActual: boolean;
  rate: number;
  totalRemaining: number;
  totalRepayment: number;
  totalInterest: number;
  totalSubsidy: number;
  totalInsurance: number;
  fees: number;
  perLoan: Record<string, { remaining: number; repayment: number; interest: number; insurance: number }>;
  deposits: Record<string, number>;
}

/** Column header with a teaching tooltip. */
function Hdr({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <i className="pi pi-info-circle text-xs opacity-40" data-pr-tooltip={tip} data-pr-position="top" />
    </span>
  );
}

export function MortgageLedgerTable({
  months,
  mortgage,
  currency,
  showBreakdown,
  onToggleBreakdown,
  isSimple,
}: {
  months: MortgageProjectionMonth[];
  mortgage: SharedMortgage;
  currency: Currency;
  showBreakdown: boolean;
  onToggleBreakdown: (v: boolean) => void;
  isSimple: boolean;
}) {
  const rows = useMemo<LedgerRow[]>(
    () =>
      months.map((m) => ({
        yearMonth: m.yearMonth,
        label: formatYearMonthShort(m.yearMonth),
        isHistorical: m.isHistorical,
        isActual: m.isAllActual,
        rate: m.loans[0]?.effectiveAnnualRate ?? 0,
        totalRemaining: m.totalRemaining,
        totalRepayment: m.totalCharge, // full bank charge (matches the spreadsheet's "total repayment")
        totalInterest: m.totalInterest,
        totalSubsidy: m.totalSubsidy,
        totalInsurance: m.totalInsurance,
        fees: m.invoicingFee + m.serviceFee,
        perLoan: Object.fromEntries(
          m.loans.map((l) => [l.loanId, { remaining: l.endingPrincipal, repayment: l.monthlyCharge, interest: l.interestPaid, insurance: l.insurance }])
        ),
        deposits: Object.fromEntries(m.members.map((p) => [p.userId, p.monthlyDeposit])),
      })),
    [months]
  );

  // Cumulative "paid so far" totals come from the latest historical row.
  const lastHistorical = [...months].reverse().find((m) => m.isHistorical) ?? months[months.length - 1];
  const hasSubsidy = months.some((m) => m.totalSubsidy > 0.005);

  const cur = (v: number) => formatCurrency(v, currency);
  const currentMonth = getCurrentYearMonth();
  // Forecast (computed) rows are dimmed; recorded actuals are shown solid. The
  // current month is highlighted so it's easy to find in the full history.
  const rowClass = (row: LedgerRow) =>
    `${row.isActual ? '' : 'opacity-70'} ${row.yearMonth === currentMonth ? 'ledger-current font-bold' : ''}`.trim();

  // On mount (and when the breakdown toggles), scroll the current month to the
  // middle of the scroll area so the ledger opens centered on "now". Retried a
  // few times because the page re-renders once its data loads (which resets the
  // scroll position).
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const center = () => {
      const wrap = containerRef.current?.querySelector('.p-datatable-wrapper') as HTMLElement | null;
      const row = wrap?.querySelector('tr.ledger-current') as HTMLElement | null;
      if (!wrap || !row) return;
      const wrapRect = wrap.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      wrap.scrollTop += rowRect.top - wrapRect.top - wrap.clientHeight / 2 + rowRect.height / 2;
    };
    const timers = [200, 500, 900, 1400].map((d) => setTimeout(center, d));
    return () => timers.forEach(clearTimeout);
  }, [months.length, showBreakdown]);

  const loanCol = (loanId: string, field: 'remaining' | 'repayment' | 'interest' | 'insurance', label: string) => (
    <Column
      key={`${loanId}-${field}`}
      header={label}
      body={(r: LedgerRow) => cur(r.perLoan[loanId]?.[field] ?? 0)}
      style={{ minWidth: '110px' }}
      align="right"
    />
  );

  return (
    <div ref={containerRef}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Payment schedule</h2>
          <p className="text-sm opacity-60">Every month from the start of the loan. <b>Actual</b> rows are your imported bank figures; <b>forecast</b> rows (dimmed) are projected.</p>
        </div>
        {!isSimple && (
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-70">Loan-by-loan breakdown</span>
            <InputSwitch checked={showBreakdown} onChange={(e) => onToggleBreakdown(e.value)} />
          </div>
        )}
      </div>

      <Tooltip target="[data-pr-tooltip]" />

      <DataTable
        value={rows}
        scrollable
        scrollHeight="560px"
        size="small"
        stripedRows
        rowClassName={rowClass}
        dataKey="yearMonth"
      >
        <Column
          header="Month"
          body={(r: LedgerRow) => (
            <span className="whitespace-nowrap">
              {r.label}
              {r.isActual ? (
                <Tag value="actual" severity="success" className="ml-2 text-xs" />
              ) : (
                <Tag value="forecast" severity="info" className="ml-2 text-xs" />
              )}
            </span>
          )}
          style={{ minWidth: '140px' }}
        />
        <Column header={<Hdr label="Rate" tip="Yearly interest rate = Euribor + the bank's fixed margin." />} body={(r: LedgerRow) => formatRate(r.rate)} style={{ minWidth: '90px' }} align="right" />

        {/* Remaining loan */}
        {showBreakdown && mortgage.loans.map((l) => loanCol(l.id, 'remaining', l.label))}
        <Column
          header={<Hdr label="Total remaining" tip="What's still owed across all loans (the sum of the loan columns)." />}
          body={(r: LedgerRow) => <span className="font-semibold">{cur(r.totalRemaining)}</span>}
          footer={cur(lastHistorical?.totalRemaining ?? 0)}
          style={{ minWidth: '130px' }}
          align="right"
        />

        {/* Repayment */}
        {showBreakdown && mortgage.loans.map((l) => loanCol(l.id, 'repayment', `${l.label} pay`))}
        <Column
          header={<Hdr label="Repayment" tip="The principal + interest you pay this month (the bank's installment), before insurance/fees." />}
          body={(r: LedgerRow) => cur(r.totalRepayment)}
          style={{ minWidth: '120px' }}
          align="right"
        />

        {/* Interest */}
        {showBreakdown && mortgage.loans.map((l) => loanCol(l.id, 'interest', `${l.label} int.`))}
        <Column
          header={<Hdr label="Interest" tip="The part of this month's payment that is interest (the cost of borrowing), after any ASP subsidy." />}
          body={(r: LedgerRow) => cur(r.totalInterest)}
          footer={cur(lastHistorical?.cumInterestPaid ?? 0)}
          style={{ minWidth: '110px' }}
          align="right"
        />

        {hasSubsidy && (
          <Column header={<Hdr label="ASP subsidy" tip="Interest the government pays on the ASP loan when the rate is above the threshold." />} body={(r: LedgerRow) => cur(r.totalSubsidy)} style={{ minWidth: '110px' }} align="right" />
        )}

        {!isSimple && (
          <>
            {showBreakdown && mortgage.loans.map((l) => loanCol(l.id, 'insurance', `${l.label} ins.`))}
            <Column
              header={<Hdr label="Insurance" tip="Loan protection insurance — a separate cost, not part of paying down the loan." />}
              body={(r: LedgerRow) => cur(r.totalInsurance)}
              footer={cur(lastHistorical?.cumInsurancePaid ?? 0)}
              style={{ minWidth: '110px' }}
              align="right"
            />
            <Column
              header={<Hdr label="Fees" tip="Invoicing fee + bank service fee for the month." />}
              body={(r: LedgerRow) => cur(r.fees)}
              footer={cur(lastHistorical?.cumFeesPaid ?? 0)}
              style={{ minWidth: '90px' }}
              align="right"
            />
          </>
        )}

        {/* What each person transfers to the loan account this month */}
        {mortgage.members.map((m) => (
          <Column
            key={`deposit-${m.userId}`}
            header={<Hdr label={`${m.name} transfers`} tip={`What ${m.name} pays into the loan account this month: their share of the installment plus the per-person service fee.`} />}
            body={(r: LedgerRow) => <span className="font-medium">{cur(r.deposits[m.userId] ?? 0)}</span>}
            style={{ minWidth: '120px' }}
            align="right"
          />
        ))}
      </DataTable>
      <p className="text-xs opacity-50 mt-2">Footer totals show what&apos;s been paid so far (up to this month).</p>
    </div>
  );
}
