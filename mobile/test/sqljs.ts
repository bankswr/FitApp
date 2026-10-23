// Db over sql.js for tests under Node: same SQLite engine, in memory (or loaded from a file).
import initSqlJs, { type Database } from "sql.js";
import type { Db, Params, Row } from "../src/db/types";

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function openTestDb(bytes?: Uint8Array): Promise<Db & { raw: Database }> {
  SQL ??= await initSqlJs();
  const raw = new SQL.Database(bytes);
  raw.run("PRAGMA foreign_keys = ON;");
  let depth = 0;
  const db = {
    raw,
    async all(sql: string, params: Params = []): Promise<Row[]> {
      const stmt = raw.prepare(sql);
      stmt.bind(params as any[]);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async run(sql: string, params: Params = []) {
      raw.run(sql, params as any[]);
      const lastId = raw.exec("SELECT last_insert_rowid()")[0].values[0][0] as number;
      return { changes: raw.getRowsModified(), lastId };
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();
      raw.run("BEGIN");
      depth = 1;
      try {
        const result = await fn();
        raw.run("COMMIT");
        return result;
      } catch (e) {
        raw.run("ROLLBACK");
        throw e;
      } finally {
        depth = 0;
      }
    },
  };
  return db;
}

// Columns the mobile schema added after Flask (schemas 3 and 5), with the default they take on Flask data.
const MOBILE_ONLY_COLUMNS: Record<string, Record<string, unknown>> = {
  routine: { autoregulate: 0 },
  log_set: { target_reps: null, uses_bodyweight: 0 },
  exercise: { weight_step: null, uses_bodyweight: 0 },
};

// Mobile-only data derived from what Flask has (schema 4: workouts on the day), left out of comparisons.
export const MOBILE_ONLY_TABLES = new Set(["log_workout"]);
const DERIVED_COLUMNS: Record<string, string[]> = { log_exercise: ["log_workout_id"] };

/** Rows with mobile-only columns dropped when they hold their default, for comparing with Flask data. */
export function asFlaskRows(table: string, rows: Row[]): Row[] {
  const derived = DERIVED_COLUMNS[table];
  if (derived) rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !derived.includes(k))));
  const extra = MOBILE_ONLY_COLUMNS[table];
  if (!extra) return rows;
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => !(k in extra && extra[k] === v))));
}
