import type { Database } from "better-sqlite3";

export const SCHEMA_VERSION = 1;

export const ASSET_CLASSES = [
  "TESOURO",
  "RENDA_FIXA_PRIVADA",
  "FII",
  "ETF",
  "ACAO",
  "FUNDO",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS imports (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     source_type   TEXT    NOT NULL,
     source_path   TEXT    NOT NULL,
     imported_at   TEXT    NOT NULL DEFAULT (datetime('now')),
     rows_total    INTEGER NOT NULL DEFAULT 0,
     rows_imported INTEGER NOT NULL DEFAULT 0,
     rows_updated  INTEGER NOT NULL DEFAULT 0,
     rows_skipped  INTEGER NOT NULL DEFAULT 0,
     notes         TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS positions (
     id                  INTEGER PRIMARY KEY AUTOINCREMENT,
     asset_class         TEXT    NOT NULL,
     external_id         TEXT    NOT NULL,
     name                TEXT    NOT NULL,
     quantity            REAL,
     avg_price_cents     INTEGER,
     current_price_cents INTEGER,
     invested_cents      INTEGER,
     market_value_cents  INTEGER,
     issuer              TEXT,
     indexer             TEXT,
     rate                TEXT,
     maturity_date       TEXT,
     has_fgc             INTEGER,
     first_imported_at   TEXT NOT NULL DEFAULT (datetime('now')),
     last_imported_at    TEXT NOT NULL DEFAULT (datetime('now')),
     last_import_id      INTEGER REFERENCES imports(id),
     UNIQUE (asset_class, external_id)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_positions_class ON positions(asset_class)`,

  `CREATE TABLE IF NOT EXISTS transactions (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     trade_date     TEXT    NOT NULL,
     settle_date    TEXT,
     asset_class    TEXT    NOT NULL,
     external_id    TEXT    NOT NULL,
     side           TEXT    NOT NULL,
     quantity       REAL    NOT NULL,
     price_cents    INTEGER NOT NULL,
     fees_cents     INTEGER NOT NULL DEFAULT 0,
     total_cents    INTEGER NOT NULL,
     broker_note_id TEXT,
     import_id      INTEGER REFERENCES imports(id),
     UNIQUE (trade_date, external_id, side, quantity, price_cents, broker_note_id)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_class, external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_date  ON transactions(trade_date)`,

  `CREATE TABLE IF NOT EXISTS dividends (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     pay_date    TEXT    NOT NULL,
     ex_date     TEXT,
     asset_class TEXT    NOT NULL,
     external_id TEXT    NOT NULL,
     kind        TEXT    NOT NULL,
     gross_cents INTEGER NOT NULL,
     tax_cents   INTEGER NOT NULL DEFAULT 0,
     net_cents   INTEGER NOT NULL,
     import_id   INTEGER REFERENCES imports(id),
     UNIQUE (pay_date, external_id, kind, gross_cents)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_dividends_asset ON dividends(asset_class, external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dividends_date  ON dividends(pay_date)`,

  `CREATE TABLE IF NOT EXISTS market_data_cache (
     ticker        TEXT NOT NULL,
     data_type     TEXT NOT NULL,
     source        TEXT NOT NULL DEFAULT 'brapi.dev',
     payload_json  TEXT NOT NULL,
     cached_at     TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (ticker, data_type, source)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_mdc_cached_at ON market_data_cache(cached_at)`,
];

export function applySchema(db: Database): void {
  const tx = db.transaction(() => {
    for (const sql of DDL_STATEMENTS) {
      db.prepare(sql).run();
    }
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    ).run(String(SCHEMA_VERSION));
  });
  tx();
}
