'use client';

import { useSearchParams } from 'next/navigation';

/**
 * App Router error boundary for the authorization error page.
 *
 * OIDC Core 1.0 §3.1.2.2: the Authorization Endpoint 303-redirects non-redirect
 * errors to /oidc-error, whose `page.tsx` throws to trigger this boundary. We read
 * the OAuth error / error_description from the URL — not from the thrown Error,
 * whose message is stripped in production builds — and render them as React text
 * so the values are safely escaped. Customize this UI with JSX as needed.
 */
export default function OidcAuthorizationError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') ?? 'invalid_request';
  const errorDescription = searchParams.get('error_description');

  return (
    <main>
      <h1>Error</h1>
      <p>{error}</p>
      {errorDescription ? <p>{errorDescription}</p> : null}
    </main>
  );
}
