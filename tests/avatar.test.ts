import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_KEYS, lookFromSeed, lookParams, randomLook, sameLook, sanitizeLook } from '../src/shared/avatar.js';

test('a look saved before the accessories existed stays plain rather than picking some up', () => {
  const fallback = { ...randomLook(), hat: 3, glasses: 2, beard: 1, eyes: 4 };
  const old = sanitizeLook({ skin: 2, hair: 1, style: 3 }, fallback);
  assert.deepEqual([old.skin, old.hair, old.style], [2, 1, 3]);
  assert.deepEqual([old.hat, old.glasses, old.beard, old.eyes, old.pants], [0, 0, 0, 0, 0]);
});

test('a bad part of a look falls back, and every part makes it through the connect URL', () => {
  const was = randomLook();
  const bad = sanitizeLook({ ...was, hat: 99, glasses: -1, pants: 1.5 }, was);
  assert.ok(sameLook(bad, was));

  const look = { ...lookFromSeed('someone'), hat: 2, glasses: 1, beard: 3, eyes: 2 };
  const q = new URLSearchParams(lookParams(look));
  const back = sanitizeLook(Object.fromEntries(LOOK_KEYS.map((k) => [k, Number(q.get(k))])), lookFromSeed('x'));
  assert.ok(sameLook(back, look));
});
