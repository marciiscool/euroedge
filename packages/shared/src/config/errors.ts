import type { z } from 'zod';

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`invalid configuration (${source}):\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }

  static fromZod(source: string, error: z.ZodError): ConfigError {
    return new ConfigError(
      source,
      error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`),
    );
  }
}
