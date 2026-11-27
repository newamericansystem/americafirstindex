import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';

const version = process.env.GIT_SHA ?? 'local';

const health: FastifyPluginAsync = async (app) => {
  app.get('/v1/health', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      await app.db.execute(sql`SELECT 1`);
      return { status: 'ok', db: 'ok', version };
    } catch (err) {
      req.log.error({ err }, 'health check: database unreachable');
      return reply.code(503).send({ status: 'error', db: 'error', version });
    }
  });
};

export default health;
