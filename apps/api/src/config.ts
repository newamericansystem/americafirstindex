import { z } from 'zod';

// App Service sets unconfigured settings to '' (e.g. ENTRA_TENANT_ID); treat that as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_WEB_ORIGIN: z.string().url(),
  ALLOWED_ORIGINS: z.string().default(''), // comma-separated; supports one leading-wildcard host pattern
  CONGRESS_API_KEY: optional(z.string()), // required from step 4
  AZURE_MAPS_KEY: optional(z.string()), // required from step 7
  ACS_CONNECTION_STRING: optional(z.string()), // required from step 10 in dev/prod
  MAIL_FROM: optional(z.string()),
  SMTP_URL: optional(z.string().url()), // local only (Mailpit)
  STORAGE_ACCOUNT_NAME: optional(z.string()),
  AZURE_STORAGE_CONNECTION_STRING: optional(z.string()), // local only (Azurite)
  MEDIA_BASE_URL: optional(z.string().url()),
  ENTRA_TENANT_ID: optional(z.string()),
  ENTRA_ADMIN_API_CLIENT_ID: optional(z.string()),
  APPLICATIONINSIGHTS_CONNECTION_STRING: optional(z.string()),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
