// One small async interface so the same code runs on Val Town (HTTP libsql) and locally (node:sqlite).
// Rows come back as objects. tx() runs statements atomically.
export type Row = Record<string, unknown>;
export type Arg = string | number | null;
export interface Stmt { sql: string; args?: Arg[] }
export interface DB {
  all(sql: string, args?: Arg[]): Promise<Row[]>;
  get(sql: string, args?: Arg[]): Promise<Row | undefined>;
  run(sql: string, args?: Arg[]): Promise<{ changes: number }>;
  tx(stmts: Stmt[]): Promise<void>;
  exec(sql: string): Promise<void>;
}
export const uuid = () => crypto.randomUUID();
export const nowISO = () => new Date().toISOString();

const onValTown = !!Deno.env.get("valtown");

async function valTownDB(): Promise<DB> {
  const { sqlite } = await import("https://esm.town/v/std/sqlite");
  const toObjs = (r: { columns: string[]; rows: unknown[][] }) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  return {
    async all(sql, args = []) { return toObjs(await sqlite.execute({ sql, args })); },
    async get(sql, args = []) { return toObjs(await sqlite.execute({ sql, args }))[0]; },
    async run(sql, args = []) { const r = await sqlite.execute({ sql, args }); return { changes: r.rowsAffected }; },
    async tx(stmts) { if (stmts.length) await sqlite.batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })), "write"); },
    async exec(sql) {
      const stmts = sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
      if (stmts.length) await sqlite.batch(stmts);
    },
  };
}

async function localDB(): Promise<DB> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(Deno.env.get("CCC_DB") ?? "./ccc2.sqlite");
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return {
    all(sql, args = []) { return Promise.resolve(db.prepare(sql).all(...args) as Row[]); },
    get(sql, args = []) { return Promise.resolve(db.prepare(sql).get(...args) as Row | undefined); },
    run(sql, args = []) { const r = db.prepare(sql).run(...args); return Promise.resolve({ changes: Number(r.changes) }); },
    tx(stmts) {
      db.exec("BEGIN");
      try { for (const s of stmts) db.prepare(s.sql).run(...(s.args ?? [])); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return Promise.resolve();
    },
    exec(sql) { db.exec(sql); return Promise.resolve(); },
  };
}

let _db: Promise<DB> | undefined;
export function db(): Promise<DB> { if (!_db) _db = onValTown ? valTownDB() : localDB(); return _db; }
