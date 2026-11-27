import fp from 'fastify-plugin';
import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import type { Config } from '../config.ts';

/**
 * Dev serves PR previews from *.azurestaticapps.net, which is cross-site to the API, so dev cookies
 * must be SameSite=None. Prod and local stay Lax.
 */
export function sessionCookieOptions(config: Pick<Config, 'APP_ENV'>): CookieSerializeOptions {
  const crossSite = config.APP_ENV === 'dev';
  return {
    httpOnly: true,
    path: '/',
    signed: true,
    secure: config.APP_ENV !== 'local',
    sameSite: crossSite ? 'none' : 'lax',
  };
}

export default fp<{ config: Config }>(async (app, { config }) => {
  await app.register(cookie, { secret: config.SESSION_SECRET });
});
