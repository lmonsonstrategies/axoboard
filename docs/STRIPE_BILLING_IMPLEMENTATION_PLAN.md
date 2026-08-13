# AxoBoard Stripe billing implementation plan

## Implementation status — 2026-08-13

The sandbox code foundation is complete on `feat/stripe-sandbox-foundation`: Starter Checkout, raw-body signed/idempotent webhooks, customer portal, transactional subscription projection, replay/out-of-order protection, and cross-workspace tests. Remaining activation work is deployment, Railway sandbox variables, Stripe webhook registration, and one retained-QA-workspace sandbox purchase. Live-mode keys and the private owner entitlement remain deliberately deferred until sandbox release gates pass.

This is the shortest safe path from account creation to a paid AxoBoard workspace. The dashboard remains fail-closed until Stripe confirms an active subscription.

## Architecture

    Public pricing page
      → AxoBoard account
      → POST /api/billing/checkout-session
      → Stripe-hosted Checkout (subscription mode)
      → POST /api/billing/stripe/webhook
      → workspace subscription + entitlement
      → /app

    Workspace billing
      → POST /api/billing/portal-session
      → Stripe-hosted customer portal

Stripe is the billing authority. AxoBoard stores the minimum local projection needed for fast authorization and auditability: workspace ID, Stripe customer/subscription/price IDs, subscription status, period dates, cancellation state, and last processed event.

## Product catalog

Launch with one monthly product until the first connector and onboarding flow are proven:

- Product: AxoBoard Starter
- Price: $99 monthly
- Currency: USD
- Quantity: fixed at one workspace
- Access: only `active`; every other status denies product access until a written grace-period policy exists

Add annual, Growth, Scale, coupons, trials, usage billing, and sales-assisted contracts only after the Starter purchase, cancellation, failed-payment, and restore paths pass production tests.

### Private owner workspace

Leroy's AxoBoard workspace is comped without creating a public free tier:

- Product/price: internal `AxoBoard Owner`, $0 recurring, hidden from Checkout and public plan APIs.
- Assignment: manual admin-only action to Leroy's exact workspace ID; never selected from a browser-supplied price ID, email match, or generic owner role.
- Entitlement: uses the same signed Stripe webhook and local subscription projection as paid workspaces so production billing behavior is exercised continuously.
- Audit: record who assigned or removed the comped price and when.

Stripe Standard itself has no setup or monthly platform fee. AxoBoard pays the applicable payment-processing and Billing usage fees only when customer transactions occur. Do not enable optional paid Stripe products unless the launch requires them.

## Required server work

1. Install the official `stripe` Node SDK and pin a tested API version.
2. Add authenticated, same-origin `POST /api/billing/checkout-session`.
3. Accept a server-side plan key, never an arbitrary browser-supplied price ID.
   - Public allowlist: `starter_monthly` only at launch.
   - Internal allowlist: `owner_comped` only through an authenticated AxoBoard admin action scoped to Leroy's exact workspace ID.
4. Create or reuse the workspace Stripe customer and attach `workspace_id` as metadata.
5. Create a Checkout Session in `subscription` mode with an idempotency key tied to workspace + request.
6. Redirect to the Stripe-hosted URL. A success page may show progress, but it must never grant access by itself.
7. Add `POST /api/billing/stripe/webhook` before any JSON body parsing and verify `Stripe-Signature` against the raw request bytes.
8. Store every Stripe event ID in a unique webhook-events table before applying it; repeated deliveries become no-ops.
9. Reconcile these events into the workspace subscription projection:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
10. Add authenticated `POST /api/billing/portal-session` and send the customer to Stripe’s hosted portal.
11. Record every entitlement transition with old status, new status, source event, actor, and timestamp.

## Railway variables

Store these only as Railway service variables, separately for staging/sandbox and production/live mode:

    STRIPE_SECRET_KEY
    STRIPE_WEBHOOK_SECRET
    STRIPE_PRICE_STARTER_MONTHLY
    STRIPE_PRICE_OWNER_COMPED
    STRIPE_PORTAL_CONFIGURATION_ID
    APP_BASE_URL=https://axoboard.io

Do not put keys in Git, browser code, chat, screenshots, support bundles, build arguments, or application logs.

## Stripe owner setup

1. Create the AxoBoard business Stripe account and complete identity/bank verification.
2. Create a sandbox and the AxoBoard Starter product/price.
3. Configure Checkout branding, statement descriptor, support contact, terms, privacy, and refund/cancellation policy.
4. Configure the customer portal for invoices, payment methods, and cancellation. Keep plan switching off for the one-plan launch.
5. Register the sandbox webhook endpoint:

       https://axoboard.io/api/billing/stripe/webhook

6. Put sandbox secrets and the price ID into Railway variables without posting them in chat.
7. After all sandbox gates pass, repeat with separate live-mode keys, price, portal configuration, and webhook secret.

## Release gates

- Successful card purchase grants the correct workspace and no other workspace.
- Abandoned/expired Checkout grants nothing.
- Duplicate and out-of-order webhook deliveries are idempotent.
- Invalid signature and altered raw body return `400` without state changes.
- Payment failure, past due, cancellation, and deletion follow the approved access policy.
- Portal cancellation revokes access at the intended time.
- Re-subscription restores only the correct workspace.
- Mixed-status multi-workspace users cannot cross entitlements.
- No secret, token, customer data, or full Stripe payload appears in logs.
- Test clocks cover renewal, failed renewal, cancellation, and recovery.
- Production verification proves both denied and active cases using a dedicated synthetic account.

## Top failure detectors

1. **Webhook body parsed before verification** — signed sandbox event returns `400`; integration test asserts byte-for-byte raw-body verification.
2. **Success URL grants access** — directly opening the success URL must still show `pending_payment` until the verified event is processed.
3. **Status drift** — scheduled reconciliation compares local subscription state with Stripe and alerts on mismatches without silently granting access.
