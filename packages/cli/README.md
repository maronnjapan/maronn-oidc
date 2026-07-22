# @maronn-oidc/cli

OpenID Connect Provider のコードを生成する CLI ツール。
Hono / Express / Fastify / Next.js 向けに、Authorization Code Flow（OAuth 2.1 / OIDC Core 1.0 準拠）を実装した OP コード一式を生成する。

生成コードは [`@maronn-oidc/core`](../core) のロジックを HTTP に配線したもので、利用者はこのコードを改造しながら「自分の要件がこの仕様で実現できるか」を検証する。

## インストールと実行

```bash
# インストールせずに実行
pnpm dlx @maronn-oidc/cli generate hono

# またはプロジェクトに追加してから実行
pnpm add -D @maronn-oidc/cli
pnpm maronn-oidc generate hono
```

## 使い方

```bash
# コード生成
maronn-oidc generate <framework> [options]

# 生成 + 既存エントリファイルへの組み込み（Next.js 以外）
maronn-oidc setup <framework> [options]
```

対応フレームワーク: `hono`, `express`, `fastify`, `nextjs`

`setup` は生成に加えて、エントリファイル内のプレースホルダーコメント（`// <!-- OIDC_IMPORT_PLACEHOLDER -->` と `// <!-- OIDC_SETUP_PLACEHOLDER -->`）を `applyOidc` の import と呼び出しに置換する。Next.js は App Router のファイル規約に従うため `setup` 非対応で、`maronn-oidc generate nextjs --output ./src/app` を使う。

### オプション

| オプション | 説明 |
|---|---|
| `--output, -o <dir>` | 出力先ディレクトリ（既定: `./oidc-provider`） |
| `--entry, -e <file>` | setup 時にパッチするエントリファイル（既定: `./src/index.ts`） |
| `--enable <features>` | 有効化する機能（カンマ区切り・複数回指定可） |
| `--disable <features>` | 既定セットから外す機能（カンマ区切り・複数回指定可） |
| `--help, -h` | ヘルプ表示 |

## 生成されるもの

```
oidc-provider/
├── app.ts / apply.ts     # OP 本体と既存アプリへの組み込み関数
├── config.ts             # ProviderConfig・クライアント登録（既定値はローカル検証専用）
├── store.ts              # インメモリストア（認可コード・トークン・セッション等）
├── resolvers.ts          # セッション・同意状態の resolver
├── views.ts              # ログイン / 同意 / エラー画面のデフォルト UI
├── routes/               # 各エンドポイントのルート実装
└── conformance.test.ts   # 生成 OP の想定挙動を固定する契約テスト
```

生成される OP のエンドポイント:

| パス | 役割 |
|---|---|
| `/authorize` | 認可エンドポイント（`response_type=code`、PKCE S256、`prompt` / `max_age` / `claims` / Request Object 対応） |
| `/token` | トークンエンドポイント（`authorization_code` / `refresh_token` グラント、`client_secret_basic` / `client_secret_post` / public client） |
| `/userinfo` | UserInfo エンドポイント（Bearer トークン、scope 別クレーム） |
| `/login`, `/consent` | ログイン・同意画面（差し替え可能なデフォルト UI 付き） |
| `/.well-known/openid-configuration` | Discovery メタデータ |
| `/.well-known/jwks.json` | JWKS（公開鍵） |
| `/introspect` | RFC 7662 Token Introspection（`introspection` 有効時） |
| `/revoke` | RFC 7009 Token Revocation（`revocation` 有効時） |

## 機能トグル（--enable / --disable）

生成されるOPの機能は、既定の全部入り構成から機能単位で増減できる。

```bash
# リフレッシュトークンとイントロスペクションを外した OP を生成
maronn-oidc generate hono --disable refresh-token,introspection

# PKCE を任意化（confidential client の非PKCEフローを許可）
maronn-oidc generate express --disable pkce
```

| 機能名 | 既定 | `--disable` 時の挙動 |
|---|---|---|
| `pkce` | 有効 | PKCE を任意化する（`allowNonPkceAuthorizationCodeFlow: true`）。明示的な confidential client の完全な非PKCEリクエストのみ許可され、public client や不正な PKCE 値は引き続き拒否される |
| `refresh-token` | 有効 | `refresh_token` grant を `unsupported_grant_type` で拒否。`offline_access` は付与されず、リフレッシュトークンは発行されない。discovery からも除去される |
| `introspection` | 有効 | RFC 7662 introspection エンドポイント（`/introspect`）を生成しない |
| `revocation` | 有効 | RFC 7009 revocation エンドポイント（`/revoke`）を生成しない |
| `request-object` | 有効 | `request` パラメータ（Request Object by value, OIDC Core 1.0 §6.1）を `request_not_supported` で拒否。discovery は `request_parameter_supported: false` を広告する |

Basic OP に必須の機能（authorize / token / userinfo / discovery / jwks / login / consent）はトグル対象外で、常に生成される。
未知の機能名や、同じ機能を `--enable` と `--disable` の両方に指定した場合はエラーになる。

### conformance.test.ts との関係

生成物には `conformance.test.ts`（契約テスト）が含まれ、選択した機能構成に合わせた内容で生成される。
無効化した機能については「無効であること」（404 応答、`unsupported_grant_type` / `request_not_supported` の拒否、discovery メタデータの不在など）をテストで固定する。
生成コードをカスタマイズした結果このテストが通らなくなった場合、本リポジトリが担保する Basic OP 挙動から外れている可能性がある。

## 生成後のセットアップ

1. ProviderConfig・署名鍵・クライアント resolver を環境変数 / DB / KV から供給する
2. `config.ts` のデフォルト値はローカル検証専用として扱う
3. 依存をインストールしてサーバーを起動する（例: `pnpm add hono @maronn-oidc/core`）

署名鍵は `SigningKeyProvider` として注入する。`createCachedSigningKeyProvider()`（core 提供）でラップすると、TTL 付きキャッシュで鍵ローテーションに追随できる。

```typescript
import { applyOidc } from './oidc-provider/apply.js';

applyOidc(app, {
  config: { issuer: 'http://localhost:3000' },
  signingKeyProvider: yourSigningKeyProvider,
});
```

配線済みの実例は本リポジトリの `samples/hono` / `samples/express` / `samples/fastify` / `samples/nextjs` を参照。

## ライセンス

MIT
