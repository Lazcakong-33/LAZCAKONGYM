import { getAuthorizedAdminEmails, isAuthorizedAdminToken } from '../firebaseAdminServer';

describe('Private administrator allowlist', () => {
  const original = { email: process.env.ADMIN_EMAIL, emails: process.env.ADMIN_EMAILS };
  afterEach(() => {
    for (const [key, value] of [['ADMIN_EMAIL', original.email], ['ADMIN_EMAILS', original.emails]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  test('missing or blank configuration grants no administrator access', () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_EMAILS;
    expect(getAuthorizedAdminEmails()).toEqual([]);
    expect(isAuthorizedAdminToken({ email: 'admin@example.invalid', emailVerified: true, signInProvider: 'google.com' })).toBe(false);
    process.env.ADMIN_EMAILS = ' , ';
    expect(getAuthorizedAdminEmails()).toEqual([]);
  });
  test('configured identity still requires verified Google sign-in', () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.invalid, second@example.invalid ';
    const token = { email: 'admin@example.invalid', emailVerified: true, signInProvider: 'google.com' };
    expect(isAuthorizedAdminToken(token)).toBe(true);
    expect(isAuthorizedAdminToken({ ...token, emailVerified: false })).toBe(false);
    expect(isAuthorizedAdminToken({ ...token, signInProvider: 'password' })).toBe(false);
  });
});
