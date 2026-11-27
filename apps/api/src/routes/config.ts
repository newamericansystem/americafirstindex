import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { siteSettings } from '@afi/db';

const CACHE_MS = 30_000;

type PublicConfig = { featureFlags: Record<string, unknown>; settings: Record<string, unknown> };

const config: FastifyPluginAsync = async (app) => {
  let cached: { value: PublicConfig; expires: number } | null = null;

  app.get('/v1/config', async () => {
    if (cached && cached.expires > Date.now()) return cached.value;

    const rows = await app.db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.isPublic, true));

    const value: PublicConfig = { featureFlags: {}, settings: {} };
    for (const row of rows) {
      if (row.key === 'feature_flags') value.featureFlags = row.value as Record<string, unknown>;
      else value.settings[row.key] = row.value;
    }
    cached = { value, expires: Date.now() + CACHE_MS };
    return value;
  });
};

export default config;
