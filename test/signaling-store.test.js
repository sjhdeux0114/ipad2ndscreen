'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventQueue, SignalingStore } = require('../src/signaling-store');

test('event queues return only events newer than a sequence', () => {
  const queue = new EventQueue();
  queue.push('first', { value: 1 });
  queue.push('second', { value: 2 });
  assert.deepEqual(queue.since(1).map((event) => event.type), ['second']);
});

test('signaling store routes offer, answer, and candidates', () => {
  const store = new SignalingStore();
  const offer = { type: 'offer', sdp: 'offer-sdp' };
  const session = store.create(offer);
  assert.equal(store.hostEvents.since(0)[0].type, 'offer');
  assert.equal(store.addReceiverCandidate(session.id, { candidate: 'receiver' }), true);
  assert.equal(store.setAnswer(session.id, { type: 'answer', sdp: 'answer-sdp' }), true);
  assert.equal(store.addHostCandidate(session.id, { candidate: 'host' }), true);
  assert.deepEqual(session.receiverEvents.since(0).map((event) => event.type), ['answer', 'host-candidate']);
});
