import { defineCommand } from 'citty';
import { findProfile, streamCompletion } from '../lib/bedrock.ts';
import { extractRegion } from '../lib/cache.ts';
import { loadConfig } from '../lib/config.ts';
import { exitWithError, requireFile } from '../lib/errors.ts';
import { output } from '../lib/output.ts';
import {
  expandAndSaveSession,
  readSession,
  SessionWriter,
  turnsToMessages,
  validateSession,
} from '../lib/session.ts';
import { estimateTokens } from '../lib/tokens.ts';
import type { ModelType } from '../types.ts';

export default defineCommand({
  meta: {
    name: 'ask',
    description: 'Continue the conversation in a session file',
  },
  args: {
    session: {
      type: 'positional',
      description: 'Session file to process (default: session.md)',
      required: false,
    },
    model: {
      type: 'string',
      description: 'Model to use (opus/sonnet/haiku)',
      alias: 'm',
      required: false,
    },
  },
  async run({ args }) {
    try {
      const sessionPath = (args.session as string | undefined) ?? 'session.md';

      await requireFile(
        sessionPath,
        sessionPath === 'session.md'
          ? "Run 'ask init' to create session.md"
          : `File not found: ${sessionPath}`,
      );

      const config = await loadConfig();
      const modelType = (args.model as ModelType) || config.model;

      let session = await readSession(sessionPath);

      const { expanded, fileCount } = await expandAndSaveSession(sessionPath, session);
      if (expanded) {
        output.success(`Expanded ${fileCount} file${fileCount !== 1 ? 's' : ''}`);
        session = await readSession(sessionPath);
      }

      validateSession(session);

      const profile = await findProfile(modelType);
      const region = extractRegion(profile);

      output.info(`Model: ${profile.modelId} ${output.dim(`(${region})`)}`);

      const messages = turnsToMessages(session.turns);
      const inputTokens = estimateTokens(messages);
      output.info(
        `Input: ${output.number(inputTokens)} tokens ${output.dim(`(${session.turns.length} turns)`)}`,
      );

      if (inputTokens > 150000) {
        output.warning('Large input may be slow or hit limits');
      }

      const nextTurnNumber = session.turns[session.turns.length - 1]!.number + 1;
      const writer = await SessionWriter.create(sessionPath, nextTurnNumber);

      let finalTokens = 0;
      let interrupted = false;

      let sigintCount = 0;
      process.on('SIGINT', () => {
        sigintCount++;
        interrupted = true;
        
        if (sigintCount >= 2) {
          // Clear streaming line and show final status
          process.stdout.write('\r\x1b[K'); // Clear line
          output.warning('Forced exit');
          process.exit(130); // Standard SIGINT exit code
        }
      });

      // Start streaming line
      output.info('');
      process.stdout.write(output.dim('Streaming... '));

      for await (const event of streamCompletion(
        profile.arn,
        messages,
        config.maxTokens ?? 32000,
        config.temperature,
      )) {
        if (interrupted) break;

        switch (event.type) {
          case 'chunk':
            await writer.write(event.text);
            finalTokens = event.tokens;
            // Update streaming progress in place
            process.stdout.write(
              `\r${output.dim('Streaming...')} ${output.number(finalTokens)} tokens ${output.dim('[ctrl+c to interrupt]')}`,
            );
            break;
          case 'error':
            throw event.error;
          case 'end':
            finalTokens = event.totalTokens;
            break;
        }
      }

      await writer.end(interrupted);

      // Clear streaming line and show final status
      process.stdout.write('\r\x1b[K'); // Clear line
      if (interrupted) {
        output.warning(`Interrupted at ${output.number(finalTokens)} tokens`);
      } else {
        output.success(`Done: ${output.number(finalTokens)} tokens`);
      }
    } catch (error) {
      exitWithError(error);
    }
  },
});
