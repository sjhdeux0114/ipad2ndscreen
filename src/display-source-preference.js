'use strict';

function normalizeDisplaySource(source) {
  if (!source || typeof source !== 'object') return null;
  const id = typeof source.id === 'string' ? source.id : '';
  const name = typeof source.name === 'string' ? source.name : '';
  const displayId = typeof source.displayId === 'string' ? source.displayId : '';
  if (!id && !name && !displayId) return null;
  return { id, name, displayId };
}

function findPreferredDisplaySource(sources, preference) {
  const saved = normalizeDisplaySource(preference);
  if (!saved) return null;
  return (saved.displayId && sources.find((source) => source.displayId === saved.displayId))
    || (saved.id && sources.find((source) => source.id === saved.id))
    || (saved.name && sources.find((source) => source.name === saved.name))
    || null;
}

module.exports = { findPreferredDisplaySource, normalizeDisplaySource };
