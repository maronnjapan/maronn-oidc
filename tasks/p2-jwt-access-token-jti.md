# [P2] JWT Access Token への `jti` 付与

## ステータス

🟡 Minor / 未着手

## 背景

RFC 9068 の JWT access token profile では `jti` は required claim として定義されている。現状の JWT access token には `jti` が含まれておらず、Introspection 用の `AccessTokenInfo.jti` も活用されていない。

## 対象ファイル

- `packages/core/src/access-token.ts`
- `packages/core/src/token-response.ts`
- `packages/core/src/introspection.ts`
- `packages/core/src/token-response.test.ts`

## 仕様参照

- RFC 9068 §2.2: JWT Access Token Claims
- RFC 7519 §4.1.7: `jti`

## 現状の実装

- Access Token payload 型に `jti` が無い
- `generateTokenResponse()` は JWT 発行時に `jti` を生成していない
- `AccessTokenInfo` には `jti?: string` があるが保存されていない

## 修正方針

- [ ] JWT access token 発行時に `jti` を生成する
- [ ] payload / ストア metadata / introspection で同じ `jti` を参照できるようにする
- [ ] `generateTokenResponse()` の返り値だけでは `jti` を呼び出し側へ返せないため、内部メタデータ伝播方法を見直す
- [ ] opaque access token への適用有無は別途切り分け、まず JWT access token を仕様準拠させる

## テスト要件

- [ ] JWT access token payload に `jti` が含まれること
- [ ] `accessTokenStore.set()` される情報に `jti` が保存されること
- [ ] introspection が `jti` を返せること
- [ ] 同一発行で `jti` が空にならないこと

## 完了条件

`pnpm --filter @maronn-oidc/core test` がパスすること
