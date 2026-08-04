# JUSTGO

JUSTGO Liberia is a multi-service platform connecting customers, drivers, restaurants, home-food vendors, and stores for delivery, transportation, food, grocery, pharmacy, and package delivery. It features secure accounts, mobile-money payment options, reviews, and administrative controls.

## Stack

Standard **Next.js** (App Router) application, deployable on **Vercel**.

```text
package.json
next.config.ts
app/                 # Next.js App Router (UI pages + API route handlers)
  src/               # React client components and styles
  server/            # Shared server libs (Prisma, session, domain logic)
  api/               # Next.js Route Handlers
database/            # Prisma schema, migrations, seed
integrations/        # Orange SMS, MTN MoMo, Orange Money placeholders
public/              # Static assets
README.md
```

## Quick start

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- App + API: http://localhost:3000

## Demo accounts

| Role | Phone | Password |
|------|-------|----------|
| Admin | `+231770000001` | `Password123!` |
| Customer | `+231770000002` | `Password123!` |
| Driver | `+231770000003` | `Password123!` |
| Merchant | `+231770000004` | `Password123!` |

## Admin temporary development guard

ChatGPT / Sites operator authentication is **not** used.

Admin UI and `/api/admin/*` require an authenticated `ADMIN` session. In **production** (`NODE_ENV=production`), Admin APIs additionally require a temporary development guard:

1. Set `ADMIN_DEV_GUARD_SECRET` in the environment (never commit the real value).
2. Send the same value as the `x-justgo-admin-guard` request header.

Without `ADMIN_DEV_GUARD_SECRET` configured in production, Admin APIs remain locked. In local development, the extra guard is open so you can use the seeded Admin account.

Do **not** treat this guard as production operator authentication. Replace it with a proper operator auth system before exposing Admin beyond trusted environments.

Optional client helper: store the secret in `sessionStorage` under `justgo_admin_guard` so the shared `api()` helper attaches the header.

## Notes

- Cash payments are not supported.
- MTN MoMo and Orange Money are listed as supported methods; live settlement is not configured.
- Orange SMS is a placeholder until production credentials and a secure client are wired.
- Secrets belong in `.env` / `.env.local` (see `.env.example`). Never commit secrets.
- This app does not depend on `.openai/hosting.json` or ChatGPT Sites deployment configuration.

## Deploy (Hostinger / Node)

Production site origin: set via environment (do not hard-code in source):

- `APP_URL=https://justgolib.com`
- `NEXT_PUBLIC_APP_URL=https://justgolib.com`
- Optional alias: `CLIENT_ORIGIN=https://justgolib.com`

Also set at least:

- `DATABASE_URL` / `DIRECT_URL` (Supabase PostgreSQL pooled + direct URIs)
- `SESSION_SECRET`
- `ADMIN_DEV_GUARD_SECRET` (required for Admin APIs in production)
- `NODE_ENV=production`

Suggested Hostinger commands:

- Install: `npm install`
- Build: `npx prisma generate && npx prisma migrate deploy && npm run build`
- Start: `npm start`

Local docs only: http://localhost:3000 — never use localhost as a production URL fallback.
