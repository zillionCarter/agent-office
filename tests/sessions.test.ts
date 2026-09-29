import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeProjectDir, copyClaudeSession, listCowork } from '../src/server/sessions.js';

function scratch(t: { after(fn: () => void): void }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-sessions-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A Cowork chat as the Claude app leaves one: its metadata, and its session's transcript under its own .claude. */
function coworkChat(root: string, local: string, meta: Record<string, unknown>, transcript = true) {
  const space = path.join(root, 'account', 'space');
  mkdirSync(space, { recursive: true });
  writeFileSync(path.join(space, `${local}.json`), JSON.stringify({ sessionId: local, ...meta }));
  if (!transcript) return;
  const projects = path.join(space, local, '.claude', 'projects', '-somewhere-outputs');
  mkdirSync(projects, { recursive: true });
  writeFileSync(path.join(projects, `${meta.cliSessionId}.jsonl`), '{"type":"user"}\n');
}

test('Cowork’s chats are found with their transcripts, newest first', (t) => {
  const root = scratch(t);
  coworkChat(root, 'local_old', { cliSessionId: 'aaa-1', title: 'Cowork setup', lastActivityAt: 10 });
  coworkChat(root, 'local_new', { cliSessionId: 'bbb-2', title: 'Sales outreach campaign', lastActivityAt: 20, isArchived: false });
  coworkChat(root, 'local_gone', { cliSessionId: 'ccc-3', title: 'No transcript', lastActivityAt: 30 }, false);
  coworkChat(root, 'local_bad', { cliSessionId: '../escape', title: 'Bad id' });

  const chats = listCowork(root);
  assert.deepEqual(chats.map((c) => c.title), ['Sales outreach campaign', 'Cowork setup']);
  assert.equal(chats[0].sessionId, 'bbb-2');
  assert.ok(chats[0].transcript.endsWith(path.join('local_new', '.claude', 'projects', '-somewhere-outputs', 'bbb-2.jsonl')));
  assert.deepEqual(listCowork(path.join(root, 'missing')), []);
});

test('a session is copied, subagents and all, to where Claude Code looks for it in another folder', (t) => {
  const root = scratch(t);
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'config');
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  });
  const from = path.join(root, 'old');
  mkdirSync(path.join(from, 'sess-1', 'subagents'), { recursive: true });
  writeFileSync(path.join(from, 'sess-1.jsonl'), 'hello\n');
  writeFileSync(path.join(from, 'sess-1', 'subagents', 'agent-a.jsonl'), 'sub\n');
  const home = path.join(root, 'Home Base');
  mkdirSync(home);

  const copy = copyClaudeSession(path.join(from, 'sess-1.jsonl'), 'sess-1', home);
  assert.equal(typeof copy, 'string');
  assert.equal(path.dirname(copy as string), path.join(root, 'config', 'projects', home.replace(/[^a-zA-Z0-9]/g, '-')));
  assert.equal(claudeProjectDir(home), path.dirname(copy as string));
  assert.equal(readFileSync(copy as string, 'utf8'), 'hello\n');
  assert.ok(existsSync(path.join(path.dirname(copy as string), 'sess-1', 'subagents', 'agent-a.jsonl')));
  assert.deepEqual(copyClaudeSession(path.join(from, 'nope.jsonl'), 'nope', home), { error: 'its conversation file is gone' });
});
