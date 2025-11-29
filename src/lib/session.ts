/**
 * Session file operations and markdown parsing
 */

import { appendFileSync } from 'node:fs';
import type { Session, Turn } from '../types.ts';
import { AskError } from './errors.ts';

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

/**
 * Validate session is ready for processing
 */
export function validateSession(session: Session): void {
  if (session.turns.length === 0) {
    throw new AskError(
      'No turns found in session.md',
      'Make sure it has proper format:\n\n# [1] Human\n\nYour question here'
    );
  }
  
  if (session.lastHumanTurnIndex === -1) {
    throw new AskError('No human turn found in session.md');
  }
  
  const lastHumanTurn = session.turns[session.lastHumanTurnIndex];
  if (!lastHumanTurn || !lastHumanTurn.content.trim()) {
    throw new AskError(
      `Turn ${lastHumanTurn?.number ?? '?'} has no content`,
      'Add your question and try again'
    );
  }
  
  // Check if already has response
  const lastTurn = session.turns[session.turns.length - 1];
  if (lastTurn && lastTurn.role === 'AI' && lastTurn.number > lastHumanTurn.number) {
    throw new AskError(
      `Turn ${lastHumanTurn.number} already has a response`,
      'Add a new human turn to continue'
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
    private turnNumber: number
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
  return turns.map(turn => ({
    role: turn.role === 'Human' ? 'user' : 'assistant',
    content: [{
      text: turn.content
    }]
  }));
}