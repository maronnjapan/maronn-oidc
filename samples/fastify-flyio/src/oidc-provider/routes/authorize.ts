import { WebRouter } from '../web-router.js';
import {
  validateAuthorizationRequest,
  validateIdTokenHint,
  createAuthTransaction,
  createAuthorizationCode,
  completeAuthTransaction,
  generateRandomString,
  checkPromptNone,
  requiresReauthentication,
  sanitizeErrorDescription,
  AuthorizationError,
  IdTokenHintError,
  type AuthorizationRequestParams,
  type JwkSet,
} from '@maronn-oidc/core';
import { clientResolver as defaultClientResolver } from '../resolvers.js';
import {
  transactionStore as defaultTransactionStore,
  authCodeStore as defaultAuthCodeStore,
  authSessionStore as defaultAuthSessionStore,
} from '../store.js';
import { defaultViews, renderView } from '../views.js';

export const authorizeApp = new WebRouter();

/**
 * Narrows raw query-string params to the typed AuthorizationRequestParams.
 * PKCE parameters are validated by core so conformance compatibility mode can
 * intentionally pass requests that omit them.
 */
function isAuthorizationRequestParams(
  params: unknown,
): params is AuthorizationRequestParams {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  return typeof p['client_id'] === 'string';
}

/**
 * Builds a redirect URL with an OAuth error response.
 * OIDC Core 1.0 Section 3.1.2.6 / RFC 6749 Section 4.1.2.1.
 *
 * errorDescription is optional; when supplied it is sanitized to the RFC 6749
 * Section 5.2 allowed character set before being appended so user-controlled
 * fragments cannot smuggle control bytes into the redirect URL.
 *
 * RFC 9207 §2: when issuer is provided, the iss parameter is appended so the
 * client can pin the issuer that produced this authorization response.
 */
function buildErrorRedirect(
  redirectUri: string,
  error: string,
  state?: string,
  errorDescription?: string,
  issuer?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (errorDescription) {
    url.searchParams.set('error_description', sanitizeErrorDescription(errorDescription));
  }
  if (state) url.searchParams.set('state', state);
  if (issuer) url.searchParams.set('iss', issuer);
  return url.toString();
}

/**
 * Iterates URLSearchParams and reports the first repeated key, if any.
 * OIDC Core 1.0 §3.1.2.1 / RFC 6749 §3.1: authorization request parameters
 * MUST NOT be repeated. Object.fromEntries(searchParams) silently keeps the
 * last value, which would let `response_type=code&response_type=token` slip
 * through, so we scan entries explicitly.
 */
function collectUniqueParams(
  searchParams: URLSearchParams,
): { params: Record<string, string>; duplicateKey?: string } {
  const params: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [key, value] of searchParams) {
    if (seen.has(key)) {
      return { params, duplicateKey: key };
    }
    seen.add(key);
    params[key] = value;
  }
  return { params };
}

/**
 * OIDC Core 1.0 Section 3.1.2.1 / Section 13.2: parses the authorization request
 * parameters from either GET (query string) or POST (application/x-www-form-urlencoded).
 * Returns null if the request transport is invalid (e.g. unsupported Content-Type on POST).
 */
async function parseAuthorizationRequestParams(
  c: any,
): Promise<{ params: Record<string, string>; duplicateKey?: string } | null> {
  if (c.req.method === 'POST') {
    const contentType = c.req.header('Content-Type') ?? '';
    // OIDC Core 1.0 Section 13.2: POST must use application/x-www-form-urlencoded.
    if (!contentType.toLowerCase().split(';')[0].trim().startsWith('application/x-www-form-urlencoded')) {
      return null;
    }
    // Read the raw body so URLSearchParams preserves duplicate keys
    // (parseBody silently dedupes them).
    const raw = await c.req.text();
    return collectUniqueParams(new URLSearchParams(raw));
  }
  return collectUniqueParams(new URL(c.req.url).searchParams);
}

/**
 * Authorization Endpoint handler shared by GET and POST.
 * OIDC Core 1.0 Section 3.1.2
 */
const handleAuthorizationRequest = async (c: any) => {
  const parsed = await parseAuthorizationRequestParams(c);

  if (parsed === null) {
    return c.json({ error: 'invalid_request', error_description: 'Authorization POST requests must use application/x-www-form-urlencoded' }, 400);
  }

  // OIDC Core 1.0 §3.1.2.1 / RFC 6749 §3.1: request parameters MUST NOT be repeated.
  if (parsed.duplicateKey !== undefined) {
    return c.json({ error: 'invalid_request', error_description: `Parameter "${parsed.duplicateKey}" must not be repeated` }, 400);
  }

  const rawParams = parsed.params;

  if (!isAuthorizationRequestParams(rawParams)) {
    return c.json({ error: 'invalid_request', error_description: 'Missing required parameter: client_id' }, 400);
  }

  const params = rawParams;

  try {
    const clientResolver = c.get('clientResolver') ?? defaultClientResolver;
    const transactionStore = c.get('transactionStore') ?? defaultTransactionStore;
    const authCodeStore = c.get('authCodeStore') ?? defaultAuthCodeStore;
    // RFC 9207 §2: include the issuer identifier on every authorization
    // response (success and error) so clients can pin the issuer that
    // produced the response.
    const config = c.get('config');
    const issuer = config.issuer;

    // OIDC Core 1.0 §11: offline_access requires prompt=consent (or another granting condition).
    // Default behavior: validateAuthorizationRequest drops offline_access from scope unless
    // prompt=consent is present. To inject your own grant policy (e.g. honor a previously
    // recorded user consent), pass an options object with isOfflineAccessGranted:
    //   await validateAuthorizationRequest(params, clientResolver, {
    //     isOfflineAccessGranted: (req, { promptValues }) => promptValues.includes('consent') || hasStoredConsent(req),
    //   });
    const validatedRequest = await validateAuthorizationRequest(
      params,
      clientResolver,
      {
        allowNonPkceAuthorizationCodeFlow: config.allowNonPkceAuthorizationCodeFlow,
        // OIDC Core 1.0 §6.1: verify signed Request Objects (request parameter)
        // against the client's registered JWKS. RS256 is required; alg=none is
        // accepted only when allowUnsignedRequestObject is enabled (conformance compat).
        requestObject: {
          allowUnsigned: config.allowUnsignedRequestObject,
        },
      },
    );

    // Create authentication transaction
    const csrfToken = await generateRandomString(32);
    const transaction = createAuthTransaction(validatedRequest, csrfToken);
    const transactionId = await generateRandomString(32);

    // Store transaction
    await transactionStore.put(
      'auth_txn:' + transactionId,
      transaction,
      10 * 60, // 10 minutes TTL
    );

    // OIDC Core 1.0 Section 3.1.2.1: prompt is a space-delimited list
    const promptValues = transaction.prompt?.trim().split(/\s+/).filter(Boolean) ?? [];

    // prompt=none must not be combined with other values (OIDC Core 1.0 Section 3.1.2.1)
    if (promptValues.includes('none') && promptValues.length > 1) {
      await transactionStore.delete('auth_txn:' + transactionId);
      return c.redirect(buildErrorRedirect(transaction.redirectUri, 'invalid_request', transaction.state, 'prompt=none must not be combined with other prompt values', issuer));
    }

    // prompt=none: silent authentication without any user interaction
    // OIDC Core 1.0 Section 3.1.2.1
    if (promptValues.includes('none')) {
      const sessionResolver = c.get('sessionResolver');
      const consentResolver = c.get('consentResolver');

      // No sessionResolver configured → cannot verify session → login_required
      if (!sessionResolver) {
        await transactionStore.delete('auth_txn:' + transactionId);
        return c.redirect(buildErrorRedirect(transaction.redirectUri, 'login_required', transaction.state, 'sessionResolver is not configured; cannot satisfy prompt=none', issuer));
      }

      // No consentResolver configured → cannot confirm consent → consent_required
      // (OIDC Core 1.0 Section 3.1.2.1: prompt=none must not display consent screen)
      if (!consentResolver) {
        await transactionStore.delete('auth_txn:' + transactionId);
        return c.redirect(buildErrorRedirect(transaction.redirectUri, 'consent_required', transaction.state, 'consentResolver is not configured; cannot satisfy prompt=none', issuer));
      }

      // OIDC Core 1.0 §3.1.2.1: when id_token_hint is provided, the OP MUST verify
      // its signature, iss, aud, and exp before trusting sub. The verified subject
      // is then matched against the active session (handled by checkPromptNone).
      // OP の JWKS を提供するための jwksProvider を context から取得する。
      let verifiedHintSubject: string | undefined;
      if (transaction.idTokenHint !== undefined) {
        const jwksProvider = c.get('jwksProvider') as undefined | (() => Promise<JwkSet> | JwkSet);
        if (!jwksProvider) {
          // jwksProvider 未提供では hint を検証できない → login_required で拒否
          await transactionStore.delete('auth_txn:' + transactionId);
          return c.redirect(buildErrorRedirect(transaction.redirectUri, 'login_required', transaction.state, 'jwksProvider is not configured; cannot verify id_token_hint', issuer));
        }
        try {
          const jwks = await jwksProvider();
          const verified = await validateIdTokenHint(transaction.idTokenHint, {
            expectedIss: issuer,
            expectedAud: transaction.clientId,
            jwks,
          });
          verifiedHintSubject = verified.sub;
        } catch (hintError) {
          await transactionStore.delete('auth_txn:' + transactionId);
          const code = hintError instanceof IdTokenHintError ? hintError.error : 'login_required';
          return c.redirect(buildErrorRedirect(transaction.redirectUri, code, transaction.state, hintError instanceof Error && hintError.message ? hintError.message : 'id_token_hint verification failed', issuer));
        }
      }

      let session;
      try {
        // checkPromptNone validates session AND consent in one shot.
        // Throws AuthorizationError(login_required | consent_required) on failure.
        session = await checkPromptNone(transaction, sessionResolver, c.req.raw, consentResolver, {
          verifiedHintSubject,
        });
      } catch (promptError) {
        await transactionStore.delete('auth_txn:' + transactionId);
        if (promptError instanceof AuthorizationError) {
          return c.redirect(buildErrorRedirect(transaction.redirectUri, promptError.error, transaction.state, promptError.errorDescription, issuer));
        }
        const serverDescription =
          promptError instanceof Error && promptError.message
            ? promptError.message
            : 'Unexpected error while evaluating prompt=none';
        return c.redirect(buildErrorRedirect(transaction.redirectUri, 'server_error', transaction.state, serverDescription, issuer));
      }

      // Check max_age: if session is too old, prompt=none cannot trigger re-authentication
      // OIDC Core 1.0 Section 3.1.2.1
      if (transaction.maxAge !== undefined && requiresReauthentication(transaction.maxAge, session.authTime)) {
        await transactionStore.delete('auth_txn:' + transactionId);
        return c.redirect(buildErrorRedirect(transaction.redirectUri, 'login_required', transaction.state, 'Session exceeds the requested max_age; re-authentication required', issuer));
      }

      // Filter offline_access if the client does not allow it
      const clientConfig = await clientResolver.findClient(transaction.clientId);
      const grantedScope = transaction.scope.split(' ').filter((s: string) => {
        if (s === 'offline_access' && !clientConfig?.offlineAccessAllowed) return false;
        return Boolean(s);
      });

      // Generate authorization code via core helper
      const responseParams = await completeAuthTransaction(
        transactionId,
        transaction,
        transactionStore,
      );
      const authCodeData = await createAuthorizationCode({
        authorizationResponse: { ...responseParams, scope: grantedScope },
        subject: session.subject,
        authTime: session.authTime,
        // OIDC Core 1.0 §3.1.3.1: TTL は ProviderConfig から設定可能（既定 300 秒）。
        ttlSeconds: config.authorizationCodeTtl,
      });
      await authCodeStore.set(authCodeData.code, authCodeData);
      await consentResolver.recordGrant?.(
        session.subject,
        transaction.clientId,
        authCodeData.grantId,
      );

      const redirectUrl = new URL(transaction.redirectUri);
      redirectUrl.searchParams.set('code', authCodeData.code);
      if (transaction.state) redirectUrl.searchParams.set('state', transaction.state);
      // RFC 9207 §2: include iss in success responses too.
      redirectUrl.searchParams.set('iss', issuer);
      return c.redirect(redirectUrl.toString());
    }

    // OIDC Core 1.0 Section 3.1.2.3: an active OP session enables Single Sign-On.
    // Reuse it (skipping the login screen) unless prompt forces fresh auth.
    // - When max_age is requested, the session must also satisfy the freshness
    //   bound (Section 3.1.2.1).
    // - When max_age is absent, any active session is reused (SSO).
    // prompt=login / prompt=select_account always force re-authentication.
    if (!promptValues.includes('login') && !promptValues.includes('select_account')) {
      const sessionResolver = c.get('sessionResolver');
      if (sessionResolver) {
        const existingSession = await sessionResolver.resolve(c.req.raw);
        const sessionIsFresh =
          existingSession !== null &&
          (transaction.maxAge === undefined ||
            !requiresReauthentication(transaction.maxAge, existingSession.authTime));
        if (existingSession && sessionIsFresh) {
          // OIDC Core 1.0 §3.1.2.1: prompt=consent MUST re-display the consent UI.
          // Otherwise, if the user already granted (a superset of) the requested
          // scopes to this client, skip the consent screen and issue the code
          // directly — the interactive analogue of the prompt=none silent path.
          const consentResolver = c.get('consentResolver');
          const requestedScopes = transaction.scope.split(' ').filter(Boolean);
          const consentAlreadyGranted =
            !promptValues.includes('consent') &&
            consentResolver !== undefined &&
            (await consentResolver.hasConsent(
              existingSession.subject,
              transaction.clientId,
              requestedScopes,
            ));

          if (consentAlreadyGranted) {
            // Filter offline_access if the client does not allow it
            const clientConfig = await clientResolver.findClient(transaction.clientId);
            const grantedScope = transaction.scope.split(' ').filter((s: string) => {
              if (s === 'offline_access' && !clientConfig?.offlineAccessAllowed) return false;
              return Boolean(s);
            });

            const responseParams = await completeAuthTransaction(
              transactionId,
              transaction,
              transactionStore,
            );
            const authCodeData = await createAuthorizationCode({
              authorizationResponse: { ...responseParams, scope: grantedScope },
              subject: existingSession.subject,
              authTime: existingSession.authTime,
              // OIDC Core 1.0 §3.1.3.1: TTL は ProviderConfig から設定可能（既定 300 秒）。
              ttlSeconds: config.authorizationCodeTtl,
            });
            await authCodeStore.set(authCodeData.code, authCodeData);
            await consentResolver.recordGrant?.(
              existingSession.subject,
              transaction.clientId,
              authCodeData.grantId,
            );

            const redirectUrl = new URL(transaction.redirectUri);
            redirectUrl.searchParams.set('code', authCodeData.code);
            if (transaction.state) redirectUrl.searchParams.set('state', transaction.state);
            // RFC 9207 §2: include iss in success responses.
            redirectUrl.searchParams.set('iss', issuer);
            return c.redirect(redirectUrl.toString());
          }

          const authSessionStore = c.get('authSessionStore') ?? defaultAuthSessionStore;
          await authSessionStore.set(transactionId, {
            subject: existingSession.subject,
            authTime: existingSession.authTime,
          });
          const consentUrl = new URL('/consent', c.req.url);
          consentUrl.searchParams.set('transaction_id', transactionId);
          return c.redirect(consentUrl.toString());
        }
      }
    }

    // Redirect to login page (prompt=login forces re-authentication; handled in login route)
    const loginUrl = new URL('/login', c.req.url);
    loginUrl.searchParams.set('transaction_id', transactionId);
    return c.redirect(loginUrl.toString());
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.redirectUri) {
        const redirectUrl = new URL(error.redirectUri);
        redirectUrl.searchParams.set('error', error.error);
        if (error.errorDescription) {
          redirectUrl.searchParams.set('error_description', error.errorDescription);
        }
        if (error.state) {
          redirectUrl.searchParams.set('state', error.state);
        }
        // RFC 9207 §2: include iss on error redirects so the client can
        // pin the issuer. config has already been read into context by
        // middleware; reread it here because the early-bound issuer is
        // scoped to the try block.
        redirectUrl.searchParams.set('iss', c.get('config').issuer);
        return c.redirect(redirectUrl.toString());
      }
      // OIDC Core 1.0 §3.1.2.2: errors that cannot be redirected (unknown
      // client_id, unregistered redirect_uri, redirect_uri with a fragment) MUST
      // NOT redirect to the supplied redirect_uri. Browser callers get an HTML
      // error page (so the OIDF Conformance Suite can submit a screenshot for
      // oidcc-ensure-registered-redirect-uri); programmatic callers that ask for
      // JSON via the Accept header still receive the OAuth error JSON.
      const acceptsJson = (c.req.header('Accept') ?? '').includes('application/json');
      if (acceptsJson) {
        return c.json({ error: error.error, error_description: error.errorDescription }, 400);
      }
      // OP 内部のエラーページパスが設定されている場合（Next.js sample のように
      // error.tsx などの framework-native なエラー画面へ委ねたいケース）は、HTML を
      // 直接返さず 303 でそのパスへ遷移する。未登録 redirect_uri へは決して飛ばさず、
      // OP 自身のパスにのみ遷移する。遷移先ページは 200 を返すため元の HTTP 400 は
      // 失われるが、ブラウザにエラー画面を見せる（OIDF の screenshot 要件）目的は満たす。
      // error / error_description は URLSearchParams でエンコードして渡す。
      // 安全性のため遷移先は OP 内部の root-relative path（'/' 始まりかつ
      // protocol-relative '//host' でない）に限定する。絶対 URL や '//host' を
      // 設定された場合は open redirect 化を防ぐため redirect せず、安全側の
      // HTML error page にフォールバックする。
      const errorPagePath = c.get('config').authorizationErrorRedirectPath;
      if (errorPagePath && errorPagePath.startsWith('/') && !errorPagePath.startsWith('//')) {
        const params = new URLSearchParams({ error: error.error });
        if (error.errorDescription) {
          params.set('error_description', error.errorDescription);
        }
        return c.redirect(`${errorPagePath}?${params.toString()}`, 303);
      }
      const views = c.get('views') ?? defaultViews;
      return renderView(
        views.errorPage({
          error: error.error,
          errorDescription: error.errorDescription,
          statusCode: 400,
        }),
        { status: 400 },
      );
    }
    return c.json({ error: 'server_error' }, 500);
  }
};

// OIDC Core 1.0 Section 3.1.2.1: Authorization Endpoint must support both GET and POST.
authorizeApp.get('/', handleAuthorizationRequest);
authorizeApp.post('/', handleAuthorizationRequest);
