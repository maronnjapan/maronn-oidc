import { createServer } from 'node:http';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3030');
const issuer = process.env.ISSUER ?? 'http://127.0.0.1:3010';
const clientId = process.env.CLIENT_ID ?? 'e2e-resource-server';
const clientSecret = process.env.CLIENT_SECRET ?? 'e2e-resource-server-secret';
const baseUrl = `http://${host}:${port}`;
const resourceServerUrl = process.env.RESOURCE_SERVER_URL ?? baseUrl;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', baseUrl);
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/profile') {
      await handleProfile(req, res);
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 502, { error: 'introspection_failed', error_description: message });
  }
});

server.listen(port, host, () => {
  console.log(`E2E resource server listening on ${baseUrl}`);
});

async function handleProfile(req, res) {
  const token = bearerToken(req.headers.authorization);
  if (token === null) {
    sendJson(res, 401, { error: 'missing_token' }, bearerChallenge());
    return;
  }

  const introspection = await introspect(token);
  if (introspection.active !== true) {
    sendJson(res, 401, { error: 'invalid_token' }, bearerChallenge());
    return;
  }
  const audience = normalizeAudience(introspection.aud);
  if (!audience.includes(resourceServerUrl)) {
    sendJson(res, 403, { error: 'invalid_audience' }, bearerChallenge());
    return;
  }

  sendJson(res, 200, {
    active: introspection.active,
    subject: introspection.sub ?? '',
    client_id: introspection.client_id ?? '',
    scope: introspection.scope ?? '',
    audience,
  });
}

async function introspect(token) {
  const response = await fetch(new URL('/introspect', issuer), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    }).toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`introspection returned ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function bearerToken(authorization) {
  const header = authorization ?? '';
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) {
    return null;
  }
  return value;
}

function normalizeAudience(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

function basicCredentials() {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function bearerChallenge() {
  return {
    'WWW-Authenticate': 'Bearer error="invalid_token"',
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}
