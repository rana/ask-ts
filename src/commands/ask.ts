import { defineCommand } from 'citty';
import { exitWithError, requireFile } from '../lib/errors.ts';
import { readSession, validateSession, SessionWriter, turnsToMessages } from '../lib/session.ts';
import { findProfile, streamCompletion } from '../lib/bedrock.ts';
import { isValidModel, getModelInfo } from '../lib/models.ts';
import { loadConfig } from '../lib/config.ts';

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
    }
  },
  async run({ args }) {
    try {
      // Load config
      const config = await loadConfig();
      
      // CLI overrides config
      const modelArg = args.model as string | undefined;
      const model = modelArg || config.model;
      
      if (!isValidModel(model)) {
        exitWithError(
          new Error(`Invalid model: ${model}. Valid options: opus, sonnet, haiku`)
        );
      }
      
      await requireFile(SESSION_PATH, "Run 'ask init' to start");
      
      const session = await readSession(SESSION_PATH);
      validateSession(session);
      
      const profile = await findProfile(model);
      console.log(`Model: ${profile.modelId}`);
      console.log();
      
      const messages = turnsToMessages(session.turns);
      const modelInfo = getModelInfo(model);
      
      // Use config maxTokens if set, otherwise model default
      const maxTokens = config.maxTokens || modelInfo.maxTokens;
      
      const lastHumanTurn = session.turns[session.lastHumanTurnIndex]!;
      const nextTurnNumber = lastHumanTurn.number + 1;
      
      const writer = await SessionWriter.begin(SESSION_PATH, nextTurnNumber);
      console.log('Streaming response... [ctrl+c to interrupt]');
      
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
                process.stdout.write(`\rStreaming response... ${event.tokens} tokens [ctrl+c to interrupt]`);
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
          console.log(`Response complete: ${totalTokens} tokens`);
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