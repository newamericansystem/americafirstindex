import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { Config } from '../config.ts';

/** Exact origins plus `https://*.example.net`-style patterns that match any single leading host label. */
export function createOriginMatcher(config: Pick<Config, 'PUBLIC_WEB_ORIGIN' | 'ALLOWED_ORIGINS'>) {
  const entries = [config.PUBLIC_WEB_ORIGIN, ...config.ALLOWED_ORIGINS.split(',')]
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const exact = new Set(entries.filter((e) => !e.includes('*')));
  const patterns = entries
    .filter((e) => e.includes('*'))
    .map((e) => {
      const m = /^(https?):\/\/\*\.(.+)$/.exec(e);
      if (!m) throw new Error(`Unsupported ALLOWED_ORIGINS pattern: ${e}`);
      const [, scheme, rest] = m;
      return new RegExp(`^${scheme}://[a-z0-9-]+(\\.[a-z0-9-]+)*\\.${rest!.replace(/[.]/g, '\\.')}$`, 'i');
    });
  return (origin: string) => exact.has(origin) || patterns.some((p) => p.test(origin));
}

export default fp<{ config: Config }>(async (app, { config }) => {
  const isAllowed = createOriginMatcher(config);
  await app.register(cors, {
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-afi-csrf'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
    origin: (origin, cb) => cb(null, !origin || isAllowed(origin)),
  });
});
