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

1. **Email**: enabled, with **Confirm email ON**.
2. **Turn email + password sign-up off.** Members use email links only. An account can be linked to an existing Ef Zin profile by email only when it signed in with an email link or Google (see `lib/auth/resolve.ts`).
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
