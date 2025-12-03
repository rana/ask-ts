import { defineCommand } from 'citty';
import {
  ConfigSchema,
  ensureConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
  updateConfig,
} from '../lib/config.ts';
import { AskError, exitWithError } from '../lib/errors.ts';
import { isValidModel } from '../lib/models.ts';
import { output } from '../lib/output.ts';
import type { ModelType } from '../types.ts';

export default defineCommand({
  meta: {
    name: 'cfg',
    description: 'Manage ask configuration',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action to perform',
      required: false,
    },
    value: {
      type: 'positional',
      description: 'Value to set',
      required: false,
    },
  },
  async run({ args }) {
    try {
      const action = args.action as string | undefined;
      const value = args.value as string | undefined;

      if (!action) {
        await ensureConfig();

        const config = await loadConfig();
        const configPath = getConfigPath();

        output.info(output.dim(`Config: ${configPath}`));
        output.info('');

        output.field('model', config.model);
        output.field('temperature', String(config.temperature));

        if (config.maxTokens) {
          output.field('maxTokens', String(config.maxTokens));
        } else {
          output.fieldDim('maxTokens', '(AWS default)');
        }

        if (config.region) {
          output.field('region', config.region);
        } else {
          output.fieldDim('region', '(no preference)');
        }

        output.field('filter', config.filter ? 'on' : 'off');
        output.field('exclude', `${config.exclude.length} patterns`);

        return;
      }

      if (action === 'reset') {
        const defaults = ConfigSchema.parse({});
        await saveConfig(defaults);
        output.success('Reset to defaults');
        return;
      }

      if (!value) {
        throw new AskError(`Missing value for '${action}'`, `Usage: ask cfg ${action} <value>`);
      }

      switch (action) {
        case 'model': {
          if (!isValidModel(value)) {
            throw new AskError(`Invalid model: ${value}`, 'Valid options: opus, sonnet, haiku');
          }
          await updateConfig('model', value as ModelType);
          output.success(`Model set to ${value}`);
          break;
        }

        case 'temperature': {
          const temp = parseFloat(value);
          if (Number.isNaN(temp) || temp < 0 || temp > 1) {
            throw new AskError('Invalid temperature', 'Must be between 0.0 and 1.0');
          }
          await updateConfig('temperature', temp);
          output.success(`Temperature set to ${temp}`);
          break;
        }

        case 'tokens':
        case 'maxTokens': {
          const tokens = parseInt(value, 10);
          if (Number.isNaN(tokens) || tokens <= 0 || tokens > 200000) {
            throw new AskError('Invalid token count', 'Must be between 1 and 200000');
          }
          await updateConfig('maxTokens', tokens);
          output.success(`Max tokens set to ${tokens}`);
          break;
        }

        case 'region': {
          if (!/^[a-z]{2}-[a-z]+-\d+$/.test(value)) {
            throw new AskError('Invalid AWS region format', 'Example: us-west-2, eu-central-1');
          }
          await updateConfig('region', value);
          output.success(`Region preference set to ${value}`);
          break;
        }

        case 'filter': {
          const enable =
            value.toLowerCase() === 'on' ||
            value.toLowerCase() === 'true' ||
            value.toLowerCase() === 'yes';
          await updateConfig('filter', enable);
          output.success(`Content filtering ${enable ? 'enabled' : 'disabled'}`);
          break;
        }

        default:
          throw new AskError(
            `Unknown config field: ${action}`,
            'Valid fields: model, temperature, tokens, region, filter',
          );
      }
    } catch (error) {
      exitWithError(error);
    }
  },
});
