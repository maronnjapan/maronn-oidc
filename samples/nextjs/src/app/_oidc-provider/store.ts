import type {
  AuthTransaction,
  AuthTransactionStore,
  AuthorizationCodeInfo,
  AccessTokenInfo,
  RefreshTokenInfo,
  UserClaims,
} from '@maronn-oidc/core';

/**
 * In-memory Authorization Transaction Store.
 * In production, replace with a persistent store (e.g., Redis, database).
 */
export class InMemoryTransactionStore implements AuthTransactionStore {
  private store = new Map<string, { value: AuthTransaction; expiresAt: number }>();

  async get(key: string): Promise<AuthTransaction | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: AuthTransaction, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + (ttlSeconds * 1000) });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * In-memory Authorization Code Store.
 * Stores issued authorization codes and their associated data.
 */
export class AuthorizationCodeStore {
  private codes = new Map<string, AuthorizationCodeInfo>();

  set(code: string, info: AuthorizationCodeInfo): void {
    this.codes.set(code, info);
  }

  get(code: string): AuthorizationCodeInfo | undefined {
    const entry = this.codes.get(code);
    if (!entry) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (entry.expiresAt <= now) {
      this.codes.delete(code);
      return undefined;
    }
    return entry;
  }

  // Mark the authorization code as used (do NOT physically delete it).
  // OAuth 2.1 §4.1.2 / RFC 9700 §4.13: a replayed code must still be findable as
  // used:true so revokeAuthorizationCode can detect reuse and revoke the grant's
  // tokens. The resolver path uses consume(); see delete() for physical removal.
  consume(code: string): void {
    const entry = this.codes.get(code);
    if (entry) {
      entry.used = true;
    }
  }

  // Physically remove the entry. Use only where physical deletion is correct
  // (e.g. expired-entry eviction), never as the resolver's "code used" path —
  // that must be consume() so reuse detection keeps working.
  delete(code: string): void {
    this.codes.delete(code);
  }
}

/**
 * In-memory Access Token Store.
 * Stores issued access tokens for UserInfo endpoint validation.
 */
export class AccessTokenStore {
  private tokens = new Map<string, AccessTokenInfo>();

  set(token: string, info: AccessTokenInfo): void {
    this.tokens.set(token, info);
  }

  get(token: string): AccessTokenInfo | undefined {
    const entry = this.tokens.get(token);
    if (!entry) return undefined;
    // Lazy eviction (RFC 6819 §5.1.5.3 / RFC 9700 §4.14): drop expired entries on
    // read so an idle in-memory store does not grow unbounded. Correctness is already
    // guaranteed by the core expiry check; this only bounds retention.
    const now = Math.floor(Date.now() / 1000);
    if (entry.expiresAt <= now) {
      this.tokens.delete(token);
      return undefined;
    }
    return entry;
  }

  delete(token: string): void {
    this.tokens.delete(token);
  }

  // OAuth 2.1 Section 4.1.2: revoke all access tokens issued under a given grant
  // when the originating authorization code is reused.
  revokeByGrantId(grantId: string): void {
    for (const [token, info] of this.tokens) {
      if (info.grantId === grantId) {
        this.tokens.delete(token);
      }
    }
  }

  /** Revoke a single access token. Used by RFC 7009 revocation endpoint. */
  revoke(token: string): void {
    this.tokens.delete(token);
  }
}

/**
 * In-memory Refresh Token Store.
 * Stores issued refresh tokens for token rotation.
 * OAuth 2.1 Section 4.3
 */
export class RefreshTokenStore {
  private tokens = new Map<string, RefreshTokenInfo>();

  set(token: string, info: RefreshTokenInfo): void {
    this.tokens.set(token, info);
  }

  get(token: string): RefreshTokenInfo | undefined {
    const entry = this.tokens.get(token);
    if (!entry) return undefined;
    // Lazy eviction only past the absolute lifetime (expiresAt). A used=true but
    // still-in-lifetime entry MUST remain so rotation-reuse detection (revokeByGrantId)
    // keeps firing (OAuth 2.1 4.3.1 / RFC 9700 4.13). Eviction never keys on the used flag.
    const now = Math.floor(Date.now() / 1000);
    if (entry.expiresAt <= now) {
      this.tokens.delete(token);
      return undefined;
    }
    return entry;
  }

  // Mark the rotated refresh token as used (do NOT physically delete it).
  // OAuth 2.1 §4.3.1 / RFC 9700 §4.13: a replayed (already-rotated) refresh token
  // must remain findable as used:true so reuse detection can revoke the grant.
  // The resolver path uses consume(); see delete() for physical removal.
  consume(token: string): void {
    const entry = this.tokens.get(token);
    if (entry) {
      entry.used = true;
    }
  }

  // Physically remove the entry. Use only where physical deletion is correct
  // (e.g. revocation / grant cascade / expired-entry eviction), never as the
  // resolver's "rotated" path — that must be consume() to keep reuse detection.
  delete(token: string): void {
    this.tokens.delete(token);
  }

  // OAuth 2.1 Section 4.1.2: revoke all refresh tokens (including rotated ones)
  // sharing the given grantId when the originating authorization code is reused.
  revokeByGrantId(grantId: string): void {
    for (const [token, info] of this.tokens) {
      if (info.grantId === grantId) {
        this.tokens.delete(token);
      }
    }
  }

  /** Revoke a single refresh token. Used by RFC 7009 revocation endpoint. */
  revoke(token: string): void {
    this.tokens.delete(token);
  }
}

/**
 * In-memory authenticated session store.
 * Keeps login results between login and consent steps.
 */
export interface AuthSessionInfo {
  subject: string;
  authTime: number;
}

export class AuthSessionStore {
  private sessions = new Map<string, AuthSessionInfo>();

  set(transactionId: string, info: AuthSessionInfo): void {
    this.sessions.set(transactionId, info);
  }

  get(transactionId: string): AuthSessionInfo | undefined {
    return this.sessions.get(transactionId);
  }

  delete(transactionId: string): void {
    this.sessions.delete(transactionId);
  }
}

/**
 * Browser (OP) session store - OIDC Core 1.0 Section 3.1.2.3.
 * Unlike AuthSessionStore (a per-transaction login -> consent handoff), this
 * persists across authorization requests, keyed by an opaque session_id carried
 * in an HttpOnly cookie. It is what makes SSO, prompt=none and max_age work.
 * In production, replace with a persistent store (e.g., KV, database).
 */
export const SESSION_COOKIE_NAME = 'session_id';

export interface BrowserSessionInfo {
  subject: string;
  authTime: number;
}

export class BrowserSessionStore {
  private sessions = new Map<string, BrowserSessionInfo>();

  set(sessionId: string, info: BrowserSessionInfo): void {
    this.sessions.set(sessionId, info);
  }

  get(sessionId: string): BrowserSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/**
 * Extract the session_id value from a Cookie request header.
 * Returns undefined when the header is missing or the cookie is absent.
 */
export function parseSessionId(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

/**
 * Build the Set-Cookie value for the browser session.
 * Attributes per study-material/http-security-headers-and-tls.md:
 * HttpOnly (no JS access), Secure (HTTPS only), SameSite=Lax. SameSite=Strict
 * would drop the cookie on the cross-site authorization redirect return and
 * break the flow, so Lax is required.
 */
export function buildSessionCookie(sessionId: string): string {
  return SESSION_COOKIE_NAME + '=' + sessionId + '; HttpOnly; Secure; SameSite=Lax; Path=/';
}

/**
 * In-memory consent store. Records that a user granted a set of scopes to a
 * client so prompt=none can confirm consent without showing UI
 * (OIDC Core 1.0 Section 3.1.2.1).
 */
export class ConsentStore {
  private grants = new Map<string, Map<string, Set<string>>>();
  // One consent can authorize multiple code flows. Keep every resulting grantId
  // indexed by subject + client so a user-initiated "remove access" operation
  // can revoke the complete AT/RT families without touching another client.
  private grantIds = new Map<string, Map<string, Set<string>>>();

  grant(subject: string, clientId: string, scopes: string[]): void {
    let byClient = this.grants.get(subject);
    if (!byClient) {
      byClient = new Map<string, Set<string>>();
      this.grants.set(subject, byClient);
    }
    const granted = byClient.get(clientId) ?? new Set<string>();
    for (const s of scopes) granted.add(s);
    byClient.set(clientId, granted);
  }

  hasConsent(subject: string, clientId: string, scopes: string[]): boolean {
    const granted = this.grants.get(subject)?.get(clientId);
    if (!granted) return false;
    return scopes.every((s) => granted.has(s));
  }

  recordGrant(subject: string, clientId: string, grantId: string): void {
    let byClient = this.grantIds.get(subject);
    if (!byClient) {
      byClient = new Map<string, Set<string>>();
      this.grantIds.set(subject, byClient);
    }
    const ids = byClient.get(clientId) ?? new Set<string>();
    ids.add(grantId);
    byClient.set(clientId, ids);
  }

  // Revoke all consent the subject granted to a client (e.g. "remove access")
  // and atomically detach the grant ids that the caller must cascade-revoke.
  revoke(subject: string, clientId: string): string[] {
    const ids = [...(this.grantIds.get(subject)?.get(clientId) ?? [])];
    this.grants.get(subject)?.delete(clientId);
    this.grantIds.get(subject)?.delete(clientId);
    return ids;
  }
}

/**
 * In-memory User Store.
 * Stores user profiles for authentication and UserInfo responses.
 * In production, replace with a database-backed user store.
 */
export class UserStore {
  private users = new Map<string, UserClaims & { password: string }>();

  constructor() {
    // Example user for development.
    // Carries the standard claims for every scope advertised in Discovery
    // (profile / email / address / phone — OIDC Core 1.0 §5.4) so the OIDF
    // Conformance Suite's VerifyScopesReturnedInUserInfoClaims finds a value for
    // each requested scope. filterClaimsByScope still gates what is returned per
    // scope; populating the fixture is the resolver's responsibility.
    this.users.set('testuser', {
      sub: 'testuser',
      // profile scope
      name: 'Test User',
      family_name: 'User',
      given_name: 'Test',
      middle_name: 'Q',
      nickname: 'testy',
      preferred_username: 'testuser',
      profile: 'https://op.example.com/users/testuser',
      picture: 'https://op.example.com/users/testuser/avatar.png',
      website: 'https://testuser.example.com',
      gender: 'unspecified',
      birthdate: '1990-01-01',
      zoneinfo: 'Asia/Tokyo',
      locale: 'en-US',
      updated_at: 1700000000,
      // email scope
      email: 'test@example.com',
      email_verified: true,
      // address scope
      address: {
        formatted: '100 Test Street, Test City, TS 10000, JP',
        street_address: '100 Test Street',
        locality: 'Test City',
        region: 'TS',
        postal_code: '10000',
        country: 'JP',
      },
      // phone scope
      phone_number: '+81-3-0000-0000',
      phone_number_verified: true,
      password: 'password',
    });

    // A second fixture makes subject-isolation and id_token_hint/session mismatch
    // flows reproducible with real signed tokens. It is development-only example
    // data, not a multi-account policy for production integrations.
    this.users.set('otheruser', {
      sub: 'otheruser',
      name: 'Other User',
      preferred_username: 'otheruser',
      email: 'other@example.com',
      email_verified: true,
      password: 'password',
    });
  }

  authenticate(username: string, password: string): (UserClaims & { password: string }) | undefined {
    const user = this.users.get(username);
    if (user && user.password === password) {
      return user;
    }
    return undefined;
  }

  getClaims(sub: string): UserClaims | undefined {
    const user = this.users.get(sub);
    if (!user) return undefined;
    const { password: _, ...claims } = user;
    return claims;
  }
}

// Singleton store instances.
//
// Backed by globalThis so a single instance is shared process-wide. This is
// required on Next.js, where Server Components / Server Actions and Route
// Handlers are instantiated in separate module layers: a plain
// `new Store()` module export would produce a different instance per layer, so
// state written by the login/consent pages (transactions, sessions, consent)
// would be invisible to the /authorize and /token route handlers and vice
// versa. It also survives dev-mode hot reloads. Harmless for single-layer
// runtimes (Node / Hono / Express / Fastify), which always see one instance.
const storeRegistry = globalThis as typeof globalThis & {
  __oidcProviderStores?: {
    transactionStore: InMemoryTransactionStore;
    authCodeStore: AuthorizationCodeStore;
    accessTokenStore: AccessTokenStore;
    refreshTokenStore: RefreshTokenStore;
    authSessionStore: AuthSessionStore;
    browserSessionStore: BrowserSessionStore;
    consentStore: ConsentStore;
    userStore: UserStore;
  };
};

const stores = (storeRegistry.__oidcProviderStores ??= {
  transactionStore: new InMemoryTransactionStore(),
  authCodeStore: new AuthorizationCodeStore(),
  accessTokenStore: new AccessTokenStore(),
  refreshTokenStore: new RefreshTokenStore(),
  authSessionStore: new AuthSessionStore(),
  browserSessionStore: new BrowserSessionStore(),
  consentStore: new ConsentStore(),
  userStore: new UserStore(),
});

export const transactionStore = stores.transactionStore;
export const authCodeStore = stores.authCodeStore;
export const accessTokenStore = stores.accessTokenStore;
export const refreshTokenStore = stores.refreshTokenStore;
export const authSessionStore = stores.authSessionStore;
export const browserSessionStore = stores.browserSessionStore;
export const consentStore = stores.consentStore;
export const userStore = stores.userStore;
