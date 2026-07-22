/**
 * Token Revocation Endpoint (RFC 7009)
 *
 * クライアントが自発的にアクセストークン / リフレッシュトークンを失効させる
 * エンドポイント用の純関数。HTTP / クライアント認証の配線は呼び出し側の責務。
 *
 * セキュリティ方針:
 * - クライアント認証必須（authenticatedClientId が空なら invalid_client）
 * - **別クライアントが発行した token を指定したら invalid_grant エラー**
 *   （RFC 7009 §2.1: "verifies whether the token was issued to the client
 *    making the revocation request. If this validation fails, the request is
 *    refused and the client is informed of the error"）
 * - トークンが見つからない場合は 200 OK 成功（RFC 7009 §2.2）
 *
 * リフレッシュトークン関連トークンの扱い (RFC 7009 §2.1):
 *   refresh を revoke → 同 grantId のアクセストークンも全て revoke (SHOULD、片方向 cascade)
 *   access  を revoke → 関連 refresh は revoke しない (MAY、本実装では採用しない)
 */

import type { AccessTokenInfo } from './userinfo';
import type { RefreshTokenInfo } from './token-request';
import { sanitizeErrorDescription } from './error-utils';

export enum RevocationErrorCode {
  InvalidRequest = 'invalid_request',
  InvalidClient = 'invalid_client',
  /** RFC 7009 §2.2.1: トークンが requesting client 以外に発行されていた場合 */
  InvalidGrant = 'invalid_grant',
}

export class RevocationError extends Error {
  public readonly error: RevocationErrorCode;
  public readonly errorDescription: string;

  constructor(error: RevocationErrorCode, errorDescription: string) {
    // RFC 6749 Section 5.2: error_description must be limited to a safe character set.
    const sanitized = sanitizeErrorDescription(errorDescription);
    super(sanitized);
    this.name = 'RevocationError';
    this.error = error;
    this.errorDescription = sanitized;
  }

  get statusCode(): number {
    return this.error === RevocationErrorCode.InvalidClient ? 401 : 400;
  }
  // 400 InvalidRequest, 400 InvalidGrant, 401 InvalidClient

  get wwwAuthenticate(): string | undefined {
    if (this.error === RevocationErrorCode.InvalidClient) {
      return 'Basic realm="Client Authentication"';
    }
    return undefined;
  }
}

export interface RevocationTokenResolvers {
  findAccessToken(token: string): Promise<AccessTokenInfo | null>;
  revokeAccessToken(token: string): Promise<void>;
  findRefreshToken?(token: string): Promise<RefreshTokenInfo | null>;
  revokeRefreshToken?(token: string): Promise<void>;
  /**
   * RFC 7009 Section 2.1 SHOULD: refresh token 失効時に
   * 同 grantId のアクセストークンも全て失効する。
   */
  revokeAccessTokensByGrantId?(grantId: string): Promise<void>;
}

export interface RevocationRequestContext {
  params: { token?: string; token_type_hint?: string };
  authenticatedClientId: string;
  resolvers: RevocationTokenResolvers;
}

async function tryRevokeAccess(
  ctx: RevocationRequestContext,
  token: string,
): Promise<boolean> {
  const info = await ctx.resolvers.findAccessToken(token);
  if (!info) return false;
  if (info.clientId !== ctx.authenticatedClientId) {
    // RFC 7009 §2.1: requesting client 以外に発行された token は refused.
    throw new RevocationError(
      RevocationErrorCode.InvalidGrant,
      'Token was not issued to the requesting client',
    );
  }
  await ctx.resolvers.revokeAccessToken(token);
  return true;
}

async function tryRevokeRefresh(
  ctx: RevocationRequestContext,
  token: string,
): Promise<boolean> {
  const find = ctx.resolvers.findRefreshToken;
  const revoke = ctx.resolvers.revokeRefreshToken;
  if (!find || !revoke) return false;
  const info = await find(token);
  if (!info) return false;
  if (info.clientId !== ctx.authenticatedClientId) {
    throw new RevocationError(
      RevocationErrorCode.InvalidGrant,
      'Token was not issued to the requesting client',
    );
  }
  await revoke(token);
  // RFC 7009 SHOULD: 同 grant の access も全部失効
  if (ctx.resolvers.revokeAccessTokensByGrantId) {
    await ctx.resolvers.revokeAccessTokensByGrantId(info.grantId);
  }
  return true;
}

/**
 * Revocation 本体。成功時は void を返し、呼び出し側が 200 OK 空ボディを返す。
 *
 * 検索順:
 * - hint=refresh_token → refresh → access
 * - それ以外（hint=access_token / 不明 / 無し） → access → refresh
 *
 * トークンが見つからなくてもエラーにしない。
 */
export async function handleRevocationRequest(
  ctx: RevocationRequestContext,
): Promise<void> {
  if (!ctx.params.token) {
    throw new RevocationError(
      RevocationErrorCode.InvalidRequest,
      'Missing required parameter: token',
    );
  }
  if (!ctx.authenticatedClientId) {
    throw new RevocationError(
      RevocationErrorCode.InvalidClient,
      'Client authentication required',
    );
  }

  const token = ctx.params.token;
  const refreshFirst = ctx.params.token_type_hint === 'refresh_token';

  if (refreshFirst) {
    if (await tryRevokeRefresh(ctx, token)) return;
    await tryRevokeAccess(ctx, token);
    return;
  }

  if (await tryRevokeAccess(ctx, token)) return;
  await tryRevokeRefresh(ctx, token);
}
