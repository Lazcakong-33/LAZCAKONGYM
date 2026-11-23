/**
 * LAZCAKONG GYM 7.0 — NATIVE ANDROID GOOGLE SIGN-IN TEST SUITE
 *
 * Verifies:
 * 1. Capacitor Android does NOT send explicit `scopes` (avoids "You CANNOT use scopes without modifying the main activity.")
 * 2. SocialLogin.initialize sets `mode: 'online'` and `skipAuthOnlyAuthorizationAfterSignIn: true` with Web Client ID
 * 3. Native Android/iOS uses SocialLogin.login -> GoogleAuthProvider.credential(idToken) -> signInWithCredential/linkWithCredential
 * 4. Native Android NEVER calls browser signInWithPopup / linkWithPopup
 * 5. Web & PWA keep using signInWithPopup / linkWithPopup exclusively
 * 6. Native errors are labeled with native operation & accurate error codes (never signInWithPopup on APK)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildNativeGoogleInitializeOptions,
  buildNativeGoogleLoginOptions,
  getGoogleAuthOperationLabel,
  getGoogleWebClientId,
  linkWithGoogleHybrid,
  normalizeNativeGoogleError,
  signInWithGoogleHybrid,
  signOutNativeGoogleCache,
  type NativeAuthDeps,
  type NativeSocialLoginClient,
} from '../../utils/nativeAuth.ts';
import type { PlatformEnvironmentInfo } from '../../utils/capacitorPlatform.ts';

const ROOT = process.cwd();

function makePlatform(platform: PlatformEnvironmentInfo['platform']): PlatformEnvironmentInfo {
  const isNative = platform === 'capacitor_android' || platform === 'capacitor_ios';
  return {
    platform,
    isCapacitorNative: isNative,
    isStandalonePwa: platform === 'pwa_standalone',
    hasServiceWorkerSupport: !isNative,
    hasCacheStorageSupport: true,
    hasNotificationSupport: true,
    hasVibrationSupport: true,
  };
}

async function runTests() {
  console.log('\n=== LAZCAKONG GYM 7.0 — NATIVE GOOGLE SIGN-IN SUITE ===\n');
  let passed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed += 1;
    } catch (err: any) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err?.stack || err?.message || err);
      process.exitCode = 1;
    }
  }

  await test('1. buildNativeGoogleLoginOptions omits `scopes` completely (compatible with stock BridgeActivity)', () => {
    const opts = buildNativeGoogleLoginOptions();
    assert.equal(opts.provider, 'google');
    assert.deepEqual(opts.options, {});
    assert.equal('scopes' in opts.options, false, 'Must NOT include `scopes` key in Google login options');

    // Mirror exact Capgo GoogleProvider.java line 492 check:
    const jsonSerialized = JSON.parse(JSON.stringify(opts.options));
    const simulatedJavaOptJsonArray = Object.prototype.hasOwnProperty.call(jsonSerialized, 'scopes')
      ? jsonSerialized.scopes
      : null;
    assert.equal(
      simulatedJavaOptJsonArray,
      null,
      'Android GoogleProvider.java config.optJSONArray("scopes") must evaluate to null'
    );
  });

  await test('2. buildNativeGoogleInitializeOptions configures Web Client ID, online mode, and skipAuthOnlyAuthorizationAfterSignIn', () => {
    const webClientId = getGoogleWebClientId();
    assert.ok(webClientId.endsWith('.apps.googleusercontent.com'));

    const initOpts = buildNativeGoogleInitializeOptions({ webClientId });
    assert.equal(initOpts.google.webClientId, webClientId);
    assert.equal(initOpts.google.mode, 'online');
    assert.equal(initOpts.google.skipAuthOnlyAuthorizationAfterSignIn, true);
    assert.equal('scopes' in initOpts.google, false);
  });

  await test('3. Capacitor Android signInWithGoogleHybrid uses SocialLogin.login (no scopes) -> signInWithCredential and NEVER calls signInWithPopup', async () => {
    const initCalls: any[] = [];
    const loginCalls: any[] = [];
    let popupCalled = 0;
    const credentialTokens: string[] = [];
    const signInWithCredentialCalls: any[] = [];

    const mockSocialLogin: NativeSocialLoginClient = {
      async initialize(options) {
        initCalls.push(options);
      },
      async login(options) {
        loginCalls.push(options);
        if ((options?.options as any)?.scopes != null) {
          throw new Error('You CANNOT use scopes without modifying the main activity. Please follow the docs!');
        }
        return {
          provider: 'google',
          result: {
            responseType: 'online',
            idToken: 'fake-google-id-token-uid-preserved',
            accessToken: null,
            profile: { email: 'atleta@gmail.com', name: 'Atleta Pro', id: '123', givenName: null, familyName: null, imageUrl: null },
          },
        };
      },
      async logout() {},
    };

    const deps: NativeAuthDeps = {
      detectPlatform: () => makePlatform('capacitor_android'),
      loadSocialLogin: async () => mockSocialLogin,
      signInWithPopupFn: (async () => {
        popupCalled += 1;
        throw new Error('signInWithPopup MUST NOT be called on Android');
      }) as any,
      credentialFromIdToken: ((token: string) => {
        credentialTokens.push(token);
        return { providerId: 'google.com', idToken: token } as any;
      }),
      signInWithCredentialFn: (async (_auth: any, cred: any) => {
        signInWithCredentialCalls.push(cred);
        return {
          user: { uid: 'existing-athlete-uid-999', email: 'atleta@gmail.com' },
        } as any;
      }) as any,
    };

    const cred = await signInWithGoogleHybrid(deps);
    assert.equal(popupCalled, 0, 'signInWithPopup must NEVER be invoked on Capacitor Android');
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].google.skipAuthOnlyAuthorizationAfterSignIn, true);
    assert.equal(loginCalls.length, 1);
    assert.equal('scopes' in loginCalls[0].options, false);
    assert.deepEqual(credentialTokens, ['fake-google-id-token-uid-preserved']);
    assert.equal(signInWithCredentialCalls.length, 1);
    assert.equal(cred.user.uid, 'existing-athlete-uid-999');
  });

  await test('4. Capacitor Android linkWithGoogleHybrid uses SocialLogin.login (no scopes) -> linkWithCredential and NEVER calls linkWithPopup', async () => {
    const loginCalls: any[] = [];
    let linkPopupCalled = 0;
    const linkCredCalls: any[] = [];

    const mockSocialLogin: NativeSocialLoginClient = {
      async initialize() {},
      async login(options) {
        loginCalls.push(options);
        if ((options?.options as any)?.scopes != null) {
          throw new Error('You CANNOT use scopes without modifying the main activity.');
        }
        return {
          provider: 'google',
          result: { responseType: 'online', idToken: 'link-id-token-abc' },
        };
      },
      async logout() {},
    };

    const fakeUser = { uid: 'legacy-athlete-uid-123' } as any;
    const res = await linkWithGoogleHybrid(fakeUser, {
      detectPlatform: () => makePlatform('capacitor_android'),
      loadSocialLogin: async () => mockSocialLogin,
      linkWithPopupFn: (async () => {
        linkPopupCalled += 1;
        throw new Error('linkWithPopup MUST NOT be called on Android');
      }) as any,
      credentialFromIdToken: ((token: string) => ({ providerId: 'google.com', idToken: token }) as any),
      linkWithCredentialFn: (async (user: any, cred: any) => {
        linkCredCalls.push({ uid: user.uid, cred });
        return { user } as any;
      }) as any,
    });

    assert.equal(linkPopupCalled, 0);
    assert.equal(loginCalls.length, 1);
    assert.equal('scopes' in loginCalls[0].options, false);
    assert.equal(linkCredCalls.length, 1);
    assert.equal(res.user.uid, 'legacy-athlete-uid-123');
  });

  await test('5. Web and PWA strictly keep signInWithPopup / linkWithPopup without calling native SocialLogin', async () => {
    let socialLoaded = 0;
    let popupCalled = 0;
    let linkPopupCalled = 0;

    for (const platform of ['web', 'pwa_standalone'] as const) {
      const signInRes = await signInWithGoogleHybrid({
        detectPlatform: () => makePlatform(platform),
        loadSocialLogin: async () => {
          socialLoaded += 1;
          throw new Error('SocialLogin must not run on Web/PWA');
        },
        signInWithPopupFn: (async () => {
          popupCalled += 1;
          return { user: { uid: `web-uid-${platform}` } } as any;
        }) as any,
      });
      assert.equal(signInRes.user.uid, `web-uid-${platform}`);

      const linkRes = await linkWithGoogleHybrid({ uid: 'web-user-1' } as any, {
        detectPlatform: () => makePlatform(platform),
        loadSocialLogin: async () => {
          socialLoaded += 1;
          throw new Error('SocialLogin must not run on Web/PWA');
        },
        linkWithPopupFn: (async (u: any) => {
          linkPopupCalled += 1;
          return { user: u } as any;
        }) as any,
      });
      assert.equal(linkRes.user.uid, 'web-user-1');
    }

    assert.equal(socialLoaded, 0);
    assert.equal(popupCalled, 2);
    assert.equal(linkPopupCalled, 2);
  });

  await test('6. Native logout cache clears Google state only in Capacitor native', async () => {
    let logoutCalls = 0;
    const mockClient: NativeSocialLoginClient = {
      async initialize() {},
      async login() {
        return {};
      },
      async logout(opts) {
        assert.equal(opts.provider, 'google');
        logoutCalls += 1;
      },
    };

    await signOutNativeGoogleCache({
      detectPlatform: () => makePlatform('web'),
      loadSocialLogin: async () => mockClient,
    });
    assert.equal(logoutCalls, 0);

    await signOutNativeGoogleCache({
      detectPlatform: () => makePlatform('capacitor_android'),
      loadSocialLogin: async () => mockClient,
    });
    assert.equal(logoutCalls, 1);
  });

  await test('7. Error labels and native error normalization avoid misreporting signInWithPopup on Android', () => {
    assert.equal(
      getGoogleAuthOperationLabel(() => makePlatform('capacitor_android')),
      'SocialLogin.login(google) -> signInWithCredential'
    );
    assert.equal(
      getGoogleAuthOperationLabel(() => makePlatform('web')),
      'signInWithPopup(google)'
    );

    const scopesErr: any = normalizeNativeGoogleError(
      new Error('You CANNOT use scopes without modifying the main activity.')
    );
    assert.equal(scopesErr.code, 'auth/native-google-scopes-unsupported');

    const shaErr: any = normalizeNativeGoogleError(
      new Error('GetCredentialCustomException: [28444] Developer console is not set up correctly')
    );
    assert.equal(shaErr.code, 'auth/native-google-config-required');

    const cancelErr: any = normalizeNativeGoogleError({
      code: 'USER_CANCELLED',
      message: 'User cancelled sign-in',
    });
    assert.equal(cancelErr.code, 'auth/popup-closed-by-user');
  });

  await test('8. Source code audit confirms zero unnecessary scopes and zero direct signInWithPopup outside nativeAuth.ts', () => {
    const nativeAuthSrc = fs.readFileSync(path.join(ROOT, 'src/utils/nativeAuth.ts'), 'utf8');
    const useGymStateSrc = fs.readFileSync(path.join(ROOT, 'src/hooks/useGymState.ts'), 'utf8');

    assert.equal(
      /scopes\s*:\s*\[/.test(nativeAuthSrc),
      false,
      'src/utils/nativeAuth.ts must NOT pass scopes array to SocialLogin.login'
    );
    assert.ok(
      nativeAuthSrc.includes('skipAuthOnlyAuthorizationAfterSignIn: true'),
      'src/utils/nativeAuth.ts must set skipAuthOnlyAuthorizationAfterSignIn: true'
    );
    assert.equal(
      useGymStateSrc.includes('signInWithPopup(') || useGymStateSrc.includes('linkWithPopup('),
      false,
      'useGymState.ts must never call signInWithPopup/linkWithPopup directly'
    );
    assert.ok(
      useGymStateSrc.includes('getGoogleAuthOperationLabel()'),
      'useGymState.ts must report platform-accurate Google Auth operation label'
    );
  });

  console.log(`\n🎉 Resumen Native Google Auth Suite: ${passed}/8 pruebas aprobadas.\n`);
}

void runTests();
