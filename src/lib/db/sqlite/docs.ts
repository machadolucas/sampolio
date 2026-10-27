import type Database from 'better-sqlite3';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getSqlite } from './client';

/**
 * Document-row access for the finance tables (`schema/finance.ts`).
 *
 * Every row holds one entity's JSON in `data`; the other columns are keys.
 * The helpers are synchronous (better-sqlite3), so a read-modify-write wrapped
 * in `inTx` runs to completion before any other request's code can touch the
 * same rows — no interleaving, no torn multi-row writes. Nested `inTx` calls
 * become savepoints.
 *
 * Column names in `where`/`keys` are checked against the table definition;
 * every value is a bound parameter.
 */

type Scalar = string | number;
export type Keys = Record<string, Scalar>;
export type SeqOrder = 'seq' | 'seq-desc';

interface TableMeta {
  name: string;
  columns: Set<string>;
  pk: string[];
  hasSeq: boolean;
  hasData: boolean;
}

const metaCache = new WeakMap<SQLiteTable, TableMeta>();

function tableMeta(table: SQLiteTable): TableMeta {
  const cached = metaCache.get(table);
  if (cached) return cached;
  const columns = Object.values(getTableColumns(table)).map((c) => c.name);
  const config = getTableConfig(table);
  const pk =
    config.primaryKeys[0]?.columns.map((c) => c.name) ??
    Object.values(getTableColumns(table))
      .filter((c) => c.primary)
      .map((c) => c.name);
  const meta: TableMeta = {
    name: getTableName(table),
    columns: new Set(columns),
    pk,
    hasSeq: columns.includes('seq'),
    hasData: columns.includes('data'),
  };
  metaCache.set(table, meta);
  return meta;
}

const stmtCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

function stmt(sql: string): Database.Statement {
  const sqlite = getSqlite();
  let byDb = stmtCache.get(sqlite);
  if (!byDb) {
    byDb = new Map();
    stmtCache.set(sqlite, byDb);
  }
  let s = byDb.get(sql);
  if (!s) {
    s = sqlite.prepare(sql);
    byDb.set(sql, s);
  }
  return s;
}

const q = (name: string) => `"${name}"`;

function whereClause(meta: TableMeta, where: Keys): { sql: string; values: Scalar[] } {
  const cols = Object.keys(where);
  for (const c of cols) {
    if (!meta.columns.has(c)) throw new Error(`Unknown column ${c} on ${meta.name}`);
  }
  if (cols.length === 0) return { sql: '', values: [] };
  return { sql: ` WHERE ${cols.map((c) => `${q(c)} = ?`).join(' AND ')}`, values: cols.map((c) => where[c]) };
}

function orderClause(meta: TableMeta, order?: SeqOrder): string {
  if (order === 'seq') return ' ORDER BY "seq" ASC';
  if (order === 'seq-desc') return ' ORDER BY "seq" DESC';
  return ` ORDER BY ${meta.pk.map(q).join(', ')}`;
}

/** Run `fn` in one transaction (a savepoint when already inside one). */
export function inTx<T>(fn: () => T): T {
  return getSqlite().transaction(fn)();
}

/** A row's key columns plus its parsed `data`. */
export interface DocRow<T> {
  keys: Keys;
  doc: T;
}

/** Raw rows (key columns + parsed `data` as `doc`). */
export function listRows<T>(table: SQLiteTable, where: Keys = {}, order?: SeqOrder): DocRow<T>[] {
  const meta = tableMeta(table);
  const w = whereClause(meta, where);
  const rows = stmt(`SELECT * FROM ${q(meta.name)}${w.sql}${orderClause(meta, order)}`).all(...w.values) as Record<
    string,
    Scalar
  >[];
  return rows.map((r) => {
    const { data, ...keys } = r;
    return { keys, doc: (meta.hasData ? JSON.parse(data as string) : undefined) as T };
  });
}

export function listDocs<T>(table: SQLiteTable, where: Keys = {}, order?: SeqOrder): T[] {
  return listRows<T>(table, where, order).map((r) => r.doc);
}

export function getDoc<T>(table: SQLiteTable, where: Keys): T | null {
  const meta = tableMeta(table);
  const w = whereClause(meta, where);
  const row = stmt(`SELECT "data" FROM ${q(meta.name)}${w.sql} LIMIT 1`).get(...w.values) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

/**
 * Insert or replace one row. `keys` must cover the primary key and every
 * other non-`data` column (e.g. `seq`, `yearMonth`); on conflict the non-PK
 * columns and `data` are overwritten.
 */
export function putDoc(table: SQLiteTable, keys: Keys, doc?: unknown): void {
  const meta = tableMeta(table);
  const cols = Object.keys(keys);
  for (const c of cols) {
    if (!meta.columns.has(c)) throw new Error(`Unknown column ${c} on ${meta.name}`);
  }
  const values: Scalar[] = cols.map((c) => keys[c]);
  if (meta.hasData) {
    cols.push('data');
    values.push(JSON.stringify(doc));
  }
  const updates = cols.filter((c) => !meta.pk.includes(c));
  const conflict = updates.length
    ? `DO UPDATE SET ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`
    : 'DO NOTHING';
  stmt(
    `INSERT INTO ${q(meta.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
      `ON CONFLICT(${meta.pk.map(q).join(', ')}) ${conflict}`,
  ).run(...values);
}

/** Plain INSERT (no upsert): a primary-key collision throws. Used by the importer. */
export function insertDoc(table: SQLiteTable, keys: Keys, doc?: unknown): void {
  const meta = tableMeta(table);
  const cols = Object.keys(keys);
  for (const c of cols) {
    if (!meta.columns.has(c)) throw new Error(`Unknown column ${c} on ${meta.name}`);
  }
  const values: Scalar[] = cols.map((c) => keys[c]);
  if (meta.hasData) {
    cols.push('data');
    values.push(JSON.stringify(doc));
  }
  stmt(`INSERT INTO ${q(meta.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
    ...values,
  );
}

/** The stored `data` text of the row with exactly these keys (undefined when missing). */
export function getRawData(table: SQLiteTable, keys: Keys): string | null | undefined {
  const meta = tableMeta(table);
  const w = whereClause(meta, keys);
  const row = stmt(`SELECT ${meta.hasData ? '"data"' : 'NULL'} AS d FROM ${q(meta.name)}${w.sql}`).get(...w.values) as
    | { d: string | null }
    | undefined;
  return row ? row.d : undefined;
}

/** Delete matching rows; returns how many were removed. */
export function deleteRows(table: SQLiteTable, where: Keys): number {
  const meta = tableMeta(table);
  const w = whereClause(meta, where);
  return stmt(`DELETE FROM ${q(meta.name)}${w.sql}`).run(...w.values).changes;
}

export function countRows(table: SQLiteTable, where: Keys = {}): number {
  const meta = tableMeta(table);
  const w = whereClause(meta, where);
  return (stmt(`SELECT count(*) AS n FROM ${q(meta.name)}${w.sql}`).get(...w.values) as { n: number }).n;
}

/** Smallest/largest `seq` in scope (null when empty). */
export function seqBounds(table: SQLiteTable, where: Keys): { min: number; max: number } | null {
  const meta = tableMeta(table);
  const w = whereClause(meta, where);
  const row = stmt(`SELECT min("seq") AS lo, max("seq") AS hi FROM ${q(meta.name)}${w.sql}`).get(...w.values) as {
    lo: number | null;
    hi: number | null;
  };
  return row.lo === null || row.hi === null ? null : { min: row.lo, max: row.hi };
}

/** `seq` for a row appended at the end of the scope. */
export function nextSeq(table: SQLiteTable, where: Keys): number {
  const b = seqBounds(table, where);
  return b ? b.max + 1 : 0;
}

/** Distinct values of one column in scope, ascending. */
export function distinctValues(table: SQLiteTable, column: string, where: Keys = {}): string[] {
  const meta = tableMeta(table);
  if (!meta.columns.has(column)) throw new Error(`Unknown column ${column} on ${meta.name}`);
  const w = whereClause(meta, where);
  const rows = stmt(`SELECT DISTINCT ${q(column)} AS v FROM ${q(meta.name)}${w.sql} ORDER BY ${q(column)}`).all(
    ...w.values,
  ) as { v: string }[];
  return rows.map((r) => r.v);
}

/**
 * Replace a whole ordered list (a former aggregate file): delete the scope,
 * then insert `docs` with `seq` 0..n-1. `extra(doc)` supplies any other key
 * columns per row (e.g. `id`).
 */
export function replaceSeqDocs<T>(table: SQLiteTable, scope: Keys, docs: T[], extra?: (doc: T) => Keys): void {
  inTx(() => {
    deleteRows(table, scope);
    docs.forEach((doc, seq) => putDoc(table, { ...scope, ...(extra ? extra(doc) : {}), seq }, doc));
  });
}
