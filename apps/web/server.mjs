import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(currentDir, 'dist');
const port = Number(process.env.WEB_PORT ?? 4173);
const apiOrigin = (process.env.API_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const mediaOrigin = (process.env.MEDIA_ORIGIN ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

const isBodyAllowed = (method) => !['GET', 'HEAD'].includes(method.toUpperCase());

const sendNotFound = (response) => {
  response.statusCode = 404;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('Not found');
};

const sendInternalError = (response, message = 'Internal server error') => {
  response.statusCode = 500;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(message);
};

const buildForwardedHeaders = (request) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  headers.set('x-forwarded-host', request.headers.host ?? '127.0.0.1');
  headers.set('x-forwarded-proto', request.socket.encrypted ? 'https' : 'http');

  return headers;
};

const proxyRequest = async (request, response, targetOrigin, prefix) => {
  const incomingUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const upstreamPath = incomingUrl.pathname.slice(prefix.length) || '/';
  const upstreamUrl = new URL(`${upstreamPath}${incomingUrl.search}`, `${targetOrigin}/`);
  const bodyAllowed = isBodyAllowed(request.method ?? 'GET');

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildForwardedHeaders(request),
      body: bodyAllowed ? request : undefined,
      duplex: bodyAllowed ? 'half' : undefined,
      redirect: 'manual',
    });

    response.statusCode = upstreamResponse.status;

    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'transfer-encoding') {
        return;
      }

      response.setHeader(key, value);
    });

    if (!upstreamResponse.body || request.method?.toUpperCase() === 'HEAD') {
      response.end();
      return;
    }

    Readable.fromWeb(upstreamResponse.body).pipe(response);
  } catch (error) {
    console.error('[web] proxy failed:', error);
    sendInternalError(response, 'Proxy request failed');
  }
};

const canAccess = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveFilePath = async (pathname) => {
  const normalizedPath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
  const requestedPath = resolve(join(distDir, normalizedPath.replace(/^[/\\]+/, '')));

  if (!requestedPath.startsWith(distDir)) {
    return null;
  }

  if (await canAccess(requestedPath)) {
    const requestedStats = await stat(requestedPath);
    if (requestedStats.isFile()) {
      return requestedPath;
    }
  }

  if (extname(requestedPath)) {
    return null;
  }

  const indexPath = join(distDir, 'index.html');
  return (await canAccess(indexPath)) ? indexPath : null;
};

const serveStatic = async (request, response) => {
  const incomingUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = incomingUrl.pathname === '/' ? '/index.html' : incomingUrl.pathname;
  const filePath = await resolveFilePath(pathname);

  if (!filePath) {
    sendNotFound(response);
    return;
  }

  const fileStats = await stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] ?? 'application/octet-stream';

  response.statusCode = 200;
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', String(fileStats.size));
  response.setHeader('cache-control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');

  if (request.method?.toUpperCase() === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    await proxyRequest(request, response, apiOrigin, '/api');
    return;
  }

  if (pathname === '/media' || pathname.startsWith('/media/')) {
    await proxyRequest(request, response, mediaOrigin, '/media');
    return;
  }

  await serveStatic(request, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[web] classic frontend listening on http://0.0.0.0:${port}`);
  console.log(`[web] proxying /api -> ${apiOrigin}`);
  console.log(`[web] proxying /media -> ${mediaOrigin}`);
});
