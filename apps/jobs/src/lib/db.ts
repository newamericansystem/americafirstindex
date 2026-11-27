import { createDb, type Db } from '@afi/db';

let client: { db: Db } | undefined;

/** One pool per worker process; Flex Consumption reuses instances across invocations. */
export function getDb(): Db {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = createDb(url, { max: 5 });
  }
  return client.db;
}
