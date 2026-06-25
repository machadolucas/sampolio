/**
 * Enable Banking — pure mappers from API JSON to Sampolio types (no I/O).
 *
 * Tolerant by design: missing/odd fields degrade gracefully rather than throw,
 * since real bank responses vary. The action/sync layer assigns stable ids to
 * mapped accounts (re-matching by accountUid/iban across re-consent), so the
 * mappers deliberately produce id-less `MappedBankAccount` records.
 */

import type {
  BankAccountRole,
  BankTransaction,
  BankTransactionStatus,
  Currency,
} from '@/types';
import { CURRENCY_VALUES } from '@/lib/constants';
import { syntheticDedupKey } from './dedup';

// ---------- Raw API shapes (loose) ----------
export interface RawAspsp {
  name?: string;
  country?: string;
}

export interface RawSessionAccount {
  uid?: string;
  account_id?: { iban?: string } | null;
  identification_hash?: string;
  name?: string;
  details?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string; // ISO: CACC, CARD, SVGS, TRAN…
  usage?: string; // PRIV / ORGA
}

export interface RawBalance {
  name?: string;
  balance_amount?: { amount?: string | number; currency?: string } | null;
  balance_type?: string; // ISO: CLBD, XPCD, ITAV, OPBD…
}

export interface RawTransaction {
  entry_reference?: string | null;
  booking_date?: string;
  value_date?: string;
  transaction_amount?: { amount?: string | number; currency?: string } | null;
  credit_debit_indicator?: string; // CRDT | DBIT
  status?: string; // BOOK | PDNG
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  creditor_name?: string;
  debtor_name?: string;
  remittance_information?: string[] | string | null;
  bank_transaction_code?: { description?: string; code?: string } | string | null;
}

export interface MappedBankAccount {
  accountUid: string;
  iban?: string;
  name?: string;
  currency: Currency;
  accountRole: BankAccountRole;
}

export interface MappedBalance {
  type: string;
  amount: number;
  currency: Currency;
}

// ---------- Helpers ----------
export function toCurrency(code?: string | null): Currency {
  if (code && (CURRENCY_VALUES as readonly string[]).includes(code)) {
    return code as Currency;
  }
  return 'EUR';
}

function toNumber(v?: string | number | null): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Map a bank's account-type/usage hints to our coarse role. */
export function inferAccountRole(acct: RawSessionAccount): BankAccountRole {
  const t = (acct.cash_account_type ?? '').toUpperCase();
  const product = (acct.product ?? '').toLowerCase();
  if (t === 'CARD' || product.includes('card') || product.includes('credit')) return 'credit-card';
  if (t === 'SVGS' || product.includes('saving')) return 'savings';
  if (t === 'CACC' || t === 'TRAN' || t === 'CASH') return 'cash';
  return 'other';
}

// ---------- Mappers ----------
export function mapAspsps(rawInput: unknown): { name: string; country: string }[] {
  const raw = (rawInput ?? {}) as { aspsps?: RawAspsp[] };
  const list = raw?.aspsps ?? [];
  return list
    .filter((a): a is RawAspsp => !!a && !!a.name)
    .map((a) => ({ name: a.name!, country: (a.country ?? '').toUpperCase() }));
}

export function mapSessionAccounts(rawInput: unknown): MappedBankAccount[] {
  const raw = (rawInput ?? {}) as { accounts?: RawSessionAccount[] };
  const list = raw?.accounts ?? [];
  return list
    .filter((a): a is RawSessionAccount => !!a && !!a.uid)
    .map((a) => ({
      accountUid: a.uid!,
      iban: a.account_id?.iban ?? undefined,
      name: a.name ?? a.product ?? undefined,
      currency: toCurrency(a.currency),
      accountRole: inferAccountRole(a),
    }));
}

export function mapBalances(rawInput: unknown): MappedBalance[] {
  const raw = (rawInput ?? {}) as { balances?: RawBalance[] };
  const list = raw?.balances ?? [];
  return list
    .filter((b): b is RawBalance => !!b && !!b.balance_amount)
    .map((b) => ({
      type: (b.balance_type ?? '').toUpperCase(),
      amount: toNumber(b.balance_amount?.amount),
      currency: toCurrency(b.balance_amount?.currency),
    }));
}

/** Preference order for the "real" balance we anchor on / display. */
const ANCHOR_BALANCE_PRIORITY = ['CLBD', 'PRCD', 'ITAV', 'XPCD', 'OPBD'];

/** Pick the most authoritative balance (closing booked preferred). */
export function pickAnchorBalance(balances: MappedBalance[]): MappedBalance | null {
  for (const type of ANCHOR_BALANCE_PRIORITY) {
    const found = balances.find((b) => b.type === type);
    if (found) return found;
  }
  return balances[0] ?? null;
}

function counterpartyOf(t: RawTransaction, signedAmount: number): string | undefined {
  // Money out → the creditor is the counterparty; money in → the debtor.
  const creditor = t.creditor?.name ?? t.creditor_name;
  const debtor = t.debtor?.name ?? t.debtor_name;
  if (signedAmount < 0) return creditor ?? debtor ?? undefined;
  return debtor ?? creditor ?? undefined;
}

function remittanceOf(t: RawTransaction): string | undefined {
  const r = t.remittance_information;
  if (!r) return undefined;
  if (Array.isArray(r)) {
    const joined = r.filter(Boolean).join(' ').trim();
    return joined || undefined;
  }
  return r.trim() || undefined;
}

function bankCodeOf(t: RawTransaction): string | undefined {
  const c = t.bank_transaction_code;
  if (!c) return undefined;
  if (typeof c === 'string') return c;
  return c.description ?? c.code ?? undefined;
}

function mapStatus(raw?: string): BankTransactionStatus {
  const s = (raw ?? '').toUpperCase();
  if (s === 'BOOK' || s === 'BOOKED') return 'booked';
  if (s === 'PDNG' || s === 'PENDING') return 'pending';
  return 'other';
}

export function mapTransactions(
  rawInput: unknown,
  linkedAccountId: string,
  nowIso: string,
  idFactory: () => string
): { transactions: BankTransaction[]; continuationKey?: string } {
  const raw = (rawInput ?? {}) as { transactions?: RawTransaction[]; continuation_key?: string };
  const list = raw?.transactions ?? [];
  const transactions: BankTransaction[] = list
    .filter((t): t is RawTransaction => !!t)
    .map((t) => {
      const magnitude = Math.abs(toNumber(t.transaction_amount?.amount));
      const indicator = (t.credit_debit_indicator ?? '').toUpperCase();
      const signedAmount = indicator === 'DBIT' ? -magnitude : magnitude;
      const currency = toCurrency(t.transaction_amount?.currency);
      const status = mapStatus(t.status);
      const valueDate = t.value_date || undefined;
      const bookingDate = t.booking_date || valueDate || nowIso.slice(0, 10);
      const counterpartyName = counterpartyOf(t, signedAmount);
      const remittanceInfo = remittanceOf(t);
      const entryReference = t.entry_reference ?? undefined;

      const dedupKey =
        status === 'booked' && entryReference
          ? entryReference
          : syntheticDedupKey({
              amount: signedAmount,
              currency,
              counterpartyName,
              remittanceInfo,
              valueDate,
            });

      return {
        id: idFactory(),
        linkedAccountId,
        dedupKey,
        entryReference,
        bookingDate,
        valueDate,
        amount: signedAmount,
        currency,
        status,
        counterpartyName,
        remittanceInfo,
        bankTransactionCode: bankCodeOf(t),
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
      } satisfies BankTransaction;
    });

  return { transactions, continuationKey: raw?.continuation_key };
}
