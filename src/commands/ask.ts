import { defineCommand } from 'citty';
import { exitWithError, requireFile } from '../lib/errors.ts';
import { readSession, validateSession, SessionWriter, turnsToMessages } from '../lib/session.ts';
import { findProfile, streamCompletion } from '../lib/bedrock.ts';
import { isValidModel, getModelInfo } from '../lib/models.ts';
import { loadConfig } from '../lib/config.ts';
import { extractRegion } from '../lib/cache.ts';
import { expandAndSaveSession, refreshExpandedFiles } from '../lib/session.ts';
import { estimateTokens } from '../lib/tokens.ts';
import { output } from '../lib/output.ts';

const SESSION_PATH = 'session.md';

export default defineCommand({
  meta: {
    name: 'ask',
    description: 'Chat with Claude via session.md'
  },
  args: {
    model: {
      type: 'string',
      description: 'Model to use (opus/sonnet/haiku)',
      alias: 'm',
      required: false
    },
    refresh: {
      type: 'boolean',
      description: 'Re-expand all file references with current content',
      alias: 'r',
      default: false
    }
  },
  async run({ args }) {
    try {
      const config = await loadConfig();
      
      const modelArg = args.model as string | undefined;
      const model = modelArg || config.model;
      const refresh = args.refresh as boolean;
      
      if (!isValidModel(model)) {
        exitWithError(
          new Error(`Invalid model: ${model}. Valid options: opus, sonnet, haiku`)
        );
      }
      
      await requireFile(SESSION_PATH, "Run 'ask init' to start");
      
      // Handle refresh before normal flow
      if (refresh) {
        output.info('Refreshing file references...');
        const { refreshed, fileCount } = await refreshExpandedFiles(SESSION_PATH);
        if (refreshed) {
          output.success(`Refreshed ${fileCount} file${fileCount > 1 ? 's' : ''}`);
        } else {
          output.info('No file references found to refresh');
          return;
        }
      }
      
      let session = await readSession(SESSION_PATH);
      validateSession(session);

      // Expand file references if present
      const { expanded, fileCount } = await expandAndSaveSession(SESSION_PATH, session);
      if (expanded) {
        output.info(`Expanded ${fileCount} file${fileCount > 1 ? 's' : ''} in session.md`);
        
        // Re-read the session after expansion
        session = await readSession(SESSION_PATH);
      }
      
      const profile = await findProfile(model);
      const region = extractRegion(profile);
      output.info(`Model: ${profile.modelId} ${output.parens(region)}`);
      
      const messages = turnsToMessages(session.turns);
      const modelInfo = getModelInfo(model);
      const maxTokens = config.maxTokens || modelInfo.maxTokens;
      const inputTokens = estimateTokens(messages);

      output.info(`Sending: ${output.number(inputTokens)} tokens ${output.parens(`${session.turns.length} turns`)}`);
      if (inputTokens > 150_000) {
        output.warning('Large context - consider starting fresh with: ask init');
      }
      
      const lastHumanTurn = session.turns[session.lastHumanTurnIndex]!;
      const nextTurnNumber = lastHumanTurn.number + 1;
      
      const writer = await SessionWriter.begin(SESSION_PATH, nextTurnNumber);
      output.info('Streaming response... [ctrl+c to interrupt]');
      
      let lastTokenCount = 0;
      let interrupted = false;
      let totalTokens = 0;
      
      const onInterrupt = () => {
        interrupted = true;
        process.stdout.write('\nInterrupting...\n');
      };
      process.on('SIGINT', onInterrupt);
      
      try {
        for await (const event of streamCompletion(profile.arn, messages, maxTokens, config.temperature)) {
          if (interrupted) break;
          
          switch (event.type) {
            case 'chunk':
              await writer.write(event.text);
              
              if (event.tokens - lastTokenCount >= 100 || event.tokens < 100) {
                process.stdout.write(`\rStreaming response... ${output.number(event.tokens)} tokens ${output.dim('[ctrl+c to interrupt]')}`);
                lastTokenCount = event.tokens;
              }
              break;
              
            case 'error':
              process.stdout.write('\r\x1b[K');
              throw event.error;
              
            case 'end':
              totalTokens = event.totalTokens;
              break;
          }
        }
        
        await writer.end(interrupted);
        process.off('SIGINT', onInterrupt);
        
        process.stdout.write('\r\x1b[K');
        if (interrupted) {
          console.log(`Response interrupted after ${totalTokens} tokens`);
        } else {
          output.success(`Received: ${output.number(totalTokens)} tokens`);
        }
        
      } catch (error) {
        await writer.end(true);
        throw error;
      }
      
    } catch (error) {
      exitWithError(error);
    }
  }
});
