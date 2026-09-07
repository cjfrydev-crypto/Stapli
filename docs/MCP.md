# Stapli MCP / ChatGPT app

Stapli exposes a remote, authenticated Model Context Protocol (MCP) endpoint so AI clients can use Stapli as a durable household shopping data layer.

## Production endpoints

- MCP: `https://stapli-gray.vercel.app/mcp`
- Protected resource metadata: `https://stapli-gray.vercel.app/.well-known/oauth-protected-resource/mcp`
- OAuth issuer: `https://dyacfwcpaahcubcwxrwh.supabase.co/auth/v1`
- OAuth consent UI: `https://stapli-gray.vercel.app/oauth/consent`

## Supabase OAuth setup

In Supabase Dashboard:

1. Authentication → OAuth Server → enable OAuth 2.1 server.
2. Authorization Path: `/oauth/consent`.
3. Enable Dynamic Client Registration for MCP clients during development/testing.
4. Authentication → URL Configuration → Site URL: `https://stapli-gray.vercel.app`.

Supabase issues the OAuth access token. Stapli validates the token with Supabase Auth, checks issuer/audience/expiry, then creates a Supabase client using that bearer token. Existing row-level security therefore remains the data authorization boundary.

## MCP tools

Read tools:

- `list_households`
- `get_current_list`
- `search_items`
- `get_purchase_history`
- `get_shopping_rules`

Write tools:

- `create_shopping_list`
- `add_to_list`
- `update_list_item`
- `remove_from_list`
- `save_shopping_rule`
- `remove_shopping_rule`

The design deliberately keeps planning/reasoning out of Stapli. AI clients should use these tools to read facts and persist user-requested changes while doing flexible reasoning themselves.

## Security model

- Every MCP request requires a Supabase OAuth bearer token.
- Tokens are server-validated with Supabase Auth before tools execute.
- Stapli additionally checks token issuer, `authenticated` audience and expiry.
- Database calls reuse the user's bearer token so household RLS continues to apply.
- OAuth consent is explicit and can be denied by the user.
- No service-role or Supabase secret key is used by the MCP server.
- Write tools are separately annotated from read-only tools for AI clients that surface action controls.

## ChatGPT development connection

Once Supabase OAuth is enabled, create a custom ChatGPT app in Developer Mode and use the MCP URL:

`https://stapli-gray.vercel.app/mcp`

The app should discover the resource metadata and Supabase OAuth server automatically. During development, Dynamic Client Registration allows ChatGPT to create its OAuth client registration without manually copying client credentials.

A public Plugin Directory submission is a later packaging/distribution step; the MCP-backed app can be tested privately first.
