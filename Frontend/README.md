# Omorenda Shopify Frontend (`omorenda-shopify-fe`)

Minimal storefront UI (React + Vite) that talks to `omorenda-shopify-be`.

## What you get
- Product listing + product detail pages (Shopify data via backend)
- Pagination: 15 products per page (`/?page=2`, `/?page=3`, ...)
- Inventory-aware UI (`In stock` / `Sold out`) and quantity limits
- Local cart (localStorage)
- Checkout page that creates a Stripe Checkout session (via backend)
- Google-only authentication (cookies + refresh flow) with a sign-in gate at checkout
- Post-checkout:
  - `/success` polls orders by Stripe session id
  - `/orders` shows order history (auth required)

## Prerequisites
- Node.js + npm
- Backend running: `omorenda-shopify-be` (default `http://localhost:8001`)

## Setup

Install dependencies:

```bash
cd omorenda-shopify-fe
npm i
```

Create `.env.local` (or use `.env`) from `.env.example`:

```bash
cp .env.example .env.local
```

Set:
- `VITE_API_BASE_URL=http://localhost:8001/api`
- Optional: `VITE_SUI_GRPC_URL` for a custom Sui gRPC endpoint. Google sign-in uses the public Sui full node for the configured network by default.

Or copy `.env.sample`:

```bash
cp .env.sample .env.local
```

Run dev server:

```bash
npm run dev
```

Vite will run on `http://localhost:3001` (if that port is free).

## Pages / routes
- `/` shop (`?page=N` for pagination)
- `/products/:handle` product detail
- `/login` login / signup
- `/checkout` cart + checkout
- `/success?session_id=...&email=...` post-checkout status
- `/orders` order history (requires login)

## How checkout works
1. Add products to cart or click **Buy Now**
2. Go to `/checkout` and click **Checkout**
3. If not logged in, you’ll be prompted to **Continue with Google** (AuthGate)
4. Frontend calls `POST {VITE_API_BASE_URL}/checkout/session` (cookies included)
3. Browser redirects to Stripe Checkout
4. Stripe sends `checkout.session.completed` webhook to the backend
5. Backend creates the Shopify order + DB order
6. `/success` page polls `/api/orders` to show the status

## Project structure (Shopify-style pages/components split)
- `src/pages/`: routed pages (`ShopPage`, `ProductPage`, `CheckoutPage`, `OrdersPage`, `SuccessPage`, `LoginPage`)
- `src/components/`: shared UI (`SiteHeader`, `AccountMenu`, `AuthGate`, etc.)
- `src/shop/`: Shopify product fetch/types (`shop/products.ts`)
- `src/api/`: API client wrappers
- `src/cart/`: cart state + storage

## Troubleshooting
- **Paid in Stripe but nothing happens / no Shopify order**
  - Ensure Stripe webhook forwarding is running in backend:
    - `stripe listen --forward-to http://localhost:8001/webhooks/stripe`
