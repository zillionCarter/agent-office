import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FLOOR } from '../src/shared/layout.js';
import { MAX_LENGTH, cleanPlacement, footprint } from '../src/shared/furniture.js';
import { Furniture } from '../src/server/furniture.js';

test('a placement is kept in the room and in range', () => {
  assert.equal(cleanPlacement({ kind: 'spaceship' as never, x: 0, z: 0 }), 'Unknown piece of furniture');
  const wall = cleanPlacement({ kind: 'wall', x: 999, z: -999, rotY: -Math.PI / 2, length: 99, color: '#ABCDEF' });
  assert.equal(typeof wall, 'object');
  if (typeof wall === 'string') return;
  assert.ok(wall.x < FLOOR.maxX && wall.z > FLOOR.minZ);
  assert.equal(wall.length, MAX_LENGTH);
  assert.equal(wall.color, '#abcdef');
  assert.ok(wall.rotY >= 0 && wall.rotY < Math.PI * 2);
  const couch = cleanPlacement({ kind: 'couch', x: 1, z: 1, length: 5, color: 'red' });
  if (typeof couch === 'string') return assert.fail(couch);
  assert.equal(couch.length, undefined, "a couch doesn't stretch");
  assert.equal(couch.color, undefined);
  const sign = cleanPlacement({ kind: 'sign', x: 0, z: 0, text: '  Alex’s office  ' });
  assert.equal(typeof sign !== 'string' && sign.text, 'Alex’s office');
});

test('a wall square to the room is one box; at an angle it is a run of small ones', () => {
  const [straight, ...more] = footprint({ kind: 'wall', x: 0, z: 0, rotY: 0, length: 4 });
  assert.equal(more.length, 0);
  assert.deepEqual([straight.minX, straight.maxX], [-2, 2]);
  assert.ok(Math.abs(straight.maxZ - straight.minZ - 0.14) < 1e-9);
  const turned = footprint({ kind: 'wall', x: 0, z: 0, rotY: Math.PI / 2, length: 4 });
  assert.equal(turned.length, 1);
  assert.ok(Math.abs(turned[0].maxZ - turned[0].minZ - 4) < 1e-9, 'a quarter turn runs along z');
  const slanted = footprint({ kind: 'wall', x: 0, z: 0, rotY: Math.PI / 4, length: 4 });
  assert.ok(slanted.length > 5);
  // None of the small boxes covers much more than the wall's own thickness across.
  for (const b of slanted) assert.ok(b.maxX - b.minX < 0.5 && b.maxZ - b.minZ < 0.5);
});

test('a floor keeps its furniture and moved desks across a restart', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-furniture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = new Furniture(dir);
  const wall = f.add({ kind: 'wall', x: 2, z: 3, rotY: 0, length: 5 }, 'Sam');
  if (typeof wall === 'string') return assert.fail(wall);
  assert.equal(typeof f.update(wall.id, { rotY: Math.PI / 2, kind: 'couch' }), 'object');
  assert.equal(f.get().items[0].kind, 'wall', "an update can't change what it is");
  assert.equal(f.placeDesk('desk-3', { x: 5, z: 5, rotY: 1 }), undefined);
  assert.match(f.placeDesk('station-queue', { x: 5, z: 5, rotY: 1 })!, /can't be moved/);
  const again = new Furniture(dir);
  assert.equal(again.get().items.length, 1);
  assert.equal(again.get().items[0].rotY, Math.round((Math.PI / 2) * 100) / 100);
  assert.deepEqual(again.get().desks['desk-3'], { x: 5, z: 5, rotY: 1 });
  assert.equal(again.placeDesk('desk-3', null), undefined);
  assert.equal(again.remove(wall.id)?.id, wall.id);
  assert.deepEqual(new Furniture(dir).get(), { items: [], desks: {} });
});
