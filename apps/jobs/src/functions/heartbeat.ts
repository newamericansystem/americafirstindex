import { app, type InvocationContext, type Timer } from '@azure/functions';
import { sql } from 'drizzle-orm';
import { getDb } from '../lib/db.ts';

export async function heartbeat(_timer: Timer, context: InvocationContext): Promise<void> {
  context.log('jobs alive');
  try {
    await getDb().execute(sql`SELECT 1`);
    context.log('heartbeat: database ok');
  } catch (err) {
    context.error('heartbeat: database check failed', err);
    throw err;
  }
}

app.timer('heartbeat', {
  schedule: '0 0 6 * * *',
  handler: heartbeat,
});
