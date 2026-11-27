import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations, sourceMigrationsFolder } from '@afi/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('afi')
      .withUsername('afi')
      .withPassword('afi')
      .start();
    url = container.getConnectionUri();
  }
  await runMigrations(url, sourceMigrationsFolder);
  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}
