# Testing payments

Stripe stays in **test mode**. Use the test secret key (`sk_test_...`) and a test-mode webhook secret. Never use a live key against this app.

Set these in the repo-root `.env` (the web app reads them through `web/.env.local`):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test secret key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from `stripe listen` or the webhook endpoint |
| `STRIPE_PRICE_PRO` | Pro price id. Checkout adds a 14-day trial. |
| `STRIPE_PRICE_FOUNDING` | Founding price id. No trial. Capped at 25 active memberships. |
| `STRIPE_PRICE_TEAM` | Team price id. 5 seats, owner plus members. |
| `STRIPE_PRICE_REPORT` | One-off area and property reports. Or set `STRIPE_PRICE_AREA_REPORT` and `STRIPE_PRICE_PROPERTY_REPORT` separately. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | So the webhook can write subscriptions and entitlements |
| `APP_BASE_URL` | Success and cancel URLs, for example `http://localhost:3000` |

Do **not** set `EMRIS_TEST_ACCESS` in any deployed environment. That flag lets a request header choose the viewer, and it is only for the automated API tests.

Cards, any future expiry, any CVC, any postal code:

| Card | What it does |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 0341` | The card attaches to a customer, then later charges fail |

Access after each step is the column in `docs/PLAN.md`. Pro, founding, and team (owner or member) share the Pro column. A one-off buyer gets only the purchased report. A failed payment keeps the Pro column for 7 days from `payment_failed_at`, then drops to the free-account column. The purchased report is not revoked.

Forward webhooks while you click through:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Put the printed `whsec_...` in `STRIPE_WEBHOOK_SECRET` and restart the app.

## 1. Pro trial

1. Sign in with a magic link.
2. Start Pro checkout (`POST /api/checkout` with `{ "plan": "pro" }`).
3. Pay with `4242 4242 4242 4242`.
4. Stripe sends `checkout.session.completed` with `payment_status: no_payment_required`.
5. Confirm the subscription status is `trialing` and `GET /api/me` reports `plan: "pro"` and `paid: true`.
6. Search, export, rehab names, alerts, and any report all succeed. The trial lasts 14 days.

## 2. One-off report

1. Sign in as a free account.
2. Start checkout with `{ "report_type": "area", "target_id": "<11-digit tract id>" }`.
3. Pay with `4242 4242 4242 4242`.
4. The webhook writes one `entitlements` row. A second delivery of the same event does not write a second row.
5. That tract's report, memo, rehab list, and export succeed.
6. A different tract still returns the free preview: rehab count plus the first row, memo first section only, export `402`.
7. Alerts return `402`. Search is unlimited.
8. Checkout for the same target returns `409`.

## 3. Founding cap

1. As a free account, start `{ "plan": "founding" }` and pay with `4242 4242 4242 4242`.
2. Confirm `plan: "founding"` and the Pro column (search, export, rehab names, alerts, every report).
3. Repeat until 25 founding subscriptions are `trialing`, `active`, `past_due`, or `unpaid`.
4. The next founding checkout returns `409` with `code: "founding_cap"`.
5. Pro and team checkout still start. A canceled founding subscription no longer counts toward the cap.

## 4. Team seats

1. Start `{ "plan": "team" }` and pay with `4242 4242 4242 4242`.
2. The buyer is the owner and has the Pro column.
3. `POST /api/team/invite` with `{ "email": "teammate@example.com" }` succeeds while fewer than 5 seats are filled (the owner counts as one).
4. The invited member, once on the team, has the same Pro column as the owner.
5. A member calling invite gets `402`. The owner at 5 seats gets `409` with `code: "seat_cap"`.

## 5. Cancellation

1. On a Pro, founding, or team subscription, cancel at period end in the Stripe test dashboard (or `cancel_at_period_end`).
2. While the status is still `active` or `trialing`, access stays on the Pro column through `current_period_end`.
3. When Stripe sends `customer.subscription.deleted`, access drops to the free-account column: 3 searches in 7 days, 1 alert, rehab preview, no export.
4. An entitlement bought earlier still opens that one report.

## 6. Failed payment

1. Create a customer in the Stripe test dashboard and attach `4000 0000 0000 0341`. Attaching succeeds.
2. Make that card the default payment method on a subscription that is about to be charged (end the trial, or create the subscription with no trial).
3. The invoice charge fails. Stripe sends `invoice.payment_failed`. The app sets `status` to `past_due` and stores `payment_failed_at` on the first failure. Later retries do not move that timestamp.
4. For 7 days after `payment_failed_at`, `GET /api/me` still reports the paid plan (`pro`, `founding`, or `team`) and the Pro column works.
5. After those 7 days, the plan is `past_due` and access matches a free account: 3 searches, 1 alert, rehab count plus the first row, memo preview, no export.
6. Paying the open invoice with `4242 4242 4242 4242` clears the failure and restores the Pro column.

`4242 4242 4242 4242` is the card to use whenever a charge should succeed. `4000 0000 0000 0341` is only for the failure in this section.
