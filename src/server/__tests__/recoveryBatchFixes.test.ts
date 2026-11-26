import fs from 'node:fs';
import path from 'node:path';
import {
  handleAdminListInvites,
  handleAdminCreateInvite,
  handleAdminBatchCreateInvites,
  handleAdminRevokeInvite,
  handleAdminDeleteAthlete,
  handleVerifyInvite,
  handleRegisterWithInvite,
  handleRedeemInvite,
} from '../authMigrationController.ts';
import {
  signInWithGoogleHybrid,
  linkWithGoogleHybrid,
} from '../../utils/nativeAuth.ts';

const webPlatformInfo = {
  platform: 'web' as const,
  isCapacitorNative: false,
  isAndroid: false,
  isIOS: false,
  isWeb: true,
  isStandalonePwa: false,
  hasServiceWorkerSupport: true,
  hasCacheStorageSupport: true,
  hasNotificationSupport: true,
  hasVibrationSupport: false,
};

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
  };
}

describe('Recovery Batch 1-3 Verification Suite', () => {
  const originalFetch = globalThis.fetch;
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  test('Admin REST fallback lists, creates, batch-creates, revokes invites and deletes non-admin athletes when Admin SDK gets PERMISSION_DENIED', async () => {
    process.env.ADMIN_EMAIL = 'kmiloko19@gmail.com';
    const adminUser = {
      uid: 'master_uid_123',
      email: 'kmiloko19@gmail.com',
      isAdmin: true,
      emailVerified: true,
      signInProvider: 'google.com',
    };

    const calls: Array<{ url: string; method: string; body?: any }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body: parsedBody });

      if (url.includes('/documents/invites?') && method === 'GET') {
        return new Response(
          JSON.stringify({
            documents: [
              {
                name: 'projects/p/databases/d/documents/invites/hash1',
                fields: {
                  token: { stringValue: 'LAZCA-TEST-1111' },
                  createdAt: { stringValue: '2026-11-25T10:00:00.000Z' },
                  used: { booleanValue: false },
                  revoked: { booleanValue: false },
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/documents/invites/') && method === 'PATCH') {
        return new Response(JSON.stringify({ fields: parsedBody?.fields || {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/documents:commit') && method === 'POST') {
        return new Response(JSON.stringify({ writeResults: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if ((url.includes('/documents/invites/') || url.includes('/documents/invite_lookup/')) && method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }

      if (url.includes('/documents/athletes/athlete_del_1') && method === 'GET') {
        return new Response(
          JSON.stringify({
            fields: {
              id: { stringValue: 'athlete_del_1' },
              email: { stringValue: 'athlete@example.com' },
              authUid: { stringValue: 'uid_athlete_1' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/documents/deleted_athletes/athlete_del_1') && method === 'PATCH') {
        return new Response(JSON.stringify({ fields: parsedBody?.fields || {} }), { status: 200 });
      }

      if (url.includes('/documents/athletes/athlete_del_1') && method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const deps = makePermissionDeniedServices();

    // 1. List invites via REST fallback
    const listReq: any = { user: adminUser, rawIdToken: 'admin-id-token' };
    const listRes = makeRes();
    await handleAdminListInvites(listReq, listRes, deps);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.invites).toHaveLength(1);
    expect(listRes.body.invites[0].token).toBe('LAZCA-TEST-1111');

    // 2. Create single invite via REST fallback
    const createReq: any = {
      user: adminUser,
      rawIdToken: 'admin-id-token',
      body: { note: 'VIP Beta' },
    };
    const createRes = makeRes();
    await handleAdminCreateInvite(createReq, createRes, deps);
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(String(createRes.body.invite.token)).toMatch(/^LZK-/);

    // 3. Batch create 5 invites via REST :commit fallback
    const batchReq: any = {
      user: adminUser,
      rawIdToken: 'admin-id-token',
      body: { count: 5 },
    };
    const batchRes = makeRes();
    await handleAdminBatchCreateInvites(batchReq, batchRes, deps);
    expect(batchRes.statusCode).toBe(201);
    expect(batchRes.body.success).toBe(true);
    expect(batchRes.body.tokens).toHaveLength(5);

    // 4. Revoke invite via REST fallback
    const revokeReq: any = {
      user: adminUser,
      rawIdToken: 'admin-id-token',
      params: { token: 'LZK-AAAA-BBBB' },
    };
    const revokeRes = makeRes();
    await handleAdminRevokeInvite(revokeReq, revokeRes, deps);
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // 5. Delete non-admin athlete via REST fallback (tombstone + delete)
    const delReq: any = {
      user: adminUser,
      rawIdToken: 'admin-id-token',
      params: { athleteId: 'athlete_del_1' },
    };
    const delRes = makeRes();
    await handleAdminDeleteAthlete(delReq, delRes, deps);
    expect(delRes.statusCode).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(calls.some((c) => c.url.includes('/documents/deleted_athletes/athlete_del_1') && c.method === 'PATCH')).toBe(true);
    expect(calls.some((c) => c.url.includes('/documents/athletes/athlete_del_1') && c.method === 'DELETE')).toBe(true);

    // 6. Protect Master Admin from deletion even in REST fallback
    const selfDelReq: any = {
      user: adminUser,
      rawIdToken: 'admin-id-token',
      params: { athleteId: 'perfil_admin_master' },
    };
    const selfDelRes = makeRes();
    await handleAdminDeleteAthlete(selfDelReq, selfDelRes, deps);
    expect(selfDelRes.statusCode).toBe(400);
  });

  test('Public/athlete invite handlers return clear 503 diagnostic when both Admin SDK and Starter-Tier REST fallback are unavailable', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Missing permissions' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const deps: any = {
      ...makePermissionDeniedServices(),
      checkRateLimitDistributed: async () => ({ allowed: true }),
      resetRateLimitDistributed: async () => {},
    };

    const verifyRes = makeRes();
    await handleVerifyInvite({ body: { token: 'LZK-1234-5678' }, ip: '127.0.0.1' } as any, verifyRes, deps);
    expect(verifyRes.statusCode).toBe(503);
    expect(String(verifyRes.body.error)).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');

    const regRes = makeRes();
    await handleRegisterWithInvite(
      {
        user: { uid: 'u1', email: 'u1@example.com', isAdmin: false },
        body: { token: 'LZK-1234-5678', name: 'Atleta' },
        ip: '127.0.0.1',
      } as any,
      regRes,
      deps
    );
    expect(regRes.statusCode).toBe(503);
    expect(String(regRes.body.error)).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');

    const redeemRes = makeRes();
    await handleRedeemInvite(
      {
        user: { uid: 'u1', email: 'u1@example.com', isAdmin: false },
        body: { token: 'LZK-1234-5678' },
      } as any,
      redeemRes,
      deps
    );
    expect(redeemRes.statusCode).toBe(503);
    expect(String(redeemRes.body.error)).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
  });

  test('Web/PWA Google Sign-In falls back to redirect only on popup-blocked / unsupported-env and surfaces auth/redirect-initiated', async () => {
    let redirectCalled = 0;
    const blockedErr: any = new Error('Popup blocked');
    blockedErr.code = 'auth/popup-blocked';

    await expect(
      signInWithGoogleHybrid({
        detectPlatform: () => webPlatformInfo,
        signInWithPopupFn: async () => {
          throw blockedErr;
        },
        signInWithRedirectFn: (async () => {
          redirectCalled += 1;
        }) as any,
      })
    ).rejects.toMatchObject({ code: 'auth/redirect-initiated' });
    expect(redirectCalled).toBe(1);

    let linkRedirectCalled = 0;
    await expect(
      linkWithGoogleHybrid({ uid: 'u1' } as any, {
        detectPlatform: () => webPlatformInfo,
        linkWithPopupFn: async () => {
          throw blockedErr;
        },
        linkWithRedirectFn: (async () => {
          linkRedirectCalled += 1;
        }) as any,
      })
    ).rejects.toMatchObject({ code: 'auth/redirect-initiated' });
    expect(linkRedirectCalled).toBe(1);

    // User closing popup must NOT trigger redirect loop
    let cancelledRedirect = 0;
    const closedErr: any = new Error('Closed by user');
    closedErr.code = 'auth/popup-closed-by-user';
    await expect(
      signInWithGoogleHybrid({
        detectPlatform: () => webPlatformInfo,
        signInWithPopupFn: async () => {
          throw closedErr;
        },
        signInWithRedirectFn: (async () => {
          cancelledRedirect += 1;
        }) as any,
      })
    ).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
    expect(cancelledRedirect).toBe(0);
  });

  test('SW cache poisoning guards and Express static 404 guard are properly configured', () => {
    const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(swSrc).toContain("const CACHE_NAME = 'lazcakongym-v7.0.5-ota'");
    expect(swSrc).toContain("contentType.includes('text/html')");
    expect(swSrc).toContain("url.pathname.startsWith('/api/')");

    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(serverSrc).toContain('app.get(/^\\/assets\\/.+/');
    expect(serverSrc).toContain('Cache-Control');

    const mainSrc = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(mainSrc).toContain('ErrorBoundary');
    expect(mainSrc).toContain('vite:preloadError');
  });
});
