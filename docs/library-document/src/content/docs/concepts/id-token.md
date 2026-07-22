---
title: ID Token
description: ID Token structure, required claims, and validation rules per OIDC Core 1.0.
---

ID Token は OpenID Connect の中核をなす JWT です。エンドユーザーの認証情報を含み、クライアントはこれを検証することでユーザーの身元を確認します。

## Structure

ID Token は JWT (JSON Web Token) 形式で、3つの部分（Header / Payload / Signature）で構成されます。

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9
.
eyJpc3MiOiJodHRwczovL3Byb3ZpZGVyLmV4YW1wbGUuY29tIiwic3ViIjoiMTIzIn0
.
<signature>
```

## JOSE Header

| クレーム | 値 | 説明 |
|---|---|---|
| `alg` | `RS256` | 署名アルゴリズム（RS256 必須） |
| `typ` | `JWT` | トークンタイプ |
| `kid` | キーID | JWK Set との照合に使用 |

## Required Claims

OIDC Core 1.0 Section 2 で定義された必須クレームです。

| クレーム | 型 | 説明 |
|---|---|---|
| `iss` | String | Issuer Identifier（プロバイダーの URL） |
| `sub` | String | Subject Identifier（ユーザーの一意な識別子） |
| `aud` | String / Array | Audience（`client_id` を含む） |
| `exp` | Number | 有効期限（Unix タイムスタンプ） |
| `iat` | Number | 発行時刻（Unix タイムスタンプ） |

## Conditional Claims

| クレーム | 条件 | 説明 |
|---|---|---|
| `nonce` | リクエストに `nonce` が含まれる場合 | リプレイ攻撃対策 |
| `at_hash` | `access_token` が発行される場合 | アクセストークンのハッシュ |
| `auth_time` | `max_age` リクエストまたは `auth_time` クレーム要求時 | 認証時刻 |

## Signature Validation

クライアントは以下の手順で ID Token を検証する必要があります。

1. `iss` がプロバイダーの URL と一致することを確認
2. `aud` に自分の `client_id` が含まれることを確認
3. `exp` が現在時刻より未来であることを確認
4. `nonce` がリクエスト時の値と一致することを確認
5. RS256 署名をプロバイダーの公開鍵（JWKS）で検証

```typescript
// 署名検証の例 (Web Crypto API)
const isValid = await crypto.subtle.verify(
  { name: 'RSASSA-PKCS1-v1_5' },
  publicKey,
  signature,
  headerAndPayload
);
```

## at_hash Calculation

`at_hash` は `access_token` の左半分のハッシュを Base64URL エンコードした値です。

```typescript
// at_hash = BASE64URL(LEFT(SHA256(access_token), 16))
const hash = await crypto.subtle.digest('SHA-256', encoder.encode(accessToken));
const atHash = base64urlEncode(hash.slice(0, 16));
```

## References

- [OIDC Core 1.0 Section 2](https://openid.net/specs/openid-connect-core-1_0.html#IDToken) — ID Token
- [OIDC Core 1.0 Section 3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) — ID Token Validation
