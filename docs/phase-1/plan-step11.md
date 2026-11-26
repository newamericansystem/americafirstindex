# Phase 1 — Step 11: Admin Content — Articles, Notifications, Email Composer, Site Settings

## Goal

Complete the admin panel so staff can run the site without code changes:

1. **Articles**: write, schedule, and publish news posts with images; shareable links with correct social previews.
2. **Notifications**: site banners and "My District" notices, optionally targeted by state or district.
3. **Email composer**: targeted campaigns with preview, test sends, approval, scheduling, and stats.
4. **Site settings**: feature flags, homepage text, legal pages, email footer, reminder schedule, and other editable settings.

## Prerequisites

- Step 10 complete (email pipeline and suppression working).

## Part A — Shared building blocks

- **Markdown**: staff write Markdown. Render on the server with `marked`, then sanitize with `sanitize-html` (allow headings,
  paragraphs, lists, links with `rel="noopener"`, images from the media host only, blockquotes, emphasis, code, tables).
  Store both `bodyMarkdown` and the sanitized `bodyHtml` (re-rendered on every save). The web app renders `bodyHtml`
  with `dangerouslySetInnerHTML` only for this server-sanitized field.
- **Media library**: `POST /v1/admin/media` (Editor; multipart image) → media service (step 5) with prefix `uploads/{yyyy}/{mm}`;
  `media_assets` table (`id, path, url, width, height, alt, uploadedBy, createdAt`); `GET /v1/admin/media?cursor=`.
  Admin component `MediaPicker` (grid + upload) used by the article editor and settings.
- **Markdown editor component** (`apps/web/src/admin/components/MarkdownEditor.jsx`): textarea with a toolbar
  (bold, italic, heading, link, list, image-from-MediaPicker) and a live preview pane that calls
  `POST /v1/admin/render-markdown` so the preview matches the server sanitizer exactly.
- **Scheduled publishing job** `publishScheduled` (timer every 5 minutes): publishes articles and notifications whose
  `scheduledFor <= now()` and `status = 'draft'`, sets `publishedAt`, writes audit rows with `actorType: 'system'`.

## Part B — Articles

### Schema

```ts
export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),             // auto from title, editable, ^[a-z0-9-]{3,100}$
  title: text('title').notNull(),
  summary: text('summary'),                          // used for cards, meta description, og:description
  bodyMarkdown: text('body_markdown').notNull().default(''),
  bodyHtml: text('body_html').notNull().default(''),
  heroImagePath: text('hero_image_path'),
  heroImageAlt: text('hero_image_alt'),
  authorName: text('author_name'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  relatedDistKeys: text('related_dist_keys').array(), // lets "My District" show relevant articles
  seoTitle: text('seo_title'),
  status: contentStatus('status').notNull().default('draft'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: text('created_by'), updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
}, (t) => [index('articles_status_pub_idx').on(t.status, t.publishedAt)]);
```

Slugs are permanent once published: changing a published slug inserts the old slug into `article_redirects (old_slug PK, article_id)`.

### Routes

Admin (Editor): list/get/create/patch/publish/unpublish/archive, `POST /:id/schedule { scheduledFor }`, `POST /:id/preview-token`
(returns a signed 1-hour token so staff can view the draft at `/news/{slug}?preview=TOKEN`).

Public:
- `GET /v1/articles?tag=&distKey=&cursor=` — published, newest first, 12 per page (cards: slug, title, summary, hero, publishedAt, tags).
- `GET /v1/articles/:slug` — full article; follows `article_redirects` with a `301`-style `{ redirectTo }` response; supports `?preview=TOKEN`.
- `GET /share/news/:slug` (served by the API at `https://api.<DOMAIN>/share/news/:slug`, outside `/v1`) — returns a small HTML page with
  `<title>`, `meta description`, Open Graph (`og:title`, `og:description`, `og:image` = hero URL, `og:url` = this share URL,
  `og:type=article`) and Twitter card tags, plus `<meta http-equiv="refresh" content="0;url=https://<DOMAIN>/news/:slug">`
  and a visible link. Social crawlers read the tags; people are redirected. Cache 10 minutes.
- `GET /sitemap.xml` (API) — static routes + published articles. Add `apps/web/public/robots.txt` with
  `Sitemap: https://api.<DOMAIN>/sitemap.xml` and `Disallow: /admin`.
- `GET /feed.xml` (API) — RSS 2.0 of the latest 20 articles.

### Web

- `/news` — article cards grid with tag filter; `/news/:slug` — article page (hero, title, date, author, body, share buttons
  for X, Facebook, email, and copy-link that all use the `/share/news/:slug` URL). Set `document.title` and meta description client-side.
- `/my-district` shows up to 3 articles whose `relatedDistKeys` include the user's districts.
- Header nav gains "News" when the `articles` flag is on.

### Admin UI

"Articles" list (status filter, search by title), editor with title, slug, summary, hero image (MediaPicker), author, tags,
related districts (multi-select of district keys), Markdown body, SEO title, and actions Save draft / Preview / Schedule / Publish /
Unpublish / Archive. Show character counts for title (≤ 70) and summary (≤ 160).

## Part C — Notifications

### Schema

```ts
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  bodyMarkdown: text('body_markdown'),
  bodyHtml: text('body_html'),
  linkUrl: text('link_url'),
  linkLabel: text('link_label'),
  severity: text('severity').notNull().default('info'),     // 'info' | 'important' | 'urgent'
  placement: text('placement').notNull().default('banner'), // 'banner' | 'feed' | 'both'
  audience: jsonb('audience').notNull().default({}),         // same Audience JSON as campaigns (Part D); {} = everyone
  dismissible: boolean('dismissible').notNull().default(true),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  status: contentStatus('status').notNull().default('draft'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: text('created_by'), updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
});
```

### Routes and UI

- Admin (Editor): CRUD + publish/unpublish/archive/schedule. Button "Also send as email" creates a campaign draft (Part D)
  pre-filled with the notification's title, body, and audience, and opens it in the composer.
- Public: `GET /v1/notifications/active?state=&cdKey=` — published, within `startsAt..endsAt`. For signed-in users the server
  ignores query params and matches the audience against the user's stored districts. Anonymous visitors only see notifications
  with an empty audience unless they pass a state/cdKey (from DistrictFinder). Cache: anonymous 60 s; signed-in `private`.
- Web: `SiteBanner` component at the top of every page shows the highest-severity banner notification; dismissal saved in
  `localStorage` by id. `/my-district` renders `feed` notifications in a "Notices" list (fills the `notices` field from step 9).

## Part D — Email composer (campaigns)

### Audience JSON (shared by campaigns and notifications)

```json
{ "all": [
  { "field": "state",   "op": "in", "value": ["TX", "OK"] },
  { "field": "cdKey",   "op": "in", "value": ["TX-23"] },
  { "field": "createdAt", "op": "gte", "value": "2026-12-01" }
] }
```

- Clauses are ANDed; `in` values are ORed. Allowed fields (whitelist): `state`, `cdKey`, `slduKey`, `sldlKey`, `countyKey`,
  `createdAt` (`gte`/`lte`). `{}` or `{ "all": [] }` = everyone.
- Implement once in `packages/shared/src/audience.js` (zod schema + human-readable summary like "Texas or Oklahoma, in TX-23")
  and in the API as `compileAudience(audience) → SQL condition` using only parameterized values.
- Phase 2 will add fields like `organizationId`; the whitelist is the only place to extend.

### Schema

```ts
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),                    // internal
  subject: text('subject').notNull(),
  preheader: text('preheader'),
  bodyMarkdown: text('body_markdown').notNull(),
  bodyHtml: text('body_html').notNull(),
  prefCategory: text('pref_category').notNull(),   // 'newsletter' | 'actionAlerts' | 'electionReminders' — which preference must be on
  audience: jsonb('audience').notNull().default({}),
  status: text('status').notNull().default('draft'), // draft | pending_approval | scheduled | sending | sent | canceled
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  recipientCount: integer('recipient_count'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdBy: text('created_by'), updatedBy: text('updated_by'),
  createdAt: ..., updatedAt: ...,
});
```

Add the FK `email_messages.campaign_id → campaigns.id` in this step's migration.

Merge tags (escaped; unknown tags are a validation error): `{{firstName|there}}`, `{{stateName}}`, `{{districtName}}`, `{{repName}}`.

### Routes (Mailer; Admin passes)

| Route | Behavior |
|---|---|
| CRUD `/v1/admin/campaigns` | Editable only in `draft` |
| `POST /:id/audience-preview` | `{ count, sample: [masked emails ×10], summary }` (count excludes suppressed / opted-out users) |
| `POST /:id/test-send` | `{ emails: [...] }` (max 5, must be staff emails from a `email.testRecipients` setting or the requester's own email) — sends immediately with `[TEST]` subject prefix, using a sample recipient's merge data |
| `POST /:id/submit` | If setting `email.requireApproval` is true → `pending_approval`; else → `scheduled` (with `scheduledFor` or now) |
| `POST /:id/approve` | Different person than the creator (enforced) → `scheduled` |
| `POST /:id/reject` | Back to `draft` with a comment (stored in audit diff) |
| `POST /:id/cancel` | From `scheduled` or `sending` → `canceled`; `sendEmail` skips messages whose campaign is canceled |
| `GET /:id/stats` | Aggregates from `email_messages`: queued, sent, delivered, bounced, suppressed, skipped, failed; plus unsubscribes attributed to the campaign (record `campaignId` in the unsubscribe token for campaign emails — add an optional `k` field to the token payload) |

### Dispatch job

`dispatchCampaigns` (timer every minute): for campaigns `scheduled` with `scheduledFor <= now()`, set `sending` + `startedAt`
(use `UPDATE ... WHERE status='scheduled' RETURNING` to claim atomically), page through the compiled audience 1,000 users at a time
(keyset pagination on `users.id`), insert `email_messages` with `dedupeKey = campaign:{id}:{userId}`, enqueue, then set `recipientCount`,
`finishedAt`, and status `sent` (meaning "all enqueued"; delivery continues asynchronously).

### Admin UI

"Email → Campaigns": list with status and stats; composer with subject, preheader, preference category, Markdown body,
audience builder (state multi-select, district multi-select filtered by state, date filter) with live count, desktop/mobile preview
(iframe rendering the final HTML via `POST /:id/render`), test send, submit/approve/schedule/cancel actions, and a stats panel after sending.
Show a confirmation dialog with the recipient count before final submit.

## Part E — Site settings

- `packages/shared/src/settings.js`: a registry `{ key, label, description, schema (zod), isPublic, role }` for every setting:
  `feature_flags`, `home.hero` (`{ eyebrow, titleBefore, titleHighlight, intro }`), `page.terms`, `page.privacy`, `policies.versions`,
  `email.footer`, `email.requireApproval` (default `true` in prod), `email.testRecipients`, `reminders.schedule`,
  `reminders.sendHourLocal`, `states.voterInfoUrls`, `site.contactEmail`, `site.socialLinks`.
- Routes (Admin): `GET /v1/admin/settings`, `PUT /v1/admin/settings/:key` (validated against the registry schema; audited with full before/after).
- Admin UI "Settings": one card per setting with an editor generated from the schema type (toggle group for flags, text fields,
  Markdown editor for pages, JSON editor with validation for complex values such as `states.voterInfoUrls`).
- Web: replace the hard-coded "Where We're Fighting" title section in `EndorsedMap.jsx` with values from `home.hero`
  (keep the current text as the fallback default and seed it into the setting). Footer links (contact, social) from settings.

## Verification

- [ ] Tests: sanitizer strips scripts/event handlers/iframes and off-host images; slug uniqueness and redirects; scheduled publishing;
      share page meta tags and escaping; audience compiler (each field/op, injection attempts, empty audience); campaign state machine
      (approval by a different user, cancel mid-send); dispatch idempotency; stats aggregation; settings validation per key.
- [ ] Use Facebook Sharing Debugger and the X card validator (or `curl -A "facebookexternalhit/1.1"`) on a dev share URL to confirm the preview.
- [ ] Dev end-to-end: Editor publishes an article and a Texas-only banner; a Texas user sees the banner and an Oklahoma user doesn't;
      Mailer creates a campaign to TX-23, gets approval from a second admin, schedules it 5 minutes out, it sends, stats update,
      one recipient unsubscribes and the campaign stats show it.
- [ ] Changing `home.hero` in Settings updates the map page text within the config cache window (30 s) without a deploy.

## Acceptance criteria

- [ ] Articles, notifications, campaigns, and settings are fully managed from the admin panel with roles, audit, drafts, and scheduling.
- [ ] Shared article links show correct titles and images on social platforms.
- [ ] Campaigns respect preferences, suppressions, approval rules, and include unsubscribe and footer requirements.
- [ ] No editorial text remains hard-coded in the web app except fallbacks.

## Rollback

All features are additive and flag-gated (`articles`, `notifications`). Campaign sending can be stopped by canceling campaigns or
disabling `dispatchCampaigns` with an app setting (`AzureWebJobs.dispatchCampaigns.Disabled=true`).
