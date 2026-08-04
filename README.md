# JUSTGO

JUSTGO Liberia is a multi-service platform connecting customers, drivers, restaurants, home-food vendors, and stores for delivery, transportation, food, grocery, pharmacy, and package delivery. It features secure accounts, mobile-money payment options, reviews, and administrative controls.

## Project structure

```text
package.json
app/                 # Application UI and API server
  src/               # React client
  server/            # Express API
database/            # Prisma schema, migrations, seed
integrations/        # Orange SMS, MTN MoMo, Orange Money placeholders
README.md
```

## Quick start

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- App: http://localhost:3000
- API: http://localhost:4000

## Demo accounts

| Role | Phone | Password |
|------|-------|----------|
| Admin | `+231770000001` | `Password123!` |
| Customer | `+231770000002` | `Password123!` |
| Driver | `+231770000003` | `Password123!` |
| Merchant | `+231770000004` | `Password123!` |

## Notes

- Cash payments are not supported.
- MTN MoMo and Orange Money are listed as supported methods; live settlement is not configured.
- Orange SMS is a placeholder until production credentials and a secure client are wired.
- Secrets belong in `.env` (see `.env.example`). Never commit `.env`, `.env.local`, or `.env.production`.

## Deploy (Vercel)

Frontend static hosting is configured via `vercel.json` for https://justgo.vercel.app.

The Express API and SQLite database are for local/`npm run dev` use. Production API hosting needs a persistent database (for example PostgreSQL) and a separate or serverless API deployment — not included in the static Vercel frontend build.
