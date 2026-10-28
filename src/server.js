'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { SignalingStore } = require('./signaling-store');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function hasAuthorizedPin(request, url, pin, isPinAuthorized) {
  const supplied = request.headers['x-pairing-pin'] || url.searchParams.get('pin');
  return isPinAuthorized ? isPinAuthorized(String(supplied || '')) : supplied === pin;
}

function isAuthorized(request, url, pin, isPinAuthorized, isDeviceAuthorized) {
  const token = request.headers['x-device-token'];
  return hasAuthorizedPin(request, url, pin, isPinAuthorized) || isDeviceAuthorized(String(token || ''));
}

function createDisplayServer({
  staticRoot,
  pin,
  isPinAuthorized,
  isDeviceAuthorized = () => false,
  registerDevice = async () => { throw new Error('Trusted device registration is unavailable.'); },
  port = 5178,
  host = '0.0.0.0',
  onSessionCountChanged = () => {}
}) {
  const store = new SignalingStore();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method || 'GET';

    try {
      if (url.pathname.startsWith('/api/')) {
        if (method === 'POST' && url.pathname === '/api/pair') {
          if (!hasAuthorizedPin(request, url, pin, isPinAuthorized)) {
            sendJson(response, 403, { error: 'Pairing PIN is incorrect.' });
            return;
          }
          sendJson(response, 201, { deviceToken: await registerDevice() });
          return;
        }

        if (!isAuthorized(request, url, pin, isPinAuthorized, isDeviceAuthorized)) {
          sendJson(response, 403, { error: 'Pairing PIN is incorrect.' });
          return;
        }

        if (method === 'GET' && url.pathname === '/api/config') {
          sendJson(response, 200, { iceServers: [], maxFrameRate: 60 });
          return;
        }

        if (method === 'POST' && url.pathname === '/api/sessions') {
          const body = await readJson(request);
          if (!body.offer?.sdp || body.offer.type !== 'offer') {
            sendJson(response, 400, { error: 'A valid WebRTC offer is required.' });
            return;
          }
          const session = store.create(body.offer);
          onSessionCountChanged(store.sessions.size);
          sendJson(response, 201, { sessionId: session.id });
          return;
        }

        if (method === 'GET' && url.pathname === '/api/host/events') {
          const since = Number(url.searchParams.get('since')) || 0;
          sendJson(response, 200, { events: store.hostEvents.since(since) });
          return;
        }

        const sessionMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{32})(?:\/(.+))?$/);
        if (sessionMatch) {
          const [, sessionId, action = ''] = sessionMatch;
          const session = store.get(sessionId);
          if (!session) {
            sendJson(response, 404, { error: 'Session was not found or expired.' });
            return;
          }

          if (method === 'GET' && action === 'events') {
            const since = Number(url.searchParams.get('since')) || 0;
            sendJson(response, 200, { events: session.receiverEvents.since(since) });
            return;
          }

          if (method === 'POST' && action === 'answer') {
            const { answer } = await readJson(request);
            if (!answer?.sdp || answer.type !== 'answer') {
              sendJson(response, 400, { error: 'A valid WebRTC answer is required.' });
              return;
            }
            store.setAnswer(sessionId, answer);
            sendJson(response, 202, { ok: true });
            return;
          }

          if (method === 'POST' && action === 'receiver-candidate') {
            const { candidate } = await readJson(request);
            store.addReceiverCandidate(sessionId, candidate);
            sendJson(response, 202, { ok: true });
            return;
          }

          if (method === 'POST' && action === 'host-candidate') {
            const { candidate } = await readJson(request);
            store.addHostCandidate(sessionId, candidate);
            sendJson(response, 202, { ok: true });
            return;
          }

          if (method === 'DELETE' && action === '') {
            store.close(sessionId);
            onSessionCountChanged(store.sessions.size);
            sendJson(response, 200, { ok: true });
            return;
          }
        }

        sendJson(response, 404, { error: 'API route not found.' });
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405).end();
        return;
      }

      const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const normalized = path.normalize(requested).replace(/^(\.\.(\\|\/|$))+/, '');
      const rootPath = path.resolve(staticRoot);
      const filePath = path.resolve(rootPath, normalized);
      const relativePath = path.relative(rootPath, filePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      const data = fs.readFileSync(filePath);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:"
      });
      if (method === 'HEAD') response.end();
      else response.end(data);
    } catch (error) {
      sendJson(response, error instanceof SyntaxError ? 400 : 500, { error: error.message });
    }
  });

  return {
    store,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

module.exports = { createDisplayServer };
