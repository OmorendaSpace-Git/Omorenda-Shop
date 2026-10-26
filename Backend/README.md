# Omorenda Shopify Backend (`omorenda-shopify-be`)

Minimal Shopify + Stripe backend that:
- reads products from **Shopify Storefront API**
- creates **Stripe Checkout** sessions for Shopify variant GIDs
- consumes **Stripe webhooks** to persist the order in Postgres and create an order in **Shopify Admin API**

## Prerequisites
- Node.js + npm
- PostgreSQL (local)
- Shopify dev store + custom app credentials:
  - Storefront access token
  - Admin access token with `read_products` + `write_orders`
- Stripe test mode secret key
- Stripe CLI (recommended for local webhook forwarding)

## Setup

Install dependencies:

```bash
cd omorenda-shopify-be
npm i
```

Create `.env` from `.env.sample` (or `.env.example`):

```bash
cp .env.sample .env
```

Fill the required values in `.env`:
- **Database**: `DATABASE_URL`
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Shopify**: `SHOPIFY_SHOP`, `SHOPIFY_API_VERSION`, `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`
- **Frontend URL** (used as default success/cancel URLs): `FRONTEND_URL`

Generate Prisma client:

```bash
npm run prisma:generate
```

Run migrations (dev):

```bash
npm run prisma:migrate
```

Run the server:

```bash
npm run dev
```

Backend runs on `http://localhost:8001` by default.

## NFT mint worker (local dev)

In a separate terminal in `Backend`, run:

```bash
npm run worker
```

Leave this running alongside the backend, frontend, and Stripe listener. The
backend queues certificates after payment; the worker submits them to Sui.
A `PENDING` certificate with zero attempts usually means the worker is absent.

Each bowl serial can be minted only once in the configured Sui collection.
Resetting local orders or Shopify products does not reset the on-chain collection.
An already-minted serial needs reconciliation with the existing NFT and owner;
repeating the transaction cannot create another certificate. For a new test
collection, deploy and configure a fresh contract before making test purchases.

## Stripe webhook (local dev)

Your webhook endpoint is:
- `POST /webhooks/stripe` (full URL: `http://localhost:8001/webhooks/stripe`)

Because Stripe can’t reach `localhost` directly, use Stripe CLI forwarding:

```bash
npm run stripe:listen
```

This command uses the backend's `STRIPE_SECRET_KEY` for the CLI, so forwarding
uses the same test account as checkout even if `stripe login` selected another
account. It saves the matching listener signing secret to `Backend/.env`.
Restart the backend after the secret changes and leave the listener terminal open.
Use `npm run stripe:listen -- --setup-only` to update the secret without starting forwarding.
Starting the listener does not replay payments completed before it was running.

## API

Base path: `/api`

- **Health**
  - `GET /api/health`
- **Products**
  - `GET /api/products?limit=15&cursor=...`
  - Returns Shopify products + variants (including `availableForSale` and `quantityAvailable` when Shopify tracks inventory)
- **Auth**
  - `POST /api/auth/google/zklogin`
  - `POST /api/auth/refresh-token`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- **Checkout**
  - `POST /api/checkout/session`
- **Orders**
  - `GET /api/orders` (auth required)
  - `GET /api/orders/:id`
  - `POST /api/orders/:id/retry-shopify`
  - `POST /api/orders/:id/refund`

### `POST /api/checkout/session` request

```json
{
  "items": [
    { "variantGid": "gid://shopify/ProductVariant/123", "quantity": 2 }
  ],
  "successUrl": "http://localhost:3001/success?session_id={CHECKOUT_SESSION_ID}&email=customer@example.com",
  "cancelUrl": "http://localhost:3001/checkout"
}
```

## How order creation works (high level)
- Frontend calls `POST /api/checkout/session` → Stripe Checkout opens
- After payment, Stripe sends `checkout.session.completed` to `POST /webhooks/stripe`
- Backend:
  - prices items using Shopify Admin pricing
  - writes an `Order` + `OrderItem`s in Postgres
  - creates the Shopify order
  - if Shopify order creation fails, backend attempts a **Stripe refund** and marks the order `REFUNDED` (otherwise `SHOPIFY_FAILED`)

## Troubleshooting
- **Paid in Stripe but no Shopify order**
  - Almost always: Stripe webhook didn’t reach the backend.
  - Ensure `stripe listen --forward-to http://localhost:8001/webhooks/stripe` is running and `STRIPE_WEBHOOK_SECRET` matches.

## Security setup

Before deploying this version:

1. Apply the Prisma migration with `npx prisma migrate deploy`.
2. Configure distinct, strong `AUTH_ACCESS_TOKEN_SECRET` and `AUTH_REFRESH_TOKEN_SECRET` values.
3. Set `FRONTEND_URLS` to the exact comma-separated browser origins allowed to call the API.
   If the frontend and API are on different sites, also set `AUTH_COOKIE_SAME_SITE=none` and use HTTPS.
Existing browser sessions are intentionally invalidated by the typed-token upgrade and users will need to sign in again.

