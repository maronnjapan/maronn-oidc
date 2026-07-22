import { sha256 } from './crypto-utils';
import { TokenError, TokenErrorCode } from './token-error';
import type {
  TokenRequestContext,
  ValidatedAuthorizationCodeRequest,
} from './token-request';

/**
 * PKCE S256のcode_verifierを検証する
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 */
async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: 'S256'
): Promise<boolean> {
  if (method === 'S256') {
    const computed = await sha256(codeVerifier);
    return computed === codeChallenge;
  }
  return false;
}

/**
 * authorization_code グラント固有の検証を行う（機能単位のエントリポイント）。
 *
 * 認可コードの存在・再利用・クライアント一致・有効期限・redirect_uri バインディング・
 * PKCE（code_verifier）の検証を担当する。
 *
 * grant_type の検証・クライアント認証・クライアント別 grant 認可を含む
 * フルの検証経路は {@link validateTokenRequest} が担う。この関数を直接使う場合、
 * それらの前段検証は呼び出し側の責務となる。
 *
 * @throws {TokenError} バリデーションエラー
 */
export async function validateAuthorizationCodeGrant(
  context: TokenRequestContext
): Promise<ValidatedAuthorizationCodeRequest> {
  const { params, authCodeResolver, authenticatedClientId } = context;

  // 認可コードの検証
  if (!params.code) {
    throw new TokenError(
      TokenErrorCode.InvalidRequest,
      'Missing required parameter: code'
    );
  }

  const authCode = await authCodeResolver.findAuthorizationCode(params.code);
  if (!authCode) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Authorization code not found'
    );
  }

  // 認可コードが使用済みかチェック（MUST: single use）
  // OAuth 2.1 Section 4.1.2 / RFC 6749 Section 4.1.2:
  // SHOULD revoke previously issued tokens on code reuse.
  if (authCode.used) {
    if (authCodeResolver.revokeTokensByGrantId) {
      await authCodeResolver.revokeTokensByGrantId(authCode.grantId);
    }
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Authorization code has already been used'
    );
  }

  // 認可コードが認証されたクライアントに発行されたものか検証
  if (authCode.clientId !== authenticatedClientId) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Authorization code was issued to a different client'
    );
  }

  // 認可コードの有効期限チェック
  // RFC 7519 convention: exp <= now means expired (same as JWT exp claim)
  const now = Math.floor(Date.now() / 1000);
  if (authCode.expiresAt <= now) {
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'Authorization code has expired'
    );
  }

  // redirect_uri の検証
  // OIDC Core 1.0 Section 3.1.3.2:
  //   "If a redirect_uri Parameter value was included in the initial Authorization Request,
  //    the redirect_uri Parameter value MUST be present in the Token Request and its value
  //    MUST match the value in the original Authorization Request."
  // 認可リクエストで redirect_uri が明示されていた場合は Token Endpoint でも必須化し一致を要求する。
  // 明示されていなければ OAuth 2.1 と同様に任意 (PKCE で AC↔Token 間のバインディングは担保されている)。
  if (authCode.redirectUriExplicit) {
    if (!params.redirect_uri) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'redirect_uri is required because it was included in the authorization request'
      );
    }
    if (params.redirect_uri !== authCode.redirectUri) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'redirect_uri does not match the authorization request'
      );
    }
  } else if (params.redirect_uri && params.redirect_uri !== authCode.redirectUri) {
    // 明示されていなくても送られてきた場合は値の一致は要求する
    throw new TokenError(
      TokenErrorCode.InvalidGrant,
      'redirect_uri does not match the authorization request'
    );
  }

  let codeVerified = false;
  const hasPkceBinding =
    authCode.codeChallenge !== undefined ||
    authCode.codeChallengeMethod !== undefined;

  if (hasPkceBinding) {
    if (
      authCode.codeChallenge === undefined ||
      authCode.codeChallengeMethod === undefined
    ) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'Authorization code PKCE binding is incomplete'
      );
    }

    // PKCE code_verifier の検証
    if (!params.code_verifier) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'Missing required parameter: code_verifier'
      );
    }

    // RFC 7636 Section 4.1: code_verifier must be 43-128 unreserved characters
    if (params.code_verifier.length < 43 || params.code_verifier.length > 128) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'code_verifier length must be between 43 and 128 characters'
      );
    }

    if (!/^[A-Za-z0-9\-._~]+$/.test(params.code_verifier)) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'code_verifier contains invalid characters'
      );
    }

    const isValid = await verifyCodeChallenge(
      params.code_verifier,
      authCode.codeChallenge,
      authCode.codeChallengeMethod
    );

    if (!isValid) {
      throw new TokenError(
        TokenErrorCode.InvalidGrant,
        'code_verifier validation failed'
      );
    }

    codeVerified = true;
  }

  // 認可コード関連の情報を削除
  await authCodeResolver.revokeAuthorizationCode(params.code);

  return {
    grantType: 'authorization_code',
    clientId: authenticatedClientId,
    code: params.code,
    grantId: authCode.grantId,
    redirectUri: authCode.redirectUri,
    scope: authCode.scope,
    nonce: authCode.nonce,
    audience: authCode.audience,
    acrValues: authCode.acrValues,
    claims: authCode.claims,
    codeVerified,
  };
}
