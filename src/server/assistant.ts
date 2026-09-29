import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A personal assistant's floor is an ordinary folder with two things in it: ABOUT-ME.md, where you
// tell your assistants about yourself, and notes/, where they keep what should outlast a session
// (see the assistant's brief in shared/roles.ts). Neither is overwritten once it's there.

const ABOUT_ME = `# About me

Your assistants read this before they start, so tell them what helps. Edit it any time (open it from
the bookshelf, or in any editor); nothing here leaves this computer except to the agent you hire.

- **Name:**
- **What I do:**
- **Where I am / time zone:**
- **How I like answers:** short and direct
- **Things I'm working on:**
- **Things to never do without asking:**
`;

const NOTES_README = `# Notes

Your assistants keep notes here that should outlast a session: plans, lists, things you told them to
remember. They're plain Markdown, so read, edit or delete them as you like.
`;

/** Sets up `dir` for a personal assistant. Returns why it couldn't, if it couldn't. */
export function assistantHome(dir: string): string | undefined {
  try {
    const about = path.join(dir, 'ABOUT-ME.md');
    if (!existsSync(about)) writeFileSync(about, ABOUT_ME);
    const notes = path.join(dir, 'notes');
    mkdirSync(notes, { recursive: true });
    const readme = path.join(notes, 'README.md');
    if (!existsSync(readme)) writeFileSync(readme, NOTES_README);
    return undefined;
  } catch (err) {
    return `Couldn't set up ${dir} for an assistant: ${(err as Error).message}`;
  }
}
