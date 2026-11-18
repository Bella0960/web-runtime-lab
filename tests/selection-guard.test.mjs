import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeMarkup, safeImageAddress, selectableMarkup } from '../src/selection-guard.mjs';

test('untrusted names and IDs are escaped before rendering', () => {
  const markup = selectableMarkup([{ id: 'a" data-n=x', name: 'A"><img src=x onerror=alert(1)>' }]);
  assert.match(markup, /data-id="a&quot; data-n=x"/);
  assert.match(markup, /A&quot;&gt;&lt;img/);
  assert.doesNotMatch(markup, /<img src=x onerror/);
});

test('unsafe avatar protocols are rejected, while allowed image URLs are preserved', () => {
  assert.equal(safeImageAddress('javascript:alert(1)'), '');
  assert.equal(safeImageAddress('data:text/html;base64,abc'), '');
  assert.equal(safeImageAddress('https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(safeImageAddress('/images/avatar.png'), '/images/avatar.png');
  assert.doesNotMatch(selectableMarkup([{ id: 'safe', name: 'Alice', avatar: 'javascript:bad()' }]), /src="javascript:/);
});

test('invalid or empty records do not crash the selector', () => {
  assert.match(selectableMarkup([null, {}, { id: '', name: 'Skip' }, { id: 5, name: 'Bob' }]), /data-id="5"/);
  assert.equal(selectableMarkup(null), '');
});

test('escaping does not change raw model data', () => {
  const rows = [{ id: "a'b", name: 'A&B', avatar: '' }];
  assert.match(selectableMarkup(rows), /A&amp;B/);
  assert.deepEqual(rows, [{ id: "a'b", name: 'A&B', avatar: '' }]);
  assert.equal(escapeMarkup('"<&'), '&quot;&lt;&amp;');
});
