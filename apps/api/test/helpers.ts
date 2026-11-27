import { inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';

export function testConfig(overrides: Partial<Record<keyof Config, string>> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: inject('databaseUrl'),
    SESSION_SECRET: 'x'.repeat(64),
    PUBLIC_WEB_ORIGIN: 'http://localhost:5173',
    ...overrides,
  });
}

export function testApp(overrides: Parameters<typeof testConfig>[0] = {}) {
  return buildApp({ config: testConfig(overrides), logger: false });
}
