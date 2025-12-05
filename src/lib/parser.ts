import type { Session, Turn } from '../types.ts';
import { findExcludedRegions, isInExcludedRegion } from './regions.ts';

export function parseSession(content: string): Session {
  const lines = content.split('\n');
  const regions = findExcludedRegions(lines);

  // Find turn headers outside excluded regions
  const turnHeaders: Array<{
    lineIndex: number;
    number: number;
    role: 'Human' | 'AI';
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (isInExcludedRegion(i, regions)) continue;

    const match = lines[i]!.match(/^# \[(\d+)\] (Human|AI)$/);
    if (match) {
      turnHeaders.push({
        lineIndex: i,
        number: parseInt(match[1]!, 10),
        role: match[2] as 'Human' | 'AI',
      });
    }
  }

  if (turnHeaders.length === 0) {
    return { turns: [], lastHumanTurnIndex: -1 };
  }

  // Extract content between headers
  const turns: Turn[] = [];

  for (let i = 0; i < turnHeaders.length; i++) {
    const header = turnHeaders[i]!;
    const nextHeader = turnHeaders[i + 1];

    const startLine = header.lineIndex + 1;
    const endLine = nextHeader ? nextHeader.lineIndex : lines.length;

    let turnContent = lines.slice(startLine, endLine).join('\n').trim();

    // Strip markdown wrapper from AI responses
    if (header.role === 'AI') {
      turnContent = unwrapMarkdownFence(turnContent);
    }

    if (turnContent) {
      turns.push({
        number: header.number,
        role: header.role,
        content: turnContent,
      });
    }
  }

  // Find last human turn
  let lastHumanTurnIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'Human') {
      lastHumanTurnIndex = i;
      break;
    }
  }

  return { turns, lastHumanTurnIndex };
}

function unwrapMarkdownFence(content: string): string {
  // Match opening fence like ````markdown
  const openMatch = content.match(/^(`{4,})markdown\n/);
  if (!openMatch) return content;

  const fence = openMatch[1]!;
  const afterOpen = content.slice(openMatch[0].length);

  // Find closing fence
  const closePattern = new RegExp(`\n${fence}$`);
  if (closePattern.test(afterOpen)) {
    return afterOpen.replace(closePattern, '').trim();
  }

  return content;
}
