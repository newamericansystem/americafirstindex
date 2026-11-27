import './telemetry.ts';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
