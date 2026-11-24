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

## Separate web app preview

The app preview uses a separate Worker named `lazcakong-gym-app-preview`.
Its static files serve the web app and the Worker returns the existing isolated
health response. The daily calorie report runs without external services.
The preview also supports email/password session initialization with Firebase
Authentication and rate-limited Workers AI for open Coach questions. Other
application API routes return 503 until ported.

1. Create a separate Firebase test project and register a web app. Configure only synthetic users and data.
2. Set `VITE_PREVIEW_FIREBASE_CONFIG` to the Firebase web SDK configuration JSON in the build environment or in an ignored `.env.cloudflare-preview.local` file.
3. Run `npm ci` and `npm run build -- --mode cloudflare-preview`.
4. Deploy from the repository root with `npx wrangler deploy --config wrangler.app-preview.jsonc` on Workers Free.

The build requires an isolated Firebase web configuration and includes the local
Coach by default. It writes to `dist-app-preview`. Existing production and native
builds keep using their default build directory. The app preview must be used
only for test data and does not replace the Express server.

### Preview training synchronization

Apply `firestore.preview.rules` only to the `(default)` database of the
`lazcakong-zero-cost-test` Firebase project. The preview client can store its
synthetic profile and training data under `athletes/{firebaseUid}` without
sharing it across accounts. Production rules are managed separately.

Run the isolated synchronization check with:
`npx firebase-tools emulators:exec --only firestore --project demo-lazcakong-preview-sync 'node scripts/check-preview-sync.mjs'`
