/**
 * LAZCAKONG GYM v7.0.5 — Functional & Security Verification Suite for Invitation Generator
 *
 * Verifies:
 * 1. Live published Firestore Rules on forward-cortex-1ds98 / ai-studio-lazcakongym-dedcb625-f047-4947-ace1-3fbed6d67760
 * 2. Master Admin verification (Google-verified email allowlist, case-insensitive) & strict rejection of athletes/spoofed tokens
 * 3. Single invite creation, QR links (Android/iPhone/APK/PWA), batch of 50 unique codes, listing existing invites, revocation
 * 4. Real end-to-end single-use verification & atomic consumption (register + redeem) and strict 409 rejection on reuse
 * 5. Zero deletion of pre-existing invites/athletes and v7.0.5 OTA compatibility (native versionCode 70000 preserved)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  handleAdminListInvites,
  handleAdminCreateInvite,
  handleAdminBatchCreateInvites,
  handleAdminRevokeInvite,
  handleVerifyInvite,
  handleRegisterWithInvite,
  handleRedeemInvite,
} from '../authMigrationController.ts';
import {
  getActiveFirebaseTargetInfo,
  hashToken,
  isAuthorizedAdminToken,
} from '../firebaseAdminServer.ts';
import {
  DEFAULT_PUBLIC_APP_URL,
  extractInviteTokenFromInput,
} from '../../utils/firebaseSync.ts';

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makePermissionDeniedServices() {
  const permErr: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.');
  permErr.code = 7;

  const failingSnapPromise = Promise.reject(permErr);
  const docRef: any = {
    get: () => failingSnapPromise,
    set: () => failingSnapPromise,
    update: () => failingSnapPromise,
    delete: () => failingSnapPromise,
  };
  const colRef: any = {
    get: () => failingSnapPromise,
    doc: () => docRef,
    where: () => ({ limit: () => ({ get: () => failingSnapPromise }) }),
  };

  return {
    getAdminServices: () =>
      ({
        auth: {} as any,
        db: {
          collection: () => colRef,
          batch: () => ({
            set: () => {},
            commit: () => Promise.reject(permErr),
          }),
          runTransaction: () => Promise.reject(permErr),
        } as any,
      }) as any,
    checkRateLimitDistributed: async () => ({ allowed: true }),
    resetRateLimitDistributed: async () => {},
  };
}

function decodeFirestoreVal(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(decodeFirestoreVal);
  if ('mapValue' in v) {
    const out: Record<string, any> = {};
    for (const [k, fv] of Object.entries(v.mapValue?.fields || {})) {
      out[k] = decodeFirestoreVal(fv);
    }
    return out;
  }
  return null;
}

function encodeFirestoreVal(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(encodeFirestoreVal) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = encodeFirestoreVal(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function decodeFields(fields: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreVal(v);
  }
  return out;
}

function encodeFields(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = encodeFirestoreVal(v);
  }
  return out;
}

interface SimulatedCaller {
  uid: string;
  email: string;
  emailVerified: boolean;
  signInProvider: string;
}

/**
 * Stateful Firestore REST simulator enforcing the exact deployed firestore.rules
 * semantics for /invites, /invite_lookup, and /athletes.
 */
function createRuleEnforcedRestSimulator(tokenDirectory: Record<string, SimulatedCaller>) {
  const collections: Record<string, Map<string, Record<string, any>>> = {
    invites: new Map(),
    invite_lookup: new Map(),
    athletes: new Map(),
    deleted_athletes: new Map(),
  };

  const isSha256Hex = (id: string) => /^[a-f0-9]{64}$/.test(id);
  const isRuleAdmin = (caller: SimulatedCaller | null) =>
    Boolean(
      caller &&
        caller.emailVerified === true &&
        caller.signInProvider === 'google.com' &&
        caller.email.toLowerCase() === 'kmiloko19@gmail.com'
    );

  function getCaller(headers?: HeadersInit): SimulatedCaller | null {
    let authHeader = '';
    if (headers instanceof Headers) {
      authHeader = headers.get('Authorization') || headers.get('authorization') || '';
    } else if (Array.isArray(headers)) {
      const found = headers.find(([k]) => k.toLowerCase() === 'authorization');
      authHeader = found ? found[1] : '';
    } else if (headers && typeof headers === 'object') {
      const rec = headers as Record<string, string>;
      authHeader = rec.Authorization || rec.authorization || '';
    }
    if (!authHeader.startsWith('Bearer ')) return null;
    const rawToken = authHeader.slice(7).trim();
    return tokenDirectory[rawToken] || null;
  }

  function parseDocPath(nameOrUrl: string): { collection: string; docId?: string } | null {
    const marker = '/documents/';
    const idx = nameOrUrl.indexOf(marker);
    if (idx === -1) return null;
    const tail = nameOrUrl.slice(idx + marker.length).split('?')[0];
    const parts = tail.split('/').filter(Boolean);
    if (parts.length === 1) return { collection: parts[0] };
    if (parts.length >= 2) return { collection: parts[0], docId: decodeURIComponent(parts[1]) };
    return null;
  }

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const caller = getCaller(init?.headers);
    const admin = isRuleAdmin(caller);

    // 1. Atomic :commit endpoint
    if (url.endsWith('/documents:commit') && method === 'POST') {
      const parsed = JSON.parse(String(init?.body || '{}'));
      const writes: any[] = Array.isArray(parsed.writes) ? parsed.writes : [];

      // Stage all writes atomically in a clone first (to validate getAfter rules)
      const staged: Record<string, Map<string, Record<string, any>>> = {
        invites: new Map(Array.from(collections.invites.entries()).map(([k, v]) => [k, { ...v }])),
        invite_lookup: new Map(
          Array.from(collections.invite_lookup.entries()).map(([k, v]) => [k, { ...v }])
        ),
        athletes: new Map(Array.from(collections.athletes.entries()).map(([k, v]) => [k, { ...v }])),
        deleted_athletes: new Map(
          Array.from(collections.deleted_athletes.entries()).map(([k, v]) => [k, { ...v }])
        ),
      };

      const touchedDocs: Array<{
        collection: string;
        docId: string;
        op: 'create' | 'update' | 'delete';
        before: Record<string, any> | undefined;
        after: Record<string, any> | undefined;
        affectedKeys: string[];
      }> = [];

      for (const w of writes) {
        if (w.delete) {
          const parsedPath = parseDocPath(String(w.delete));
          if (!parsedPath || !parsedPath.docId) {
            return new Response(JSON.stringify({ error: { message: 'Invalid delete path' } }), {
              status: 400,
            });
          }
          const col = staged[parsedPath.collection];
          const before = col?.get(parsedPath.docId);
          col?.delete(parsedPath.docId);
          touchedDocs.push({
            collection: parsedPath.collection,
            docId: parsedPath.docId,
            op: 'delete',
            before,
            after: undefined,
            affectedKeys: [],
          });
          continue;
        }

        if (w.update) {
          const parsedPath = parseDocPath(String(w.update.name || ''));
          if (!parsedPath || !parsedPath.docId) {
            return new Response(JSON.stringify({ error: { message: 'Invalid update path' } }), {
              status: 400,
            });
          }
          const col = staged[parsedPath.collection];
          if (!col) {
            return new Response(JSON.stringify({ error: { message: 'Unknown collection' } }), {
              status: 403,
            });
          }
          const before = col.get(parsedPath.docId);
          if (w.currentDocument?.exists === true && !before) {
            return new Response(
              JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Document does not exist' } }),
              { status: 404 }
            );
          }
          if (w.currentDocument?.exists === false && before) {
            return new Response(
              JSON.stringify({ error: { status: 'ALREADY_EXISTS', message: 'Document already exists' } }),
              { status: 409 }
            );
          }

          const patch = decodeFields(w.update.fields);
          const maskPaths: string[] | undefined = w.updateMask?.fieldPaths;
          let nextDoc: Record<string, any>;
          let affectedKeys: string[];

          if (maskPaths && before) {
            nextDoc = { ...before };
            affectedKeys = [...maskPaths];
            for (const key of maskPaths) {
              if (key in patch) nextDoc[key] = patch[key];
            }
          } else {
            nextDoc = { ...patch };
            affectedKeys = Object.keys(nextDoc);
          }

          col.set(parsedPath.docId, nextDoc);
          touchedDocs.push({
            collection: parsedPath.collection,
            docId: parsedPath.docId,
            op: before ? 'update' : 'create',
            before,
            after: nextDoc,
            affectedKeys,
          });
        }
      }

      // Enforce exact deployed firestore.rules on every write in the atomic batch
      for (const t of touchedDocs) {
        if (admin) continue;

        if (!caller) {
          return new Response(
            JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Missing auth' } }),
            { status: 403 }
          );
        }

        if (t.collection === 'invites') {
          if (t.op !== 'update' || !t.before || !t.after) {
            return new Response(
              JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Only admin creates/deletes invites' } }),
              { status: 403 }
            );
          }
          const allowedKeys = new Set(['used', 'usedAt', 'usedByUid', 'usedByName', 'usedByEmail']);
          const keysValid = t.affectedKeys.every((k) => allowedKeys.has(k));
          const lookupAfter = staged.invite_lookup.get(t.docId);
          const lookupConsistent =
            !collections.invite_lookup.has(t.docId) ||
            (lookupAfter && lookupAfter.used === true && lookupAfter.active === false);

          const canConsume =
            isSha256Hex(t.docId) &&
            t.before.used === false &&
            Boolean(t.before.revoked) === false &&
            t.after.used === true &&
            t.after.usedByUid === caller.uid &&
            typeof t.after.usedAt === 'string' &&
            t.after.usedAt.length > 0 &&
            keysValid &&
            lookupConsistent;

          if (!canConsume) {
            return new Response(
              JSON.stringify({
                error: {
                  status: 'PERMISSION_DENIED',
                  message: 'Invite already used, revoked, or invalid redemption fields',
                },
              }),
              { status: 403 }
            );
          }
          continue;
        }

        if (t.collection === 'invite_lookup') {
          if (t.op !== 'update' || !t.before || !t.after) {
            return new Response(
              JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Only admin creates/deletes invite_lookup' } }),
              { status: 403 }
            );
          }
          const allowedKeys = new Set(['used', 'active', 'usedAt']);
          const keysValid = t.affectedKeys.every((k) => allowedKeys.has(k));
          const inviteAfter = staged.invites.get(t.docId);
          const inviteConsistent =
            Boolean(inviteAfter) &&
            inviteAfter!.used === true &&
            inviteAfter!.usedByUid === caller.uid;

          const canConsumeLookup =
            isSha256Hex(t.docId) &&
            t.before.used === false &&
            Boolean(t.before.revoked) === false &&
            t.before.active === true &&
            t.after.used === true &&
            t.after.active === false &&
            typeof t.after.usedAt === 'string' &&
            t.after.usedAt.length > 0 &&
            keysValid &&
            inviteConsistent;

          if (!canConsumeLookup) {
            return new Response(
              JSON.stringify({
                error: {
                  status: 'PERMISSION_DENIED',
                  message: 'Invite lookup already consumed or inconsistent with /invites',
                },
              }),
              { status: 403 }
            );
          }
          continue;
        }

        if (t.collection === 'athletes') {
          if (
            t.op !== 'create' ||
            !t.after ||
            t.after.authUid !== caller.uid ||
            t.after.isAdmin === true ||
            t.after.isAdmin === 'true'
          ) {
            return new Response(
              JSON.stringify({
                error: {
                  status: 'PERMISSION_DENIED',
                  message: 'Athletes cannot create admin profiles or profiles for another UID',
                },
              }),
              { status: 403 }
            );
          }
          continue;
        }

        return new Response(
          JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Default deny' } }),
          { status: 403 }
        );
      }

      // Commit staged maps
      collections.invites = staged.invites;
      collections.invite_lookup = staged.invite_lookup;
      collections.athletes = staged.athletes;
      collections.deleted_athletes = staged.deleted_athletes;

      return new Response(JSON.stringify({ writeResults: writes.map(() => ({})) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Single document / collection REST routes
    const parsedPath = parseDocPath(url);
    if (!parsedPath) {
      return new Response(JSON.stringify({ error: { message: 'Unknown URL' } }), { status: 404 });
    }
    const col = collections[parsedPath.collection];
    if (!col) {
      return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), {
        status: 403,
      });
    }

    // List collection
    if (method === 'GET' && !parsedPath.docId) {
      if (!admin) {
        return new Response(
          JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Admin only list' } }),
          { status: 403 }
        );
      }
      const docs = Array.from(col.entries()).map(([id, data]) => ({
        name: `projects/p/databases/d/documents/${parsedPath.collection}/${id}`,
        fields: encodeFields(data),
      }));
      return new Response(JSON.stringify({ documents: docs }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get document
    if (method === 'GET' && parsedPath.docId) {
      if (parsedPath.collection === 'invite_lookup') {
        if (!admin && !isSha256Hex(parsedPath.docId)) {
          return new Response(
            JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Invalid lookup key' } }),
            { status: 403 }
          );
        }
      } else if (!admin) {
        return new Response(
          JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Admin only get' } }),
          { status: 403 }
        );
      }

      const found = col.get(parsedPath.docId);
      if (!found) {
        return new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: `projects/p/databases/d/documents/${parsedPath.collection}/${parsedPath.docId}`,
          fields: encodeFields(found),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete document
    if (method === 'DELETE' && parsedPath.docId) {
      if (!admin) {
        return new Response(
          JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Admin only delete' } }),
          { status: 403 }
        );
      }
      col.delete(parsedPath.docId);
      return new Response('{}', { status: 200 });
    }

    return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 });
  }) as typeof fetch;

  return { collections, fetchMock };
}

async function runSuite() {
  console.log('\n======================================================================');
  console.log(' LAZCAKONG GYM v7.0.5 — INVITATION GENERATOR FUNCTIONAL & SECURITY SUITE');
  console.log('======================================================================\n');

  const originalFetch = globalThis.fetch;
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'kmiloko19@gmail.com';

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Live Firestore Rules Verification against active Firebase project
    // -------------------------------------------------------------------------
    const target = getActiveFirebaseTargetInfo();
    assert.equal(target.projectId, 'forward-cortex-1ds98', 'Active Firebase project must be forward-cortex-1ds98');
    assert.equal(
      target.databaseId,
      'ai-studio-lazcakongym-dedcb625-f047-4947-ace1-3fbed6d67760',
      'Active Firestore databaseId must match provisioned AI Studio DB'
    );

    const randomLookupHash = crypto.randomBytes(32).toString('hex');
    const liveLookupUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      target.projectId
    )}/databases/${encodeURIComponent(target.databaseId)}/documents/invite_lookup/${randomLookupHash}`;
    const liveLookupRes = await originalFetch(liveLookupUrl, { method: 'GET' });
    assert.equal(
      liveLookupRes.status,
      404,
      `Live published firestore.rules must allow 64-hex get on /invite_lookup/{hash} (expected 404 for unknown token, got ${liveLookupRes.status})`
    );

    const liveListLookupUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      target.projectId
    )}/databases/${encodeURIComponent(target.databaseId)}/documents/invite_lookup`;
    const liveListLookupRes = await originalFetch(liveListLookupUrl, { method: 'GET' });
    assert.equal(
      liveListLookupRes.status,
      403,
      `Live published firestore.rules must deny unauthenticated list on /invite_lookup (got ${liveListLookupRes.status})`
    );

    const liveListInvitesUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      target.projectId
    )}/databases/${encodeURIComponent(target.databaseId)}/documents/invites`;
    const liveListInvitesRes = await originalFetch(liveListInvitesUrl, { method: 'GET' });
    assert.equal(
      liveListInvitesRes.status,
      403,
      `Live published firestore.rules must deny unauthenticated list on /invites (got ${liveListInvitesRes.status})`
    );
    console.log('✅ [1/9] Live Firestore Rules verified on forward-cortex-1ds98 (404 exact lookup / 403 list / 403 invites)');

    // -------------------------------------------------------------------------
    // Setup Rule-Enforced Starter-Tier REST Simulator
    // -------------------------------------------------------------------------
    const tokenDirectory: Record<string, SimulatedCaller> = {
      'token-admin-google': {
        uid: 'uid_master_admin',
        email: 'KMILOKO19@GMAIL.COM', // Mixed case intentionally tests case-insensitive rule match
        emailVerified: true,
        signInProvider: 'google.com',
      },
      'token-athlete-1': {
        uid: 'uid_athlete_alpha',
        email: 'atleta.uno@gmail.com',
        emailVerified: true,
        signInProvider: 'google.com',
      },
      'token-athlete-2': {
        uid: 'uid_athlete_beta',
        email: 'atleta.dos@gmail.com',
        emailVerified: true,
        signInProvider: 'google.com',
      },
      'token-spoofed-password': {
        uid: 'uid_spoof_pw',
        email: 'kmiloko19@gmail.com',
        emailVerified: true,
        signInProvider: 'password',
      },
    };

    const sim = createRuleEnforcedRestSimulator(tokenDirectory);
    // Pre-seed an existing legacy invite (without invite_lookup) + existing athlete to ensure ZERO deletion
    const legacyToken = 'LZK-LEGACY-9999';
    const legacyHash = hashToken(legacyToken);
    sim.collections.invites.set(legacyHash, {
      token: legacyToken,
      createdAt: '2026-10-01T12:00:00.000Z',
      used: false,
      revoked: false,
      note: 'Invitación histórica existente',
    });
    sim.collections.athletes.set('athlete_existing_01', {
      id: 'athlete_existing_01',
      name: 'Atleta Existente',
      email: 'existente@gym.com',
      authUid: 'uid_existing_01',
      isAdmin: false,
    });

    globalThis.fetch = sim.fetchMock;
    const deps = makePermissionDeniedServices();

    const verifiedAdminUser = {
      uid: 'uid_master_admin',
      email: 'KMILOKO19@GMAIL.COM',
      isAdmin: true,
      emailVerified: true,
      signInProvider: 'google.com',
    };

    // -------------------------------------------------------------------------
    // TEST 2: Admin Auth Verification & Strict Athlete/Spoof Denial
    // -------------------------------------------------------------------------
    assert.equal(
      isAuthorizedAdminToken({
        email: 'KMILOKO19@GMAIL.COM',
        emailVerified: true,
        signInProvider: 'google.com',
      }),
      true,
      'Verified Google Master Admin must be authorized regardless of email case'
    );
    assert.equal(
      isAuthorizedAdminToken({
        email: 'kmiloko19@gmail.com',
        emailVerified: true,
        signInProvider: 'password',
      }),
      false,
      'Password-provider spoof of admin email MUST be rejected'
    );
    assert.equal(
      isAuthorizedAdminToken({
        email: 'atleta.uno@gmail.com',
        emailVerified: true,
        signInProvider: 'google.com',
      }),
      false,
      'Regular athlete Google account MUST NOT be authorized as admin'
    );

    const athleteReqBase = {
      user: {
        uid: 'uid_athlete_alpha',
        email: 'atleta.uno@gmail.com',
        isAdmin: false,
        emailVerified: true,
        signInProvider: 'google.com',
      },
      rawIdToken: 'token-athlete-1',
      body: { count: 50 },
      params: { token: legacyToken },
    };

    for (const [label, handler] of [
      ['list', handleAdminListInvites],
      ['create', handleAdminCreateInvite],
      ['batch50', handleAdminBatchCreateInvites],
      ['revoke', handleAdminRevokeInvite],
    ] as const) {
      const r = makeRes();
      await handler(athleteReqBase as any, r, deps);
      assert.equal(r.statusCode, 403, `Athlete must receive 403 on admin ${label}`);
    }
    console.log('✅ [2/9] Master Admin Google identity verified; athletes & spoofed tokens strictly denied (403)');

    // -------------------------------------------------------------------------
    // TEST 3: Single Invite Creation + Zero-PII Lookup Mirror + QR URL Format
    // -------------------------------------------------------------------------
    const createRes = makeRes();
    await handleAdminCreateInvite(
      {
        user: verifiedAdminUser,
        rawIdToken: 'token-admin-google',
        body: { note: 'Prueba Real v7.0.5' },
      } as any,
      createRes,
      deps
    );
    assert.equal(createRes.statusCode, 201, `Single invite creation must return 201, got ${createRes.statusCode}`);
    assert.equal(createRes.body.success, true);
    const singleToken: string = createRes.body.invite.token;
    assert.match(singleToken, /^LZK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const singleHash = hashToken(singleToken);
    assert.ok(sim.collections.invites.has(singleHash), 'Single invite must exist in /invites/{hash}');
    const lookupDoc = sim.collections.invite_lookup.get(singleHash);
    assert.ok(lookupDoc, 'Single invite must atomically create /invite_lookup/{hash}');
    assert.equal(lookupDoc!.active, true);
    assert.equal(lookupDoc!.used, false);
    assert.equal('token' in lookupDoc!, false, 'Zero-PII invite_lookup must NEVER store raw token');
    assert.equal('usedByEmail' in lookupDoc!, false, 'Zero-PII invite_lookup must NEVER store PII');

    // QR URL compatibility for Android & iPhone (PWA / APK)
    const androidQrUrl = `${DEFAULT_PUBLIC_APP_URL}/?invite=${encodeURIComponent(singleToken)}&platform=android`;
    const iosQrUrl = `${DEFAULT_PUBLIC_APP_URL}/?invite=${encodeURIComponent(singleToken)}&platform=ios`;
    assert.equal(extractInviteTokenFromInput(androidQrUrl), singleToken);
    assert.equal(extractInviteTokenFromInput(iosQrUrl), singleToken);
    console.log(`✅ [3/9] Single invite created (${singleToken}) with zero-PII lookup & Android/iPhone QR links`);

    // -------------------------------------------------------------------------
    // TEST 4: Batch Generation of 50 Unique Codes in 1 Atomic Commit
    // -------------------------------------------------------------------------
    const batchRes = makeRes();
    await handleAdminBatchCreateInvites(
      {
        user: verifiedAdminUser,
        rawIdToken: 'token-admin-google',
        body: { count: 50, note: 'Lote Masivo 50 v7.0.5' },
      } as any,
      batchRes,
      deps
    );
    assert.equal(batchRes.statusCode, 201, `Batch 50 creation must return 201, got ${batchRes.statusCode}`);
    assert.equal(batchRes.body.success, true);
    assert.equal(batchRes.body.tokens.length, 50, 'Batch must return exactly 50 tokens');
    assert.equal(new Set(batchRes.body.tokens).size, 50, 'All 50 batch tokens must be strictly unique');
    for (const t of batchRes.body.tokens as string[]) {
      const h = hashToken(t);
      assert.ok(sim.collections.invites.has(h), `Batch token ${t} must exist in /invites`);
      assert.ok(sim.collections.invite_lookup.has(h), `Batch token ${t} must exist in /invite_lookup`);
    }
    console.log('✅ [4/9] Batch of 50 unique invitations generated atomically (100 Firestore writes)');

    // -------------------------------------------------------------------------
    // TEST 5: Listing Existing Invitations Preserves Legacy Data + Backfills Lookup
    // -------------------------------------------------------------------------
    const listRes = makeRes();
    await handleAdminListInvites(
      { user: verifiedAdminUser, rawIdToken: 'token-admin-google' } as any,
      listRes,
      deps
    );
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.success, true);
    assert.equal(listRes.body.invites.length, 52, 'Must list 1 legacy + 1 single + 50 batch = 52 invites');
    assert.ok(
      listRes.body.invites.some((i: any) => i.token === legacyToken),
      'Pre-existing legacy invite must remain intact'
    );
    // Allow microtask/background additive backfill to finish
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(
      sim.collections.invite_lookup.has(legacyHash),
      'Listing invites should additively backfill missing /invite_lookup for legacy unused invites'
    );
    console.log('✅ [5/9] Existing invitations restored (52 total) & legacy lookup additively backfilled');

    // -------------------------------------------------------------------------
    // TEST 6: Real Single-Use Verification + Registration Consumption + 409 Reuse Block
    // -------------------------------------------------------------------------
    const verifyBefore = makeRes();
    await handleVerifyInvite(
      { body: { token: singleToken }, ip: '10.0.0.1' } as any,
      verifyBefore,
      deps
    );
    assert.equal(verifyBefore.statusCode, 200);
    assert.equal(verifyBefore.body.valid, true, 'Unused single invite must verify as valid on Starter Tier');
    assert.equal(verifyBefore.body.status, 'valid');

    // Athlete 1 registers with singleToken
    const reg1Res = makeRes();
    await handleRegisterWithInvite(
      {
        user: {
          uid: 'uid_athlete_alpha',
          email: 'atleta.uno@gmail.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
        rawIdToken: 'token-athlete-1',
        ip: '10.0.0.2',
        body: {
          token: singleToken,
          name: 'Atleta Alfa',
          email: 'atleta.uno@gmail.com',
          weight: '78',
          height: '176',
          age: '29',
        },
      } as any,
      reg1Res,
      deps
    );
    assert.equal(reg1Res.statusCode, 201, `Athlete 1 registration must succeed with 201, got ${reg1Res.statusCode}: ${JSON.stringify(reg1Res.body)}`);
    assert.equal(reg1Res.body.success, true);
    assert.equal(reg1Res.body.isAdmin, false, 'Registered athlete MUST NEVER be admin');
    assert.equal(reg1Res.body.profile.isAdmin, false, 'Registered athlete profile MUST NEVER be admin');
    assert.equal(reg1Res.body.authUid, 'uid_athlete_alpha');

    // Verify invite state in both collections
    assert.equal(sim.collections.invites.get(singleHash)?.used, true);
    assert.equal(sim.collections.invites.get(singleHash)?.usedByUid, 'uid_athlete_alpha');
    assert.equal(sim.collections.invite_lookup.get(singleHash)?.used, true);
    assert.equal(sim.collections.invite_lookup.get(singleHash)?.active, false);

    // Public verification now MUST report 'used'
    const verifyAfter = makeRes();
    await handleVerifyInvite(
      { body: { token: singleToken }, ip: '10.0.0.3' } as any,
      verifyAfter,
      deps
    );
    assert.equal(verifyAfter.statusCode, 200);
    assert.equal(verifyAfter.body.valid, false);
    assert.equal(verifyAfter.body.status, 'used');

    // Athlete 2 attempts to reuse the SAME singleToken for registration -> MUST fail with 409!
    const reg2Res = makeRes();
    await handleRegisterWithInvite(
      {
        user: {
          uid: 'uid_athlete_beta',
          email: 'atleta.dos@gmail.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
        rawIdToken: 'token-athlete-2',
        ip: '10.0.0.4',
        body: {
          token: singleToken,
          name: 'Atleta Beta',
          email: 'atleta.dos@gmail.com',
        },
      } as any,
      reg2Res,
      deps
    );
    assert.equal(reg2Res.statusCode, 409, `Second registration with same invite MUST return 409, got ${reg2Res.statusCode}`);
    assert.equal(reg2Res.body.success, false);

    // Athlete 2 also tries handleRedeemInvite on the SAME already-used invite -> MUST fail with 409!
    const redeemUsedRes = makeRes();
    await handleRedeemInvite(
      {
        user: {
          uid: 'uid_athlete_beta',
          email: 'atleta.dos@gmail.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
        rawIdToken: 'token-athlete-2',
        body: { token: singleToken, athleteName: 'Atleta Beta' },
      } as any,
      redeemUsedRes,
      deps
    );
    assert.equal(redeemUsedRes.statusCode, 409, `Redeeming an already-used invite MUST return 409, got ${redeemUsedRes.statusCode}`);
    console.log('✅ [6/9] Real single-use invite verification + registration + strict 409 reuse rejection verified');

    // -------------------------------------------------------------------------
    // TEST 7: Redeem Unused Batch Invite Once & Block Second Redemption
    // -------------------------------------------------------------------------
    const batchToken1: string = batchRes.body.tokens[0];
    const redeem1Res = makeRes();
    await handleRedeemInvite(
      {
        user: {
          uid: 'uid_athlete_beta',
          email: 'atleta.dos@gmail.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
        rawIdToken: 'token-athlete-2',
        body: { token: batchToken1, athleteName: 'Atleta Beta' },
      } as any,
      redeem1Res,
      deps
    );
    assert.equal(redeem1Res.statusCode, 200, `First redeem of unused batch token must return 200, got ${redeem1Res.statusCode}`);
    assert.equal(redeem1Res.body.success, true);

    const redeem1AgainRes = makeRes();
    await handleRedeemInvite(
      {
        user: {
          uid: 'uid_athlete_beta',
          email: 'atleta.dos@gmail.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
        rawIdToken: 'token-athlete-2',
        body: { token: batchToken1, athleteName: 'Atleta Beta' },
      } as any,
      redeem1AgainRes,
      deps
    );
    assert.equal(redeem1AgainRes.statusCode, 409, 'Second redeem of same batch token MUST return 409');
    console.log('✅ [7/9] Batch invite single-use redemption & 409 replay protection verified');

    // -------------------------------------------------------------------------
    // TEST 8: Revoke Invite Removes Both /invites and /invite_lookup Without Touching Others
    // -------------------------------------------------------------------------
    const batchToken2: string = batchRes.body.tokens[1];
    const revokeRes = makeRes();
    await handleAdminRevokeInvite(
      {
        user: verifiedAdminUser,
        rawIdToken: 'token-admin-google',
        params: { token: batchToken2 },
      } as any,
      revokeRes,
      deps
    );
    assert.equal(revokeRes.statusCode, 200);
    assert.equal(revokeRes.body.success, true);

    const verifyRevoked = makeRes();
    await handleVerifyInvite(
      { body: { token: batchToken2 }, ip: '10.0.0.5' } as any,
      verifyRevoked,
      deps
    );
    assert.equal(verifyRevoked.statusCode, 200);
    assert.equal(verifyRevoked.body.valid, false);
    assert.equal(verifyRevoked.body.status, 'not_found');

    // Ensure pre-existing athlete & legacy invite were NEVER deleted
    assert.ok(sim.collections.athletes.has('athlete_existing_01'), 'Pre-existing athlete must be untouched');
    assert.ok(sim.collections.invites.has(legacyHash), 'Pre-existing legacy invite must be untouched');
    console.log('✅ [8/9] Invite revocation verified; pre-existing users & invitations strictly preserved');

    // -------------------------------------------------------------------------
    // TEST 9: Version 7.0.5, Token Renewal Wiring, OTA Native VersionCode 70000
    // -------------------------------------------------------------------------
    const rulesSrc = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
    assert.ok(rulesSrc.includes("email.lower() == 'kmiloko19@gmail.com'"), 'firestore.rules must lowercase admin email');
    assert.ok(rulesSrc.includes('match /invite_lookup/{tokenHash}'), 'firestore.rules must define /invite_lookup');
    assert.ok(rulesSrc.includes('getAfter('), 'firestore.rules must enforce atomic getAfter consistency');

    const syncSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/firebaseSync.ts'), 'utf8');
    assert.ok(syncSrc.includes('forceRenewFirebaseAuthToken'), 'firebaseSync must expose token renewal');
    assert.ok(syncSrc.includes('fetchAdminApiWithTokenRetry'), 'firebaseSync must auto-retry with refreshed token on 401/403');

    const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/InstallApkModal.tsx'), 'utf8');
    assert.ok(modalSrc.includes('Renovar Token'), 'InstallApkModal must include manual token renewal control');

    const updateAppSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/updateApp.ts'), 'utf8');
    assert.ok(updateAppSrc.includes("DEFAULT_APP_VERSION = 'v7.0.5'"), 'updateApp.ts must be v7.0.5');

    const gradleSrc = fs.readFileSync(path.join(process.cwd(), 'android/app/build.gradle'), 'utf8');
    assert.ok(gradleSrc.includes('70000'), 'Android native versionCode 70000 must be preserved for OTA');
    assert.ok(gradleSrc.includes(': "7.0.0"'), 'Android native versionName 7.0.0 must be preserved for OTA');

    console.log('✅ [9/9] Version 7.0.5, token renewal, hardened rules & OTA native versionCode 70000 verified');
    console.log('\n🎉 ALL 9 INVITATION GENERATOR v7.0.5 FUNCTIONAL & SECURITY TESTS PASSED!\n');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  }
}

runSuite().catch((err) => {
  console.error('❌ INVITATION GENERATOR v7.0.5 SUITE FAILED:', err);
  process.exit(1);
});
