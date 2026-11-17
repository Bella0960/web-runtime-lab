import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, toBatches } from '../src/runtime.mjs';

test('registry keeps stable keys and rejects accidental overwrites', () => {
  const registry = createRegistry();
  registry.register('a', { ok: true });
  assert.deepEqual(registry.keys(), ['a']);
  assert.equal(registry.get('a').ok, true);
  assert.throws(() => registry.register('a', {}), /Duplicate/);
  assert.throws(() => registry.register('', {}), /nonempty/);
});

test('batching is deterministic and never mutates input', () => {
  const input = [1, 2, 3, 4, 5];
  assert.deepEqual(toBatches(input, 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.throws(() => toBatches(input, 0), /positive/);
});
