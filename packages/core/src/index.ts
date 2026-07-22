/**
 * OpenID Connect Provider Core
 */

export const version = '0.0.1';

export {
  validateAuthorizationRequest,
  validateRegisteredRedirectUris,
  defaultIsOfflineAccessGranted,
  AuthorizationError,
  AuthorizationErrorCode,
  DEFAULT_MAX_CLAIMS_PARAMETER_LENGTH,
  DEFAULT_REQUEST_OBJECT_SIGNING_ALGS,
} from './authorization-request';

export {
  parseRequestObject,
  RequestObjectError,
} from './request-object';

export type {
  ParseRequestObjectOptions,
} from './request-object';

export type {
  AuthorizationRequestParams,
  ClientInfo,
  ClientResolver,
  ValidatedAuthorizationRequest,
  ValidateAuthorizationRequestOptions,
  OfflineAccessGrantedCallback,
} from './authorization-request';

export {
  validateTokenRequest,
  validateAuthorizationCodeGrant,
  validateRefreshTokenGrant,
  TokenError,
  TokenErrorCode,
} from './token-request';

export type {
  TokenRequestParams,
  TokenClientInfo,
  TokenClientResolver,
  AuthorizationCodeInfo,
  AuthorizationCodeResolver,
  RefreshTokenInfo,
  RefreshTokenResolver,
  TokenRequestContext,
  ValidatedTokenRequest,
  ValidatedAuthorizationCodeRequest,
  ValidatedRefreshTokenRequest,
} from './token-request';

export {
  generateTokenResponse,
  buildAccessTokenAudience,
  buildIdTokenAudience,
} from './token-response';

export type {
  TokenResponseOptions,
  TokenResponse,
  GenerateTokenResponseResult,
  AccessTokenAudienceInput,
  IdTokenAudienceInput,
  IdTokenAudienceResult,
  AcrResolver,
} from './token-response';

export {
  exportPublicJwk,
  exportJwks,
  signingKeysToJwkSet,
} from './jwks';

export {
  validateIdTokenHint,
  IdTokenHintError,
} from './id-token';

export type {
  IdTokenPayload,
  GenerateIdTokenOptions,
} from './id-token';

export type {
  Jwk,
  JwkSet,
  JwksKeyEntry,
} from './jwks';

export {
  generateRandomString,
  extractAlgorithmParamsFromJwk,
  getJwaAlgorithm,
} from './crypto-utils';

export {
  sanitizeErrorDescription,
} from './error-utils';

export {
  createAuthTransaction,
  getAuthTransaction,
  validateCsrfToken,
  handleLoginFailure,
  completeAuthTransaction,
  checkPromptNone,
  requiresReauthentication,
  AuthTransactionError,
  AuthTransactionErrorCode,
} from './auth-transaction';

export type {
  AuthTransaction,
  AuthTransactionStore,
  AuthorizationResponseParams,
  ConsentResolver,
  LoginFailureResult,
  PromptNoneOptions,
  SessionInfo,
  SessionResolver,
} from './auth-transaction';

export {
  buildProviderMetadata,
} from './discovery';

export type {
  ProviderMetadataConfig,
  ProviderMetadata,
} from './discovery';

export {
  handleUserInfoRequest,
  generateUserInfoJwt,
  filterClaimsByScope,
  UserInfoError,
  UserInfoErrorCode,
  SCOPE_CLAIMS_MAP,
} from './userinfo';

export type {
  AccessTokenInfo,
  AccessTokenResolver,
  AddressClaim,
  UserClaims,
  UserClaimsResolver,
  ClaimsParameter,
  ClaimRequestEntry,
  ClaimRequestValue,
  UserInfoRequestContext,
  UserInfoResponse,
  UserInfoJwtOptions,
} from './userinfo';

export {
  assertHasRs256Key,
  assertKeyStrength,
  assertKidStrategyConsistent,
  createCachedSigningKeyProvider,
  getRegisteredSigningKeys,
  selectSigningKeyByAlg,
} from './signing-key';

export type {
  SigningKey,
  SigningKeyProvider,
  KeyStrengthPolicy,
} from './signing-key';

export {
  authenticateClient,
} from './client-auth';

export type {
  ClientAuthContext,
} from './client-auth';

export {
  createAuthorizationCode,
} from './authorization-code';

export type {
  AuthorizationCodeData,
  CreateAuthorizationCodeOptions,
} from './authorization-code';

export {
  createJwtAccessTokenIssuer,
  createOpaqueAccessTokenIssuer,
} from './access-token-issuer';

export type {
  AccessTokenFormat,
  AccessTokenIssuer,
  AccessTokenIssuanceContext,
} from './access-token-issuer';

export {
  handleIntrospectionRequest,
  IntrospectionError,
  IntrospectionErrorCode,
} from './introspection';

export type {
  IntrospectionRequestContext,
  IntrospectionResponse,
  IntrospectionAccessTokenResolver,
  IntrospectionRefreshTokenResolver,
} from './introspection';

export {
  handleRevocationRequest,
  RevocationError,
  RevocationErrorCode,
} from './revocation';

export type {
  RevocationRequestContext,
  RevocationTokenResolvers,
} from './revocation';
