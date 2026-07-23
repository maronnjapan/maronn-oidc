import { WebRouter } from '../web-router.js';
import {
  authenticateClient,
  handleRevocationRequest,
  RevocationError,
  TokenError,
} from '@maronn-oidc/core';
import {
  tokenClientResolver as defaultTokenClientResolver,
  revocationResolvers as defaultRevocationResolvers,
} from '../resolvers.js';

export const revocationApp = new WebRouter();

function isFormUrlEncoded(contentType: string): boolean {
  return contentType.toLowerCase().split(';')[0]?.trim() === 'application/x-www-form-urlencoded';
}

/**
 * Token Revocation Endpoint
 * RFC 7009 Section 2
 *
 * Confidential clients authenticate with their registered secret method. Public
 * clients registered with token_endpoint_auth_method=none identify themselves
 * with client_id only (RFC 7009 §2.1).
 * Always returns 200 OK with no body for both "revoked" and "not found" cases
 * to prevent client side-channels (RFC 7009 Section 2.2).
 *
 * Refresh token revocation also revokes sibling access tokens via grantId
 * (RFC 7009 Section 2.1 SHOULD).
 */
revocationApp.post('/', async (c) => {
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
    const resolvers = c.get('revocationResolvers') ?? defaultRevocationResolvers;

    const authenticatedClientId = await authenticateClient({
      params,
      authorizationHeader: authorization,
      clientResolver: tokenClientResolver,
    });

    await handleRevocationRequest({
      params: {
        token: typeof params.token === 'string' ? params.token : undefined,
        token_type_hint:
          typeof params.token_type_hint === 'string' ? params.token_type_hint : undefined,
      },
      authenticatedClientId,
      resolvers,
    });

    // RFC 7009 Section 2.2: empty body, 200 OK
    return c.body(null, 200);
  } catch (error) {
    if (error instanceof TokenError) {
      const status = error.statusCode as 400 | 401;
      if (error.wwwAuthenticate) c.header('WWW-Authenticate', error.wwwAuthenticate);
      return c.json(
        { error: error.error, error_description: error.errorDescription },
        status,
      );
    }
    if (error instanceof RevocationError) {
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
