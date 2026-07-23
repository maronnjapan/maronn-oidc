# Next.js sample

VercelではMarketplaceから接続できるUpstash Redis REST、ローカルではNode.js組み込みSQLiteを使用する。どちらも生成OPの同じ `JsonStoreBackend` 契約へ接続され、外部ランタイムライブラリは不要。

ローカル（DBソフト・Docker不要）:

```bash
pnpm --filter @maronn-oidc/sample-nextjs build
pnpm --filter @maronn-oidc/sample-nextjs start
```

デフォルトの保存先は `.data/oidc.sqlite` で、`OIDC_SQLITE_PATH` で変更できる。

VercelではUpstash Redis integrationを追加し、次の環境変数を設定する。

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

`VERCEL` が設定された環境でRedis資格情報がない場合は、永続化されない一時ファイルへ誤ってフォールバックしないよう起動を失敗させる。
