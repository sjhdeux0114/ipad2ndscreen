'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createTrustedDeviceStore(directory) {
  const filePath = path.join(directory, 'trusted-devices.json');
  const tokenHashes = new Set();

  async function persist() {
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ tokenHashes: [...tokenHashes] }, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath).catch(async (error) => {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    });
  }

  return {
    filePath,
    async load() {
      try {
        const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
        tokenHashes.clear();
        for (const hash of value.tokenHashes || []) {
          if (/^[a-f0-9]{64}$/.test(hash)) tokenHashes.add(hash);
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
    },
    isAuthorized(token) {
      return typeof token === 'string' && token.length >= 32 && tokenHashes.has(hashToken(token));
    },
    async register() {
      const token = crypto.randomBytes(32).toString('base64url');
      tokenHashes.add(hashToken(token));
      await persist();
      return token;
    }
  };
}

module.exports = { createTrustedDeviceStore, hashToken };
