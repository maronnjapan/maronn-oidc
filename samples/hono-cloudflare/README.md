# Hono Cloudflare sample

Cloudflare Workers上で動くHono OPで、認可トランザクション・コード・トークン・セッション・同意・ユーザーをD1へ保存する。ローカルでもWranglerがD1をエミュレートするため、DBソフトやDockerは不要。

```bash
pnpm install
pnpm --filter @maronn-oidc/sample-hono-cloudflare start
```

ローカルDBは `.wrangler/state` に永続化される。別の保存先を使う場合は `OIDC_D1_PERSIST_PATH` を指定する。

Cloudflareへデプロイする場合は `wrangler d1 create maronn-oidc-sample` でD1を作成し、`wrangler.jsonc` の `database_id` を実IDへ変更したうえで、次を実行する。

```bash
pnpm --filter @maronn-oidc/sample-hono-cloudflare exec wrangler d1 migrations apply maronn-oidc-sample --remote
pnpm --filter @maronn-oidc/sample-hono-cloudflare exec wrangler deploy
```

サンプルの署名鍵は起動時生成である。本番相当の検証ではCloudflare Secrets等から固定・ローテーション可能な鍵を読み込むこと。
