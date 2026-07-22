/**
 * Token Introspection Endpoint (RFC 7662)
 *
 * リソースサーバ（protected resource）または confidential client が、
 * 受け取ったアクセストークン / リフレッシュトークンの有効性と属性を
 * クエリできる純関数を提供する。HTTP 配線は呼び出し側の責務。
 *
 * RFC 7662 §2.1: クライアント認証は必須だが、トークン所有クライアントと
 * caller の一致は要件ではない（protected resource が他クライアント発行の
 * トークンを introspect するのが本来のユースケース）。本実装も同様に
 * 所有チェックは行わず、authenticated confidential client であれば
 * いずれのトークンも introspect 可能。
 *
 * セキュリティ方針:
 * - クライアント認証必須（authenticatedClientId が空なら invalid_client）
 * - active=false のレスポンスは最小限（{ active: false } のみ）
 */

import type { AccessTokenInfo } from './userinfo';
import type { RefreshTokenInfo } from './token-request';
import { sanitizeErrorDescription } from './error-utils';

/**
 * RFC 7662 で示唆されるエラー。実体は OAuth 2.0 Section 5.2 のエラー。
 */
export enum IntrospectionErrorCode {
  InvalidRequest = 'invalid_request',
  InvalidClient = 'invalid_client',
}

export class IntrospectionError extends Error {
  public readonly error: IntrospectionErrorCode;
  public readonly errorDescription: string;

  constructor(error: IntrospectionErrorCode, errorDescription: string) {
    // RFC 6749 Section 5.2: error_description must be limited to a safe character set.
    const sanitized = sanitizeErrorDescription(errorDescription);
    super(sanitized);
    this.name = 'IntrospectionError';
    this.error = error;
    this.errorDescription = sanitized;
  }

  get statusCode(): number {
    return this.error === IntrospectionErrorCode.InvalidClient ? 401 : 400;
  }

  get wwwAuthenticate(): string | undefined {
    if (this.error === IntrospectionErrorCode.InvalidClient) {
      return 'Basic realm="Client Authentication"';
    }
    return undefined;
  }
}

export interface IntrospectionAccessTokenResolver {
  findAccessToken(token: string): Promise<AccessTokenInfo | null>;
}

export interface IntrospectionRefreshTokenResolver {
  resolve(token: string): Promise<RefreshTokenInfo | null>;
}

export interface IntrospectionRequestContext {
  params: { token?: string; token_type_hint?: string };
  /** クライアント認証済みのclientId。空文字なら invalid_client */
  authenticatedClientId: string;
  accessTokenResolver: IntrospectionAccessTokenResolver;
  refreshTokenResolver?: IntrospectionRefreshTokenResolver;
}

/**
 * RFC 7662 Section 2.2 のレスポンス。
 * active=false のときは active のみ。active=true のときは推奨クレームを optional で含む。
 */
export type IntrospectionResponse =
  | { active: false }
  | {
      active: true;
      scope?: string;
      client_id?: string;
      token_type?: 'Bearer' | 'refresh_token';
      exp?: number;
      iat?: number;
      nbf?: number;
      sub?: string;
      aud?: string | string[];
      iss?: string;
      jti?: string;
    };

const INACTIVE: IntrospectionResponse = { active: false };

function isAccessTokenActive(info: AccessTokenInfo, now: number): boolean {
  if (info.expiresAt <= now) return false;
  // RFC 7519 §4.1.5 / RFC 7662 §2.2: a token whose nbf ("not before") is in the
  // future is not yet valid, so it MUST be reported inactive. Applies to both JWT
  // and opaque tokens because the stored token info drives introspection.
  if (info.nbf !== undefined && info.nbf > now) return false;
  return true;
}

function isRefreshTokenActive(info: RefreshTokenInfo, now: number): boolean {
  if (info.used) return false;
  if (info.expiresAt <= now) return false;
  return true;
}

function buildAccessTokenResponse(info: AccessTokenInfo): IntrospectionResponse {
  const res: Extract<IntrospectionResponse, { active: true }> = {
    active: true,
    scope: info.scope.join(' '),
    client_id: info.clientId,
    token_type: 'Bearer',
    sub: info.sub,
    exp: info.expiresAt,
  };
  if (info.iat !== undefined) res.iat = info.iat;
  // RFC 7662 §2.2: nbf is an OPTIONAL response member; echo it when stored.
  if (info.nbf !== undefined) res.nbf = info.nbf;
  if (info.audience !== undefined && info.audience.length > 0) {
    res.aud = info.audience;
  }
  if (info.issuer !== undefined) res.iss = info.issuer;
  if (info.jti !== undefined) res.jti = info.jti;
  return res;
}

function buildRefreshTokenResponse(info: RefreshTokenInfo): IntrospectionResponse {
  const res: Extract<IntrospectionResponse, { active: true }> = {
    active: true,
    scope: info.scope.join(' '),
    client_id: info.clientId,
    token_type: 'refresh_token',
    sub: info.subject,
    exp: info.expiresAt,
  };
  if (info.iat !== undefined) res.iat = info.iat;
  if (info.issuer !== undefined) res.iss = info.issuer;
  return res;
}

/**
 * Token Introspection 本体。
 *
 * 1. token / authenticatedClientId のバリデーション
 * 2. token_type_hint に応じて access → refresh または refresh → access の順で検索
 * 3. 見つかれば各種チェック (clientId 一致 / exp / used) をかけて active 判定
 * 4. active なら推奨クレームを最大限詰めて返す。inactive なら { active: false } のみ。
 */
export async function handleIntrospectionRequest(
  ctx: IntrospectionRequestContext,
): Promise<IntrospectionResponse> {
  const { params, authenticatedClientId, accessTokenResolver, refreshTokenResolver } = ctx;

  if (!params.token) {
    throw new IntrospectionError(
      IntrospectionErrorCode.InvalidRequest,
      'Missing required parameter: token',
    );
  }
  if (!authenticatedClientId) {
    throw new IntrospectionError(
      IntrospectionErrorCode.InvalidClient,
      'Client authentication required',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const token = params.token;
  const refreshFirst = params.token_type_hint === 'refresh_token';

  if (refreshFirst && refreshTokenResolver) {
    const rt = await refreshTokenResolver.resolve(token);
    if (rt) {
      return isRefreshTokenActive(rt, now)
        ? buildRefreshTokenResponse(rt)
        : INACTIVE;
    }
    const at = await accessTokenResolver.findAccessToken(token);
    if (at) {
      return isAccessTokenActive(at, now)
        ? buildAccessTokenResponse(at)
        : INACTIVE;
    }
    return INACTIVE;
  }

  // hint=access_token / 不明 / 未指定 → access first
  const at = await accessTokenResolver.findAccessToken(token);
  if (at) {
    return isAccessTokenActive(at, now)
      ? buildAccessTokenResponse(at)
      : INACTIVE;
  }
  if (refreshTokenResolver) {
    const rt = await refreshTokenResolver.resolve(token);
    if (rt) {
      return isRefreshTokenActive(rt, now)
        ? buildRefreshTokenResponse(rt)
        : INACTIVE;
    }
  }
  return INACTIVE;
}
