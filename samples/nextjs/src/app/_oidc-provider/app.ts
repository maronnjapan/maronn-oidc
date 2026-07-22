import { WebRouter, type WebMiddleware } from './web-router';
import { authorizeApp } from './routes/authorize';
import { tokenApp } from './routes/token';
import { userinfoApp } from './routes/userinfo';
import { introspectionApp } from './routes/introspection';
import { revocationApp } from './routes/revocation';
import { jwksApp } from './routes/jwks';
import { discoveryApp } from './routes/discovery';
import { loginApp } from './routes/login';
import { consentApp } from './routes/consent';
import {
  createInMemoryClientResolver,
  createProviderConfig,
  type ProviderConfig,
} from './config';
import {
  sessionResolver as defaultSessionResolver,
  consentResolver as defaultConsentResolver,
} from './resolvers';
import { createViews, type Views } from './views';
import {
  assertHasRs256Key,
  assertKeyStrength,
  assertKidStrategyConsistent,
  getRegisteredSigningKeys,
  signingKeysToJwkSet,
} from '@maronn-oidc/core';
import type {
  SigningKey,
  SigningKeyProvider,
  ClientResolver,
  TokenClientResolver,
  AcrResolver,
  JwkSet,
  SessionResolver,
  ConsentResolver,
} from '@maronn-oidc/core';

export type CorsOrigins = string | string[];

export interface OidcProviderOptions {
  config?: Partial<ProviderConfig>;
  signingKeyProvider: SigningKeyProvider;
  idTokenSigningKeyProvider?: SigningKeyProvider;
  userinfoSigningKeyProvider?: SigningKeyProvider;
  clientResolver?: ClientResolver;
  tokenClientResolver?: TokenClientResolver;
  sessionResolver?: SessionResolver;
  consentResolver?: ConsentResolver;
  acrResolver?: AcrResolver;
  jwksProvider?: () => Promise<JwkSet> | JwkSet;
  corsOrigins?: CorsOrigins;
  /**
   * Custom UI for the login / consent / error pages.
   * Provide any subset; omitted pages fall back to the default views.
   * Inject your own UI here instead of editing views.ts.
   */
  views?: Partial<Views>;
}

export function validateSigningKeySet(
  keys: readonly SigningKey[],
  requireRs256 = false,
): void {
  assertKeyStrength(keys);
  assertKidStrategyConsistent(keys);
  if (requireRs256) {
    assertHasRs256Key(keys.map((key) => key.privateKey));
  }
}

export function createApp(options: OidcProviderOptions): WebRouter {
  const app = new WebRouter();

  const corsOrigins = options.corsOrigins ?? '*';
  const protectedCors = createCorsMiddleware({
    origins: corsOrigins,
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  const publicCors = createCorsMiddleware({
    origins: '*',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  });
  app.use('/token', protectedCors);
  app.use('/userinfo', protectedCors);
  app.use('/introspect', protectedCors);
  app.use('/revoke', protectedCors);
  app.use('/.well-known/openid-configuration', publicCors);
  app.use('/.well-known/jwks.json', publicCors);

  app.use('*', async (c, next) => {
    let signingKey;
    let idTokenSigningKey;
    let userinfoSigningKey;
    let signingKeys;
    let idTokenSigningKeys;
    let userinfoSigningKeys;
    try {
      signingKey = await options.signingKeyProvider.getSigningKey();
      signingKeys = await getRegisteredSigningKeys(options.signingKeyProvider);
      const idProvider = options.idTokenSigningKeyProvider ?? options.signingKeyProvider;
      idTokenSigningKey = await idProvider.getSigningKey();
      idTokenSigningKeys = await getRegisteredSigningKeys(idProvider);
      const uiProvider = options.userinfoSigningKeyProvider ?? options.signingKeyProvider;
      userinfoSigningKey = await uiProvider.getSigningKey();
      userinfoSigningKeys = await getRegisteredSigningKeys(uiProvider);
      validateSigningKeySet(signingKeys);
      validateSigningKeySet(idTokenSigningKeys, true);
      validateSigningKeySet(userinfoSigningKeys);
    } catch {
      return c.json({ error: 'server_error', error_description: 'Failed to load signing key' }, 503);
    }

    const { privateKey, publicJwk, keyId } = signingKey;
    const clientResolver =
      options.clientResolver ?? createInMemoryClientResolver();

    c.set('privateKey', privateKey);
    c.set('publicJwk', publicJwk);
    c.set('keyId', keyId);
    c.set('idTokenPrivateKey', idTokenSigningKey.privateKey);
    c.set('idTokenPublicJwk', idTokenSigningKey.publicJwk);
    c.set('idTokenKeyId', idTokenSigningKey.keyId);
    c.set('userinfoPrivateKey', userinfoSigningKey.privateKey);
    c.set('userinfoPublicJwk', userinfoSigningKey.publicJwk);
    c.set('userinfoKeyId', userinfoSigningKey.keyId);
    c.set('signingKeys', signingKeys);
    c.set('idTokenSigningKeys', idTokenSigningKeys);
    c.set('userinfoSigningKeys', userinfoSigningKeys);
    c.set('config', createProviderConfig(options.config));
    c.set('clientResolver', clientResolver);
    c.set('tokenClientResolver', options.tokenClientResolver ?? clientResolver);
    if (options.acrResolver) {
      c.set('acrResolver', options.acrResolver);
    }
    // P1: id_token_hint 検証用 JWKS プロバイダ。未指定なら OP 自身の ID Token
    // 署名鍵セットを既定として使い、OP が発行した ID Token を hint として検証できる
    // ようにする（OIDC Core 1.0 §3.1.2.2）。明示指定があれば優先。
    c.set('jwksProvider', options.jwksProvider ?? (() => signingKeysToJwkSet(idTokenSigningKeys)));
    c.set('sessionResolver', options.sessionResolver ?? defaultSessionResolver);
    c.set('consentResolver', options.consentResolver ?? defaultConsentResolver);
    // Inject custom UI (login / consent / error) merged over the defaults.
    c.set('views', createViews(options.views));
    await next();
  });

  app.route('/authorize', authorizeApp);
  app.route('/token', tokenApp);
  app.route('/userinfo', userinfoApp);
  app.route('/introspect', introspectionApp);
  app.route('/revoke', revocationApp);
  app.route('/.well-known/jwks.json', jwksApp);
  app.route('/.well-known/openid-configuration', discoveryApp);
  app.route('/login', loginApp);
  app.route('/consent', consentApp);

  return app;
}

interface CorsOptions {
  origins: CorsOrigins;
  allowMethods: string[];
  allowHeaders: string[];
  maxAge: number;
}

function createCorsMiddleware(options: CorsOptions): WebMiddleware {
  return async (c, next) => {
    const origin = resolveCorsOrigin(c.req.raw.headers.get('Origin'), options.origins);
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
    }
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', options.allowMethods.join(','));
    c.header('Access-Control-Allow-Headers', options.allowHeaders.join(','));
    c.header('Access-Control-Max-Age', String(options.maxAge));

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  };
}

function resolveCorsOrigin(requestOrigin: string | null, allowed: CorsOrigins): string | undefined {
  if (allowed === '*') return '*';
  if (typeof allowed === 'string') return allowed;
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return undefined;
}
