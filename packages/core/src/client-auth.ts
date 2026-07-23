/**
 * クライアント認証
 * OAuth 2.1 Section 2.3 / OIDC Core 1.0 Section 9
 *
 * Token Endpoint で受け付けるクライアント認証方式:
 * - client_secret_basic: Authorization: Basic base64(clientId:clientSecret)
 * - client_secret_post:  リクエストボディの client_id + client_secret
 *
 * OAuth 2.1 Section 2.3: 1リクエストにつき1つの認証方式のみ使用しなければならない。
 */

import { timingSafeEqual } from './crypto-utils';
import { TokenError, TokenErrorCode } from './token-request';
import type { TokenClientResolver } from './token-request';

/**
 * クライアント認証コンテキスト
 */
export interface ClientAuthContext {
  /** リクエストボディのパラメータ（application/x-www-form-urlencoded） */
  params: Record<string, string | undefined>;
  /** Authorization ヘッダーの値（無ければ空文字） */
  authorizationHeader: string;
  /** クライアント情報を解決するリゾルバー */
  clientResolver: TokenClientResolver;
}

/**
 * RFC 6749 Section 2.3.1: credentials are application/x-www-form-urlencoded encoded.
 * '+' represents space; '%XX' sequences are percent-decoded.
 */
function formUrlDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, '%20'));
}

/**
 * Authorization: Basic ヘッダーから clientId/clientSecret を抽出する。
 * Basic 形式でない、または base64 / フォーマットが不正な場合は null。
 */
/**
 * RFC 7235 Section 2.1: HTTP authentication scheme は case-insensitive。
 * スキーム名のみを ASCII 小文字化して指定スキームと比較する。
 * 認証情報本体（base64 や bearer token 値）は変換しない。
 */
function matchAuthScheme(
  authHeader: string,
  scheme: string,
): string | null {
  const spaceIndex = authHeader.indexOf(' ');
  if (spaceIndex === -1) {
    return null;
  }
  const headerScheme = authHeader.slice(0, spaceIndex).toLowerCase();
  if (headerScheme !== scheme.toLowerCase()) {
    return null;
  }
  return authHeader.slice(spaceIndex + 1);
}

function hasAuthScheme(authHeader: string, scheme: string): boolean {
  return matchAuthScheme(authHeader, scheme) !== null;
}

function parseBasicAuth(
  authHeader: string,
): { clientId: string; clientSecret: string } | null {
  const base64Credentials = matchAuthScheme(authHeader, 'Basic');
  if (base64Credentials === null) {
    return null;
  }
  let decoded: string;
  try {
    const binary = atob(base64Credentials);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  // RFC 6749 Section 2.3.1: decode form-urlencoded credentials after splitting
  try {
    return {
      clientId: formUrlDecode(decoded.slice(0, separatorIndex)),
      clientSecret: formUrlDecode(decoded.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
}

/**
 * クライアント認証を行う
 *
 * 認証成功時: 認証済みクライアントID（string）を返す
 * 認証失敗時: TokenError をスロー
 *
 * @param context クライアント認証コンテキスト
 * @returns 認証されたクライアントID
 * @throws {TokenError} 認証失敗時
 */
export async function authenticateClient(
  context: ClientAuthContext,
): Promise<string> {
  const { params, authorizationHeader, clientResolver } = context;

  const hasBasicHeader = hasAuthScheme(authorizationHeader, 'Basic');
  const hasPostCredential =
    params.client_id !== undefined || params.client_secret !== undefined;

  // RFC 6749 §2.3 / OAuth 2.1 §2.3: 1リクエストで複数の「認証方式」を併用してはいけない。
  // ただし §3.2.1 の client_id 単独送信は自身を識別するための「識別子」であって認証方式ではない。
  // よって多重認証方式の判定はボディの client_secret（client_secret_post の資格情報）の有無のみで行い、
  // Basic ヘッダ + ボディ client_id（secret なし）という多くのクライアントライブラリの実装を拒否しない。
  const hasPostSecret = params.client_secret !== undefined;
  if (hasBasicHeader && hasPostSecret) {
    throw new TokenError(
      TokenErrorCode.InvalidRequest,
      'Multiple client authentication methods provided. Use either Authorization header or request body, not both.',
    );
  }

  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (hasBasicHeader) {
    const basic = parseBasicAuth(authorizationHeader);
    if (!basic) {
      throw new TokenError(
        TokenErrorCode.InvalidClient,
        'Invalid Authorization header format',
      );
    }
    // RFC 6749 §3.2.1: Basic と併送された client_id は識別子として許容するが、
    // Basic 側の client_id と食い違う場合は矛盾（クライアント設定ミス／混同）として拒否する。
    if (
      params.client_id !== undefined &&
      params.client_id !== basic.clientId
    ) {
      throw new TokenError(
        TokenErrorCode.InvalidRequest,
        'client_id in request body does not match the Authorization header',
      );
    }
    clientId = basic.clientId;
    clientSecret = basic.clientSecret;
  } else if (hasPostCredential) {
    clientId = params.client_id;
    clientSecret = params.client_secret;
  }

  // client_id は public / confidential を問わず必須。
  // RFC 6749 §4.1.3: 未認証クライアントは client_id を送らなければならない。
  if (!clientId) {
    throw new TokenError(
      TokenErrorCode.InvalidClient,
      'Client authentication required',
    );
  }

  const client = await clientResolver.findClient(clientId);
  if (!client) {
    throw new TokenError(
      TokenErrorCode.InvalidClient,
      'Client authentication failed',
    );
  }

  // OIDC Core 1.0 §9 / RFC 7591 §2: token_endpoint_auth_method の既定は client_secret_basic。
  const registeredMethod = client.tokenEndpointAuthMethod ?? 'client_secret_basic';

  // RFC 6749 §2.1 / §3.2.1 / OAuth 2.1 §2.4: public client（auth_method = none）は
  // client_id のみで識別し、クライアント認証を行わない。
  // ただし credentials を提示した場合は登録方式（none）と一致しないため拒否し、
  // confidential への昇格／ダウングレードの混同を防ぐ。
  if (registeredMethod === 'none') {
    if (hasBasicHeader || clientSecret !== undefined) {
      throw new TokenError(
        TokenErrorCode.InvalidClient,
        'Client authentication method does not match the registered token_endpoint_auth_method',
      );
    }
    return clientId;
  }

  // confidential client は client_secret 必須。
  if (!clientSecret) {
    throw new TokenError(
      TokenErrorCode.InvalidClient,
      'Client authentication required',
    );
  }

  // 実際に使われた認証方式が登録方式と一致しなければ認証失敗とし、認証方式ダウングレードを防ぐ。
  const usedMethod = hasBasicHeader
    ? 'client_secret_basic'
    : 'client_secret_post';
  if (usedMethod !== registeredMethod) {
    throw new TokenError(
      TokenErrorCode.InvalidClient,
      'Client authentication method does not match the registered token_endpoint_auth_method',
    );
  }

  // OAuth 2.1 §7.4.1 / RFC 6749 §10.10: constant-time comparison to thwart timing attacks
  const secretMatches = await timingSafeEqual(client.clientSecret ?? '', clientSecret);
  if (!secretMatches) {
    throw new TokenError(
      TokenErrorCode.InvalidClient,
      'Client authentication failed',
    );
  }

  return clientId;
}
