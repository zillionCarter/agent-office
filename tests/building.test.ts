import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-building-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const floor = (id: string, palette: number): FloorDef => {
    const dir = path.join(root, 'acme', id);
    mkdirSync(dir, { recursive: true });
    return { id, name: id, repo: `acme/${id}`, dir, palette, addedBy: 'Sam', addedAt: 1 };
  };
  const defs = [floor('api', 0), floor('web', 1), floor('docs', 2)];
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify(defs));
  return { root, dataDir, defs };
}

const saved = (dataDir: string) => (JSON.parse(readFileSync(path.join(dataDir, 'floors.json'), 'utf8')) as FloorDef[]).map((d) => d.id);

test('a floor comes off the building and stays off, with its checkout left where it was', (t) => {
  const { root, dataDir, defs } = office(t);
  const building = new Building(dataDir, root);

  const r = building.remove('web');
  assert.equal(typeof r, 'object');
  assert.equal((r as FloorDef).dir, defs[1].dir);
  assert.deepEqual(building.list().map((d) => d.id), ['api', 'docs']);
  assert.deepEqual(saved(dataDir), ['api', 'docs']);
  assert.ok(existsSync(defs[1].dir), 'the checkout stays on disk');

  // After a restart it's still gone.
  assert.deepEqual(new Building(dataDir, root).list().map((d) => d.id), ['api', 'docs']);
});

test("floors that aren't there can't be taken off", (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);

  assert.equal(building.remove('nope'), 'No such floor');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs']);
});

test('the floor the office was started in comes off too, stays off after a restart, and moves back in when its repository is added again', async (t) => {
  const { root, dataDir, defs } = office(t);
  // The office's own checkout, with its GitHub origin (how it's recognised once it's no longer a floor).
  execFileSync('git', ['init', '-q', defs[0].dir]);
  execFileSync('git', ['-C', defs[0].dir, 'remote', 'add', 'origin', 'https://github.com/acme/api.git']);
  const building = new Building(dataDir, root);
  building.ensureLocal(defs[0].dir, 'the office');
  assert.ok(building.isLocal('api'));
  assert.ok(!building.isLocal('web'));

  const r = building.remove('api', 'Sam');
  assert.equal((r as FloorDef).id, 'api');
  assert.ok(!building.isLocal('api'));
  assert.deepEqual(saved(dataDir), ['web', 'docs']);
  assert.ok(existsSync(defs[0].dir), 'the checkout stays on disk');

  // The next start doesn't put it back.
  const again = new Building(dataDir, root);
  assert.equal(again.ensureLocal(defs[0].dir, 'the office'), undefined);
  assert.deepEqual(again.list().map((d) => d.id), ['web', 'docs']);
  assert.deepEqual(saved(dataDir), ['web', 'docs']);

  // Adding acme/api again uses the checkout it always was (no clone, no GitHub needed).
  const started: string[] = [];
  const back = await again.add('https://github.com/acme/api', 'Sam', (d) => started.push(d.dir));
  assert.equal(typeof back, 'object', String(back));
  assert.equal((back as FloorDef).dir, defs[0].dir);
  assert.deepEqual(started, [defs[0].dir]);
  assert.ok(again.isLocal((back as FloorDef).id));
  assert.deepEqual(saved(dataDir), ['web', 'docs', 'api']);
  assert.ok(!existsSync(path.join(dataDir, 'local-floor.json')));

  // ...and it's a floor again at the next start.
  const third = new Building(dataDir, root);
  assert.equal(third.ensureLocal(defs[0].dir, 'the office')?.id, 'api');
  assert.deepEqual(third.list().map((d) => d.id), ['web', 'docs', 'api']);
});

test('any folder can be a floor as it is, and an assistant floor gets its brief', (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);
  const notes = path.join(root, 'elsewhere', 'notes');
  mkdirSync(path.join(notes, 'recipes'), { recursive: true });

  const added = building.addFolder(notes, 'Sam');
  assert.equal(typeof added, 'object');
  assert.equal((added as FloorDef).name, 'notes');
  assert.equal((added as FloorDef).repo, undefined, 'not a checkout, so no repository');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs', 'notes']);

  // Twice, inside another floor, holding one, missing, or the whole home folder: no.
  assert.match(building.addFolder(notes, 'Sam') as string, /already the notes floor/);
  assert.match(building.addFolder(path.join(notes, 'recipes'), 'Sam') as string, /inside the notes floor/);
  assert.match(building.addFolder(path.join(root, 'acme'), 'Sam') as string, /holds the api floor/);
  assert.match(building.addFolder(path.join(root, 'nowhere'), 'Sam') as string, /no folder at/);
  assert.match(building.addFolder('~', 'Sam') as string, /too big/);
  assert.match(building.addFolder('relative/path', 'Sam') as string, /full path/);

  // An assistant's floor is made if it isn't there, with ABOUT-ME.md and notes/, and says what it is after a restart.
  const home = path.join(root, 'assistant');
  const assistant = building.addFolder(home, 'Sam', { create: true, kind: 'assistant', name: 'Helper' });
  assert.equal(typeof assistant, 'object');
  assert.equal((assistant as FloorDef).name, 'Helper');
  assert.ok(existsSync(path.join(home, 'ABOUT-ME.md')));
  assert.ok(existsSync(path.join(home, 'notes', 'README.md')));
  assert.equal(new Building(dataDir, root).list().find((d) => d.dir === home)?.kind, 'assistant');
});

test('browsing lists a folder’s folders, hidden ones left out, and says which is a floor', (t) => {
  const { root, dataDir, defs } = office(t);
  const building = new Building(dataDir, root);
  mkdirSync(path.join(root, 'acme', '.secret'));
  writeFileSync(path.join(root, 'acme', 'file.txt'), 'x');

  const listing = building.browse(path.join(root, 'acme'));
  assert.deepEqual(listing.folders, ['api', 'docs', 'web']);
  assert.equal(listing.floor, undefined);
  assert.equal(building.browse(defs[0].dir).floor, 'api');
  assert.match(building.browse(path.join(root, 'missing')).error!, /no folder/);
  assert.match(building.browse('nope').error!, /full path/);
});
