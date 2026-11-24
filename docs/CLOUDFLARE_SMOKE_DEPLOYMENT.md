# Cloudflare Workers — isolated smoke deployment

This is deliberately NOT the production app. The existing Express backend and Firebase are untouched.
The worker has no production origin, database binding, credentials, or outbound network calls.

## Connect through Cloudflare dashboard
- Repository: Lazcakong-33/LAZCAKONGYM
- Branch: migration/zero-cost (do not use main)
- Worker name: lazcakong-gym-zero-cost-test
- Root directory: repository root
- Build command: leave empty (standalone smoke worker has no dependencies)
- Deploy command: npx wrangler deploy
- Plan: Workers Free; do not add paid bindings or services.
- Do not configure a production domain, Firebase credentials, Gemini credentials or OTA endpoint.

After successful deploy, open the new workers.dev address and /api/health. Expect mode isolated-preview and all access flags false. Other endpoints intentionally return 503. Do not redirect users to this Worker.

## Local tests
node --test scripts/zero-cost-cloudflare-smoke.test.mjs

## Remaining migration work
Port and validate Express routes, Firebase Admin and database plan compatibility, background tasks, notifications and OTA. Only use test accounts and isolated data until cutover gates in docs/ZERO_COST_MIGRATION.md pass. This smoke deployment alone does not reduce current Cloud Run costs or replace LAZCAKONG GYM.
