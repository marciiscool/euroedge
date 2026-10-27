import { pino, type Logger, type LevelWithSilent } from 'pino';

/** Keys whose values must never reach logs. */
const REDACT = [
  '*.privateKey',
  '*.PRIVATE_KEY',
  '*.password',
  '*.secret',
  '*.apiKey',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export function createLogger(service: string, level: LevelWithSilent = 'info'): Logger {
  return pino({
    level,
    base: { service },
    redact: { paths: REDACT, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
