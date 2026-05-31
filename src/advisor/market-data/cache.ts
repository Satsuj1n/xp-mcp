import type { Database } from "better-sqlite3";

export interface CachedEntry<T> {
  data: T;
  cached_at: string;
  age_seconds: number;
}

type DataType = "quote" | "fundamentals" | "universe" | "crypto_quote";

interface Row {
  payload_json: string;
  cached_at: string;
  age_seconds: number;
}

export class MarketDataCache {
  constructor(private readonly db: Database) {}

  get<T>(
    ticker: string,
    dataType: DataType,
    maxAgeMinutes: number,
  ): CachedEntry<T> | null {
    const row = this.db
      .prepare<[string, DataType, string]>(
        `SELECT payload_json,
                cached_at,
                CAST((julianday('now') - julianday(cached_at)) * 86400 AS INTEGER) AS age_seconds
           FROM market_data_cache
          WHERE ticker = ?
            AND data_type = ?
            AND cached_at > datetime('now', ?)
          ORDER BY cached_at DESC
          LIMIT 1`,
      )
      .get(ticker, dataType, `-${maxAgeMinutes} minutes`) as Row | undefined;
    if (!row) return null;
    return {
      data: JSON.parse(row.payload_json) as T,
      cached_at: row.cached_at,
      age_seconds: row.age_seconds,
    };
  }

  put(
    ticker: string,
    dataType: string,
    payload: unknown,
    source = "brapi.dev",
  ): void {
    this.db
      .prepare(
        `INSERT INTO market_data_cache (ticker, data_type, source, payload_json, cached_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(ticker, data_type, source)
         DO UPDATE SET payload_json = excluded.payload_json,
                       cached_at = excluded.cached_at`,
      )
      .run(ticker, dataType, source, JSON.stringify(payload));
  }

  clearExpired(maxAgeMinutes: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM market_data_cache WHERE cached_at <= datetime('now', ?)`,
      )
      .run(`-${maxAgeMinutes} minutes`);
    return result.changes;
  }
}
