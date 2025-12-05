import { appendFileSync } from 'node:fs';
import type { Session, Turn } from '../types.ts';
import { AskError } from './errors.ts';
import { expandReferences } from './expand.ts';
import { output } from './output.ts';
import { parseSession } from './parser.ts';

export { parseSession };

export interface ExpandedContent {
  type: 'directory' | 'file' | 'url';
  pattern: string;
  startLine: number;
  endLine: number;
  isStandalone: boolean;
}

export async function findAllExpandedContent(content: string): Promise<ExpandedContent[]> {
  const expansions: ExpandedContent[] = [];
  const lines = content.split('\n');

  // Find directory markers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const dirMatch = line.match(/^<!-- dir: (.+) -->$/);
    if (dirMatch) {
      const pattern = dirMatch[1]!;
      const startLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]?.trim() === '<!-- /dir -->') {
          expansions.push({
            type: 'directory',
            pattern,
            startLine,
            endLine: j,
            isStandalone: true,
          });
          i = j;
          break;
        }
      }
    }
  }

  // Find URL markers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const urlMatch = line.match(/^<!-- url: (.+) -->$/);
    if (urlMatch) {
      const url = urlMatch[1]!;
      const startLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]?.trim() === '<!-- /url -->') {
          expansions.push({
            type: 'url',
            pattern: url,
            startLine,
            endLine: j,
            isStandalone: true,
          });
          i = j;
          break;
        }
      }
    }
  }

  // Find file markers (standalone, not inside dir blocks)
  const dirRanges = expansions
    .filter((e) => e.type === 'directory')
    .map((e) => ({ start: e.startLine, end: e.endLine }));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fileMatch = line.match(/^<!-- file: (.+) -->$/);
    if (fileMatch) {
      // Check if inside a directory block
      const insideDir = dirRanges.some((r) => i > r.start && i < r.end);
      if (insideDir) continue;

      const filePath = fileMatch[1]!;
      const startLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]?.trim() === '<!-- /file -->') {
          expansions.push({
            type: 'file',
            pattern: filePath,
            startLine,
            endLine: j,
            isStandalone: true,
          });
          i = j;
          break;
        }
      }
    }
  }

  return expansions;
}

export async function refreshAllContent(
  sessionPath: string,
): Promise<{ refreshed: boolean; fileCount: number }> {
  const content = await Bun.file(sessionPath).text();

  // Check for unexpanded references first
  const unexpandedPattern = /\[\[([^\]​]+)\]\]/g;
  if (unexpandedPattern.test(content)) {
    const { expanded, fileCount } = await expandReferences(content);
    if (fileCount > 0) {
      const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
      await Bun.write(tmpPath, expanded);
      const fs = await import('node:fs/promises');
      await fs.rename(tmpPath, sessionPath);

      return { refreshed: true, fileCount };
    }
  }

  const expansions = await findAllExpandedContent(content);

  if (expansions.length === 0) {
    return { refreshed: false, fileCount: 0 };
  }

  let totalFiles = 0;
  const lines = content.split('\n');

  // Process in reverse order to preserve line numbers
  for (const expansion of expansions.reverse()) {
    try {
      output.refreshStart(expansion.pattern);

      if (expansion.type === 'directory') {
        const { expanded, fileCount } = await expandReferences(`[[${expansion.pattern}]]`);

        const expandedLines = expanded.split('\n');
        const startIdx = expandedLines.findIndex((line) => line.includes('<!-- dir:'));
        const endIdx = expandedLines.findIndex((line) => line.trim() === '<!-- /dir -->');

        if (startIdx !== -1 && endIdx !== -1) {
          const newContent = expandedLines.slice(startIdx, endIdx + 1);

          lines.splice(
            expansion.startLine,
            expansion.endLine - expansion.startLine + 1,
            ...newContent,
          );

          output.refreshSuccess(expansion.pattern, `${fileCount} files`);
          totalFiles += fileCount;
        }
      } else if (expansion.type === 'url') {
        const { expanded, fileCount } = await expandReferences(`[[${expansion.pattern}]]`);

        if (fileCount > 0) {
          const expandedLines = expanded.split('\n');
          const startIdx = expandedLines.findIndex((line) => line.includes('<!-- url:'));
          const endIdx = expandedLines.findIndex((line) => line.trim() === '<!-- /url -->');

          if (startIdx !== -1 && endIdx !== -1) {
            const newContent = expandedLines.slice(startIdx, endIdx + 1);

            lines.splice(
              expansion.startLine,
              expansion.endLine - expansion.startLine + 1,
              ...newContent,
            );

            output.refreshSuccess(expansion.pattern);
            totalFiles += 1;
          }
        }
      } else if (expansion.type === 'file') {
        const { expanded, fileCount } = await expandReferences(`[[${expansion.pattern}]]`);

        if (fileCount > 0) {
          const expandedLines = expanded.split('\n');
          const startIdx = expandedLines.findIndex((line) => line.includes('<!-- file:'));
          const endIdx = expandedLines.findIndex((line) => line.trim() === '<!-- /file -->');

          if (startIdx !== -1 && endIdx !== -1) {
            const newContent = expandedLines.slice(startIdx, endIdx + 1);

            lines.splice(
              expansion.startLine,
              expansion.endLine - expansion.startLine + 1,
              ...newContent,
            );

            output.refreshSuccess(expansion.pattern);
            totalFiles += 1;
          }
        }
      }
    } catch {
      output.warning(`Failed to refresh ${expansion.pattern}`);
    }
  }

  const updatedContent = lines.join('\n');
  const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, updatedContent);

  const fs = await import('node:fs/promises');
  await fs.rename(tmpPath, sessionPath);

  return { refreshed: true, fileCount: totalFiles };
}

export async function readSession(path: string): Promise<Session> {
  const file = Bun.file(path);
  const content = await file.text();
  return parseSession(content);
}

export async function expandAndSaveSession(
  path: string,
  session: Session,
): Promise<{ expanded: boolean; fileCount: number }> {
  const lastHumanTurn = session.turns[session.lastHumanTurnIndex];
  if (!lastHumanTurn) {
    return { expanded: false, fileCount: 0 };
  }

  const pattern = /\[\[([^\]​]+)\]\]/g;
  if (!pattern.test(lastHumanTurn.content)) {
    return { expanded: false, fileCount: 0 };
  }

  const { expanded, fileCount } = await expandReferences(lastHumanTurn.content);

  if (fileCount === 0) {
    return { expanded: false, fileCount: 0 };
  }

  const fullContent = await Bun.file(path).text();

  const turnHeader = `# [${lastHumanTurn.number}] Human`;
  const turnIndex = fullContent.lastIndexOf(turnHeader);

  if (turnIndex === -1) {
    throw new Error('Could not find turn header in session file');
  }

  const afterHeader = turnIndex + turnHeader.length;
  const nextTurnMatch = fullContent.indexOf('\n# [', afterHeader);
  const endOfTurn = nextTurnMatch === -1 ? fullContent.length : nextTurnMatch;

  const newContent =
    fullContent.slice(0, afterHeader) +
    '\n\n' +
    expanded.trim() +
    '\n' +
    fullContent.slice(endOfTurn);

  const tmpPath = `${path}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, newContent);

  const fs = await import('node:fs/promises');
  await fs.rename(tmpPath, path);

  return { expanded: true, fileCount };
}

export function validateSession(session: Session): void {
  if (session.turns.length === 0) {
    throw new AskError(
      'No turns found in session.md',
      'Make sure it has proper format:\n\n# [1] Human\n\nYour question here',
    );
  }

  if (session.lastHumanTurnIndex === -1) {
    throw new AskError('No human turn found in session.md');
  }

  const lastHumanTurn = session.turns[session.lastHumanTurnIndex];
  if (!lastHumanTurn || !lastHumanTurn.content.trim()) {
    throw new AskError(
      `Turn ${lastHumanTurn?.number ?? '?'} has no content`,
      'Add your question and try again',
    );
  }

  const lastTurn = session.turns[session.turns.length - 1];
  if (lastTurn && lastTurn.role === 'AI' && lastTurn.number > lastHumanTurn.number) {
    throw new AskError(
      `Turn ${lastHumanTurn.number} already has a response`,
      'Add a new human turn to continue',
    );
  }
}

export class SessionWriter {
  private headerWritten = false;
  private contentWritten = false;

  private constructor(
    private sessionPath: string,
    private turnNumber: number,
  ) {}

  static create(path: string, turnNumber: number): SessionWriter {
    return new SessionWriter(path, turnNumber);
  }

  private async writeHeader(): Promise<void> {
    if (this.headerWritten) return;

    const content = await Bun.file(this.sessionPath).text();
    const header = `\n\n# [${this.turnNumber}] AI\n\n\`\`\`\`markdown\n`;

    await Bun.write(this.sessionPath, content.trimEnd() + header);
    this.headerWritten = true;
  }

  async write(chunk: string): Promise<void> {
    if (!chunk) return;

    if (!this.headerWritten) {
      await this.writeHeader();
    }

    appendFileSync(this.sessionPath, chunk);
    this.contentWritten = true;
  }

  async end(interrupted: boolean = false): Promise<void> {
    if (!this.headerWritten) return;

    let closing = '';

    if (interrupted && this.contentWritten) {
      closing += '\n[Interrupted]';
    }

    closing += `\n\`\`\`\`\n\n# [${this.turnNumber + 1}] Human\n\n`;

    appendFileSync(this.sessionPath, closing);
  }
}

export function turnsToMessages(turns: Turn[]): import('../types.ts').Message[] {
  return turns.map((turn) => ({
    role: turn.role === 'Human' ? 'user' : 'assistant',
    content: [
      {
        text: turn.content,
      },
    ],
  }));
}
