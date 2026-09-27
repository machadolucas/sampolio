import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeUserDataFromExport, readUserDataForExport } from './data-transfer';
import { getAccounts } from './accounts';
import { getRecurringItems } from './recurring-items';
import { getGoals } from './goals';
import { getTrips } from './trips';
import { getBalanceSnapshots } from './reconciliation';
import { getUserDir, writeEncryptedFile } from './encryption';
import { dataExportSchema, MAX_IMPORT_ROWS_PER_ARRAY } from '@/lib/schemas/data-transfer.schema';
import type { DataExport } from '@/lib/schemas/data-transfer.schema';
import { createMockAccount, createMockRecurringItem, createMockPlannedItem } from '@/test/mocks';
import type { BalanceSnapshot, Goal, Trip } from '@/types';

/** Real disk round-trips of the JSON backup writer (encrypted write → decrypt read). */
describe('data-transfer db layer', () => {
  let dataDir: string;
  const userId = 'import-user';

  const account = createMockAccount({ id: 'acc-1', userId: 'export-user' });
  const recurring = createMockRecurringItem({ id: 'rec-1', accountId: 'acc-1' });
  const goal: Goal = {
    id: 'goal-1', userId: 'export-user', name: 'Emergency fund', targetAmount: 10000,
    currency: 'EUR', trackingMethod: 'manual', currentManualAmount: 500, isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const snapshot: BalanceSnapshot = {
    id: 'snap-1', userId: 'export-user', entityType: 'cash-account', entityId: 'acc-1',
    yearMonth: '2026-06', expectedBalance: 100, actualBalance: 120, variance: 20,
    source: 'manual', createdAt: '2026-06-01T00:00:00.000Z',
  };

  const payload: DataExport = {
    format: 'sampolio-export',
    version: 1,
    exportedAt: '2026-07-03T00:00:00.000Z',
    userId: 'export-user',
    entities: {
      accounts: [{ ...account, recurringItems: [recurring], plannedItems: [], salaryConfigs: [], taxedIncomes: [] }],
      investments: [],
      debts: [],
      receivables: [],
      goals: [goal],
      budgets: [],
      reconciliation: { snapshots: [snapshot], adjustments: [], sessions: [] },
      preferences: null,
    },
    notIncluded: [],
  };

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `sampolio-data-transfer-test-${process.pid}`);
    process.env.DATA_DIR = dataDir;
  });

  afterAll(async () => {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('the schema accepts a real payload and rejects garbage', () => {
    expect(dataExportSchema.safeParse(payload).success).toBe(true);
    expect(dataExportSchema.safeParse({ hello: 'world' }).success).toBe(false);
    expect(dataExportSchema.safeParse({ ...payload, format: 'other' }).success).toBe(false);
  });

  it('imports a payload, rewriting userId and preserving ids', async () => {
    const counts = await writeUserDataFromExport(userId, payload, 'merge');
    expect(counts).toMatchObject({ accounts: 1, accountSubItems: 1, goals: 1, snapshots: 1 });

    const accounts = await getAccounts(userId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('acc-1');
    expect(accounts[0].userId).toBe(userId);

    const items = await getRecurringItems(userId, 'acc-1');
    expect(items.map((i) => i.id)).toEqual(['rec-1']);

    const goals = await getGoals(userId);
    expect(goals.map((g) => g.id)).toEqual(['goal-1']);
    expect(goals[0].userId).toBe(userId);

    const snapshots = await getBalanceSnapshots(userId);
    expect(snapshots.map((s) => s.id)).toEqual(['snap-1']);
  });

  it('merge mode upserts by id and keeps unrelated entities', async () => {
    // Pre-existing goal not present in the payload must survive a merge.
    const extraGoal: Goal = { ...goal, id: 'goal-keep', name: 'Keep me' };
    await writeEncryptedFile(path.join(getUserDir(userId), 'goals', 'goal-keep.enc'), extraGoal);

    const modified: DataExport = {
      ...payload,
      entities: { ...payload.entities, goals: [{ ...goal, name: 'Renamed fund' }] },
    };
    await writeUserDataFromExport(userId, modified, 'merge');

    const goals = await getGoals(userId);
    expect(goals).toHaveLength(2);
    expect(goals.find((g) => g.id === 'goal-1')?.name).toBe('Renamed fund');
    expect(goals.find((g) => g.id === 'goal-keep')?.name).toBe('Keep me');
  });

  it('replace mode wipes exported entity types but never bank data', async () => {
    const bankDir = path.join(getUserDir(userId), 'bank-connections');
    await fs.mkdir(bankDir, { recursive: true });
    const bankFile = path.join(bankDir, 'conn-1.enc');
    await fs.writeFile(bankFile, 'sentinel');

    await writeUserDataFromExport(userId, payload, 'replace');

    const goals = await getGoals(userId);
    expect(goals.map((g) => g.id)).toEqual(['goal-1']); // goal-keep wiped by replace
    await expect(fs.readFile(bankFile, 'utf8')).resolves.toBe('sentinel');
  });

  describe('trips (export v2)', () => {
    const trip: Trip = {
      id: 'trip-1', userId: 'export-user', name: 'Berlin conference', destinationCountry: 'DE',
      startDateTime: '2026-05-04T07:00', endDateTime: '2026-05-06T21:00',
      days: [
        { date: '2026-05-04', countryCode: 'DE', freeMeals: 0 },
        { date: '2026-05-05', countryCode: 'DE', freeMeals: 0 },
        { date: '2026-05-06', countryCode: 'DE', freeMeals: 0 },
      ],
      rates: { domesticFull: 54, domesticPartial: 25, defaultForeign: 80, countryRates: { DE: 69 } },
      linkedAccountId: 'acc-1', expectedReimbursementMonth: '2026-06', status: 'planned',
      createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z',
    };
    const budget = {
      id: 'budget-1', startMonth: '2026-05', endMonth: '2026-05',
      fundingSources: [{ id: 'f-1', kind: 'per-diem', amount: 1, linkedTripId: 'trip-1' }],
    };
    const v2 = (trips: unknown[] | undefined): DataExport => ({
      ...payload,
      version: 2,
      entities: { ...payload.entities, budgets: [budget] as unknown as DataExport['entities']['budgets'], trips: trips as Trip[] | undefined },
    });
    const tripUser = 'trip-import-user';

    it('restores trips with their ids so budget trip links still resolve', async () => {
      expect(dataExportSchema.safeParse(v2([trip])).success).toBe(true);
      const counts = await writeUserDataFromExport(tripUser, v2([trip]), 'replace');
      expect(counts.trips).toBe(1);
      const trips = await getTrips(tripUser);
      expect(trips.map((t) => [t.id, t.userId])).toEqual([['trip-1', tripUser]]);
      const exported = await readUserDataForExport(tripUser);
      const linked = (exported.budgets[0] as unknown as typeof budget).fundingSources[0].linkedTripId;
      expect(exported.trips?.map((t) => t.id)).toContain(linked);
    });

    it('a v1 backup (no trips key) imports and never wipes existing trips, even in replace mode', async () => {
      const v1 = { ...payload, version: 1 } as DataExport;
      expect(dataExportSchema.safeParse(v1).success).toBe(true);
      const counts = await writeUserDataFromExport(tripUser, v1, 'replace');
      expect(counts.trips).toBeNull();
      expect((await getTrips(tripUser)).map((t) => t.id)).toEqual(['trip-1']);
    });

    it('a v2 replace with an empty trips array does remove existing trips', async () => {
      await writeUserDataFromExport(tripUser, v2([]), 'replace');
      expect(await getTrips(tripUser)).toEqual([]);
    });

    it('export reads fresh from disk (no cache) and round-trips through the schema', async () => {
      await writeUserDataFromExport(tripUser, v2([trip]), 'merge');
      await writeEncryptedFile(path.join(getUserDir(tripUser), 'trips', 'trip-2.enc'), { ...trip, id: 'trip-2' });
      const entities = await readUserDataForExport(tripUser);
      expect(entities.trips?.map((t) => t.id).sort()).toEqual(['trip-1', 'trip-2']);
      expect(entities.accounts[0].recurringItems.map((i) => i.id)).toEqual(['rec-1']);
      expect(dataExportSchema.safeParse({ ...payload, version: 2, entities }).success).toBe(true);
    });

    it('rejects trip rows the per-diem engine would choke on', () => {
      const bad = (o: Record<string, unknown>) => dataExportSchema.safeParse(v2([{ ...trip, ...o }])).success;
      expect(bad({ id: '../x' })).toBe(false);
      expect(bad({ startDateTime: '2026-05-04' })).toBe(false);
      expect(bad({ endDateTime: '2026-05-03T07:00' })).toBe(false); // ends before it starts
      expect(bad({ startDateTime: '0001-01-01T00:00', endDateTime: '9999-12-31T23:59' })).toBe(false); // unbounded span
      expect(bad({ expectedReimbursementMonth: '2026-13' })).toBe(false);
      expect(bad({ rates: {} })).toBe(false);
      expect(bad({ futureField: 1 })).toBe(true); // unknown fields still round-trip
    });
  });

  describe('hostile payloads', () => {
    const withGoals = (goals: unknown[]) => ({ ...payload, entities: { ...payload.entities, goals } });
    const withAccount = (overrides: Record<string, unknown>) => ({
      ...payload,
      entities: { ...payload.entities, accounts: [{ ...payload.entities.accounts[0], ...overrides }] },
    });

    it('the schema rejects path-traversal ids anywhere in the payload', () => {
      expect(dataExportSchema.safeParse(withGoals([{ ...goal, id: '../../../app-settings' }])).success).toBe(false);
      expect(dataExportSchema.safeParse(withAccount({ id: '../../sam' })).success).toBe(false);
      expect(
        dataExportSchema.safeParse(withAccount({ recurringItems: [{ ...recurring, id: 'a/b' }] })).success
      ).toBe(false);
      expect(
        dataExportSchema.safeParse({
          ...payload,
          entities: { ...payload.entities, reconciliation: { ...payload.entities.reconciliation, snapshots: [{ ...snapshot, id: '..' }] } },
        }).success
      ).toBe(false);
    });

    it('the writer rejects a traversal id before replace mode deletes anything', async () => {
      const outside = path.join(dataDir, 'app-settings.enc');
      const hostile = withGoals([{ ...goal, id: '../../../app-settings', selfSignupEnabled: true }]) as DataExport;
      await expect(writeUserDataFromExport(userId, hostile, 'replace')).rejects.toThrow(/Invalid id/);
      await expect(fs.access(outside)).rejects.toThrow();
      // Nothing was wiped: the previous import is intact.
      expect((await getGoals(userId)).map((g) => g.id)).toEqual(['goal-1']);
    });

    it('rejects planned/recurring rows that would stall the projection loops', () => {
      const planned = (o: Record<string, unknown>) =>
        withAccount({ plannedItems: [createMockPlannedItem({ id: 'p-1', kind: 'repeating', frequency: 'custom', firstOccurrence: '2026-01', ...o })] });
      expect(dataExportSchema.safeParse(planned({ customIntervalMonths: 12 })).success).toBe(true);
      expect(dataExportSchema.safeParse(planned({ customIntervalMonths: 0.5 })).success).toBe(false);
      expect(dataExportSchema.safeParse(planned({ customIntervalMonths: 0 })).success).toBe(false);
      expect(dataExportSchema.safeParse(planned({ firstOccurrence: '2026-1.5' })).success).toBe(false);
      expect(dataExportSchema.safeParse(planned({ frequency: 'hourly' })).success).toBe(false);
      expect(dataExportSchema.safeParse(planned({ endDate: '' })).success).toBe(true);
      expect(
        dataExportSchema.safeParse(withAccount({ recurringItems: [{ ...recurring, startDate: '2026-13' }] })).success
      ).toBe(false);
      expect(dataExportSchema.safeParse(withAccount({ planningHorizonMonths: 1e9 })).success).toBe(false);
      expect(dataExportSchema.safeParse(withAccount({ customEndDate: 'zzzz' })).success).toBe(false);
    });

    it('accepts the custom-end-date horizon (-1) and rejects budget periods that would stall', () => {
      expect(dataExportSchema.safeParse(withAccount({ planningHorizonMonths: -1, customEndDate: '2030-12' })).success).toBe(true);
      expect(dataExportSchema.safeParse(withAccount({ planningHorizonMonths: -2 })).success).toBe(false);
      const withBudget = (b: Record<string, unknown>) => ({
        ...payload,
        entities: { ...payload.entities, budgets: [{ id: 'b-1', startMonth: '2026-01', endMonth: '2026-03', ...b }] },
      });
      expect(dataExportSchema.safeParse(withBudget({})).success).toBe(true);
      expect(dataExportSchema.safeParse(withBudget({ startMonth: 'NaN-NaN', endMonth: 'NaN-NaN' })).success).toBe(false);
      expect(dataExportSchema.safeParse(withBudget({ lines: [{ id: 'l-1', startMonth: '2026-1.5' }] })).success).toBe(false);
    });

    it('keeps unknown fields for round-trips', () => {
      const parsed = dataExportSchema.parse(withGoals([{ ...goal, futureField: { a: 1 } }]));
      expect((parsed.entities.goals[0] as Record<string, unknown>).futureField).toEqual({ a: 1 });
    });

    it('caps row counts', () => {
      const many = Array.from({ length: MAX_IMPORT_ROWS_PER_ARRAY + 1 }, (_, i) => ({ id: `g-${i}` }));
      expect(dataExportSchema.safeParse(withGoals(many)).success).toBe(false);
    });
  });
});
