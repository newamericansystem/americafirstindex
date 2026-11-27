import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http-errors.ts';

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export default fp(async (app) => {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` } } satisfies ErrorBody);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'Invalid request', details: err.issues },
      } satisfies ErrorBody);
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      } satisfies ErrorBody);
    }
    const e = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (e.validation) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: e.message ?? 'Invalid request', details: e.validation },
      } satisfies ErrorBody);
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({
        error: { code: 'bad_request', message: e.message ?? 'Bad request' },
      } satisfies ErrorBody);
    }
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'internal_error', message: `Internal error (request ${req.id})` },
    } satisfies ErrorBody);
  });
});
