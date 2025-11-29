#!/usr/bin/env bun

/**
 * ask-ts: AI conversation management through markdown
 * 
 * This is the CLI entry point - orchestration only, no business logic
 */

import { parseArgs } from 'node:util';
import { exitWithError, requireFile } from './lib/errors.ts';
import { readSession, validateSession, SessionWriter, turnsToMessages } from './lib/session.ts';
import { findProfile, streamCompletion } from './lib/bedrock.ts';
import { DEFAULT_MODEL, isValidModel, getModelInfo } from './lib/models.ts';
import type { ModelType } from './types.ts';

const SESSION_PATH = 'session.md';

/**
 * Parse command line arguments
 */
function getCliArgs(): { model: ModelType } {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: {
        type: 'string',
        short: 'm',
        default: DEFAULT_MODEL
      }
    },
    strict: true,
    allowPositionals: false
  });

  const model = values.model || DEFAULT_MODEL;
  
  if (!isValidModel(model)) {
    exitWithError(
      new Error(`Invalid model: ${model}. Valid options: opus, sonnet, haiku`)
    );
  }

  return { model };
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const { model } = getCliArgs();
    
    // Verify session file exists
    await requireFile(SESSION_PATH, "Run 'ask init' to start");
    
    // Read and validate session
    const session = await readSession(SESSION_PATH);
    validateSession(session);
    
    // Find the appropriate inference profile
    console.log(`Discovering ${model} inference profile...`);
    const profile = await findProfile(model);
    console.log(`Model: ${profile.modelId}`);
    console.log();
    
    // Prepare messages for Bedrock
    const messages = turnsToMessages(session.turns);
    const modelInfo = getModelInfo(model);
    
    // Get next turn number
    const lastHumanTurn = session.turns[session.lastHumanTurnIndex]!;
    const nextTurnNumber = lastHumanTurn.number + 1;
    
    // Setup streaming
    const writer = await SessionWriter.begin(SESSION_PATH, nextTurnNumber);
    console.log('Streaming response... [ctrl+c to interrupt]');
    
    let lastTokenCount = 0;
    let interrupted = false;
    let totalTokens = 0;
    
    // Handle interruption
    const onInterrupt = () => {
      interrupted = true;
      process.stdout.write('\nInterrupting...\n');
    };
    process.on('SIGINT', onInterrupt);
    
    try {
      // Stream the completion
      for await (const event of streamCompletion(profile.arn, messages, modelInfo.maxTokens)) {
        if (interrupted) break;
        
        switch (event.type) {
          case 'chunk':
            await writer.write(event.text);
            
            // Update progress every 100 tokens or at start
            if (event.tokens - lastTokenCount >= 100 || event.tokens < 100) {
              process.stdout.write(`\rStreaming response... ${event.tokens} tokens [ctrl+c to interrupt]`);
              lastTokenCount = event.tokens;
            }
            break;
            
          case 'error':
            process.stdout.write('\r\x1b[K'); // Clear line
            throw event.error;
            
          case 'end':
            totalTokens = event.totalTokens;
            break;
        }
      }
      
      // Clean up
      await writer.end(interrupted);
      process.off('SIGINT', onInterrupt);
      
      // Final status
      process.stdout.write('\r\x1b[K'); // Clear line
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

// Execute if run directly
if (import.meta.main) {
  main();
}