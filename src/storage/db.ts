import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applySchema } from "./schema.js";

let _db: Database.Database | null = null;

/**
 * Resolve the DB path. `XP_MCP_DB_PATH` overrides for tests / portability.
 * Default lives under the user's home so the server is single-user by design.
 */
export function resolveDbPath(): string {
  const override = process.env.XP_MCP_DB_PATH;
  if (override) return override;
  return join(homedir(), ".xp-mcp", "data.db");
}

/**
 * Open (and lazily initialize) the singleton DB connection.
 * `WAL` journal mode is enabled for concurrent reads — even though this server
 * is single-process, WAL is faster for the read-heavy MCP tool workload.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  applySchema(db);
  _db = db;
  return db;
}

/** Close the singleton DB. Mostly for tests. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
