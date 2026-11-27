import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp } from './helpers.ts';

describe('GET /v1/health', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.close());

  it('reports ok when the database answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', version: expect.any(String) });
  });

  it('reports 503 when the database is unreachable', async () => {
    const broken = await testApp({ DATABASE_URL: 'postgresql://afi:afi@127.0.0.1:1/afi' });
    try {
      const res = await broken.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'error', db: 'error' });
    } finally {
      await broken.close();
    }
  });
});

describe('GET /v1/config', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.close());

  it('returns seeded feature flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      featureFlags: { signup: false, myDistrict: false, articles: false, notifications: false },
      settings: {},
    });
  });
});

describe('errors and CORS', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp({ ALLOWED_ORIGINS: 'https://*.azurestaticapps.net' });
  });
  afterAll(() => app.close());

  it('uses the uniform error shape for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it.each([
    ['http://localhost:5173', true],
    ['https://zealous-ocean-0b965d11e-12.westus2.5.azurestaticapps.net', true],
    ['https://evil.example.com', false],
    ['https://azurestaticapps.net.evil.com', false],
  ])('origin %s allowed=%s', async (origin, allowed) => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/config',
      headers: { origin, 'access-control-request-method': 'GET' },
    });
    if (allowed) {
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } else {
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
