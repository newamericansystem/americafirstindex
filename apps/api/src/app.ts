import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { createDbClient, type Db } from './db/client.ts';
import corsPlugin from './plugins/cors.ts';
import securityPlugin from './plugins/security.ts';
import cookiesPlugin from './plugins/cookies.ts';
import errorsPlugin from './plugins/errors.ts';
import healthRoutes from './routes/health.ts';
import configRoutes from './routes/config.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
}

export type BuildAppOptions = {
  config: Config;
  logger?: boolean;
};

export async function buildApp({ config, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    logger: logger && {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'email', '*.email', '*.*.email'],
        censor: '[redacted]',
      },
    },
  });

  const { pool, db } = createDbClient(config.DATABASE_URL);
  app.decorate('config', config);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(corsPlugin, { config });
  await app.register(cookiesPlugin, { config });

  await app.register(healthRoutes);
  await app.register(configRoutes);

  return app;
}
