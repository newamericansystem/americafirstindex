import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(), // e.g. 'feature_flags', 'home.hero'
  value: jsonb('value').notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
