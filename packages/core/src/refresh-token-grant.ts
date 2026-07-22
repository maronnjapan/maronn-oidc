import { TokenError, TokenErrorCode } from './token-error';
import type {
  TokenRequestContext,
  ValidatedRefreshTokenRequest,
} from './token-request';

/**
 * refresh_token グラント固有の検証を行う（機能単位のエントリポイント）。
 *
 * リフレッシュトークンの存在・再利用（ローテーション後の再提示）・クライアント一致・
 * 絶対寿命・アイドルタイムアウト・scope 縮小の検証を担当する。
 *
 * grant_type の検証・クライアント認証・クライアント別 grant 認可を含む
 * フルの検証経路は {@link validateTokenRequest} が担う。この関数を直接使う場合、
 * それらの前段検証は呼び出し側の責務となる。
 *
 * @throws {TokenError} バリデーションエラー
 */
export async function validateRefreshTokenGrant(
  context: TokenRequestContext
): Promise<ValidatedRefreshTokenRequest> {
  const { params, authenticatedClientId, refreshTokenResolver } = context;

  // refresh_token パラメータの存在チェック
  if (!params.refresh_token) {
    throw new TokenError(
      TokenErrorCode.InvalidRequest,
      'Missing required parameter: refresh_token'
    );
  }

  if (!refreshTokenResolver) {
    throw new TokenError(
      TokenErrorCode.InvalidRequest,
      'Refresh token resolver not provided'
    );
  }

  const refreshTokenInfo = await refreshTokenResolver.resolve(params.refresh_token);
  if (!refreshTokenInfo) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Refresh token not found'
    );
  }

  // 使用済みチェック（トークンローテーション: OAuth 2.1 Section 4.3.1）
  // 再利用検知時は同 grant の AT/RT を全失効する（SHOULD）。
  if (refreshTokenInfo.used) {
    if (refreshTokenResolver.revokeTokensByGrantId) {
      await refreshTokenResolver.revokeTokensByGrantId(refreshTokenInfo.grantId);
    }
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Refresh token has already been used'
    );
  }

  // クライアント一致チェック
  if (refreshTokenInfo.clientId !== authenticatedClientId) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Refresh token was issued to a different client'
    );
  }

  // 有効期限チェック（絶対寿命）
  // RFC 7519 §4.1.4 convention: expiresAt <= now means expired (on-or-after).
  // Unified with the authorization-code boundary so both grants treat
  // `expiresAt === now` identically (expired), removing the prior <-vs-<= mismatch.
  const nowForRefresh = Math.floor(Date.now() / 1000);
  if (refreshTokenInfo.expiresAt <= nowForRefresh) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Refresh token has expired'
    );
  }

  // アイドル（無操作）タイムアウト（任意・オプトイン、既定 OFF）。
  // RFC 9700 §4.14.2 は refresh token の露出を抑えるため rotation と限定的な有効期限を
  // 推奨しているが、「一定期間未使用なら失効」という inactivity/idle timeout そのものを
  // 規定してはいない。これは Auth0 の "inactivity lifetime" など IdP で一般的な運用機構で、
  // 上記 RFC の「露出時間を短くする」方針を具体化するオプションとして提供する。
  // idleTimeout > 0 かつ lastUsedAt があり、最終利用からの経過が閾値を超えていれば失効。
  // 絶対寿命とは独立で、いずれか早い方で失効する。
  const idleTimeout = context.refreshTokenIdleTimeoutSeconds;
  if (
    idleTimeout !== undefined &&
    idleTimeout > 0 &&
    refreshTokenInfo.lastUsedAt !== undefined &&
    nowForRefresh - refreshTokenInfo.lastUsedAt > idleTimeout
  ) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Refresh token expired due to inactivity'
    );
  }

  // スコープ検証（OAuth 2.1 Section 4.3 / RFC 6749 Section 6）
  // 要求されたスコープは元の認可時のスコープと同等かサブセットでなければならない
  let effectiveScope = refreshTokenInfo.scope;
  if (params.scope !== undefined) {
    const requestedScopes = params.scope.split(' ').filter((s) => s.length > 0);
    // 空のスコープ指定は不正
    if (requestedScopes.length === 0) {
      throw new TokenError(
        TokenErrorCode.InvalidScope,
        'Requested scope must not be empty'
      );
    }
    // 重複除去
    const uniqueRequestedScopes = [...new Set(requestedScopes)];
    const originalScopeSet = new Set(refreshTokenInfo.scope);
    const invalidScopes = uniqueRequestedScopes.filter((s) => !originalScopeSet.has(s));
    if (invalidScopes.length > 0) {
      throw new TokenError(
        TokenErrorCode.InvalidScope,
        `Requested scope exceeds original grant: ${invalidScopes.join(' ')}`
      );
    }
    effectiveScope = uniqueRequestedScopes;
  }

  // トークンローテーション順序 (OAuth 2.1 Section 4.3.1):
  // 旧 RT の失効は呼び出し側が「新トークン保存に成功した後」に行う。
  // ここで先に失効すると、後続の generateTokenResponse / store.set が失敗した場合に
  // ユーザーが旧 RT も新 RT も持たない状態に陥り、再ログインを強いる。
  return {
    grantType: 'refresh_token',
    clientId: authenticatedClientId,
    subject: refreshTokenInfo.subject,
    scope: effectiveScope,
    grantId: refreshTokenInfo.grantId,
    audience: refreshTokenInfo.audience,
    authTime: refreshTokenInfo.authTime,
    nonce: refreshTokenInfo.nonce,
    acr: refreshTokenInfo.acr,
    amr: refreshTokenInfo.amr,
    azp: refreshTokenInfo.azp,
    // OAuth 2.1 §6.1: 初回発行時刻を rotation を跨いで保持し、absolute lifetime のみで失効させる。
    originalIssuedAt: refreshTokenInfo.originalIssuedAt,
    // RFC 6749 §6 / OIDC Core 1.0 §11: rotation 可否は元 grant の offline_access で判定する。
    // effectiveScope（縮小後 scope）ではなく元 refresh token の scope を見ることで、
    // 縮小要求で offline_access を落としても新 refresh token を発行し続けられる。
    hadOfflineAccess: refreshTokenInfo.scope.includes('offline_access'),
  };
}
