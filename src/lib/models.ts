import type { ModelType } from '../types.ts';

export function isValidModel(value: unknown): value is ModelType {
  return (
    typeof value === 'string' &&
    (value === 'opus' || value === 'sonnet' || value === 'haiku')
  );
}
