import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_ASSET_BYTES, MAX_IMAGE_BYTES, cleanAssetPatch, type AssetInfo, type AssetType } from '../shared/assets.js';

/** What a file is, from its first bytes: a binary glTF model, or a PNG, JPEG or WebP picture. */
export function sniff(buf: Buffer): { type: AssetType; ext: string; mime: string } | undefined {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'glTF') return { type: 'model', ext: 'glb', mime: 'model/gltf-binary' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { type: 'image', ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { type: 'image', ext: 'webp', mime: 'image/webp' };
  return undefined;
}

/**
 * The building's asset library (see shared/assets.ts): the files in <office>/.agent-office/assets/,
 * and what's known about each in assets.json beside them.
 */
export class AssetLibrary {
  private list: AssetInfo[] = [];
  private dir: string;
  private file: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'assets');
    this.file = path.join(this.dir, 'assets.json');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      if (existsSync(this.file)) {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as AssetInfo[];
        for (const a of Array.isArray(saved) ? saved : []) {
          if (typeof a?.id !== 'string' || !/^[a-f0-9]{12}$/.test(a.id) || !existsSync(this.path(a))) continue;
          this.list.push({ ...a, ...cleanAssetPatch(a), seats: cleanAssetPatch({ seats: a.seats ?? [] }).seats ?? [] });
        }
      }
    } catch (err) {
      console.error(`agent-office: ${this.file} couldn't be read: ${(err as Error).message}`);
    }
  }

  all(): AssetInfo[] {
    return this.list;
  }

  get(id: string): AssetInfo | undefined {
    return this.list.find((a) => a.id === id);
  }

  /** Where an asset's file is. */
  path(a: Pick<AssetInfo, 'id' | 'type'> & { ext?: string }): string {
    if (a.type === 'model') return path.join(this.dir, `${a.id}.glb`);
    for (const ext of ['png', 'jpg', 'webp']) {
      const p = path.join(this.dir, `${a.id}.${ext}`);
      if (existsSync(p)) return p;
    }
    return path.join(this.dir, `${a.id}.${a.ext ?? 'png'}`);
  }

  mime(a: AssetInfo): string {
    const ext = path.extname(this.path(a)).slice(1);
    return a.type === 'model' ? 'model/gltf-binary' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  }

  /** Files a new model or picture. Returns it, or why it can't. */
  add(buf: Buffer, name: string, by: string): AssetInfo | string {
    const kind = sniff(buf);
    if (!kind) return 'That isn’t a .glb model or a PNG, JPEG or WebP picture. From Blender: File → Export → glTF 2.0, format glTF Binary (.glb).';
    if (buf.length > (kind.type === 'model' ? MAX_ASSET_BYTES : MAX_IMAGE_BYTES)) return 'That file is too big';
    if (this.list.length >= 500) return 'The library is full (500 things)';
    const id = randomBytes(6).toString('hex');
    const info: AssetInfo = {
      id,
      type: kind.type,
      name: name.trim().replace(/\.(glb|png|jpe?g|webp)$/i, '').slice(0, 60) || (kind.type === 'model' ? 'Model' : 'Picture'),
      bytes: buf.length,
      by,
      at: Date.now(),
      scale: 1,
      solid: true,
      seats: [],
    };
    try {
      writeFileSync(this.path({ ...info, ext: kind.ext }), buf, { mode: 0o600 });
    } catch (err) {
      return `Couldn't save it: ${(err as Error).message}`;
    }
    this.list.push(info);
    this.save();
    return info;
  }

  update(id: string, patch: Partial<AssetInfo>): AssetInfo | string {
    const a = this.get(id);
    if (!a) return "That's not in the library any more";
    Object.assign(a, cleanAssetPatch(patch));
    this.save();
    return a;
  }

  remove(id: string): AssetInfo | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    this.list = this.list.filter((x) => x !== a);
    rmSync(this.path(a), { force: true });
    this.save();
    return a;
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the asset library: ${(err as Error).message}`);
    }
  }
}
