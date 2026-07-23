// The Authorization Endpoint 303-redirects non-redirect errors here (see
// runtime.ts authorizationErrorRedirectPath), so this page must always render
// dynamically and never be statically cached.
export const dynamic = 'force-dynamic';

interface OidcErrorPageProps {
  searchParams: Promise<{ error?: string; error_description?: string }>;
}

/**
 * Authorization error page (OIDC Core 1.0 §3.1.2.2).
 *
 * The Authorization Endpoint cannot redirect certain errors (unknown client_id,
 * unregistered redirect_uri, redirect_uri with a fragment) back to the client,
 * so it sends the browser here instead. This Server Component intentionally
 * throws so the sibling App Router error boundary (`error.tsx`) renders the UI —
 * the idiomatic Next.js way to surface errors, consistent with login / consent
 * being real pages rather than HTML strings from a route handler. `error.tsx`
 * reads error / error_description from the URL, so the thrown Error only needs to
 * activate the boundary.
 */
export default async function OidcErrorPage({ searchParams }: OidcErrorPageProps) {
  const { error } = await searchParams;
  throw new Error(`Authorization error: ${error ?? 'invalid_request'}`);
}
