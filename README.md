# Stapli

**Shopping that remembers.**

Stapli is a shared grocery-list PWA that learns what a household actually buys, how much it usually gets, when products tend to come round again, and which retailer-specific article the household prefers.

The product deliberately tracks **purchases rather than pantry inventory**. A completed shopping-list item becomes a purchase event; that history powers observed cadence, quantity learning, carry-over, and next-shop generation without asking people to maintain cupboard counts.

## First-base product

- Real Supabase email/password sign-up, sign-in, email confirmation and password reset
- Private households with invite-ready membership and row-level security
- Shared realtime shopping trips
- Exact retailer articles underneath household-level needs
- One-tap bought state with quick `− / +` actual-quantity correction
- Explicit outcomes for unavailable, still-have-some, and defer-to-next-shop
- Automatic carry-over of unresolved items
- `Auto`, `Manual`, and `Off` prediction modes
- Rolling 16-week observed cadence remains visible in every mode
- Recent quantity learning and routine-vs-one-off purchase context
- Tesco Clubcard ZIP/JSON import with a raw immutable-style import ledger
- Idempotent import/purchase identities so repeated exports reconcile rather than multiply history
- Mobile-first installable PWA shell

## Product model

Stapli separates four things that ordinary shopping-list apps tend to collapse:

```text
Household need
  ↓
Retailer-specific article
  ↓
Shopping trip item
  ↓
Purchase event
```

For example, **Semi-skimmed milk** is the household need. `Tesco British Semi-Skimmed Milk 4 Pints` can be the preferred Tesco article. Buying it on Tuesday is a purchase event. This lets Stapli understand that an Asda article can satisfy the same need without forgetting the product the household prefers at Tesco.

## Stack

- Next.js 16 App Router / PWA
- React 19
- Supabase Auth, Postgres, RLS and Realtime
- `@supabase/ssr` cookie-based sessions
- TypeScript
- JSZip for retailer ZIP imports

Dependencies are pinned to exact versions in `package.json`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and publishable key.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

```bash
cp .env.example .env.local
npm install
npm run dev
```

### Environment variables

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

No Supabase secret/service-role key belongs in the browser or in this repository.

## Quality commands

```bash
npm run typecheck
npm run lint
npm run build
```

The GitHub Actions workflow runs these checks on pushes and pull requests.

## Security model

Every household-owned table has RLS enabled. Household membership is checked server-side, and cross-household references are additionally constrained at the database relationship level. Public/anonymous roles do not receive application-table access. Authenticated RPCs use RLS unless a narrowly scoped security-definer function is required for household creation or invite acceptance.

## Current scope

Stapli is intentionally **not** a pantry/inventory tracker, recipe manager or nutrition product. Shopping is the focus. The next major layers are retailer recommendation/cross-store handling, richer exact-article management, and the authenticated ChatGPT app/plugin surface.
