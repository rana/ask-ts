import { defineCommand } from 'citty';
import { exitWithError, AskError } from '../lib/errors.ts';
import { loadConfig, saveConfig, updateConfig, getConfigPath, ConfigSchema } from '../lib/config.ts';
import { isValidModel } from '../lib/models.ts';
import chalk from 'chalk';
import type { ModelType } from '../types.ts';

export default defineCommand({
  meta: {
    name: 'cfg',
    description: 'Manage ask configuration'
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action to perform',
      required: false
    },
    value: {
      type: 'positional',
      description: 'Value to set',
      required: false
    }
  },
  async run({ args }) {
    try {
      const action = args.action as string | undefined;
      const value = args.value as string | undefined;
      
      // No args = show current config
      if (!action) {
        const config = await loadConfig();
        const configPath = getConfigPath();
        
        console.log(chalk.dim(`Config: ${configPath}\n`));
        console.log(chalk.cyan('model:') + `       ${config.model}`);
        console.log(chalk.cyan('temperature:') + ` ${config.temperature}`);
        
        if (config.maxTokens) {
          console.log(chalk.cyan('maxTokens:') + `   ${config.maxTokens}`);
        } else {
          console.log(chalk.cyan('maxTokens:') + `   ${chalk.dim('(AWS default)')}`);
        }
        
        return;
      }
      
      // Reset command
      if (action === 'reset') {
        const defaults = ConfigSchema.parse({});
        await saveConfig(defaults);
        console.log(chalk.green('✓') + ' Reset to defaults');
        return;
      }
      
      // Field updates
      if (!value) {
        throw new AskError(
          `Missing value for '${action}'`,
          `Usage: ask cfg ${action} <value>`
        );
      }
      
      switch (action) {
        case 'model': {
          if (!isValidModel(value)) {
            throw new AskError(
              `Invalid model: ${value}`,
              'Valid options: opus, sonnet, haiku'
            );
          }
          await updateConfig('model', value as ModelType);
          console.log(chalk.green('✓') + ` Model set to ${value}`);
          break;
        }
        
        case 'temperature': {
          const temp = parseFloat(value);
          if (isNaN(temp) || temp < 0 || temp > 1) {
            throw new AskError(
              'Invalid temperature',
              'Must be between 0.0 and 1.0'
            );
          }
          await updateConfig('temperature', temp);
          console.log(chalk.green('✓') + ` Temperature set to ${temp}`);
          break;
        }
        
        case 'tokens':
        case 'maxTokens': {
          const tokens = parseInt(value, 10);
          if (isNaN(tokens) || tokens <= 0 || tokens > 200000) {
            throw new AskError(
              'Invalid token count',
              'Must be between 1 and 200000'
            );
          }
          await updateConfig('maxTokens', tokens);
          console.log(chalk.green('✓') + ` Max tokens set to ${tokens}`);
          break;
        }
        
        default:
          throw new AskError(
            `Unknown config field: ${action}`,
            'Valid fields: model, temperature, tokens'
          );
      }
      
    } catch (error) {
      exitWithError(error);
    }
  }
});