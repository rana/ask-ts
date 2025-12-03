/**
 * Session file operations and markdown parsing
 */

import { appendFileSync } from 'node:fs';
import type { Session, Turn } from '../types.ts';
import { AskError } from './errors.ts';
import { expandReferences } from './expand.ts';
import { output } from './output.ts';

export interface ExpandedContent {
  type: 'directory' | 'file';
  pattern: string; // "src/lib/" or "README.md"
  startLine: number;
  endLine: number;
  isStandalone: boolean; // true if not inside another expansion
}

export async function findAllExpandedContent(content: string): Promise<ExpandedContent[]> {
  const expansions: ExpandedContent[] = [];

  // First, find all directory expansions
  const dirMarkers = await findDirectoryMarkers(content);
  for (const marker of dirMarkers) {
    expansions.push({
      type: 'directory',
      pattern: marker.pattern,
      startLine: marker.startLine,
      endLine: marker.endLine,
      isStandalone: true,
    });
  }

  // Then, find all file expansions
  const fileBlocks = findFileBlocks(content);
  for (const block of fileBlocks) {
    // Check if this file is inside a directory expansion
    const insideDir = dirMarkers.some(
      (dir) => block.start > dir.startLine && block.end < dir.endLine,
    );

    if (!insideDir) {
      expansions.push({
        type: 'file',
        pattern: block.filePath,
        startLine: block.start,
        endLine: block.end,
        isStandalone: true,
      });
    }
  }

  return expansions;
}

export async function refreshAllContent(
  sessionPath: string,
): Promise<{ refreshed: boolean; fileCount: number }> {
  let content = await Bun.file(sessionPath).text();

  // First, expand any unexpanded references
  const { expandReferences } = await import('./expand.ts');
  const unexpandedPattern = /\[\[([^\]]+)\]\]/g;
  const hasUnexpanded = unexpandedPattern.test(content);

  if (hasUnexpanded) {
    const { expanded, fileCount } = await expandReferences(content, 0);
    if (fileCount > 0) {
      content = expanded;
      // Write the expanded content
      const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
      await Bun.write(tmpPath, content);
      const fs = await import('node:fs/promises');
      await fs.rename(tmpPath, sessionPath);

      output.info(`Expanded ${fileCount} new reference${fileCount !== 1 ? 's' : ''}`);
    }
  }

  // Then find existing expansions to refresh
  const expansions = await findAllExpandedContent(content);

  if (expansions.length === 0) {
    return { refreshed: hasUnexpanded, fileCount: 0 };
  }

  output.info(
    `Found ${expansions.length} expansion${expansions.length !== 1 ? 's' : ''} to refresh...`,
  );

  let totalFiles = 0;
  const lines = content.split('\n');

  // Process in reverse order to maintain line numbers
  for (const expansion of expansions.reverse()) {
    try {
      if (expansion.type === 'directory') {
        const { expanded, fileCount } = await expandReferences(`[[${expansion.pattern}]]`, 0);

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

          totalFiles += fileCount;
        }
      } else {
        const { expanded, fileCount } = await expandReferences(`[[${expansion.pattern}]]`, 0);

        if (fileCount > 0) {
          const newLines = expanded
            .split('\n')
            .filter((line, idx, arr) =>
              idx === 0 || idx === arr.length - 1 ? line.trim() !== '' : true,
            );

          lines.splice(
            expansion.startLine,
            expansion.endLine - expansion.startLine + 1,
            ...newLines,
          );

          totalFiles += 1;
        }
      }
    } catch (error) {
      output.warning(`Failed to refresh ${expansion.pattern}: ${error}`);
    }
  }

  const updatedContent = lines.join('\n');
  const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, updatedContent);

  const fs = await import('node:fs/promises');
  await fs.rename(tmpPath, sessionPath);

  return { refreshed: true, fileCount: totalFiles };
}

/**
 * Parse session.md content into structured turns
 */
export function parseSession(content: string): Session {
  const turns: Turn[] = [];

  // Match headers like "# [1] Human" or "# [2] AI"
  const headerPattern = /^# \[(\d+)\] (Human|AI)$/gm;
  const matches = Array.from(content.matchAll(headerPattern));

  if (matches.length === 0) {
    return { turns: [], lastHumanTurnIndex: -1 };
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match || match.index === undefined) continue;

    const number = parseInt(match[1]!, 10);
    const role = match[2] as 'Human' | 'AI';

    // Extract content between headers
    const startPos = match.index + match[0].length;
    const nextMatch = matches[i + 1];
    const endPos = nextMatch?.index ?? content.length;
    let turnContent = content.slice(startPos, endPos).trim();

    // Strip markdown wrapper from AI responses
    if (role === 'AI' && turnContent.startsWith('````markdown')) {
      turnContent = turnContent
        .replace(/^````markdown\n/, '')
        .replace(/\n````$/, '')
        .trim();
    }

    if (turnContent) {
      turns.push({ number, role, content: turnContent });
    }
  }

  // Find last human turn
  let lastHumanTurnIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn && turn.role === 'Human') {
      lastHumanTurnIndex = i;
      break;
    }
  }

  return { turns, lastHumanTurnIndex };
}

/**
 * Read and parse session file
 */
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

  // Use the same pattern as expandReferences to check for actual references
  const pattern = /\[\[([^\]]+)\]\]/g;
  if (!pattern.test(lastHumanTurn.content)) {
    return { expanded: false, fileCount: 0 };
  }

  const { expanded, fileCount } = await expandReferences(
    lastHumanTurn.content,
    lastHumanTurn.number,
  );

  if (fileCount === 0) {
    return { expanded: false, fileCount: 0 };
  }

  // Read the full file content
  const fullContent = await Bun.file(path).text();

  // Find and replace the last human turn content
  const turnHeader = `# [${lastHumanTurn.number}] Human`;
  const turnIndex = fullContent.lastIndexOf(turnHeader);

  if (turnIndex === -1) {
    throw new Error('Could not find turn header in session file');
  }

  // Find the end of this turn (start of next turn or end of file)
  const afterHeader = turnIndex + turnHeader.length;
  const nextTurnMatch = fullContent.indexOf('\n# [', afterHeader);
  const endOfTurn = nextTurnMatch === -1 ? fullContent.length : nextTurnMatch;

  // Reconstruct the file with expanded content
  const newContent =
    fullContent.slice(0, afterHeader) +
    '\n\n' +
    expanded.trim() +
    '\n' +
    fullContent.slice(endOfTurn);

  // Write atomically using fs.rename
  const tmpPath = `${path}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, newContent);

  // Use fs.rename instead of moveTo
  const fs = await import('node:fs/promises');
  await fs.rename(tmpPath, path);

  return { expanded: true, fileCount };
}

/**
 * Validate session is ready for processing
 */
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

  // Check if already has response
  const lastTurn = session.turns[session.turns.length - 1];
  if (lastTurn && lastTurn.role === 'AI' && lastTurn.number > lastHumanTurn.number) {
    throw new AskError(
      `Turn ${lastHumanTurn.number} already has a response`,
      'Add a new human turn to continue',
    );
  }
}

/**
 * Stream writer for appending AI responses
 */
export class SessionWriter {
  private headerWritten = false;
  private contentWritten = false;

  private constructor(
    private sessionPath: string,
    private turnNumber: number,
  ) {}

  /**
   * Begin a new streaming session
   */
  static async begin(path: string, turnNumber: number): Promise<SessionWriter> {
    const writer = new SessionWriter(path, turnNumber);
    await writer.writeHeader();
    return writer;
  }

  private async writeHeader(): Promise<void> {
    const content = await Bun.file(this.sessionPath).text();
    const header = `\n\n# [${this.turnNumber}] AI\n\n\`\`\`\`markdown\n`;

    await Bun.write(this.sessionPath, content.trimEnd() + header);
    this.headerWritten = true;
  }

  /**
   * Write a chunk of the response
   */
  async write(chunk: string): Promise<void> {
    if (!this.headerWritten || !chunk) return;

    appendFileSync(this.sessionPath, chunk);
    this.contentWritten = true;
  }

  /**
   * End the session and prepare for next turn
   */
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

/**
 * Convert turns to Bedrock message format
 */
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

interface DirectoryMarker {
  pattern: string;
  startLine: number;
  endLine: number;
}

export async function findDirectoryMarkers(content: string): Promise<DirectoryMarker[]> {
  const lines = content.split('\n');
  const markers: DirectoryMarker[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startMatch = line?.match(/^<!-- dir: (.+) -->$/);

    if (startMatch) {
      const pattern = startMatch[1]!.trim();
      const startLine = i;

      // Find matching end tag
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]?.trim() === '<!-- /dir -->') {
          markers.push({ pattern, startLine, endLine: j });
          i = j; // Skip past this block
          break;
        }
      }
    }
  }

  return markers;
}

export async function refreshDirectoryExpansions(
  sessionPath: string,
): Promise<{ refreshed: boolean; fileCount: number }> {
  const content = await Bun.file(sessionPath).text();
  const markers = await findDirectoryMarkers(content);

  if (markers.length === 0) {
    return { refreshed: false, fileCount: 0 };
  }

  output.info(
    `Found ${markers.length} directory expansion${markers.length !== 1 ? 's' : ''} to refresh...`,
  );

  const lines = content.split('\n');
  let totalFiles = 0;

  // Import expandReferences at the top of this function
  const { expandReferences } = await import('./expand.ts');

  // Process in reverse to maintain line numbers
  for (const marker of markers.reverse()) {
    try {
      // Re-expand the directory
      const { expanded, fileCount } = await expandReferences(`[[${marker.pattern}]]`);

      // Extract just the content between the markers
      const expandedLines = expanded.split('\n');
      const startIdx = expandedLines.findIndex((line) => line.includes('<!-- dir:'));
      const endIdx = expandedLines.findIndex((line) => line.trim() === '<!-- /dir -->');

      if (startIdx !== -1 && endIdx !== -1) {
        const newContent = expandedLines.slice(startIdx, endIdx + 1);

        // Replace lines
        lines.splice(marker.startLine, marker.endLine - marker.startLine + 1, ...newContent);

        totalFiles += fileCount;
      }
    } catch (error) {
      output.warning(`Failed to refresh ${marker.pattern}: ${error}`);
    }
  }

  // Write atomically
  const updatedContent = lines.join('\n');
  const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
  await Bun.write(tmpPath, updatedContent);

  const fs = await import('node:fs/promises');
  await fs.rename(tmpPath, sessionPath);

  return { refreshed: true, fileCount: totalFiles };
}

interface FileBlock {
  start: number;
  end: number;
  filePath: string;
  fence: string;
  lang: string;
}

export async function refreshExpandedFiles(
  path: string,
): Promise<{ refreshed: boolean; fileCount: number }> {
  const content = await Bun.file(path).text();
  const blocks = findFileBlocks(content);

  if (blocks.length === 0) {
    return { refreshed: false, fileCount: 0 };
  }

  output.info(`Found ${blocks.length} file references to refresh...`);

  const lines = content.split('\n');
  let fileCount = 0;
  let offset = 0;

  for (const block of blocks) {
    try {
      const file = Bun.file(block.filePath);
      if (!(await file.exists())) {
        output.warning(`Skipping ${block.filePath} - file no longer exists`);
        continue;
      }

      let newContent = await file.text();

      // Apply escaping
      newContent = newContent.replace(/\[\[/g, '[\u200B[');
      newContent = newContent.replace(/\]\]/g, ']\u200B]');

      // Build replacement lines
      const fence = newContent.includes('```') ? '``````' : '```';
      const newLines = [
        `### ${block.filePath}`,
        `${fence}${block.lang}`,
        ...newContent.split('\n'),
        fence,
      ];

      // Replace with offset adjustment
      lines.splice(block.start + offset, block.end - block.start + 1, ...newLines);

      offset += newLines.length - (block.end - block.start + 1);
      fileCount++;
    } catch (error) {
      output.warning(`Error refreshing ${block.filePath}: ${error}`);
    }
  }

  if (fileCount > 0) {
    const updatedContent = lines.join('\n');

    const tmpPath = `${path}.tmp-${Date.now()}`;
    await Bun.write(tmpPath, updatedContent);

    const fs = await import('node:fs/promises');
    await fs.rename(tmpPath, path);

    return { refreshed: true, fileCount };
  }

  return { refreshed: false, fileCount: 0 };
}

function findFileBlocks(content: string): FileBlock[] {
  const lines = content.split('\n');
  const blocks: FileBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for: ### filepath
    if (line?.startsWith('### ')) {
      const filePath = line.substring(4).trim();
      const start = i;

      // Next line should be code fence
      i++;
      if (i >= lines.length) break;

      const fenceLine = lines[i];
      const fenceMatch = fenceLine?.match(/^(`{3,})(\w*)/);
      if (!fenceMatch) continue;

      const fence = fenceMatch[1] || '```';
      const lang = fenceMatch[2] || '';

      // Find closing fence
      i++;
      while (i < lines.length && lines[i] !== fence) {
        i++;
      }

      if (i < lines.length) {
        blocks.push({
          start,
          end: i,
          filePath,
          fence,
          lang,
        });
      }
    }

    i++;
  }

  return blocks;
}
