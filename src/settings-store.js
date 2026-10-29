'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeDisplaySource } = require('./display-source-preference');

const DEFAULT_SETTINGS = Object.freeze({
  autoStart: false,
  masterCode: '',
  latencyProfile: 'ultra-low',
  frameRate: 60,
  lastDisplaySource: null
});

function normalizeSettings(value = {}) {
  const masterCode = typeof value.masterCode === 'string' ? value.masterCode.trim() : '';
  if (masterCode && !/^\d{6}$/.test(masterCode)) throw new Error('마스터 코드는 숫자 6자리여야 합니다.');
  const profile = value.latencyProfile === 'text-30' ? 'text' : value.latencyProfile;
  const latencyProfile = ['ultra-low', 'balanced', 'quality', 'text'].includes(profile)
    ? profile
    : DEFAULT_SETTINGS.latencyProfile;
  return {
    autoStart: Boolean(value.autoStart),
    masterCode,
    latencyProfile,
    frameRate: [30, 60].includes(Number(value.frameRate)) ? Number(value.frameRate) : value.latencyProfile === 'text-30' ? 30 : 60,
    lastDisplaySource: normalizeDisplaySource(value.lastDisplaySource)
  };
}

function createSettingsStore(directory) {
  const filePath = path.join(directory, 'settings.json');
  return {
    filePath,
    async load() {
      try {
        return normalizeSettings(JSON.parse(await fs.readFile(filePath, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError || /마스터 코드/.test(error.message || '')) return { ...DEFAULT_SETTINGS };
        throw error;
      }
    },
    async save(value) {
      const settings = normalizeSettings(value);
      await fs.mkdir(directory, { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      await fs.rename(temporaryPath, filePath).catch(async (error) => {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        await fs.rm(filePath, { force: true });
        await fs.rename(temporaryPath, filePath);
      });
      return settings;
    }
  };
}

module.exports = { DEFAULT_SETTINGS, createSettingsStore, normalizeSettings };
