/**
 * Feature toggles for the generated OpenID Connect Provider.
 *
 * The default generation output enables every feature (the full Basic OP +
 * optional endpoints). Users can remove features from the default with
 * `--disable`, and explicitly (re-)enable them with `--enable`.
 *
 * Basic OP mandatory capabilities (authorize / token / userinfo / discovery /
 * jwks / login / consent) are not toggleable and are always generated.
 */

/** CLI-facing feature names (kebab-case, used with --enable / --disable). */
export const AVAILABLE_FEATURES = [
  'pkce',
  'refresh-token',
  'introspection',
  'revocation',
  'request-object',
] as const;

export type FeatureName = (typeof AVAILABLE_FEATURES)[number];

/**
 * Resolved feature configuration passed through the generator pipeline.
 *
 * - pkce: when false, the generated config defaults to
 *   `allowNonPkceAuthorizationCodeFlow: true` (PKCE optional for explicit
 *   confidential clients; public clients still require it).
 * - refreshToken: when false, the token endpoint rejects the refresh_token
 *   grant with `unsupported_grant_type`, offline_access is never granted, and
 *   no refresh token is issued or persisted.
 * - introspection: when false, the RFC 7662 endpoint is not generated.
 * - revocation: when false, the RFC 7009 endpoint is not generated.
 * - requestObject: when false, the authorize endpoint rejects the `request`
 *   parameter with `request_not_supported` (OIDC Core 1.0 §6.3).
 */
export interface OidcFeatureConfig {
  pkce: boolean;
  refreshToken: boolean;
  introspection: boolean;
  revocation: boolean;
  requestObject: boolean;
}

/** Mapping from CLI feature names to OidcFeatureConfig keys. */
const FEATURE_KEYS: Record<FeatureName, keyof OidcFeatureConfig> = {
  pkce: 'pkce',
  'refresh-token': 'refreshToken',
  introspection: 'introspection',
  revocation: 'revocation',
  'request-object': 'requestObject',
};

/** Default: every feature enabled (matches the historical generation output). */
export const DEFAULT_FEATURES: OidcFeatureConfig = {
  pkce: true,
  refreshToken: true,
  introspection: true,
  revocation: true,
  requestObject: true,
};

function assertKnownFeature(name: string): asserts name is FeatureName {
  if (!(AVAILABLE_FEATURES as readonly string[]).includes(name)) {
    throw new Error(
      `Unknown feature: "${name}". Available features: ${AVAILABLE_FEATURES.join(', ')}`,
    );
  }
}

/**
 * Resolve CLI --enable / --disable lists into an OidcFeatureConfig,
 * starting from DEFAULT_FEATURES.
 *
 * @throws {Error} on an unknown feature name, or a feature listed in both
 *   enable and disable.
 */
export function resolveFeatures(options: {
  enable?: string[];
  disable?: string[];
}): OidcFeatureConfig {
  const enable = options.enable ?? [];
  const disable = options.disable ?? [];

  for (const name of [...enable, ...disable]) {
    assertKnownFeature(name);
  }

  for (const name of enable) {
    if (disable.includes(name)) {
      throw new Error(`Feature "${name}" cannot be both enabled and disabled`);
    }
  }

  const features: OidcFeatureConfig = { ...DEFAULT_FEATURES };
  for (const name of enable) {
    assertKnownFeature(name);
    features[FEATURE_KEYS[name]] = true;
  }
  for (const name of disable) {
    assertKnownFeature(name);
    features[FEATURE_KEYS[name]] = false;
  }
  return features;
}
