import test from 'node:test';
import assert from 'node:assert/strict';
import { deskSeat } from '../src/shared/layout.js';
import { placedAll, placedDesk, placedSeats, placedSpot } from '../src/shared/placed.js';
import type { AssetInfo } from '../src/shared/assets.js';
import type { FurnitureItem } from '../src/shared/furniture.js';

const asset = (over: Partial<AssetInfo> = {}): AssetInfo => ({ id: 'aaaaaaaaaaaa', type: 'model', name: 'Gold desk', bytes: 1, by: 'x', at: 0, scale: 1, solid: true, seats: [], ...over });
const item = (over: Partial<FurnitureItem> = {}): FurnitureItem => ({ id: 'i1', kind: 'asset', asset: 'aaaaaaaaaaaa', x: 5, z: -2, rotY: 0, scale: 1, by: 'x', at: 0, ...over });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('a spot on a model moves, turns and grows with the model', () => {
  const p = placedSpot(item({ rotY: Math.PI / 2, scale: 2 }), { x: 1, y: 0.5, z: 0, rotY: 0 });
  close(p.x, 5);
  close(p.z, -2 - 2);
  close(p.y, 1);
  close(p.rotY, Math.PI / 2);
});

test("a desk on a model puts its worker where it's set up, facing its way", () => {
  assert.equal(placedDesk(item(), asset()), undefined, 'no desk set up, no desk');
  // Set up facing -z (toward the desk's front edge at z = -0.5), sitting at z = 0.4.
  const d = placedDesk(item(), asset({ desk: { x: 0, y: 0.45, z: 0.4, rotY: Math.PI } }))!;
  assert.equal(d.id, 'a-i1');
  const seat = deskSeat(d, 0.93);
  close(seat.x, 5);
  close(seat.z, -2 + 0.4);
  close(d.seatY, 0.45);
  // The desk (where the laptop is) is in front of the worker: further toward -z.
  assert.ok(d.z < seat.z);
});

test('each seat on a model is a place to sit, at its height', () => {
  const seats = placedSeats(item({ scale: 0.5 }), asset({ seats: [{ x: -1, y: 0.9, z: 0, rotY: 0 }, { x: 1, y: 0.9, z: 0, rotY: 0 }] }));
  assert.deepEqual(seats.map((s) => s.id), ['m-i1-0', 'm-i1-1']);
  close(seats[0].x, 4.5);
  close(seats[0].hips, 0.45);
  const all = placedAll([item(), item({ id: 'i2', asset: 'bbbbbbbbbbbb' }), { ...item({ id: 'w' }), kind: 'wall', asset: undefined }], [asset({ desk: { x: 0, y: 0.4, z: 0, rotY: 0 } })]);
  assert.deepEqual(all.desks.map((d) => d.id), ['a-i1'], 'a model not in the library, and a wall, have none');
});

test('a worker desk put down is a desk where it was put, and on the lot everything stands on the street', () => {
  const desk = { ...item({ id: 'd1', kind: 'desk', asset: undefined, x: 30, z: 4, rotY: 1 }) };
  const { desks } = placedAll([desk], []);
  assert.deepEqual([desks[0].id, desks[0].x, desks[0].z, desks[0].rotY, desks[0].deskTop], ['a-d1', 30, 4, 1, 0.78]);
  const onLot = placedAll([desk, item({ id: 'c1' })], [asset({ seats: [{ x: 0, y: 0.5, z: 0, rotY: 0 }] })], -3.6);
  assert.equal(onLot.desks[0].baseY, -3.6);
  assert.equal(onLot.seats[0].y, -3.6);
  close(onLot.seats[0].hips, 0.5);
});
