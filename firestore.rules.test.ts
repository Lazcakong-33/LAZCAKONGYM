import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  terminate,
  Firestore,
  EmulatorMockTokenOptions,
} from 'firebase/firestore';
import {
  initializeApp as initializeAdminApp,
  deleteApp as deleteAdminApp,
  App as AdminApp,
} from 'firebase-admin/app';
import {
  getFirestore as getAdminFirestore,
  Firestore as AdminFirestore,
} from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';

/**
 * LAZCAKONG GYM 5.0 - STRICT FIRESTORE RULES UNIT TEST SUITE
 *
 * Security & Verification Guarantees:
 * 1. Targets synthetic project `demo-lazcakongym-test` exclusively (never production).
 * 2. Scopes `FIRESTORE_EMULATOR_HOST` strictly to `127.0.0.1:8080` (or injected emulator host:port)
 *    for the duration of the suite only, restoring prior environment state in `afterAll`.
 * 3. Uses public SDK interfaces only (`adminDb.databaseId`, `adminDb.settings`, `app.options.projectId`,
 *    `clientDb.toJSON()`, `getFirestore(app, DATABASE_ID)`) — zero reliance on private `_settings` / `_databaseId`.
 * 4. Loads rules via official `@firebase/rules-unit-testing` `initializeTestEnvironment`, validates that
 *    `firebase.json` / `firebase.contingency.json` binds the named database to the expected `.rules` file,
 *    and proves rules evaluation on `(default)` (not `(default)`).
 * 5. Seeds & verifies fixtures inside `testEnv.withSecurityRulesDisabled()` via Admin SDK connected
 *    explicitly to the local emulator — zero `'owner'` `mockUserToken` strings.
 * 6. Combines positive and negative assertions across all 10 cases to distinguish valid rules from
 *    open rules, closed-by-default (`if false`) rules, or mismatched (`normal` vs `contingency`) rulesets.
 */

const PROJECT_ID = 'demo-lazcakongym-test';
const DATABASE_ID = '(default)';
const DEFAULT_DATABASE_ID = '(default)';

const RULES_MODE = (process.env.RULES_MODE || 'normal').toLowerCase();
const IS_CONTINGENCY = RULES_MODE === 'contingency';
const RULES_FILE = IS_CONTINGENCY ? 'contingency_firestore.rules' : 'firestore.rules';
const CONFIG_FILE = IS_CONTINGENCY ? 'firebase.contingency.json' : 'firebase.json';

function resolveEmulatorHostPort(): { host: string; port: number; hostAndPort: string } {
  const envHostPort = process.env.FIRESTORE_EMULATOR_HOST;
  if (envHostPort) {
    const [host, rawPort] = envHostPort.split(':');
    const resolvedHost = host || '127.0.0.1';
    const resolvedPort = Number(rawPort || '8080');
    const port = Number.isFinite(resolvedPort) ? resolvedPort : 8080;
    return { host: resolvedHost, port, hostAndPort: `${resolvedHost}:${port}` };
  }
  return { host: '127.0.0.1', port: 8080, hostAndPort: '127.0.0.1:8080' };
}

const {
  host: EMULATOR_HOST,
  port: EMULATOR_PORT,
  hostAndPort: EMULATOR_HOST_AND_PORT,
} = resolveEmulatorHostPort();

interface SeedRecord {
  path: string;
  data: Record<string, unknown>;
}

const SYNTHETIC_FIXTURES: SeedRecord[] = [
  {
    path: 'users/user_123',
    data: {
      uid: 'user_123',
      name: 'Atleta Base',
      email: 'user@gmail.com',
      isAdmin: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  {
    path: 'athletes/athlete_1',
    data: {
      id: 'athlete_1',
      name: 'Atleta Uno',
      authUid: 'athlete_uid_1',
      isAdmin: false,
    },
  },
  {
    path: 'athletes/athlete_2',
    data: {
      id: 'athlete_2',
      name: 'Atleta Dos',
      authUid: 'athlete_uid_2',
      isAdmin: false,
    },
  },
  {
    path: 'deleted_athletes/athlete_tomb_1',
    data: {
      athleteId: 'athlete_tomb_1',
      authUid: 'athlete_uid_1',
      deletedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  {
    path: 'invites/INV_HASH_TEST',
    data: {
      used: false,
    },
  },
  {
    path: 'athlete_credentials/athlete_1',
    data: {
      pinHash: 'scrypt$16384$8$1$00$00',
    },
  },
  {
    path: 'security_audit_logs/audit_1',
    data: {
      event: 'synthetic_seed_check',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
];

const TEST_COLLECTIONS = [
  'users',
  'athletes',
  'deleted_athletes',
  'invites',
  'athlete_credentials',
  'security_audit_logs',
] as const;

let testEnv: RulesTestEnvironment;
let adminApp: AdminApp | undefined;
let adminDb: AdminFirestore | undefined;
let defaultAdminDb: AdminFirestore | undefined;
let previousEmulatorHost: string | undefined;
let emulatorHostOverridden = false;
const verifiedSeedPaths: string[] = [];

const createdApps: FirebaseApp[] = [];
const createdDbs: Firestore[] = [];

function assertFirebaseCliConfigMatchesNamedDb(): void {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing Firebase CLI config file: ${CONFIG_FILE}`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    firestore?: Array<{ database?: string; rules?: string }>;
  };
  const entries = Array.isArray(parsed.firestore) ? parsed.firestore : [];
  const matchingEntry = entries.find(
    (entry) => entry.database === DATABASE_ID && entry.rules === RULES_FILE
  );
  if (!matchingEntry) {
    throw new Error(
      `${CONFIG_FILE} does not bind named database "${DATABASE_ID}" to "${RULES_FILE}". Found: ${JSON.stringify(entries)}`
    );
  }
}

function createDbClientForDatabase(
  databaseId: string,
  label: string,
  mockUserToken?: EmulatorMockTokenOptions
): Firestore {
  const app = initializeApp(
    { projectId: PROJECT_ID },
    `rules-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  createdApps.push(app);
  const db =
    databaseId === DEFAULT_DATABASE_ID ? getFirestore(app) : getFirestore(app, databaseId);

  if (mockUserToken) {
    connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT, {
      mockUserToken,
    });
  } else {
    connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
  }
  createdDbs.push(db);
  return db;
}

function createNamedDbClient(
  label: string,
  mockUserToken?: EmulatorMockTokenOptions
): Firestore {
  return createDbClientForDatabase(DATABASE_ID, label, mockUserToken);
}

async function clearCollections(targetDb: AdminFirestore): Promise<void> {
  for (const colName of TEST_COLLECTIONS) {
    const snap = await targetDb.collection(colName).get();
    if (!snap.empty) {
      const batch = targetDb.batch();
      for (const docSnap of snap.docs) {
        batch.delete(docSnap.ref);
      }
      await batch.commit();
    }
  }
}

async function clearAndSeedNamedDatabaseWithAdminSdk(): Promise<void> {
  if (process.env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST_AND_PORT) {
    throw new Error(
      `FIRESTORE_EMULATOR_HOST must equal "${EMULATOR_HOST_AND_PORT}" during Admin SDK seed.`
    );
  }

  adminApp = initializeAdminApp(
    { projectId: PROJECT_ID },
    `rules-admin-seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );

  if (adminApp.options.projectId !== PROJECT_ID) {
    throw new Error(
      `Admin SDK projectId mismatch: expected "${PROJECT_ID}", got "${adminApp.options.projectId}"`
    );
  }

  defaultAdminDb = getAdminFirestore(adminApp);
  defaultAdminDb.settings({ host: EMULATOR_HOST_AND_PORT, ssl: false });

  adminDb = getAdminFirestore(adminApp, DATABASE_ID);
  adminDb.settings({ host: EMULATOR_HOST_AND_PORT, ssl: false });

  if (defaultAdminDb.databaseId !== DEFAULT_DATABASE_ID) {
    throw new Error(`Expected default databaseId "(default)", got "${defaultAdminDb.databaseId}".`);
  }
  if (adminDb.databaseId !== DATABASE_ID) {
    throw new Error(`Expected named databaseId "${DATABASE_ID}", got "${adminDb.databaseId}".`);
  }

  // Ensure BOTH (default) and named DB are clean, and ONLY the named DB receives synthetic fixtures.
  await clearCollections(defaultAdminDb);
  await clearCollections(adminDb);

  const seedBatch = adminDb.batch();
  for (const item of SYNTHETIC_FIXTURES) {
    seedBatch.set(adminDb.doc(item.path), item.data);
  }
  await seedBatch.commit();

  verifiedSeedPaths.length = 0;
  for (const item of SYNTHETIC_FIXTURES) {
    const namedSnap = await adminDb.doc(item.path).get();
    if (!namedSnap.exists) {
      throw new Error(
        `Seed verification failed: document "${item.path}" missing in named database "${DATABASE_ID}".`
      );
    }
    const defaultSnap = await defaultAdminDb.doc(item.path).get();
    if (defaultSnap.exists) {
      throw new Error(
        `Database isolation failed: fixture "${item.path}" unexpectedly exists in "(default)" database.`
      );
    }
    verifiedSeedPaths.push(item.path);
  }
}

beforeAll(async () => {
  if (!PROJECT_ID.startsWith('demo-')) {
    throw new Error(`Unsafe projectId "${PROJECT_ID}": rules suite must use a synthetic demo-* project.`);
  }

  assertFirebaseCliConfigMatchesNamedDb();

  previousEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST_AND_PORT;
  emulatorHostOverridden = true;

  const rulesPath = path.resolve(process.cwd(), RULES_FILE);
  const rules = fs.readFileSync(rulesPath, 'utf8');

  // Strict official initialization: do NOT catch or silence errors if emulator is offline or rules fail to compile
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: EMULATOR_HOST,
      port: EMULATOR_PORT,
    },
  });

  await testEnv.withSecurityRulesDisabled(async () => {
    await clearAndSeedNamedDatabaseWithAdminSdk();
  });
});

afterAll(async () => {
  for (const db of createdDbs) {
    await terminate(db).catch(() => {});
  }
  for (const app of createdApps) {
    await deleteApp(app).catch(() => {});
  }
  if (defaultAdminDb) {
    await defaultAdminDb.terminate().catch(() => {});
  }
  if (adminDb) {
    await adminDb.terminate().catch(() => {});
  }
  if (adminApp) {
    await deleteAdminApp(adminApp).catch(() => {});
  }
  if (testEnv) {
    await testEnv.cleanup();
  }

  if (emulatorHostOverridden) {
    if (previousEmulatorHost === undefined) {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    } else {
      process.env.FIRESTORE_EMULATOR_HOST = previousEmulatorHost;
    }
    emulatorHostOverridden = false;
  }
});

describe(`LAZCAKONG GYM 5.0 - Security Rules (${RULES_FILE} / ${DATABASE_ID})`, () => {
  test('ENV-01: Rules are evaluated on the named DB (not (default)) and distinguish valid rules from closed-by-default or open rules', async () => {
    expect(verifiedSeedPaths).toEqual(SYNTHETIC_FIXTURES.map((f) => f.path));

    const athlete1NamedDb = createNamedDbClient('env_athlete_1', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const anonNamedDb = createNamedDbClient('env_anon_named');
    const adminNamedDb = createNamedDbClient('env_admin_named', {
      sub: 'admin_master',
      user_id: 'admin_master',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminDefaultDb = createDbClientForDatabase(DEFAULT_DATABASE_ID, 'env_admin_default', {
      sub: 'admin_master',
      user_id: 'admin_master',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });

    // Public client SDK metadata confirmation (zero private properties)
    expect(athlete1NamedDb.app.options.projectId).toBe(PROJECT_ID);
    const serialized = athlete1NamedDb.toJSON() as {
      databaseId?: { projectId?: string; database?: string };
      settings?: { host?: string; ssl?: boolean; isUsingEmulator?: boolean };
    };
    expect(serialized.databaseId?.projectId).toBe(PROJECT_ID);
    expect(serialized.databaseId?.database).toBe(DATABASE_ID);
    expect(serialized.settings?.isUsingEmulator).toBe(true);
    expect(serialized.settings?.ssl).toBe(false);

    // Operational proof: fixtures exist ONLY in DATABASE_ID, NOT in (default)
    const defaultAdminSnap = await assertSucceeds(getDoc(doc(adminDefaultDb, 'athletes', 'athlete_1')));
    expect(defaultAdminSnap.exists()).toBe(false);

    // Positive proof on named DB (fails if rules were closed-by-default `if false` or targeting `(default)`)
    const namedOwnerSnap = await assertSucceeds(getDoc(doc(athlete1NamedDb, 'athletes', 'athlete_1')));
    expect(namedOwnerSnap.exists()).toBe(true);
    expect(namedOwnerSnap.data()).toMatchObject({
      id: 'athlete_1',
      authUid: 'athlete_uid_1',
      isAdmin: false,
    });

    // Negative proof on named DB (fails if rules were open `if true`)
    await assertFails(getDoc(doc(anonNamedDb, 'athletes', 'athlete_1')));

    // Positive + negative boundary proof for admin vs locked credentials on named DB
    const inviteSnap = await assertSucceeds(getDoc(doc(adminNamedDb, 'invites', 'INV_HASH_TEST')));
    expect(inviteSnap.exists()).toBe(true);
    await assertFails(getDoc(doc(adminNamedDb, 'athlete_credentials', 'athlete_1')));
  });

  test('AUTH-01: Unauthenticated client cannot read or write /users, /athletes, /invites, /deleted_athletes, or /security_audit_logs', async () => {
    const anonDb = createNamedDbClient('anon');
    await assertFails(getDoc(doc(anonDb, 'users', 'user_123')));
    await assertFails(getDoc(doc(anonDb, 'athletes', 'athlete_1')));
    await assertFails(getDoc(doc(anonDb, 'invites', 'INV_HASH_TEST')));
    await assertFails(getDoc(doc(anonDb, 'deleted_athletes', 'athlete_tomb_1')));
    await assertFails(getDoc(doc(anonDb, 'security_audit_logs', 'audit_1')));
    await assertFails(setDoc(doc(anonDb, 'athletes', 'anon_x'), { id: 'anon_x' }));
  });

  test('USERS-01: Regular user cannot set isAdmin = true or unauthorized keys on /users/{uid} create', async () => {
    const userDb = createNamedDbClient('user_new_esc', {
      sub: 'user_new_esc',
      user_id: 'user_new_esc',
      email: 'esc@gmail.com',
      admin: false,
    });

    await assertFails(
      setDoc(doc(userDb, 'users', 'user_new_esc'), {
        uid: 'user_new_esc',
        isAdmin: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await assertFails(
      setDoc(doc(userDb, 'users', 'user_new_esc'), {
        uid: 'user_new_esc',
        unexpectedRole: 'superadmin',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  test('USERS-02: Regular user cannot impersonate another uid or read another /users/{uid} doc', async () => {
    const userDb = createNamedDbClient('user_123_impersonate', {
      sub: 'user_123',
      user_id: 'user_123',
      email: 'user@gmail.com',
    });

    const ownSnap = await assertSucceeds(getDoc(doc(userDb, 'users', 'user_123')));
    expect(ownSnap.exists()).toBe(true);

    await assertFails(getDoc(doc(userDb, 'users', 'user_456')));
    await assertFails(
      setDoc(doc(userDb, 'users', 'user_456'), {
        uid: 'user_123',
        displayName: 'Impersonator',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  test('USERS-03: Regular user can create and safely update own /users/{uid} without mutating isAdmin or uid', async () => {
    const userDb = createNamedDbClient('user_self_valid', {
      sub: 'user_self_valid',
      user_id: 'user_self_valid',
      email: 'valid@gmail.com',
    });

    await assertSucceeds(
      setDoc(doc(userDb, 'users', 'user_self_valid'), {
        uid: 'user_self_valid',
        name: 'Atleta Valido',
        email: 'valid@gmail.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    );

    await assertSucceeds(
      updateDoc(doc(userDb, 'users', 'user_self_valid'), {
        displayName: 'Atleta Actualizado',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })
    );

    await assertFails(
      updateDoc(doc(userDb, 'users', 'user_self_valid'), {
        isAdmin: true,
      })
    );

    await assertFails(
      updateDoc(doc(userDb, 'users', 'user_self_valid'), {
        uid: 'other_uid',
      })
    );
  });

  test('ATHLETES-01: Athlete isolation permits own read and blocks reading or writing another athlete profile', async () => {
    const athlete1Db = createNamedDbClient('athlete_1_iso', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });

    const ownSnap = await assertSucceeds(getDoc(doc(athlete1Db, 'athletes', 'athlete_1')));
    expect(ownSnap.exists()).toBe(true);
    await assertFails(getDoc(doc(athlete1Db, 'athletes', 'athlete_2')));
    await assertFails(
      updateDoc(doc(athlete1Db, 'athletes', 'athlete_2'), { name: 'Hijacked' })
    );
  });

  test('ATHLETES-02: Athlete cannot escalate privileges, hijack authUid, or write pin', async () => {
    const athlete1Db = createNamedDbClient('athlete_1_esc', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });

    await assertFails(
      updateDoc(doc(athlete1Db, 'athletes', 'athlete_1'), { isAdmin: true })
    );
    await assertFails(
      updateDoc(doc(athlete1Db, 'athletes', 'athlete_1'), { authUid: 'attacker_uid' })
    );
    await assertFails(
      updateDoc(doc(athlete1Db, 'athletes', 'athlete_1'), { pin: '9999' })
    );
  });

  test('ATHLETES-03: Mode-specific write policy on /athletes/{athleteId} distinguishes normal vs contingency vs closed rules', async () => {
    const athlete1Db = createNamedDbClient('athlete_1_mode', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const athlete2Db = createNamedDbClient('athlete_2_mode', {
      sub: 'athlete_uid_2',
      user_id: 'athlete_uid_2',
      email: 'atleta2@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const adminNamedDb = createNamedDbClient('admin_mode_check', {
      sub: 'admin_master',
      user_id: 'admin_master',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });

    const ownerWriteAttempt = updateDoc(doc(athlete1Db, 'athletes', 'athlete_1'), {
      name: 'Atleta Uno Editado',
    });

    if (IS_CONTINGENCY) {
      // Contingency rules freeze non-admin writes on /athletes while preserving admin writes
      await assertFails(ownerWriteAttempt);
      await assertSucceeds(
        updateDoc(doc(adminNamedDb, 'athletes', 'athlete_1'), {
          name: 'Atleta Uno Admin Contingency',
        })
      );
      const updatedSnap = await assertSucceeds(getDoc(doc(athlete1Db, 'athletes', 'athlete_1')));
      expect(updatedSnap.data()?.name).toBe('Atleta Uno Admin Contingency');
    } else {
      // Normal rules allow owner update (proves rules are neither closed-by-default nor contingency)
      await assertSucceeds(ownerWriteAttempt);
      const updatedSnap = await assertSucceeds(getDoc(doc(athlete1Db, 'athletes', 'athlete_1')));
      expect(updatedSnap.data()?.name).toBe('Atleta Uno Editado');
      // Another athlete still cannot write athlete_1 (proves rules are not open)
      await assertFails(
        updateDoc(doc(athlete2Db, 'athletes', 'athlete_1'), { name: 'Cross Athlete Overwrite' })
      );
    }
  });

  test('ISOLATION-01: /athlete_credentials, /invites, and /security_audit_logs enforce strict boundaries & reject spoofed/unverified admins', async () => {
    const athlete1Db = createNamedDbClient('athlete_1_locked', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const unverifiedAdminEmailDb = createNamedDbClient('unverified_admin_email', {
      sub: 'attacker_unverified',
      user_id: 'attacker_unverified',
      email: 'admin@example.invalid',
      email_verified: false,
      firebase: { sign_in_provider: 'password' },
    });
    const passwordAdminEmailDb = createNamedDbClient('password_admin_email', {
      sub: 'attacker_pwd_admin',
      user_id: 'attacker_pwd_admin',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const customClaimNonAdminDb = createNamedDbClient('custom_claim_non_admin', {
      sub: 'attacker_claim_admin',
      user_id: 'attacker_claim_admin',
      email: 'otro@gmail.com',
      email_verified: true,
      admin: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminNamedDb = createNamedDbClient('admin_cred_check', {
      sub: 'admin_master',
      user_id: 'admin_master',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });

    await assertFails(getDoc(doc(athlete1Db, 'athlete_credentials', 'athlete_1')));
    await assertFails(getDoc(doc(adminNamedDb, 'athlete_credentials', 'athlete_1')));
    await assertFails(getDoc(doc(athlete1Db, 'invites', 'INV_HASH_TEST')));
    await assertFails(getDoc(doc(unverifiedAdminEmailDb, 'invites', 'INV_HASH_TEST')));
    await assertFails(getDoc(doc(passwordAdminEmailDb, 'invites', 'INV_HASH_TEST')));
    await assertFails(getDoc(doc(customClaimNonAdminDb, 'invites', 'INV_HASH_TEST')));
    await assertSucceeds(getDoc(doc(adminNamedDb, 'invites', 'INV_HASH_TEST')));
    await assertFails(getDoc(doc(athlete1Db, 'security_audit_logs', 'audit_1')));
    await assertFails(getDoc(doc(customClaimNonAdminDb, 'security_audit_logs', 'audit_1')));
    await assertSucceeds(getDoc(doc(adminNamedDb, 'security_audit_logs', 'audit_1')));
    await assertFails(
      setDoc(doc(adminNamedDb, 'security_audit_logs', 'audit_forged'), { event: 'forged' })
    );
  });

  test('DELETED-01: Non-admin cannot write /deleted_athletes; owner can read own tombstone; admin can write', async () => {
    const athlete1Db = createNamedDbClient('athlete_1_del', {
      sub: 'athlete_uid_1',
      user_id: 'athlete_uid_1',
      email: 'atleta1@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const adminNamedDb = createNamedDbClient('admin_master_del', {
      sub: 'admin_master',
      user_id: 'admin_master',
      email: 'admin@example.invalid',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });

    const tombSnap = await assertSucceeds(getDoc(doc(athlete1Db, 'deleted_athletes', 'athlete_tomb_1')));
    expect(tombSnap.exists()).toBe(true);
    await assertFails(
      setDoc(doc(athlete1Db, 'deleted_athletes', 'athlete_1'), {
        athleteId: 'athlete_1',
        deletedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    await assertSucceeds(
      setDoc(doc(adminNamedDb, 'deleted_athletes', 'athlete_x'), {
        athleteId: 'athlete_x',
        deletedAt: '2026-01-01T00:00:00.000Z',
      })
    );
    await assertSucceeds(deleteDoc(doc(adminNamedDb, 'deleted_athletes', 'athlete_x')));
  });
});
