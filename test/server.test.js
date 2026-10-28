'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createDisplayServer } = require('../src/server');

test('server protects signaling and completes a handshake', async (context) => {
  const trustedTokens = new Set();
  const server = createDisplayServer({
    staticRoot: path.join(__dirname, '..', 'public'),
    pin: '123456',
    port: 0,
    host: '127.0.0.1',
    isPinAuthorized: (pin) => pin === '123456' || pin === '654321',
    isDeviceAuthorized: (token) => trustedTokens.has(token),
    registerDevice: async () => {
      const token = 'trusted-device-token';
      trustedTokens.add(token);
      return token;
    }
  });
  const address = await server.start();
  context.after(() => server.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const denied = await fetch(`${base}/api/config`, { headers: { 'X-Pairing-Pin': '000000' } });
  assert.equal(denied.status, 403);

  const masterCodeAccepted = await fetch(`${base}/api/config`, { headers: { 'X-Pairing-Pin': '654321' } });
  assert.equal(masterCodeAccepted.status, 200);

  const deniedPairing = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'X-Pairing-Pin': '000000' } });
  assert.equal(deniedPairing.status, 403);

  const paired = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'X-Pairing-Pin': '123456' } });
  assert.equal(paired.status, 201);
  const { deviceToken } = await paired.json();
  const trustedDeviceAccepted = await fetch(`${base}/api/config`, { headers: { 'X-Device-Token': deviceToken } });
  assert.equal(trustedDeviceAccepted.status, 200);

  const created = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pairing-Pin': '123456' },
    body: JSON.stringify({ offer: { type: 'offer', sdp: 'test-offer' } })
  });
  assert.equal(created.status, 201);
  const { sessionId } = await created.json();

  const hostEvents = await fetch(`${base}/api/host/events?since=0`, { headers: { 'X-Pairing-Pin': '123456' } }).then((response) => response.json());
  assert.equal(hostEvents.events[0].payload.sessionId, sessionId);

  const answer = await fetch(`${base}/api/sessions/${sessionId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pairing-Pin': '123456' },
    body: JSON.stringify({ answer: { type: 'answer', sdp: 'test-answer' } })
  });
  assert.equal(answer.status, 202);

  const receiverEvents = await fetch(`${base}/api/sessions/${sessionId}/events?since=0`, { headers: { 'X-Pairing-Pin': '123456' } }).then((response) => response.json());
  assert.equal(receiverEvents.events[0].payload.answer.sdp, 'test-answer');
});
