# Fastify sample

Node.js組み込みの `node:sqlite` を使い、OPの全状態を `.data/oidc.sqlite` に永続化する。外部DBライブラリ、DBソフト、Dockerは不要（Node.js 22.13以上）。

```bash
pnpm --filter @maronn-oidc/sample-fastify build
pnpm --filter @maronn-oidc/sample-fastify start
```

保存先は `OIDC_SQLITE_PATH` で変更できる。単一Nodeプロセスを永続ボリューム付きでデプロイするPoC向けであり、複数インスタンス構成では共有DB用の `JsonStoreBackend` 実装へ置き換える。
