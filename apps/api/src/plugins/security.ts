import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { HttpError } from '../lib/http-errors.ts';

export default fp(async (app) => {
  await app.register(helmet);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(ctx.statusCode, 'rate_limited', `Too many requests; retry in ${ctx.after}`),
  });
});
