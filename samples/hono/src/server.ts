import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { app, issuer } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3010');

const server = createServer(async (incoming, outgoing) => {
  try {
    const response = await app.fetch(toRequest(incoming));
    await writeResponse(outgoing, response);
  } catch (error) {
    console.error(error);
    outgoing.statusCode = 500;
    outgoing.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`Hono sample listening on ${issuer}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}

function toRequest(incoming: IncomingMessage): Request {
  const url = new URL(incoming.url ?? '/', issuer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = incoming.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
  };
  if (hasBody) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function writeResponse(
  outgoing: ServerResponse,
  response: Response,
): Promise<void> {
  outgoing.statusCode = response.status;
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    outgoing.setHeader('Set-Cookie', setCookies);
  }
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') return;
    outgoing.setHeader(name, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  outgoing.end(body);
}
