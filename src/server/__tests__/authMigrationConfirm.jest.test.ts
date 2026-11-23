import { handleConfirmMigration } from '../authMigrationController';

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

function buildMockAdminServices(options: {
  firebaseUser?: any;
  athleteData?: Record<string, any> | null;
  credData?: Record<string, any> | null;
}) {
  const state = {
    credDeleted: false,
    athleteUpdated: false,
    auditLogged: false,
    lastAthletePatch: null as any,
    lastAuditLog: null as any,
  };

  const mockAuth = {
    async getUser(_uid: string) {
      throw new Error('Starter Tier violation: auth.getUser() must not be called');
    },
  };

  const mockDb = {
    collection(name: string) {
      if (name === 'athletes') {
        return {
          where() {
            return {
              limit() {
                return {
                  async get() {
                    if (!options.athleteData) {
                      return { empty: true, docs: [] };
                    }
                    return {
                      empty: false,
                      docs: [
                        {
                          id: 'athlete_synthetic_01',
                          data: () => options.athleteData,
                          ref: {
                            async set(patch: any) {
                              state.athleteUpdated = true;
                              state.lastAthletePatch = patch;
                            },
                          },
                        },
                      ],
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'athlete_credentials') {
        return {
          doc() {
            return {
              async get() {
                return {
                  exists: Boolean(options.credData),
                  data: () => options.credData,
                };
              },
              async delete() {
                state.credDeleted = true;
              },
            };
          },
        };
      }
      if (name === 'security_audit_logs') {
        return {
          async add(logEntry: any) {
            state.auditLogged = true;
            state.lastAuditLog = logEntry;
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  };

  return {
    state,
    getAdminServices: () => ({ auth: mockAuth as any, db: mockDb as any }),
  };
}

describe('handleConfirmMigration (/api/auth/confirm-migration) hardening', () => {
  test('rejects 422 and preserves legacy PIN when session is custom token even if persistentAuthVerified=true and password provider exists', async () => {
    const mock = buildMockAdminServices({
      firebaseUser: {
        uid: 'uid_1',
        email: 'atleta@test.com',
        emailVerified: true,
        disabled: false,
        providerData: [{ providerId: 'password' }],
      },
      athleteData: {
        authUid: 'uid_1',
        email: 'atleta@test.com',
        migrationStatus: 'provisional_claimed',
      },
      credData: {
        pinHash: 'scrypt$16384$8$1$aa$bb',
      },
    });

    const req: any = {
      user: {
        uid: 'uid_1',
        email: 'atleta@test.com',
        isAdmin: false,
        emailVerified: true,
        signInProvider: 'custom',
      },
      body: { persistentAuthVerified: true },
    };
    const res = createMockRes();

    await handleConfirmMigration(req, res, { getAdminServices: mock.getAdminServices });

    expect(res.statusCode).toBe(422);
    expect(mock.state.credDeleted).toBe(false);
    expect(mock.state.athleteUpdated).toBe(false);
  });

  test('rejects 422 and preserves legacy PIN when password is flagged as system-generated pending replacement', async () => {
    const mock = buildMockAdminServices({
      firebaseUser: {
        uid: 'uid_2',
        email: 'atleta2@test.com',
        emailVerified: true,
        disabled: false,
        providerData: [{ providerId: 'password' }],
      },
      athleteData: {
        authUid: 'uid_2',
        email: 'atleta2@test.com',
        migrationStatus: 'provisional_claimed',
      },
      credData: {
        pinHash: 'scrypt$16384$8$1$aa$bb',
        systemGeneratedPasswordPendingReplacement: true,
      },
    });

    const req: any = {
      user: {
        uid: 'uid_2',
        email: 'atleta2@test.com',
        isAdmin: false,
        emailVerified: true,
        signInProvider: 'password',
      },
      body: { persistentAuthVerified: true },
    };
    const res = createMockRes();

    await handleConfirmMigration(req, res, { getAdminServices: mock.getAdminServices });

    expect(res.statusCode).toBe(422);
    expect(mock.state.credDeleted).toBe(false);
  });

  test('rejects 422 when recovery email is not verified even with google.com provider and persistentAuthVerified=true', async () => {
    const mock = buildMockAdminServices({
      firebaseUser: {
        uid: 'uid_3',
        email: 'atleta3@test.com',
        emailVerified: false,
        disabled: false,
        providerData: [{ providerId: 'google.com' }],
      },
      athleteData: {
        authUid: 'uid_3',
        email: 'atleta3@test.com',
        migrationStatus: 'provisional_claimed',
      },
      credData: {
        pinHash: 'scrypt$16384$8$1$aa$bb',
      },
    });

    const req: any = {
      user: {
        uid: 'uid_3',
        email: 'atleta3@test.com',
        isAdmin: false,
        emailVerified: false,
        signInProvider: 'google.com',
      },
      body: { persistentAuthVerified: true },
    };
    const res = createMockRes();

    await handleConfirmMigration(req, res, { getAdminServices: mock.getAdminServices });

    expect(res.statusCode).toBe(422);
    expect(mock.state.credDeleted).toBe(false);
  });

  test('succeeds 200 and purges legacy PIN only when authenticated with user-controlled google.com provider and verified email', async () => {
    const mock = buildMockAdminServices({
      firebaseUser: {
        uid: 'uid_4',
        email: 'atleta4@test.com',
        emailVerified: true,
        disabled: false,
        providerData: [{ providerId: 'google.com' }],
      },
      athleteData: {
        authUid: 'uid_4',
        email: 'atleta4@test.com',
        migrationStatus: 'provisional_claimed',
      },
      credData: {
        pinHash: 'scrypt$16384$8$1$aa$bb',
      },
    });

    const req: any = {
      user: {
        uid: 'uid_4',
        email: 'atleta4@test.com',
        isAdmin: false,
        emailVerified: true,
        signInProvider: 'google.com',
        authTime: Math.floor(Date.now() / 1000),
      },
      body: { persistentAuthVerified: true },
    };
    const res = createMockRes();

    await handleConfirmMigration(req, res, { getAdminServices: mock.getAdminServices });

    expect(res.statusCode).toBe(200);
    expect(mock.state.credDeleted).toBe(true);
    expect(mock.state.athleteUpdated).toBe(true);
    expect(mock.state.lastAthletePatch.authProviderConfirmed).toBe('google.com');
    expect(mock.state.auditLogged).toBe(true);
  });
});
