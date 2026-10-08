# Supabase Auth setup for My Ef Zin

Members sign in without a password: an emailed link, or Google. Do these steps once per Supabase project (in the Supabase dashboard), before launch.

## Environment variables

| Variable | Where | Value |
|---|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` | Vercel (production and preview) | `https://www.efzinwellness.com`. **Required in production.** It is used for sign-in links, emails and Stripe return URLs, and the request's Host header is never trusted. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Project URL (Settings > API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | The anon (public) key |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel, server only | Used to create member accounts after payment. Never expose the service role key. |

## Authentication > Providers

1. **Email**: enabled, with **Confirm email ON**. **This is what makes linking by email safe.** A signed-in account is matched to an existing Ef Zin profile by email only when Supabase has confirmed the address (`email_confirmed_at`) and the provider is `email` or `google` (see `lib/auth/resolve.ts`). Supabase reports the provider `email` for password sign-ups as well as for email links, so the provider check alone cannot tell them apart. The confirmation step is what proves the person owns the address. Never turn "Confirm email" off.
2. **Avoid password sign-ups.** Members use email links only, and the site never offers a password. If your Supabase dashboard has a separate toggle for email + password sign-up, turn it off. Some versions have no separate toggle (email links and passwords share the Email provider). In that case, leaving "Confirm email" ON (step 1) is the safeguard.
3. **Google**: enable it and add the Google OAuth client ID and secret (Google Cloud console). In Google, add the Supabase callback URL that the provider page shows.

## Authentication > URL configuration

- **Site URL**: the production origin, the same as `NEXT_PUBLIC_SITE_ORIGIN`.
- **Redirect URLs** (allow list), for production and for each preview or local origin you use:
  - `<origin>/account/auth/callback` (Google)
  - `<origin>/account/auth/confirm` (email links)
  - `<origin>/account`

## Authentication > Email templates > Magic Link

Make the link point at the site's own confirm page (token-hash flow) rather than `{{ .ConfirmationURL }}`:

```html
<a href="{{ .SiteURL }}/account/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to My Ef Zin</a>
```

The confirm page asks the member to tap **Sign in**, and the server then verifies the token. Email link scanners therefore cannot use up the link, and no other site can sign someone in. Claim links sent after a booking use the same page; they are built by `lib/auth/provision.ts` with `type=magiclink`.
