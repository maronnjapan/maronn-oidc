import type {
  ClientResolver,
  TokenClientResolver,
  AuthorizationCodeResolver,
  AuthorizationCodeInfo,
  AccessTokenResolver,
  AccessTokenInfo,
  RefreshTokenResolver,
  RefreshTokenInfo,
  UserClaimsResolver,
  UserClaims,
  IntrospectionAccessTokenResolver,
  IntrospectionRefreshTokenResolver,
  RevocationTokenResolvers,
  SessionResolver,
  SessionInfo,
  ConsentResolver,
} from '@maronn-oidc/core';
import { createInMemoryClientResolver } from './config.js';
import {
  authCodeStore,
  accessTokenStore,
  refreshTokenStore,
  userStore,
  browserSessionStore,
  consentStore,
  parseSessionId,
} from './store.js';

/**
 * Default in-memory client resolver for quick local testing.
 * Project integrations should inject a D1/KV/env-backed resolver through Hono context.
 */
export const clientResolver: ClientResolver & TokenClientResolver =
  createInMemoryClientResolver();

export const tokenClientResolver: TokenClientResolver = clientResolver;

/**
 * Authorization Code Resolver for Token Endpoint.
 */
export const authorizationCodeResolver: AuthorizationCodeResolver = {
  async findAuthorizationCode(code: string): Promise<AuthorizationCodeInfo | null> {
    const entry = authCodeStore.get(code);
    if (!entry) return null;
    return entry;
  },
  async revokeAuthorizationCode(code: string): Promise<void> {
    authCodeStore.consume(code);
  },
  // OAuth 2.1 Section 4.1.2 / RFC 6749 Section 4.1.2:
  // SHOULD revoke all tokens previously issued from a reused authorization code.
  async revokeTokensByGrantId(grantId: string): Promise<void> {
    accessTokenStore.revokeByGrantId(grantId);
    refreshTokenStore.revokeByGrantId(grantId);
  },
};

/**
 * Access Token Resolver for UserInfo Endpoint.
 */
export const accessTokenResolver: AccessTokenResolver = {
  async findAccessToken(token: string): Promise<AccessTokenInfo | null> {
    return accessTokenStore.get(token) ?? null;
  },
};

/**
 * Refresh Token Resolver for Token Endpoint.
 * OAuth 2.1 Section 4.3
 */
export const refreshTokenResolver: RefreshTokenResolver = {
  async resolve(token: string): Promise<RefreshTokenInfo | null> {
    return refreshTokenStore.get(token) ?? null;
  },
  async revokeRefreshToken(token: string): Promise<void> {
    refreshTokenStore.consume(token);
  },
  // OAuth 2.1 Section 4.3.1: refresh token の再利用を検知した時は同 grant の
  // AT/RT をすべて失効する SHOULD。
  async revokeTokensByGrantId(grantId: string): Promise<void> {
    accessTokenStore.revokeByGrantId(grantId);
    refreshTokenStore.revokeByGrantId(grantId);
  },
};

/**
 * User Claims Resolver for UserInfo Endpoint.
 */
export const userClaimsResolver: UserClaimsResolver = {
  async findUserClaims(sub: string): Promise<UserClaims | null> {
    return userStore.getClaims(sub) ?? null;
  },
};

/**
 * Resolvers for RFC 7662 Token Introspection.
 * Reuses the same in-memory stores as UserInfo / token rotation.
 */
export const introspectionAccessTokenResolver: IntrospectionAccessTokenResolver = {
  async findAccessToken(token) {
    return accessTokenStore.get(token) ?? null;
  },
};

export const introspectionRefreshTokenResolver: IntrospectionRefreshTokenResolver = {
  async resolve(token) {
    return refreshTokenStore.get(token) ?? null;
  },
};

/**
 * Resolvers for RFC 7009 Token Revocation.
 *
 * RFC 7009 Section 2.1 SHOULD: revoking a refresh token also revokes all
 * access tokens that share the same grantId.
 */
export const revocationResolvers: RevocationTokenResolvers = {
  async findAccessToken(token) {
    return accessTokenStore.get(token) ?? null;
  },
  async revokeAccessToken(token) {
    accessTokenStore.revoke(token);
  },
  async findRefreshToken(token) {
    return refreshTokenStore.get(token) ?? null;
  },
  async revokeRefreshToken(token) {
    refreshTokenStore.revoke(token);
  },
  async revokeAccessTokensByGrantId(grantId) {
    accessTokenStore.revokeByGrantId(grantId);
  },
};

/**
 * Default session resolver: reads the browser session cookie and looks up the
 * active OP session (OIDC Core 1.0 Section 3.1.2.3). This is what enables SSO
 * and silent authentication (prompt=none) across authorization requests.
 */
export const sessionResolver: SessionResolver = {
  async resolve(request: Request): Promise<SessionInfo | null> {
    const sessionId = parseSessionId(request.headers.get('Cookie'));
    if (!sessionId) return null;
    const session = browserSessionStore.get(sessionId);
    if (!session) return null;
    return { subject: session.subject, authTime: session.authTime };
  },
};

/**
 * Default consent resolver backed by the in-memory consent store.
 * OIDC Core 1.0 Section 3.1.2.1: prompt=none must reject with consent_required
 * when consent has not been previously granted.
 */
export type GrantAwareConsentResolver = ConsentResolver & {
  recordGrant(subject: string, clientId: string, grantId: string): Promise<void>;
};

/**
 * User-facing "remove access" coordinator. The consent index is cleared first,
 * then every grant family for that subject/client is synchronously revoked.
 * Production stores must provide strongly consistent reads for this operation so
 * prompt=none and token use cannot observe stale consent or stale tokens.
 */
export async function revokeConsentAndTokens(subject: string, clientId: string): Promise<void> {
  const grantIds = consentStore.revoke(subject, clientId);
  for (const grantId of grantIds) {
    await authorizationCodeResolver.revokeTokensByGrantId?.(grantId);
  }
}

export const consentResolver: GrantAwareConsentResolver = {
  async hasConsent(subject: string, clientId: string, scopes: string[]): Promise<boolean> {
    return consentStore.hasConsent(subject, clientId, scopes);
  },
  // OIDC Core 1.0 Section 3.1.2.4: record the user's consent so a later
  // prompt=none (or non-interactive) request can confirm it without UI.
  async recordConsent(subject: string, clientId: string, scopes: string[]): Promise<void> {
    consentStore.grant(subject, clientId, scopes);
  },
  async recordGrant(subject: string, clientId: string, grantId: string): Promise<void> {
    consentStore.recordGrant(subject, clientId, grantId);
  },
  async revokeConsent(subject: string, clientId: string): Promise<void> {
    await revokeConsentAndTokens(subject, clientId);
  },
};
