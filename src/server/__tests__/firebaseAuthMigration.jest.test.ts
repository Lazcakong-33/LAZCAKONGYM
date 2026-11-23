import { FieldValue } from 'firebase-admin/firestore';
import {
  handleMigrateLegacyAuth,
  handleSessionInit,
  handleVerifyInvite,
  handleRegisterWithInvite,
  handleAdminRecoverAthlete,
  handleAdminListInvites,
  handleAdminCreateInvite,
  handleAdminRevokeInvite,
  handleAdminDeleteAthlete,
} from '../authMigrationController';
import { hashToken, hashPinWithScrypt, isAuthorizedAdminToken } from '../firebaseAdminServer';
import { buildRuleCompliantAthletePatch } from '../../utils/firebaseSync';
import {
  extractGoogleVerifiedState,
  isEffectiveFrontendAdmin,
} from '../../utils/adminAuthCriterion';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

type DocStore = Record<string, Record<string, any>>;

function applySetData(existing: Record<string, any> | undefined, data: Record<string, any>, merge = false) {
  const base = merge && existing ? { ...existing } : {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && v.constructor?.name === 'DeleteTransform') {
      delete base[k];
    } else if (v === FieldValue.delete()) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return base;
}

function createStarterTierFirebaseHarness(seed?: {
  collections?: Record<string, DocStore>;
}) {
  const collections: Record<string, DocStore> = {
    athletes: {},
    athlete_credentials: {},
    invites: {},
    deleted_athletes: {},
    security_audit_logs: {},
    ...(seed?.collections || {}),
  };

  let autoDocCounter = 1;

  const makeDocRef = (colName: string, docId: string) => ({
    id: docId,
    _col: colName,
    _id: docId,
    async get() {
      const store = (collections[colName] ||= {});
      const data = store[docId];
      return {
        id: docId,
        exists: data !== undefined,
        data: () => (data ? { ...data } : undefined),
        ref: makeDocRef(colName, docId),
      };
    },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
      const store = (collections[colName] ||= {});
      store[docId] = applySetData(store[docId], data, Boolean(opts?.merge));
    },
    async update(data: Record<string, any>) {
      const store = (collections[colName] ||= {});
      if (!store[docId]) throw new Error(`Doc not found: ${colName}/${docId}`);
      store[docId] = applySetData(store[docId], data, true);
    },
    async delete() {
      const store = (collections[colName] ||= {});
      delete store[docId];
    },
  });

  const makeQuery = (colName: string, filters: Array<{ field: string; op: string; val: any }>, maxLimit?: number) => {
    const queryObj: any = {
      _col: colName,
      _filters: filters,
      _limit: maxLimit,
      where(field: string, op: string, val: any) {
        return makeQuery(colName, [...filters, { field, op, val }], maxLimit);
      },
      limit(n: number) {
        return makeQuery(colName, filters, n);
      },
      async get() {
        const store = (collections[colName] ||= {});
        let entries = Object.entries(store);
        for (const f of filters) {
          if (f.op === '==') {
            entries = entries.filter(([, d]) => d[f.field] === f.val);
          }
        }
        if (typeof maxLimit === 'number') {
          entries = entries.slice(0, maxLimit);
        }
        const docs = entries.map(([id, data]) => ({
          id,
          exists: true,
          data: () => ({ ...data }),
          ref: makeDocRef(colName, id),
        }));
        return {
          empty: docs.length === 0,
          docs,
          forEach(cb: (d: any) => void) {
            docs.forEach(cb);
          },
        };
      },
    };
    return queryObj;
  };

  const mockDb: any = {
    collection(colName: string) {
      collections[colName] ||= {};
      return {
        doc(docId?: string) {
          const resolvedId = docId || `auto_${colName}_${autoDocCounter++}`;
          return makeDocRef(colName, resolvedId);
        },
        where(field: string, op: string, val: any) {
          return makeQuery(colName, [{ field, op, val }]);
        },
        async get() {
          const docs = Object.entries(collections[colName]).map(([id, data]) => ({
            id,
            exists: true,
            data: () => ({ ...data }),
            ref: makeDocRef(colName, id),
          }));
          return {
            empty: docs.length === 0,
            docs,
            forEach(cb: (d: any) => void) {
              docs.forEach(cb);
            },
          };
        },
        async add(data: Record<string, any>) {
          const id = `audit_${autoDocCounter++}`;
          collections[colName][id] = { ...data };
          return makeDocRef(colName, id);
        },
      };
    },
    batch() {
      const ops: Array<() => Promise<void>> = [];
      return {
        set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
          ops.push(() => ref.set(data, opts));
        },
        async commit() {
          for (const op of ops) await op();
        },
      };
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
      const tx = {
        async get(target: any) {
          return target.get();
        },
        set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
          const store = (collections[ref._col] ||= {});
          store[ref._id] = applySetData(store[ref._id], data, Boolean(opts?.merge));
        },
        update(ref: any, data: Record<string, any>) {
          const store = (collections[ref._col] ||= {});
          if (!store[ref._id]) throw new Error(`Tx doc missing: ${ref._col}/${ref._id}`);
          store[ref._id] = applySetData(store[ref._id], data, true);
        },
      };
      return fn(tx);
    },
  };

  // Strict Starter Tier guard: forbid ALL Auth Admin IAM calls
  const forbiddenIam = (method: string) => () => {
    throw new Error(`Starter Tier violation: auth.${method}() must NEVER be called`);
  };
  const mockAuth: any = {
    getUser: forbiddenIam('getUser'),
    getUserByEmail: forbiddenIam('getUserByEmail'),
    createUser: forbiddenIam('createUser'),
    deleteUser: forbiddenIam('deleteUser'),
    setCustomUserClaims: forbiddenIam('setCustomUserClaims'),
    createCustomToken: forbiddenIam('createCustomToken'),
  };

  return {
    collections,
    deps: {
      getAdminServices: () => ({ auth: mockAuth, db: mockDb }),
      checkRateLimitDistributed: async () => ({ allowed: true }),
      resetRateLimitDistributed: async () => {},
    },
  };
}

describe('LAZCAKONGYM Google Cloud Starter Tier Auth Suite', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'admin@example.invalid';
  });

  afterAll(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  describe('handleSessionInit (/api/auth/session-init)', () => {
    test('grants admin:true ONLY to verified Google Master Admin email without Auth Admin IAM calls and bootstraps single master profile', async () => {
      const harness = createStarterTierFirebaseHarness();

      const req: any = {
        user: {
          uid: 'uid_master_admin',
          email: 'admin@example.invalid',
          isAdmin: true,
          emailVerified: true,
          signInProvider: 'google.com',
        },
      };
      const res = createMockRes();

      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(200);
      expect(res.body.isAdmin).toBe(true);
      expect(res.body.athleteId).toBe('perfil_admin_master');
      expect(harness.collections.athletes['perfil_admin_master'].isAdmin).toBe(true);
      expect(harness.collections.athletes['perfil_admin_master'].authUid).toBe('uid_master_admin');
      expect(harness.collections.athletes['perfil_admin_master'].pin).toBeUndefined();
    });

    test('NEVER grants admin or auto-links Master Admin profile via non-Google password login or unverified email', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_admin_master: {
              id: 'perfil_admin_master',
              email: 'admin@example.invalid',
              isAdmin: true,
            },
          },
        },
      });

      const reqPasswordProvider: any = {
        user: {
          uid: 'uid_password_attacker',
          email: 'admin@example.invalid',
          isAdmin: false, // Server middleware rejects password provider for Admin
          emailVerified: true,
          signInProvider: 'password',
        },
      };
      const res = createMockRes();
      await handleSessionInit(reqPasswordProvider, res, harness.deps);

      expect(res.statusCode).toBe(409);
      expect(res.body.requiresLegacyVerification).toBe(true);
      expect(harness.collections.athletes['perfil_admin_master'].authUid).toBeUndefined();
    });

    test('never grants admin:true to non-admin athletes linked by authUid even if athlete.isAdmin was poisoned in DB, strips pin, and preserves history', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_poisoned_01: {
              id: 'perfil_poisoned_01',
              name: 'Atleta Con Historial',
              email: 'atleta@gym.com',
              authUid: 'uid_atleta',
              isAdmin: true, // Poisoned flag in Firestore
              pin: '1234',
              routines: [{ id: 'rut_1', name: 'Push A' }],
              history: [{ id: 'w_1', totalVolumeKg: 4200 }],
              prs: { press_banca: { weightKg: 100 } },
            },
          },
        },
      });

      const req: any = {
        user: {
          uid: 'uid_atleta',
          email: 'atleta@gym.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
      };
      const res = createMockRes();

      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(200);
      expect(res.body.isAdmin).toBe(false);
      expect(res.body.athleteId).toBe('perfil_poisoned_01');
      const updated = harness.collections.athletes['perfil_poisoned_01'];
      expect(updated.isAdmin).toBe(false);
      expect(updated.authUid).toBe('uid_atleta');
      expect('pin' in updated).toBe(false);
      expect(updated.routines).toHaveLength(1);
      expect(updated.history).toHaveLength(1);
      expect(updated.prs.press_banca.weightKg).toBe(100);
    });

    test('NEVER auto-links an unlinked non-admin legacy profile solely because entered/Google email matches (returns 409 requiresLegacyVerification)', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_legacy_carlos: {
              id: 'perfil_legacy_carlos',
              name: 'Carlos Antiguo',
              email: 'carlos@gym.com',
              pin: '4321',
              routines: [{ id: 'r1', name: 'Pierna' }],
              history: [{ id: 'h1', totalVolumeKg: 6000 }],
            },
          },
        },
      });

      const req: any = {
        user: {
          uid: 'uid_unverified_claimer',
          email: 'carlos@gym.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
      };
      const res = createMockRes();

      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.requiresLegacyVerification).toBe(true);
      expect(harness.collections.athletes['perfil_legacy_carlos'].authUid).toBeUndefined();
    });

    test('rejects 403 for brand-new non-admin user without existing athlete profile', async () => {
      const harness = createStarterTierFirebaseHarness();
      const req: any = {
        user: {
          uid: 'uid_stranger',
          email: 'stranger@gym.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
      };
      const res = createMockRes();

      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(Object.keys(harness.collections.athletes)).toHaveLength(0);
    });

    test('rejects 409 when email already belongs to a different authUid', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_atleta_1: {
              id: 'perfil_atleta_1',
              name: 'Atleta Uno',
              email: 'atleta@gym.com',
              authUid: 'uid_original_owner',
              migrationStatus: 'confirmed',
            },
          },
        },
      });

      const req: any = {
        user: {
          uid: 'uid_second_account',
          email: 'atleta@gym.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'google.com',
        },
      };
      const res = createMockRes();

      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('handleMigrateLegacyAuth (/api/auth/migrate-legacy)', () => {
    test('rejects 401 when caller is not authenticated in Firebase Auth first', async () => {
      const harness = createStarterTierFirebaseHarness();
      const res = createMockRes();
      await handleMigrateLegacyAuth(
        { ip: '127.0.0.1', body: { email: 'old@gym.com', pin: '4321' } } as any,
        res,
        harness.deps
      );
      expect(res.statusCode).toBe(401);
    });

    test('requires valid legacy PIN (scrypt), atomically binds caller authUid, deletes pin & credentials, logs audit, and preserves all history/PRs', async () => {
      const scryptPinHash = await hashPinWithScrypt('4321');
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_camilo_old: {
              id: 'perfil_camilo_old',
              name: 'Atleta Histórico',
              email: 'historico@gym.com',
              pin: '4321',
              isAdmin: true, // Poisoned DB flag must be stripped for non-admin
              routines: [{ id: 'r1', name: 'Fuerza 5x5' }],
              history: [{ id: 'h1', date: '2026-01-01', totalVolumeKg: 5100 }],
              prs: { sentadilla: { weightKg: 140 } },
              bodyWeightLogs: [{ date: '2026-01-01', weightKg: 82 }],
            },
          },
          athlete_credentials: {
            perfil_camilo_old: {
              athleteId: 'perfil_camilo_old',
              pinHash: scryptPinHash,
            },
          },
        },
      });

      const req: any = {
        ip: '127.0.0.1',
        user: {
          uid: 'uid_firebase_atleta',
          email: 'historico@gym.com',
          isAdmin: false,
          emailVerified: true,
          signInProvider: 'password',
        },
        body: { email: 'historico@gym.com', pin: '4321' },
      };
      const res = createMockRes();

      await handleMigrateLegacyAuth(req, res, harness.deps);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.athleteId).toBe('perfil_camilo_old');
      expect(res.body.authUid).toBe('uid_firebase_atleta');
      expect(res.body.isAdmin).toBe(false);
      expect(res.body.customToken).toBeUndefined();
      expect(res.body.profile.pin).toBeUndefined();
      expect(res.body.profile.routines).toHaveLength(1);
      expect(res.body.profile.history).toHaveLength(1);

      const storedAthlete = harness.collections.athletes['perfil_camilo_old'];
      expect('pin' in storedAthlete).toBe(false);
      expect(storedAthlete.isAdmin).toBe(false);
      expect(storedAthlete.migrationStatus).toBe('confirmed');
      expect(storedAthlete.authUid).toBe('uid_firebase_atleta');

      const storedCred = harness.collections.athlete_credentials['perfil_camilo_old'];
      expect('pinHash' in storedCred).toBe(false);
      expect('pin' in storedCred).toBe(false);
      expect(storedCred.linkedAuthUid).toBe('uid_firebase_atleta');
      expect(Object.keys(harness.collections.security_audit_logs)).toHaveLength(1);
    });

    test('supports single-use Coach recovery code (LZK-REC-...) issued by Master Admin and blocks reuse afterward', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_luis: {
              id: 'perfil_luis',
              name: 'Luis Atleta',
              email: 'luis@gym.com',
              routines: [{ id: 'r1', name: 'Empuje' }],
              history: [{ id: 'h1', totalVolumeKg: 3000 }],
            },
          },
        },
      });

      const recoverRes = createMockRes();
      await handleAdminRecoverAthlete(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_master',
            email: 'admin@example.invalid',
            isAdmin: true,
            emailVerified: true,
            signInProvider: 'google.com',
          },
          body: { athleteId: 'perfil_luis', reason: 'Olvidó PIN legacy' },
        } as any,
        recoverRes,
        harness.deps
      );

      expect(recoverRes.statusCode).toBe(200);
      const recoveryCode = recoverRes.body.recoveryCode as string;
      expect(recoveryCode).toMatch(/^LZK-REC-[A-F0-9]{6}$/);

      // Link using recovery code from authenticated Firebase session (even with different Google email)
      const linkRes = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_luis_google',
            email: 'luis.personal@gmail.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'google.com',
          },
          body: { email: 'luis@gym.com', pin: recoveryCode },
        } as any,
        linkRes,
        harness.deps
      );

      expect(linkRes.statusCode).toBe(200);
      expect(harness.collections.athletes['perfil_luis'].authUid).toBe('uid_luis_google');
      expect(harness.collections.athletes['perfil_luis'].history).toHaveLength(1);

      // Replay recovery code attempt fails 409/401
      const replayRes = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_intruder',
            email: 'intruder@gmail.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'google.com',
          },
          body: { email: 'luis@gym.com', pin: recoveryCode },
        } as any,
        replayRes,
        harness.deps
      );
      expect(replayRes.statusCode).toBe(409);
    });

    test('blocks password-provider takeover of Master Admin email and blocks already-linked / tombstoned athletes', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_admin_master: {
              id: 'perfil_admin_master',
              email: 'admin@example.invalid',
              pin: '9999',
              isAdmin: true,
            },
            perfil_deleted: { id: 'perfil_deleted', email: 'deleted@gym.com', pin: '1111' },
            perfil_active: { id: 'perfil_active', email: 'active@gym.com', pin: '9999' },
          },
          deleted_athletes: {
            perfil_deleted: { athleteId: 'perfil_deleted', deletedAt: '2026-01-01T00:00:00Z' },
          },
        },
      });

      const resAdminHijack = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: { uid: 'uid_bad', email: 'admin@example.invalid', isAdmin: false, signInProvider: 'password' },
          body: { email: 'admin@example.invalid', pin: '9999' },
        } as any,
        resAdminHijack,
        harness.deps
      );
      expect(resAdminHijack.statusCode).toBe(403);

      const resDeleted = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: { uid: 'uid_del', email: 'deleted@gym.com', isAdmin: false, signInProvider: 'password' },
          body: { email: 'deleted@gym.com', pin: '1111' },
        } as any,
        resDeleted,
        harness.deps
      );
      expect(resDeleted.statusCode).toBe(403);

      const resWrongPin = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: { uid: 'uid_act', email: 'active@gym.com', isAdmin: false, signInProvider: 'password' },
          body: { email: 'active@gym.com', pin: '0000' },
        } as any,
        resWrongPin,
        harness.deps
      );
      expect(resWrongPin.statusCode).toBe(401);
    });
  });

  describe('handleVerifyInvite & handleRegisterWithInvite (/api/invites/*)', () => {
    test('registers new athlete atomically using verified Firebase Auth Bearer UID, enforces isAdmin:false, and blocks reuse with 409', async () => {
      const token = 'LZK-TEST-7788';
      const harness = createStarterTierFirebaseHarness({
        collections: {
          invites: {
            [hashToken(token)]: {
              token,
              createdAt: '2026-01-01T00:00:00Z',
              createdBy: 'Coach Admin',
              used: false,
              revoked: false,
            },
          },
        },
      });

      // Verify invite status first
      const verifyRes = createMockRes();
      await handleVerifyInvite({ ip: '127.0.0.1', body: { token } } as any, verifyRes, harness.deps);
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body.valid).toBe(true);
      expect(verifyRes.body.status).toBe('valid');

      // Register first athlete (must be authenticated via Client SDK Firebase Auth)
      const regRes = createMockRes();
      await handleRegisterWithInvite(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_client_signup_1',
            email: 'nuevo@gym.com',
            isAdmin: false,
            emailVerified: false,
            signInProvider: 'password',
          },
          body: {
            token,
            name: 'Nuevo Atleta',
            email: 'nuevo@gym.com',
            avatar: '🦁',
            goal: 'Hipertrofia & Masa',
          },
        } as any,
        regRes,
        harness.deps
      );

      expect(regRes.statusCode).toBe(201);
      expect(regRes.body.success).toBe(true);
      expect(regRes.body.isAdmin).toBe(false);
      expect(regRes.body.authUid).toBe('uid_client_signup_1');
      expect(regRes.body.customToken).toBeUndefined();
      const createdAthlete = harness.collections.athletes[regRes.body.athleteId];
      expect(createdAthlete.isAdmin).toBe(false);
      expect(createdAthlete.authUid).toBe('uid_client_signup_1');
      expect('pin' in createdAthlete).toBe(false);
      expect(createdAthlete.migrationStatus).toBe('confirmed');
      expect(harness.collections.invites[hashToken(token)].used).toBe(true);

      // Verify second check returns status: used
      const verifyUsedRes = createMockRes();
      await handleVerifyInvite({ ip: '127.0.0.1', body: { token } } as any, verifyUsedRes, harness.deps);
      expect(verifyUsedRes.statusCode).toBe(200);
      expect(verifyUsedRes.body.valid).toBe(false);
      expect(verifyUsedRes.body.status).toBe('used');

      // Attempt second registration with same invite -> 409
      const reuseRes = createMockRes();
      await handleRegisterWithInvite(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_client_signup_2',
            email: 'segundo@gym.com',
            isAdmin: false,
            signInProvider: 'password',
          },
          body: {
            token,
            name: 'Segundo Atleta',
            email: 'segundo@gym.com',
          },
        } as any,
        reuseRes,
        harness.deps
      );
      expect(reuseRes.statusCode).toBe(409);
    });

    test('rejects unauthenticated call (401), duplicate email (409), and preserves invite when duplicate detected in tx', async () => {
      const token = 'LZK-DUP-9900';
      const tokenHash = hashToken(token);
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_dup: { id: 'perfil_dup', email: 'duplicado@gym.com', name: 'Existente', authUid: 'uid_existing' },
          },
          invites: {
            [tokenHash]: {
              token,
              createdAt: '2026-01-01T00:00:00Z',
              createdBy: 'Coach Admin',
              used: false,
              revoked: false,
            },
          },
        },
      });

      const unauthRes = createMockRes();
      await handleRegisterWithInvite(
        { ip: '127.0.0.1', body: { token, name: 'NoAuth', email: 'a@b.com' } } as any,
        unauthRes,
        harness.deps
      );
      expect(unauthRes.statusCode).toBe(401);

      const dupEmailRes = createMockRes();
      await handleRegisterWithInvite(
        {
          ip: '127.0.0.1',
          user: { uid: 'uid_new', email: 'duplicado@gym.com', isAdmin: false, signInProvider: 'password' },
          body: { token, name: 'Duplicado', email: 'duplicado@gym.com' },
        } as any,
        dupEmailRes,
        harness.deps
      );
      expect(dupEmailRes.statusCode).toBe(409);
      expect(harness.collections.invites[tokenHash].used).toBe(false);
    });
  });

  describe('Admin endpoints (/api/admin/*)', () => {
    test('rejects non-admin callers with 403 across all admin invite and athlete delete handlers', async () => {
      const harness = createStarterTierFirebaseHarness();
      const nonAdminReq: any = {
        user: { uid: 'uid_user', email: 'atleta@gym.com', isAdmin: false },
        params: { token: 'LZK-AAAA-BBBB', athleteId: 'perfil_1' },
        body: {},
      };
      const forgedEmailNonGoogleReq: any = {
        user: { uid: 'uid_fake', email: 'admin@example.invalid', isAdmin: false, signInProvider: 'password' },
        params: { token: 'LZK-AAAA-BBBB', athleteId: 'perfil_1' },
        body: {},
      };

      for (const req of [nonAdminReq, forgedEmailNonGoogleReq]) {
        for (const handler of [
          handleAdminListInvites,
          handleAdminCreateInvite,
          handleAdminRevokeInvite,
          handleAdminDeleteAthlete,
        ]) {
          const res = createMockRes();
          await handler(req, res, harness.deps);
          expect(res.statusCode).toBe(403);
        }
      }
    });

    test('allows verified Google Master Admin to create, list, revoke invites and safely tombstone/delete athletes', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_admin_master: {
              id: 'perfil_admin_master',
              email: 'admin@example.invalid',
              authUid: 'uid_master',
              isAdmin: true,
            },
            perfil_victim: {
              id: 'perfil_victim',
              email: 'victim@gym.com',
              authUid: 'uid_victim',
              isAdmin: false,
            },
          },
          athlete_credentials: {
            perfil_victim: { pinHash: 'scrypt$16384$8$1$aa$bb' },
          },
        },
      });

      const adminUser = {
        uid: 'uid_master',
        email: 'admin@example.invalid',
        isAdmin: true,
        emailVerified: true,
        signInProvider: 'google.com',
      };

      // Create invite
      const createRes = createMockRes();
      await handleAdminCreateInvite(
        { user: adminUser, body: { note: 'VIP Test' } } as any,
        createRes,
        harness.deps
      );
      expect(createRes.statusCode).toBe(201);
      const token = createRes.body.invite.token;
      expect(token).toMatch(/^LZK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      // List invites
      const listRes = createMockRes();
      await handleAdminListInvites({ user: adminUser } as any, listRes, harness.deps);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.invites).toHaveLength(1);
      expect(listRes.body.invites[0].token).toBe(token);

      // Revoke invite
      const revokeRes = createMockRes();
      await handleAdminRevokeInvite(
        { user: adminUser, params: { token }, body: {} } as any,
        revokeRes,
        harness.deps
      );
      expect(revokeRes.statusCode).toBe(200);
      expect(Object.keys(harness.collections.invites)).toHaveLength(0);

      // Prevent Master Admin self-deletion
      const selfDeleteRes = createMockRes();
      await handleAdminDeleteAthlete(
        { user: adminUser, params: { athleteId: 'perfil_admin_master' } } as any,
        selfDeleteRes,
        harness.deps
      );
      expect(selfDeleteRes.statusCode).toBe(400);

      // Delete athlete cleanly
      const delRes = createMockRes();
      await handleAdminDeleteAthlete(
        { user: adminUser, params: { athleteId: 'perfil_victim' } } as any,
        delRes,
        harness.deps
      );
      expect(delRes.statusCode).toBe(200);
      expect(harness.collections.athletes['perfil_victim']).toBeUndefined();
      expect(harness.collections.athlete_credentials['perfil_victim']).toBeUndefined();
      expect(harness.collections.deleted_athletes['perfil_victim']).toBeDefined();
      expect(Object.keys(harness.collections.security_audit_logs)).toHaveLength(1);
    });
  });

  describe('buildRuleCompliantAthletePatch client Firestore guard', () => {
    test('strips pin, isAdmin, authUid, migrationStatus, legacyPinPurged, serverIdentityVerified and undefined values while retaining training data', () => {
      const patch = buildRuleCompliantAthletePatch({
        id: 'perfil_1',
        name: 'Atleta',
        pin: '1234',
        isAdmin: true,
        authUid: 'spoofed_uid',
        migrationStatus: 'confirmed',
        legacyPinPurged: true,
        serverIdentityVerified: true,
        themeAccent: undefined,
        routines: [{ id: 'r1', name: 'Empuje' }],
        history: [{ id: 'w1', totalVolumeKg: 3500, optionalNote: undefined }],
        prs: { sentadilla: { weightKg: 130 } },
      });

      expect('pin' in patch).toBe(false);
      expect('isAdmin' in patch).toBe(false);
      expect('authUid' in patch).toBe(false);
      expect('migrationStatus' in patch).toBe(false);
      expect('legacyPinPurged' in patch).toBe(false);
      expect('serverIdentityVerified' in patch).toBe(false);
      expect('themeAccent' in patch).toBe(false);
      expect(patch.id).toBe('perfil_1');
      expect((patch.routines as any[]).length).toBe(1);
      expect('optionalNote' in (patch.history as any[])[0]).toBe(false);
      expect((patch.prs as any).sentadilla.weightKg).toBe(130);
    });
  });

  describe('Frontend + Backend Admin Authorization Parity (Starter Tier)', () => {
    test('server respects custom ADMIN_EMAILS env config without hardcoded frontend email conflict', async () => {
      const prevAdminEmails = process.env.ADMIN_EMAILS;
      process.env.ADMIN_EMAILS = 'custom.coach@gym.com';
      try {
        const harness = createStarterTierFirebaseHarness({
          collections: {
            athletes: {
              perfil_camilo: {
                id: 'perfil_camilo',
                name: 'CamiloLazcano',
                email: 'custom.coach@gym.com',
                authUid: 'uid_custom_coach',
                isAdmin: false,
              },
            },
          },
        });

        const googleTokenIsAdmin = isAuthorizedAdminToken({
          email: 'custom.coach@gym.com',
          emailVerified: true,
          signInProvider: 'google.com',
        });
        expect(googleTokenIsAdmin).toBe(true);

        const req: any = {
          user: {
            uid: 'uid_custom_coach',
            email: 'custom.coach@gym.com',
            isAdmin: googleTokenIsAdmin,
            emailVerified: true,
            signInProvider: 'google.com',
          },
        };
        const res = createMockRes();
        await handleSessionInit(req, res, harness.deps);

        expect(res.statusCode).toBe(200);
        expect(res.body.isAdmin).toBe(true);
        expect(res.body.adminRequiresGoogleSignIn).toBe(false);
        expect(res.body.signInProvider).toBe('google.com');

        const tokenState = extractGoogleVerifiedState(
          { signInProvider: 'google.com', claims: { email_verified: true } },
          true
        );
        expect(tokenState.isGoogleVerified).toBe(true);
        expect(
          isEffectiveFrontendAdmin({
            hasAuthUser: true,
            isGoogleVerifiedSession: tokenState.isGoogleVerified,
            serverAdminVerified: Boolean(res.body.isAdmin),
          })
        ).toBe(true);
      } finally {
        if (prevAdminEmails === undefined) {
          delete process.env.ADMIN_EMAILS;
        } else {
          process.env.ADMIN_EMAILS = prevAdminEmails;
        }
      }
    });

    test('linked admin profile signing in with password gets isAdmin:false and adminRequiresGoogleSignIn:true', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_camilo: {
              id: 'perfil_camilo',
              name: 'CamiloLazcano',
              email: 'admin@example.invalid',
              authUid: 'uid_camilo',
              isAdmin: true,
            },
          },
        },
      });

      const passwordTokenIsAdmin = isAuthorizedAdminToken({
        email: 'admin@example.invalid',
        emailVerified: true,
        signInProvider: 'password',
      });
      expect(passwordTokenIsAdmin).toBe(false);

      const req: any = {
        user: {
          uid: 'uid_camilo',
          email: 'admin@example.invalid',
          isAdmin: passwordTokenIsAdmin,
          emailVerified: true,
          signInProvider: 'password',
        },
      };
      const res = createMockRes();
      await handleSessionInit(req, res, harness.deps);

      expect(res.statusCode).toBe(200);
      expect(res.body.athleteId).toBe('perfil_camilo');
      expect(res.body.isAdmin).toBe(false);
      expect(res.body.adminRequiresGoogleSignIn).toBe(true);

      const tokenState = extractGoogleVerifiedState(
        { signInProvider: 'password', claims: { email_verified: true, admin: true } },
        true
      );
      expect(tokenState.isGoogleVerified).toBe(false);
      expect(
        isEffectiveFrontendAdmin({
          hasAuthUser: true,
          isGoogleVerifiedSession: tokenState.isGoogleVerified,
          serverAdminVerified: Boolean(res.body.isAdmin),
        })
      ).toBe(false);
    });

    test('extractGoogleVerifiedState ignores Custom Claims and requires both google.com and email_verified', () => {
      expect(
        extractGoogleVerifiedState({
          signInProvider: 'password',
          claims: { admin: true, email_verified: true },
        }).isGoogleVerified
      ).toBe(false);

      expect(
        extractGoogleVerifiedState({
          signInProvider: 'google.com',
          claims: { email_verified: false },
        }).isGoogleVerified
      ).toBe(false);

      expect(
        extractGoogleVerifiedState({
          signInProvider: null,
          claims: { firebase: { sign_in_provider: 'google.com' }, email_verified: true },
        })
      ).toEqual({ isGoogleVerified: true, signInProvider: 'google.com' });
    });
  });

  describe('Already-Migrated Account Login & Password Change Regression Suite', () => {
    test('already-migrated profile after password change authenticates directly via Email/Password and Google using authUid without redirecting to legacy PIN linking', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_migrado_01: {
              id: 'perfil_migrado_01',
              name: 'Camilo Atleta Vinculado',
              email: 'vinculado@gym.com',
              authUid: 'uid_vinculado_01',
              migrationStatus: 'confirmed',
              legacyPinPurged: true,
              isAdmin: false,
              routines: [{ id: 'rut_push', name: 'Push Hipertrofia' }],
              history: [{ id: 'hist_1', date: '2026-03-10', totalVolumeKg: 5400 }],
              prs: { press_banca: { weightKg: 115 } },
            },
          },
        },
      });

      // 1. If the user accidentally hits /api/auth/migrate-legacy, server returns alreadyMigrated: true, sameUid: true
      const migrateAttemptRes = createMockRes();
      await handleMigrateLegacyAuth(
        {
          ip: '127.0.0.1',
          user: {
            uid: 'uid_vinculado_01',
            email: 'vinculado@gym.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'password',
          },
          body: { email: 'vinculado@gym.com', pin: 'NewPassword2026!' },
        } as any,
        migrateAttemptRes,
        harness.deps
      );
      expect(migrateAttemptRes.statusCode).toBe(409);
      expect(migrateAttemptRes.body.alreadyMigrated).toBe(true);
      expect(migrateAttemptRes.body.sameUid).toBe(true);

      // 2. Normal login with Email + Password (after password change in Firebase Auth) resolves profile by authUid
      const passwordSessionRes = createMockRes();
      await handleSessionInit(
        {
          user: {
            uid: 'uid_vinculado_01',
            email: 'vinculado@gym.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'password',
          },
        } as any,
        passwordSessionRes,
        harness.deps
      );
      expect(passwordSessionRes.statusCode).toBe(200);
      expect(passwordSessionRes.body.success).toBe(true);
      expect(passwordSessionRes.body.athleteId).toBe('perfil_migrado_01');
      expect(passwordSessionRes.body.authUid).toBe('uid_vinculado_01');
      expect(passwordSessionRes.body.requiresLegacyVerification).toBeUndefined();
      expect(passwordSessionRes.body.profile.routines).toHaveLength(1);
      expect(passwordSessionRes.body.profile.history).toHaveLength(1);
      expect(passwordSessionRes.body.profile.prs.press_banca.weightKg).toBe(115);

      // 3. Normal login with Google resolves the exact same profile by authUid without creating duplicates
      const googleSessionRes = createMockRes();
      await handleSessionInit(
        {
          user: {
            uid: 'uid_vinculado_01',
            email: 'vinculado@gym.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'google.com',
          },
        } as any,
        googleSessionRes,
        harness.deps
      );
      expect(googleSessionRes.statusCode).toBe(200);
      expect(googleSessionRes.body.success).toBe(true);
      expect(googleSessionRes.body.athleteId).toBe('perfil_migrado_01');
      expect(googleSessionRes.body.authUid).toBe('uid_vinculado_01');
      expect(Object.keys(harness.collections.athletes)).toEqual(['perfil_migrado_01']);
    });

    test('reports linkingConflict (and never requiresLegacyVerification) when an already-migrated profile has a missing or conflicting authUid', async () => {
      const harness = createStarterTierFirebaseHarness({
        collections: {
          athletes: {
            perfil_migrado_conflict: {
              id: 'perfil_migrado_conflict',
              name: 'Perfil Ya Migrado Sin UID Coincidente',
              email: 'conflicto@gym.com',
              migrationStatus: 'confirmed',
              legacyPinPurged: true,
              isAdmin: false,
            },
          },
        },
      });

      const res = createMockRes();
      await handleSessionInit(
        {
          user: {
            uid: 'uid_otro_proveedor',
            email: 'conflicto@gym.com',
            isAdmin: false,
            emailVerified: true,
            signInProvider: 'password',
          },
        } as any,
        res,
        harness.deps
      );

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.linkingConflict).toBe(true);
      expect(res.body.requiresLegacyVerification).toBe(false);
    });
  });
});
