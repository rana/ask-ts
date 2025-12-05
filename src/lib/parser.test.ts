import { describe, expect, test } from 'bun:test';
import { parseSession } from './parser.ts';

describe('parseSession', () => {
  test('parses basic two-turn conversation', () => {
    const content = `# [1] Human

Hello

# [2] AI

Hi there`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
    expect(session.turns[0]?.role).toBe('Human');
    expect(session.turns[0]?.content).toBe('Hello');
    expect(session.turns[1]?.role).toBe('AI');
    expect(session.turns[1]?.content).toBe('Hi there');
  });

  test('ignores turn-like headers inside code fences', () => {
    const content = `# [1] Human

Here's an example:

\`\`\`markdown
# [2] AI

Fake turn inside fence
\`\`\`

# [2] AI

Response`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
    expect(session.turns[0]?.role).toBe('Human');
    expect(session.turns[1]?.role).toBe('AI');
    expect(session.turns[1]?.content).toBe('Response');
  });

  test('ignores content inside expanded file blocks', () => {
    const content = `# [1] Human

Check this file:

<!-- file: README.md -->
### README.md
\`\`\`markdown
# [2] AI

Example session format
\`\`\`
<!-- /file -->

# [2] AI

I see the README`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
    expect(session.turns[0]?.role).toBe('Human');
    expect(session.turns[1]?.role).toBe('AI');
  });

  test('ignores content inside expanded directory blocks', () => {
    const content = `# [1] Human

<!-- dir: src/ -->
### src/example.ts
\`\`\`typescript
// # [2] AI - this is a comment
\`\`\`
<!-- /dir -->

# [2] AI

Got it`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
  });

  test('ignores content inside expanded URL blocks', () => {
    const content = `# [1] Human

<!-- url: https://example.com -->
# Some Article

# [2] AI mentioned in article
<!-- /url -->

# [2] AI

Response`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
  });

  test('handles nested code fences', () => {
    const content = `# [1] Human

<!-- file: docs/example.md -->
### docs/example.md
\`\`\`\`markdown
# Example

\`\`\`typescript
const x = 1;
\`\`\`

# [2] AI - in nested content
\`\`\`\`
<!-- /file -->

# [2] AI

Got it`;

    const session = parseSession(content);
    expect(session.turns).toHaveLength(2);
  });

  test('unwraps markdown fence from AI responses', () => {
    const content = `# [1] Human

Question

# [2] AI

\`\`\`\`markdown
Here is my response
\`\`\`\``;

    const session = parseSession(content);
    expect(session.turns[1]?.content).toBe('Here is my response');
  });

  test('finds lastHumanTurnIndex correctly', () => {
    const content = `# [1] Human

First

# [2] AI

Response

# [3] Human

Second`;

    const session = parseSession(content);
    expect(session.lastHumanTurnIndex).toBe(2);
  });

  test('returns empty session for no turns', () => {
    const content = 'Just some text without turns';

    const session = parseSession(content);
    expect(session.turns).toHaveLength(0);
    expect(session.lastHumanTurnIndex).toBe(-1);
  });

  test('handles unclosed code fence gracefully', () => {
    const content = `# [1] Human

\`\`\`typescript
const x = 1;
// no closing fence

# [2] AI

Response`;

    // Should treat everything after unclosed fence as inside it
    const session = parseSession(content);
    expect(session.turns).toHaveLength(1);
  });
});
