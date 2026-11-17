// Small, dependency-free helpers used in browser-side experiments.
export function createRegistry() {
  const entries = new Map();
  return Object.freeze({
    register(id, value) {
      if (typeof id !== 'string' || !id.trim()) {
        throw new TypeError('A nonempty string key is required');
      }
      if (entries.has(id)) throw new Error('Duplicate registry key');
      entries.set(id, value);
      return value;
    },
    get(id) { return entries.get(id); },
    has(id) { return entries.has(id); },
    keys() { return [...entries.keys()]; }
  });
}

export function toBatches(items, size = 4) {
  if (!Array.isArray(items)) throw new TypeError('Expected an array');
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError('Batch size must be a positive integer');
  }
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
