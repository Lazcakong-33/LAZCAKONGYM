/**
 * Automated Verification Suite: LAZCAKONG GYM 7.0 — Admin Access & UI Hydration Repair
 *
 * Strictly uses synthetic test fixtures and in-memory mocks/harnesses.
 * Zero reads or writes against production Firebase or real athlete profiles.
 *
 * Verifies:
 * 1. Legitimate Google Admin login (no custom claims, no username trust).
 * 2. Post-login role hydration (AuthProvider onIdTokenChanged + forced refresh + useGymState late admin binding/roster hydration).
 * 3. Android APK close/reopen session restore & canonical API URL origin protection against stale preview origins.
 * 4. Admin UI visibility in Navigation, TodayView, SettingsCloudView, and ProfileModal (rendered HTML checks).
 * 5. Regular non-admin user blocked from Admin UI and Admin data.
 * 6. Unauthorized access rejected across all Admin API controllers (HTTP 401/403).
 * 7. localStorage tampering / display-name spoofing ("LAZCAKONG_33") cannot escalate privileges.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { Navigation } from '../../components/Navigation.tsx';
import { ProfileModal } from '../../components/ProfileModal.tsx';
import { TodayView } from '../../views/TodayView.tsx';
import { SettingsCloudView } from '../../views/SettingsCloudView.tsx';
import { ThemeProvider } from '../../context/ThemeContext.tsx';
import {
  extractGoogleVerifiedState,
  isEffectiveFrontendAdmin,
} from '../../utils/adminAuthCriterion.ts';
import {
  canResumeInstantLocalSession,
  getOfflineSessionBinding,
  OFFLINE_SESSION_BINDING_KEY,
  saveOfflineSessionBinding,
} from '../../utils/offlineSessionManager.ts';
import { resolveApiUrl } from '../../utils/apiUrl.ts';
import { isAuthorizedAdminToken } from '../firebaseAdminServer.ts';
import {
  handleAdminBroadcastUpdate,
  handleAdminCreateInvite,
  handleAdminDeleteAthlete,
  handleAdminListInvites,
  handleAdminRecoverAthlete,
  handleAdminRevokeInvite,
  handleSessionInit,
} from '../authMigrationController.ts';
import type { Profile } from '../../types/index.ts';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function createMockRes() {
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

function createSyntheticFirestoreHarness(seed?: Record<string, Record<string, Record<string, any>>>) {
  const collections: Record<string, Record<string, Record<string, any>>> = {
    athletes: {},
    athlete_credentials: {},
    invites: {},
    deleted_athletes: {},
    security_audit_logs: {},
    ...(seed || {}),
  };

  let counter = 1;
  const makeDocRef = (col: string, id: string) => ({
    id,
    _col: col,
    _id: id,
    async get() {
      const doc = collections[col]?.[id];
      return {
        id,
        exists: doc !== undefined,
        data: () => (doc ? { ...doc } : undefined),
        ref: makeDocRef(col, id),
      };
    },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
      collections[col] ||= {};
      collections[col][id] = opts?.merge && collections[col][id] ? { ...collections[col][id], ...data } : { ...data };
    },
    async update(data: Record<string, any>) {
      collections[col] ||= {};
      collections[col][id] = { ...(collections[col][id] || {}), ...data };
    },
    async delete() {
      if (collections[col]) delete collections[col][id];
    },
  });

  const makeQuery = (col: string, filters: Array<{ field: string; op: string; val: any }>, max?: number) => ({
    where(field: string, op: string, val: any) {
      return makeQuery(col, [...filters, { field, op, val }], max);
    },
    limit(n: number) {
      return makeQuery(col, filters, n);
    },
    async get() {
      let entries = Object.entries(collections[col] || {});
      for (const f of filters) {
        if (f.op === '==') {
          entries = entries.filter(([, d]) => d[f.field] === f.val);
        }
      }
      if (typeof max === 'number') entries = entries.slice(0, max);
      const docs = entries.map(([id, data]) => ({
        id,
        exists: true,
        data: () => ({ ...data }),
        ref: makeDocRef(col, id),
      }));
      return {
        empty: docs.length === 0,
        docs,
        forEach(cb: (d: any) => void) {
          docs.forEach(cb);
        },
      };
    },
  });

  const db: any = {
    collection(col: string) {
      collections[col] ||= {};
      return {
        doc(id?: string) {
          return makeDocRef(col, id || `auto_${col}_${counter++}`);
        },
        where(field: string, op: string, val: any) {
          return makeQuery(col, [{ field, op, val }]);
        },
        async get() {
          const docs = Object.entries(collections[col] || {}).map(([id, data]) => ({
            id,
            exists: true,
            data: () => ({ ...data }),
            ref: makeDocRef(col, id),
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
          const id = `log_${counter++}`;
          collections[col][id] = { ...data };
          return makeDocRef(col, id);
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
  };

  return {
    collections,
    deps: {
      getAdminServices: () => ({ auth: {} as any, db }),
      checkRateLimitDistributed: async () => ({ allowed: true }),
      resetRateLimitDistributed: async () => {},
    },
  };
}

function makeSyntheticProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'perfil_synthetic_1',
    name: 'Atleta Test',
    email: 'athlete@synthetic.test',
    authUid: 'uid_synthetic_1',
    avatar: '🦍',
    goal: 'Fuerza Máxima',
    weeklyTargetDays: 5,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 88,
    themeAccent: 'smartfit',
    isAdmin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithBrowserGlobals<T>(fn: () => T): T {
  const memStorage = createMemoryStorage();
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;
  const prevDocument = (globalThis as any).document;
  (globalThis as any).localStorage = memStorage;
  (globalThis as any).window = {
    localStorage: memStorage,
    location: { protocol: 'https:', hostname: 'localhost', origin: 'https://localhost' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  (globalThis as any).document = {
    documentElement: {
      style: { setProperty() {} },
      setAttribute() {},
    },
  };
  try {
    return fn();
  } finally {
    if (prevWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = prevWindow;
    if (prevLocalStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = prevLocalStorage;
    if (prevDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = prevDocument;
  }
}

async function runSuite() {
  let passed = 0;
  const check = (name: string, fn: () => void | Promise<void>) =>
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`✅ [PASS] ${name}`);
      });

  // 1. Legitimate Google Admin Login (even when profile name is display alias like LAZCAKONG_33)
  await check('1. Admin authentication resolves via verified Google ID token & allowlist (not display name)', async () => {
    const prevAdminEmail = process.env.ADMIN_EMAIL;
    const prevAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin.coach@synthetic.test';
    try {
      const harness = createSyntheticFirestoreHarness({
        athletes: {
          perfil_admin_alias: {
            id: 'perfil_admin_alias',
            name: 'LAZCAKONG_33',
            email: 'admin.coach@synthetic.test',
            authUid: 'uid_admin_google',
            isAdmin: false, // Even if Firestore profile doc had isAdmin: false, verified Google allowlist restores it
          },
        },
      });

      const isAdminClaim = isAuthorizedAdminToken({
        email: 'admin.coach@synthetic.test',
        emailVerified: true,
        signInProvider: 'google.com',
      });
      assert.equal(isAdminClaim, true);

      const res = createMockRes();
      await handleSessionInit(
        {
          user: {
            uid: 'uid_admin_google',
            email: 'admin.coach@synthetic.test',
            isAdmin: isAdminClaim,
            emailVerified: true,
            signInProvider: 'google.com',
          },
        } as any,
        res,
        harness.deps
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.isAdmin, true);
      assert.equal(res.body.adminRequiresGoogleSignIn, false);
      assert.equal(res.body.athleteId, 'perfil_admin_alias');

      const tokenState = extractGoogleVerifiedState(
        { signInProvider: 'google.com', claims: { email_verified: true } },
        true
      );
      assert.equal(tokenState.isGoogleVerified, true);
      assert.equal(
        isEffectiveFrontendAdmin({
          hasAuthUser: true,
          isGoogleVerifiedSession: tokenState.isGoogleVerified,
          serverAdminVerified: Boolean(res.body.isAdmin),
        }),
        true
      );
    } finally {
      if (prevAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = prevAdminEmail;
      if (prevAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prevAdminEmails;
    }
  });

  // 2. Role Hydration & Token Refresh Recovery invariants (AuthProvider + useGymState)
  await check('2. AuthProvider & useGymState include onIdTokenChanged, forced refresh retry, and late admin roster/binding hydration', () => {
    const authSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AuthProvider.tsx'), 'utf8');
    assert.ok(authSrc.includes('onIdTokenChanged'), 'AuthProvider must subscribe to onIdTokenChanged');
    assert.ok(authSrc.includes('getIdTokenResult(true)'), 'AuthProvider must retry forced token refresh when Google claims appear stale');

    const gymSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useGymState.ts'), 'utf8');
    assert.ok(
      gymSrc.includes('if (serverSaysAdmin && !tokenState.isGoogleVerified)') &&
        gymSrc.includes('refreshAuthSession(currentUser, true)'),
      'bootstrapAuthenticatedSession must force-refresh token when server verifies admin'
    );
    assert.ok(
      gymSrc.includes('if (payload.isAdmin && !tokenState.isGoogleVerified && auth.currentUser)') &&
        gymSrc.includes('refreshAuthSession(auth.currentUser, true)'),
      'finalizeAuthenticatedSession must force-refresh token when server verifies admin'
    );
    assert.ok(
      gymSrc.includes('adminRosterHydratedUidRef') &&
        gymSrc.includes('isAdminVerified: true') &&
        gymSrc.includes('fetchAthletesFromCloud'),
      'useGymState must synchronize offline binding and full athlete roster when admin claim settles'
    );
  });

  // 3. Android APK close/reopen restore & API origin protection
  await check('3. Android APK close/reopen preserves verified Admin binding and ignores temporary ais-dev/ais-pre API overrides', () => {
    const storage = createMemoryStorage();
    const adminProfile = makeSyntheticProfile({
      id: 'perfil_admin_android',
      name: 'LAZCAKONG_33',
      isAdmin: true,
    });

    const saved = saveOfflineSessionBinding(
      {
        uid: 'uid_admin_google',
        athleteId: adminProfile.id,
        isGoogleVerified: true,
        isAdminVerified: true,
        profile: adminProfile,
      },
      storage
    );
    assert.equal(saved?.isAdminVerified, true);

    const reopened = canResumeInstantLocalSession({
      authUserUid: 'uid_admin_google',
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(reopened.allowed, true);
    assert.equal(reopened.isAdminVerified, true);
    assert.equal(reopened.athleteId, adminProfile.id);

    // Simulate Capacitor Android runtime with stale preview localStorage override
    const prevWindow = (globalThis as any).window;
    const prevLocalStorage = (globalThis as any).localStorage;
    const apkStorage = createMemoryStorage();
    apkStorage.setItem('lazcakon_api_base_url', 'https://ais-dev-stale-preview-123.run.app');
    (globalThis as any).localStorage = apkStorage;
    (globalThis as any).window = {
      localStorage: apkStorage,
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
      location: { protocol: 'https:', hostname: 'localhost', origin: 'https://localhost' },
    };
    try {
      const apiUrl = resolveApiUrl('/api/auth/session-init');
      assert.equal(
        apiUrl,
        'https://lazcakongym.ai.studio/api/auth/session-init',
        'Capacitor Android must ignore stale ais-dev-* localStorage overrides and target canonical backend'
      );
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
      if (prevLocalStorage === undefined) delete (globalThis as any).localStorage;
      else (globalThis as any).localStorage = prevLocalStorage;
    }
  });

  // 4. UI Visibility for Authorized Admin (Navigation, TodayView, SettingsCloudView, ProfileModal)
  await check('4. Authorized Admin sees Admin tab in Navigation, shortcut in TodayView, card in SettingsCloudView, and entry in ProfileModal', () => {
    const adminProfile = makeSyntheticProfile({ name: 'LAZCAKONG_33', isAdmin: true });
    const noop = () => {};
    const noopAsync = async () => ({ success: true, message: 'ok' });

    const navHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Navigation, {
        currentTab: 'hoy',
        onTabChange: noop,
        hasActiveWorkout: false,
        isAdmin: true,
      })
    );
    assert.ok(navHtml.includes('data-testid="nav-tab-admin"'), 'Navigation must render Admin tab when isAdmin=true');

    const todayHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(TodayView, {
          routines: [],
          history: [],
          prs: {},
          activeSession: null,
          activeProfile: adminProfile,
          onStartWorkout: noop,
          onNavigateActive: noop,
          onSelectDay: noop,
          onOpenCreateRoutine: noop,
          onOpenPlateCalculator: noop,
          onNavigateTab: noop,
          onOpenInstallApk: noop,
          onOpenAIRoutineModal: noop,
          onOpenProfileSwitcher: noop,
          isAdmin: true,
        })
      )
    );
    assert.ok(todayHtml.includes('data-testid="today-admin-btn"'), 'TodayView header must render Admin button when isAdmin=true');

    const modalHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ProfileModal, {
        isOpen: true,
        onClose: noop,
        profiles: [adminProfile],
        activeProfileId: adminProfile.id,
        isAdmin: true,
        onSwitchProfile: noop,
        onCreateProfile: noop,
        onDeleteProfile: noop,
        onNavigateTab: noop,
      })
    );
    assert.ok(modalHtml.includes('Panel de Administración'), 'ProfileModal must render Admin Panel button when isAdmin=true');

    const settingsHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          {
            profileId: adminProfile.id,
            initialAccent: 'smartfit',
            children: React.createElement(SettingsCloudView, {
              activeProfile: adminProfile,
              onUpdateProfile: noop,
              onOpenProfileSwitcher: noop,
              onLogout: noop,
              onOpenPlateCalculator: noop,
              onExportBackup: () => ({ success: true }),
              onInspectBackup: () => ({ valid: true, summary: { profiles: 1, routines: 0, workouts: 0, prs: 0, bodyWeightLogs: 0 }, errors: [] }) as any,
              onImportBackup: () => ({ success: true, message: 'ok' }),
              onResetRoutines: noop,
              onSyncCloud: noopAsync,
              onNavigateToTab: noop,
              isAdmin: true,
            }),
          }
        )
      )
    );
    assert.ok(
      settingsHtml.includes('data-testid="settings-admin-panel-btn"'),
      'SettingsCloudView must render Admin Panel button when isAdmin=true'
    );
  });

  // 5. Password sign-in warning banner + Regular Non-Admin user blocked from all Admin UI
  await check('5. Regular user never sees Admin UI, while password-signed admin sees Google Sign-In warning without granting Admin access', () => {
    const regularProfile = makeSyntheticProfile({ name: 'Atleta Regular', isAdmin: false });
    const noop = () => {};
    const noopAsync = async () => ({ success: true, message: 'ok' });

    const navUserHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Navigation, {
        currentTab: 'hoy',
        onTabChange: noop,
        hasActiveWorkout: false,
        isAdmin: false,
      })
    );
    assert.equal(navUserHtml.includes('nav-tab-admin'), false);

    const todayUserHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(TodayView, {
          routines: [],
          history: [],
          prs: {},
          activeSession: null,
          activeProfile: regularProfile,
          onStartWorkout: noop,
          onNavigateActive: noop,
          onSelectDay: noop,
          onOpenCreateRoutine: noop,
          onOpenPlateCalculator: noop,
          onNavigateTab: noop,
          onOpenInstallApk: noop,
          onOpenAIRoutineModal: noop,
          onOpenProfileSwitcher: noop,
          isAdmin: false,
          adminRequiresGoogleSignIn: false,
        })
      )
    );
    assert.equal(todayUserHtml.includes('today-admin-btn'), false);
    assert.equal(todayUserHtml.includes('admin-requires-google-banner'), false);

    const settingsUserHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          {
            profileId: regularProfile.id,
            initialAccent: 'smartfit',
            children: React.createElement(SettingsCloudView, {
              activeProfile: regularProfile,
              onUpdateProfile: noop,
              onOpenProfileSwitcher: noop,
              onLogout: noop,
              onOpenPlateCalculator: noop,
              onExportBackup: () => ({ success: true }),
              onInspectBackup: () => ({ valid: true, summary: { profiles: 1, routines: 0, workouts: 0, prs: 0, bodyWeightLogs: 0 }, errors: [] }) as any,
              onImportBackup: () => ({ success: true, message: 'ok' }),
              onResetRoutines: noop,
              onSyncCloud: noopAsync,
              onNavigateToTab: noop,
              isAdmin: false,
              adminRequiresGoogleSignIn: false,
            }),
          }
        )
      )
    );
    assert.equal(settingsUserHtml.includes('settings-admin-panel-btn'), false);
    assert.equal(settingsUserHtml.includes('settings-admin-requires-google'), false);

    // Now test password-signed admin (isAdmin=false, adminRequiresGoogleSignIn=true)
    const todayWarnHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(TodayView, {
          routines: [],
          history: [],
          prs: {},
          activeSession: null,
          activeProfile: makeSyntheticProfile({ name: 'LAZCAKONG_33', isAdmin: true }),
          onStartWorkout: noop,
          onNavigateActive: noop,
          onSelectDay: noop,
          onOpenCreateRoutine: noop,
          onOpenPlateCalculator: noop,
          onNavigateTab: noop,
          onOpenInstallApk: noop,
          onOpenAIRoutineModal: noop,
          onOpenProfileSwitcher: noop,
          isAdmin: false,
          adminRequiresGoogleSignIn: true,
        })
      )
    );
    assert.equal(todayWarnHtml.includes('today-admin-btn'), false);
    assert.ok(todayWarnHtml.includes('data-testid="admin-requires-google-banner"'));

    const settingsWarnHtml = renderWithBrowserGlobals(() =>
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          {
            profileId: regularProfile.id,
            initialAccent: 'smartfit',
            children: React.createElement(SettingsCloudView, {
              activeProfile: regularProfile,
              onUpdateProfile: noop,
              onOpenProfileSwitcher: noop,
              onLogout: noop,
              onOpenPlateCalculator: noop,
              onExportBackup: () => ({ success: true }),
              onInspectBackup: () => ({ valid: true, summary: { profiles: 1, routines: 0, workouts: 0, prs: 0, bodyWeightLogs: 0 }, errors: [] }) as any,
              onImportBackup: () => ({ success: true, message: 'ok' }),
              onResetRoutines: noop,
              onSyncCloud: noopAsync,
              onNavigateToTab: noop,
              isAdmin: false,
              adminRequiresGoogleSignIn: true,
            }),
          }
        )
      )
    );
    assert.equal(settingsWarnHtml.includes('settings-admin-panel-btn'), false);
    assert.ok(settingsWarnHtml.includes('data-testid="settings-admin-requires-google"'));
  });

  // 6. Admin Backend Endpoints Reject Unauthorized Access (HTTP 403)
  await check('6. All backend Admin endpoints reject non-admin, password-only, and LAZCAKONG_33 spoofed callers with HTTP 403', async () => {
    const harness = createSyntheticFirestoreHarness();
    const unauthorizedCallers = [
      { uid: 'uid_regular', email: 'regular@synthetic.test', isAdmin: false, signInProvider: 'google.com' },
      { uid: 'uid_password', email: 'kmiloko19@gmail.com', isAdmin: false, signInProvider: 'password' },
      { uid: 'uid_spoof_name', name: 'LAZCAKONG_33', email: 'spoof@synthetic.test', isAdmin: false, signInProvider: 'google.com' },
    ];

    const handlers = [
      handleAdminListInvites,
      handleAdminCreateInvite,
      handleAdminRevokeInvite,
      handleAdminDeleteAthlete,
      handleAdminRecoverAthlete,
      handleAdminBroadcastUpdate,
    ];

    for (const user of unauthorizedCallers) {
      for (const handler of handlers) {
        const res = createMockRes();
        await handler(
          {
            user,
            params: { token: 'LZK-TEST-0000', athleteId: 'perfil_any' },
            body: { athleteId: 'perfil_any', message: 'test' },
          } as any,
          res,
          harness.deps
        );
        assert.equal(res.statusCode, 403, `Expected 403 for ${user.uid}`);
      }
    }
  });

  // 7. Tampering localStorage / Display Name Spoofing Cannot Escalate Privileges
  await check('7. Tampering localStorage or forging profile name "LAZCAKONG_33" with isAdmin:true NEVER grants Admin access', () => {
    const storage = createMemoryStorage();
    const forgedProfile = makeSyntheticProfile({
      id: 'perfil_forged',
      name: 'LAZCAKONG_33',
      isAdmin: true,
    });
    storage.setItem('lazcakon_profiles', JSON.stringify([forgedProfile]));
    storage.setItem('lazcakon_is_logged_in', 'true');

    // Forging raw JSON binding directly in localStorage without verified Google token
    storage.setItem(
      OFFLINE_SESSION_BINDING_KEY,
      JSON.stringify({
        version: 1,
        uid: 'uid_attacker',
        athleteId: forgedProfile.id,
        isGoogleVerified: true,
        isAdminVerified: true,
        savedAt: Date.now(),
        profileSnapshot: forgedProfile,
      })
    );

    // 7a: No Firebase Auth UID -> blocked
    const noAuth = canResumeInstantLocalSession({
      authUserUid: null,
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(noAuth.allowed, false);
    assert.equal(noAuth.isAdminVerified, false);

    // 7b: Mismatched Firebase Auth UID -> blocked
    const mismatchAuth = canResumeInstantLocalSession({
      authUserUid: 'uid_different_victim',
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(mismatchAuth.allowed, false);

    // 7c: saveOfflineSessionBinding strips admin if isGoogleVerified=false
    const downgraded = saveOfflineSessionBinding(
      {
        uid: 'uid_attacker',
        athleteId: forgedProfile.id,
        isGoogleVerified: false,
        isAdminVerified: true,
        profile: forgedProfile,
      },
      storage
    );
    assert.equal(downgraded?.isAdminVerified, false);

    // 7d: isEffectiveFrontendAdmin refuses without all 3 server+Firebase proofs even if profile.isAdmin === true
    assert.equal(
      isEffectiveFrontendAdmin({
        hasAuthUser: false,
        isGoogleVerifiedSession: true,
        serverAdminVerified: true,
      }),
      false
    );
    assert.equal(
      isEffectiveFrontendAdmin({
        hasAuthUser: true,
        isGoogleVerifiedSession: false,
        serverAdminVerified: true,
      }),
      false
    );
    assert.equal(
      isEffectiveFrontendAdmin({
        hasAuthUser: true,
        isGoogleVerifiedSession: true,
        serverAdminVerified: false,
      }),
      false
    );
  });

  console.log(`\n🎉 ALL ${passed} ADMIN ACCESS REPAIR CHECKS PASSED!`);
}

runSuite().catch((err) => {
  console.error('❌ adminAccessRepairSuite failed:', err);
  process.exit(1);
});
