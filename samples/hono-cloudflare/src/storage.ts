import {
  createJsonProviderStores,
  type JsonStoreBackend,
  type JsonStoreEntry,
  type ProviderStores,
} from './oidc-provider/store.js';

interface StoredRow {
  key: string;
  value: string;
  expires_at: number | null;
}

class D1JsonStoreBackend implements JsonStoreBackend {
  constructor(private readonly database: D1Database) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.database
      .prepare('SELECT key, value, expires_at FROM oidc_store WHERE key = ?')
      .bind(key)
      .first<StoredRow>();
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      await this.delete(key);
      return null;
    }
    return JSON.parse(row.value) as T;
  }

  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
    await this.database
      .prepare(
        'INSERT INTO oidc_store (key, value, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
      )
      .bind(key, JSON.stringify(value), expiresAt)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.database.prepare('DELETE FROM oidc_store WHERE key = ?').bind(key).run();
  }

  async list<T>(prefix: string): Promise<Array<JsonStoreEntry<T>>> {
    const result = await this.database
      .prepare(
        'SELECT key, value, expires_at FROM oidc_store ' +
        'WHERE key >= ? AND key < ? ORDER BY key',
      )
      .bind(prefix, prefix + '\uffff')
      .all<StoredRow>();
    const entries: Array<JsonStoreEntry<T>> = [];
    for (const row of result.results) {
      if (row.expires_at !== null && row.expires_at <= Date.now()) {
        await this.delete(row.key);
      } else {
        entries.push({ key: row.key, value: JSON.parse(row.value) as T });
      }
    }
    return entries;
  }
}

const storesByBinding = new WeakMap<D1Database, ProviderStores>();

export function createD1ProviderStores(database: D1Database): ProviderStores {
  const existing = storesByBinding.get(database);
  if (existing) return existing;
  const stores = createJsonProviderStores(new D1JsonStoreBackend(database));
  storesByBinding.set(database, stores);
  return stores;
}

