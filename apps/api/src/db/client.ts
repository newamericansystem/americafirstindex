import { createDb } from '@afi/db';

export type { Db } from '@afi/db';

export function createDbClient(databaseUrl: string) {
  return createDb(databaseUrl);
}
