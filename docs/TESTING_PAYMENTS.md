# Testing Emris payments

Stripe stays in **test mode**. Use a test secret key (`sk_test_...`) and a test webhook secret. Never use a live key against local checkout.

## Setup

1. Apply `db/migrations/003_billing.sql` in Supabase.
2. Put these in `.env` (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test secret key |
| `STRIPE_WEBHOOK_SECRET` | From `stripe listen` or a Dashboard webhook |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Auth + service writes |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook and billing updates |
| `APP_BASE_URL` | Success/cancel and invite links, e.g. `http://localhost:3000` |

3. Create catalog prices from `lib/pricing.ts`:

```bash
npm run stripe:setup
```

That writes Stripe price ids into `lib/pricing.ts`. Commit them after a successful test-mode run.

4. Forward webhooks:

```bash
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
  --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.

## Cards

| Card | What it does |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 0341` | Attaches, then later charges fail |

Any future expiry, any CVC.

## Smoke path

1. Sign in, open `/pricing`, start Pro (7-day trial).
2. Pay with `4242…`. Land on `/account/billing?checkout=success`.
3. Confirm webhook `200` and plan shows Pro / Trial.
4. `GET /api/near` no longer hits the free search cap.
5. Cancel in the Customer Portal; access stays through period end, then Free.
6. Team: checkout Team (3 seats), invite a teammate from `/account/team`.
7. One-off: `POST /api/checkout` with `{ "report_type": "area", "target_id": "<11-digit tract>" }`.

## Offline unit tests

```bash
npm test
```

These cover checkout body validation, founding cap, grace period, and invite expiry without calling Stripe.
