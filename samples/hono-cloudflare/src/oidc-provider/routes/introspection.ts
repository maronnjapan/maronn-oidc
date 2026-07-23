import { Hono } from 'hono';
import {
  authenticateClient,
  handleIntrospectionRequest,
  IntrospectionError,
  TokenError,
} from '@maronn-oidc/core';
import {
  tokenClientResolver as defaultTokenClientResolver,
  introspectionAccessTokenResolver as defaultAccessResolver,
  introspectionRefreshTokenResolver as defaultRefreshResolver,
} from '../resolvers.js';

export const introspectionApp = new Hono<{ Variables: Record<string, any> }>();

function isFormUrlEncoded(contentType: string): boolean {
  return contentType.toLowerCase().split(';')[0]?.trim() === 'application/x-www-form-urlencoded';
}

/**
 * Token Introspection Endpoint
 * RFC 7662 Section 2
 *
 * Confidential client only — public clients are out of scope for this template.
 * Response is always cache-busting per RFC 7662 Section 2.2.
 */
introspectionApp.post('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');

  if (!isFormUrlEncoded(c.req.header('Content-Type') ?? '')) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'Content-Type must be application/x-www-form-urlencoded',
      },
      400,
    );
  }

  const body = Object.fromEntries(new URLSearchParams(await c.req.text()));
  const authorization = c.req.header('Authorization') ?? '';
  const params = Object.fromEntries(
    Object.entries(body).map(([k, v]) => [k, String(v)]),
  );

  try {
    const tokenClientResolver = c.get('tokenClientResolver') ?? defaultTokenClientResolver;
    const accessTokenResolver =
      c.get('introspectionAccessTokenResolver') ?? defaultAccessResolver;
    const refreshTokenResolver =
      c.get('introspectionRefreshTokenResolver') ?? defaultRefreshResolver;

    const authenticatedClientId = await authenticateClient({
      params,
      authorizationHeader: authorization,
      clientResolver: tokenClientResolver,
    });

    const response = await handleIntrospectionRequest({
      params: {
        token: typeof params.token === 'string' ? params.token : undefined,
        token_type_hint:
          typeof params.token_type_hint === 'string' ? params.token_type_hint : undefined,
      },
      authenticatedClientId,
      accessTokenResolver,
      refreshTokenResolver,
    });

    return c.json(response);
  } catch (error) {
    if (error instanceof TokenError) {
      const status = error.statusCode as 400 | 401;
      if (error.wwwAuthenticate) c.header('WWW-Authenticate', error.wwwAuthenticate);
      return c.json(
        { error: error.error, error_description: error.errorDescription },
        status,
      );
    }
    if (error instanceof IntrospectionError) {
      const status = error.statusCode as 400 | 401;
      if (error.wwwAuthenticate) c.header('WWW-Authenticate', error.wwwAuthenticate);
      return c.json(
        { error: error.error, error_description: error.errorDescription },
        status,
      );
    }
    return c.json({ error: 'server_error' }, 500);
  }
});
