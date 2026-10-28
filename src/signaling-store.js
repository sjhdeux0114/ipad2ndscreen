'use strict';

const crypto = require('node:crypto');

class EventQueue {
  constructor() {
    this.sequence = 0;
    this.events = [];
  }

  push(type, payload) {
    const event = { id: ++this.sequence, type, payload };
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    return event;
  }

  since(sequence) {
    return this.events.filter((event) => event.id > sequence);
  }
}

class SignalingStore {
  constructor({ sessionTtlMs = 10 * 60 * 1000 } = {}) {
    this.sessionTtlMs = sessionTtlMs;
    this.sessions = new Map();
    this.hostEvents = new EventQueue();
  }

  create(offer) {
    this.cleanup();
    const id = crypto.randomBytes(16).toString('hex');
    const session = {
      id,
      createdAt: Date.now(),
      offer,
      receiverEvents: new EventQueue()
    };
    this.sessions.set(id, session);
    this.hostEvents.push('offer', { sessionId: id, offer });
    return session;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  addReceiverCandidate(id, candidate) {
    const session = this.get(id);
    if (!session) return false;
    this.hostEvents.push('receiver-candidate', { sessionId: id, candidate });
    return true;
  }

  setAnswer(id, answer) {
    const session = this.get(id);
    if (!session) return false;
    session.receiverEvents.push('answer', { answer });
    return true;
  }

  addHostCandidate(id, candidate) {
    const session = this.get(id);
    if (!session) return false;
    session.receiverEvents.push('host-candidate', { candidate });
    return true;
  }

  close(id) {
    if (!this.sessions.delete(id)) return false;
    this.hostEvents.push('close', { sessionId: id });
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > this.sessionTtlMs) this.sessions.delete(id);
    }
  }
}

module.exports = { EventQueue, SignalingStore };
