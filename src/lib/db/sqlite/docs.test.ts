import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useTempDataDir } from '@/test/temp-data-dir';
import { closeDb } from './client';
import {
  countRows,
  deleteRows,
  distinctValues,
  getDoc,
  inTx,
  insertDoc,
  listDocs,
  nextSeq,
  putDoc,
  replaceSeqDocs,
} from './docs';
import { bankTransaction, goal, splitExpense } from './schema';

let tmp: ReturnType<typeof useTempDataDir>;

beforeAll(() => {
  closeDb();
  tmp = useTempDataDir('sampolio-docs-test-');
});

afterAll(() => {
  closeDb();
  tmp.cleanup();
});

beforeEach(() => {
  deleteRows(goal, {});
  deleteRows(bankTransaction, {});
  deleteRows(splitExpense, {});
});

describe('document rows', () => {
  it('round-trips the exact JSON and upserts by primary key', () => {
    const doc = { id: 'g-1', name: 'Buffer', nested: { list: [1, 2] }, legacy: null };
    putDoc(goal, { userId: 'alex', id: 'g-1' }, doc);
    expect(getDoc(goal, { userId: 'alex', id: 'g-1' })).toEqual(doc);
    putDoc(goal, { userId: 'alex', id: 'g-1' }, { ...doc, name: 'Renamed' });
    expect(countRows(goal)).toBe(1);
    expect(getDoc<typeof doc>(goal, { userId: 'alex', id: 'g-1' })?.name).toBe('Renamed');
    expect(getDoc(goal, { userId: 'sam', id: 'g-1' })).toBeNull();
  });

  it('insertDoc refuses a key collision', () => {
    insertDoc(goal, { userId: 'alex', id: 'g-1' }, {});
    expect(() => insertDoc(goal, { userId: 'alex', id: 'g-1' }, {})).toThrow(/UNIQUE|PRIMARY/);
  });

  it('rejects unknown columns', () => {
    expect(() => listDocs(goal, { nope: 'x' })).toThrow(/Unknown column/);
    expect(() => putDoc(goal, { userId: 'a', id: 'b', 'id" OR 1=1 --': 'x' }, {})).toThrow(/Unknown column/);
  });

  it('inTx rolls back every write when the callback throws', () => {
    expect(() =>
      inTx(() => {
        putDoc(goal, { userId: 'alex', id: 'g-1' }, {});
        putDoc(goal, { userId: 'alex', id: 'g-2' }, {});
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(countRows(goal)).toBe(0);
  });

  it('replaceSeqDocs keeps list order, including identical rows', () => {
    const scope = { userId: 'alex', linkedAccountId: 'link-1' };
    const rows = [{ k: 'b' }, { k: 'a' }, { k: 'a' }];
    replaceSeqDocs(bankTransaction, scope, rows);
    expect(listDocs(bankTransaction, scope, 'seq')).toEqual(rows);
    expect(listDocs(bankTransaction, scope, 'seq-desc')).toEqual([...rows].reverse());
    expect(nextSeq(bankTransaction, scope)).toBe(3);
    replaceSeqDocs(bankTransaction, scope, [{ k: 'z' }]);
    expect(listDocs(bankTransaction, scope, 'seq')).toEqual([{ k: 'z' }]);
    replaceSeqDocs(bankTransaction, scope, []);
    expect(countRows(bankTransaction, scope)).toBe(0);
    expect(nextSeq(bankTransaction, scope)).toBe(0);
  });

  it('distinctValues lists a column ascending and deleteRows reports its count', () => {
    for (const [id, ym] of [['e1', '2026-09'], ['e2', '2026-07'], ['e3', '2026-09']]) {
      putDoc(splitExpense, { groupId: 'g', id, yearMonth: ym, seq: 0 }, { id });
    }
    expect(distinctValues(splitExpense, 'yearMonth', { groupId: 'g' })).toEqual(['2026-07', '2026-09']);
    expect(deleteRows(splitExpense, { groupId: 'g', yearMonth: '2026-09' })).toBe(2);
  });
});
