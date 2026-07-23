import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createJsonProviderStores,
  type JsonStoreBackend,
  type JsonStoreEntry,
} from './oidc-provider/store.js';

interface StoredRow {
  key: string;
  value: string;
  expires_at: number | null;
}

/**
 * File-backed SQLite storage using Node's built-in node:sqlite module.
 * No database server, native add-on, Docker container, or external runtime
 * dependency is required.
 */
class SqliteJsonStoreBackend implements JsonStoreBackend {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    const databasePath = resolve(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL');
    this.database.exec(
      'CREATE TABLE IF NOT EXISTS oidc_store (' +
      'key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)',
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const row = this.database
      .prepare('SELECT key, value, expires_at FROM oidc_store WHERE key = ?')
      .get(key) as unknown as StoredRow | undefined;
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      await this.delete(key);
      return null;
    }
    return JSON.parse(row.value) as T;
  }

  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
    this.database.prepare(
      'INSERT INTO oidc_store (key, value, expires_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    ).run(key, JSON.stringify(value), expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.database.prepare('DELETE FROM oidc_store WHERE key = ?').run(key);
  }

  async list<T>(prefix: string): Promise<Array<JsonStoreEntry<T>>> {
    const rows = this.database
      .prepare(
        'SELECT key, value, expires_at FROM oidc_store ' +
        'WHERE key >= ? AND key < ? ORDER BY key',
      )
      .all(prefix, prefix + '\uffff') as unknown as StoredRow[];
    const entries: Array<JsonStoreEntry<T>> = [];
    for (const row of rows) {
      if (row.expires_at !== null && row.expires_at <= Date.now()) {
        await this.delete(row.key);
      } else {
        entries.push({ key: row.key, value: JSON.parse(row.value) as T });
      }
    }
    return entries;
  }
}

const sqlitePath = process.env.OIDC_SQLITE_PATH ?? '.data/oidc.sqlite';

export const providerStores = createJsonProviderStores(
  new SqliteJsonStoreBackend(sqlitePath),
);

