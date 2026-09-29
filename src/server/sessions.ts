import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Claude Code keeps each session as a transcript under <config>/projects/<the folder it ran in, with
// everything but letters and digits turned into dashes>/<session id>.jsonl, and `--resume <id>` only
// looks in the folder for where it's started. So a session carries on somewhere else (a worker moved
// to another floor, a chat brought in from Cowork) once its transcript is copied there.

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
}

/** Where Claude Code keeps the transcripts of sessions started in `cwd`. */
export function claudeProjectDir(cwd: string, configDir = claudeConfigDir()): string {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    // not there yet: as given
  }
  return path.join(configDir, 'projects', real.replace(/[^a-zA-Z0-9]/g, '-'));
}

/**
 * Copies session `id`'s transcript (and the folder of subagent transcripts beside it, if any) to where
 * a session started in `cwd` is looked for. Returns the copy's path, or why it couldn't.
 */
export function copyClaudeSession(transcript: string, id: string, cwd: string): string | { error: string } {
  if (!existsSync(transcript)) return { error: 'its conversation file is gone' };
  const dest = claudeProjectDir(cwd);
  const target = path.join(dest, `${id}.jsonl`);
  try {
    mkdirSync(dest, { recursive: true });
    if (path.resolve(transcript) !== target) cpSync(transcript, target);
    const side = path.join(path.dirname(transcript), id);
    if (existsSync(side) && statSync(side).isDirectory() && path.resolve(side) !== path.join(dest, id)) cpSync(side, path.join(dest, id), { recursive: true });
  } catch (err) {
    return { error: `couldn't copy its conversation: ${(err as Error).message}` };
  }
  return target;
}

/** A chat from Claude's Cowork mode that can be brought into the office as a worker. */
export interface CoworkChat {
  /** Cowork's own id for it. */
  id: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  model?: string;
  /** The Claude Code session under it, and its transcript. */
  sessionId: string;
  transcript: string;
  archived: boolean;
}

/** Where the Claude desktop app keeps Cowork's chats on this machine. */
export function coworkRoot(): string {
  if (process.env.AGENT_OFFICE_COWORK_DIR) return process.env.AGENT_OFFICE_COWORK_DIR;
  const base =
    process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support', 'Claude')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'Claude')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'Claude');
  return path.join(base, 'local-agent-mode-sessions');
}

const dirs = (p: string) => {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(p, e.name));
  } catch {
    return [];
  }
};

/**
 * Cowork's chats, newest first. Each is a local_<id>.json two folders down (account, then workspace)
 * with a local_<id>/ folder beside it holding the Claude Code config its session ran with.
 */
export function listCowork(root = coworkRoot()): CoworkChat[] {
  const chats: CoworkChat[] = [];
  for (const account of dirs(root)) {
    for (const space of dirs(account)) {
      let names: string[];
      try {
        names = readdirSync(space).filter((n) => /^local_[\w-]+\.json$/.test(n));
      } catch {
        continue;
      }
      for (const name of names) {
        try {
          const meta = JSON.parse(readFileSync(path.join(space, name), 'utf8')) as Record<string, unknown>;
          const sessionId = typeof meta.cliSessionId === 'string' && /^[\w-]+$/.test(meta.cliSessionId) ? meta.cliSessionId : undefined;
          if (!sessionId) continue;
          const projects = path.join(space, name.replace(/\.json$/, ''), '.claude', 'projects');
          const transcript = dirs(projects)
            .map((d) => path.join(d, `${sessionId}.jsonl`))
            .find((f) => existsSync(f));
          if (!transcript) continue;
          chats.push({
            id: typeof meta.sessionId === 'string' ? meta.sessionId : name.replace(/\.json$/, ''),
            title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim().slice(0, 120) : 'Untitled chat',
            createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
            lastActivityAt: typeof meta.lastActivityAt === 'number' ? meta.lastActivityAt : 0,
            model: typeof meta.model === 'string' ? meta.model : undefined,
            sessionId,
            transcript,
            archived: meta.isArchived === true,
          });
        } catch {
          // not one of Cowork's, or half-written
        }
      }
    }
  }
  return chats.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
