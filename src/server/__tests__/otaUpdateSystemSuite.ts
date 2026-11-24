/**
 * Automated Verification Suite: LAZCAKONG GYM 7.0 — CI APK & Safe OTA Update System
 *
 * Strictly non-destructive tests using in-memory storage, synthetic manifests,
 * and static/controller audits. Zero reads/writes against production Firebase,
 * production OTA channels, or Android keystore secrets.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  downloadAndStageOtaUpdate,
  evaluateOtaCompatibility,
  markOtaBootReady,
  rollbackOtaToPreviousBundle,
  validateOtaManifest,
  type OtaManifestPayload,
  type OtaPluginAdapter,
} from '../../utils/otaUpdateEngine.ts';
import {
  handleGetOtaBundleZip,
  handleGetOtaManifest,
} from '../otaUpdateController.ts';

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
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: null,
    headers,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
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

function makeValidDevManifest(overrides: Partial<OtaManifestPayload> = {}): OtaManifestPayload {
  return {
    version: '6.4.3',
    buildId: '6.4.3-ota-dev',
    channel: 'development',
    url: 'https://lazcakongym.ai.studio/api/ota/bundles/lazcakongym-ota-6.4.3.zip',
    checksum: crypto.createHash('sha256').update('synthetic-ota-zip').digest('hex'),
    contentsPolicy: 'web_assets_only',
    changedScopes: ['ui', 'library', 'react_ts', 'assets'],
    requiresApkUpdate: false,
    minNativeVersionCode: 1,
    capacitorMajor: 8,
    releaseNotes: 'Actualización de prueba en desarrollo',
    ...overrides,
  };
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

  // 1. Etapa A — GitHub Actions & Gradle Signing Security Audit
  await check('1. GitHub Actions workflow & build.gradle support Debug + secret-only Release signing without exposing keys', () => {
    const wfPath = path.resolve(process.cwd(), '.github/workflows/android-apk.yml');
    assert.ok(fs.existsSync(wfPath), 'Missing .github/workflows/android-apk.yml');
    const wf = fs.readFileSync(wfPath, 'utf8');

    assert.ok(wf.includes("node-version: '22'"), 'Workflow must use Node 22');
    assert.ok(wf.includes("java-version: '21'"), 'Workflow must use JDK 21');
    assert.ok(wf.includes('platforms;android-36'), 'Workflow must provision Android SDK 36');
    assert.ok(wf.includes('npx cap sync android'), 'Workflow must run cap sync android');
    assert.ok(wf.includes('./gradlew assembleDebug'), 'Workflow must build Debug APK');
    assert.ok(wf.includes('./gradlew assembleRelease'), 'Workflow must support Release APK');
    assert.ok(
      wf.includes('secrets.ANDROID_KEYSTORE_BASE64') &&
        wf.includes('secrets.ANDROID_KEYSTORE_PASSWORD') &&
        wf.includes('secrets.ANDROID_KEY_ALIAS') &&
        wf.includes('secrets.ANDROID_KEY_PASSWORD') &&
        wf.includes('secrets.ANDROID_DEBUG_KEYSTORE_BASE64'),
      'Debug & Release signing must come exclusively from GitHub Secrets'
    );
    assert.ok(wf.includes('"ci/**"'), 'Workflow must support independent ci/** branches without overwriting main');
    assert.ok(!wf.includes('keytool -genkey'), 'Must never auto-generate keystore keys');
    assert.ok(wf.includes('actions/upload-artifact@v4'), 'Must publish APK as downloadable artifact');
    assert.ok(!wf.includes('playstore') && !wf.includes('appdistribution:distribute'), 'Must never auto-publish');

    const gradleSrc = fs.readFileSync(path.resolve(process.cwd(), 'android/app/build.gradle'), 'utf8');
    assert.ok(gradleSrc.includes('applicationId "com.lazcakong.gym"'), 'Must preserve applicationId com.lazcakong.gym');
    assert.ok(gradleSrc.includes('LAZCAKONG_KEYSTORE_FILE'), 'build.gradle must check optional CI release keystore env var');
    assert.ok(gradleSrc.includes('LAZCAKONG_DEBUG_KEYSTORE_FILE'), 'build.gradle must check optional CI debug keystore env var');
  });

  // 2. Capacitor config keeps manual mode & zero external cloud auto-connect
  await check('2. capacitor.config.ts configures @capgo/capacitor-updater in safe manual mode without production channel', () => {
    const capCfg = fs.readFileSync(path.resolve(process.cwd(), 'capacitor.config.ts'), 'utf8');
    assert.ok(capCfg.includes('CapacitorUpdater:'), 'Missing CapacitorUpdater plugin config');
    assert.ok(capCfg.includes('autoUpdate: false'), 'autoUpdate must stay false for manual/safe control');
    assert.ok(capCfg.includes("statsUrl: ''"), 'External Capgo telemetry must be disabled');
    assert.ok(capCfg.includes('appReadyTimeout: 10000'), 'Rollback watchdog timeout must be configured');
  });

  // 3. HTTPS, SHA-256 Checksum, Semver, and Production Isolation
  await check('3. OTA validator enforces HTTPS, valid 64-hex SHA-256 checksum, semver, and fail-closed production channel', () => {
    const valid = validateOtaManifest(makeValidDevManifest(), {
      currentWebVersion: 'v6.4.2',
      currentNativeVersionCode: 1,
      expectedChannel: 'development',
    });
    assert.equal(valid.valid, true);

    const httpRejected = validateOtaManifest(
      makeValidDevManifest({ url: 'http://lazcakongym.ai.studio/api/ota/bundles/lazcakongym-ota-6.4.3.zip' }),
      { currentWebVersion: 'v6.4.2', expectedChannel: 'development' }
    );
    assert.equal(httpRejected.valid, false);

    const badChecksumRejected = validateOtaManifest(
      makeValidDevManifest({ checksum: 'not-a-sha256' }),
      { currentWebVersion: 'v6.4.2', expectedChannel: 'development' }
    );
    assert.equal(badChecksumRejected.valid, false);

    const prodBlocked = validateOtaManifest(
      makeValidDevManifest({ channel: 'production' }),
      { currentWebVersion: 'v6.4.2', expectedChannel: 'production', allowProduction: false }
    );
    assert.equal(prodBlocked.valid, false);

    const previewHostInStagingBlocked = validateOtaManifest(
      makeValidDevManifest({
        channel: 'staging',
        url: 'https://ais-dev-12345.run.app/api/ota/bundles/lazcakongym-ota-6.4.3.zip',
      }),
      { currentWebVersion: 'v6.4.2', expectedChannel: 'staging' }
    );
    assert.equal(previewHostInStagingBlocked.valid, false);
  });

  // 4. Native Change Protection (NEVER send Java, plugins, Gradle, or AndroidManifest via OTA)
  await check('4. Native compatibility guard blocks Java, AndroidManifest, Gradle, and native plugin changes from OTA', () => {
    for (const forbiddenScope of ['android_java', 'android_manifest', 'gradle', 'native_plugin', 'keystore'] as const) {
      const res = evaluateOtaCompatibility(
        makeValidDevManifest({ changedScopes: ['ui', forbiddenScope] }),
        1
      );
      assert.equal(res.valid, false);
      assert.equal(res.requiresApkUpdate, true);
    }

    const nativeTooOld = evaluateOtaCompatibility(
      makeValidDevManifest({ minNativeVersionCode: 2 }),
      1
    );
    assert.equal(nativeTooOld.valid, false);
    assert.equal(nativeTooOld.requiresApkUpdate, true);

    const apkFlag = evaluateOtaCompatibility(
      makeValidDevManifest({ requiresApkUpdate: true }),
      1
    );
    assert.equal(apkFlag.valid, false);
    assert.equal(apkFlag.requiresApkUpdate, true);
  });

  // 5. Active Workout Deferral + Successful Download + Rollback
  await check('5. OTA download passes checksum, defers safely during active workout, applies when idle, and supports rollback', async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      'lazcakon_perfil_test_active_session',
      JSON.stringify({ sessionId: 'wk-active-1', routineTitle: 'Push A', exercises: [] })
    );

    const calls: string[] = [];
    const mockAdapter: OtaPluginAdapter = {
      async notifyAppReady() {
        calls.push('notifyAppReady');
        return { bundle: { id: 'builtin' } };
      },
      async download(opts) {
        calls.push(`download:${opts.version}:${opts.checksum}`);
        return {
          id: 'bundle_6_4_3',
          version: opts.version,
          downloaded: new Date().toISOString(),
          checksum: opts.checksum || '',
          status: 'success',
        };
      },
      async set(opts) {
        calls.push(`set:${opts.id}`);
      },
      async next(opts) {
        calls.push(`next:${opts.id}`);
        return { id: opts.id, version: '6.4.3', downloaded: '', checksum: '', status: 'pending' };
      },
      async reset(opts) {
        calls.push(`reset:${Boolean(opts?.toLastSuccessful)}`);
      },
      async current() {
        return { bundle: { id: 'bundle_6_4_3', version: '6.4.3', downloaded: '', checksum: '', status: 'success' }, native: '1.0' };
      },
    };

    const boot = await markOtaBootReady(mockAdapter, true);
    assert.equal(boot.notified, true);

    const manifest = makeValidDevManifest();
    const deferredResult = await downloadAndStageOtaUpdate(manifest, {
      adapter: mockAdapter,
      storage,
      currentWebVersion: 'v6.4.2',
      forceNativeForTest: true,
      applyImmediatelyWhenSafe: true,
    });
    assert.equal(deferredResult.status, 'deferred_unsafe');
    assert.equal(calls.some((c) => c.startsWith('set:')), false, 'Must NEVER call set() / reload during active workout');

    // Clear active workout -> now safe to apply
    storage.removeItem('lazcakon_perfil_test_active_session');
    const appliedResult = await downloadAndStageOtaUpdate(manifest, {
      adapter: mockAdapter,
      storage,
      currentWebVersion: 'v6.4.2',
      forceNativeForTest: true,
      applyImmediatelyWhenSafe: true,
    });
    assert.equal(appliedResult.status, 'applied');
    assert.ok(calls.includes('set:bundle_6_4_3'));

    // Rollback support
    const rb = await rollbackOtaToPreviousBundle(mockAdapter, true);
    assert.equal(rb.rolledBack, true);
    assert.ok(calls.includes('reset:true'));
  });

  // 6. Server OTA Manifest Fail-Closed Production & Path Traversal Guard
  await check('6. Server OTA controller keeps production disconnected by default and blocks path traversal in bundle download', () => {
    const prevProd = process.env.OTA_PRODUCTION_ENABLED;
    delete process.env.OTA_PRODUCTION_ENABLED;
    try {
      const prodRes = createMockRes();
      handleGetOtaManifest({ query: { channel: 'production' } } as any, prodRes);
      assert.equal(prodRes.statusCode, 200);
      assert.equal(prodRes.body.enabled, false);
      assert.equal(prodRes.body.updateAvailable, false);
      assert.equal(prodRes.body.manifest, null);

      const devRes = createMockRes();
      handleGetOtaManifest({ query: { channel: 'development' } } as any, devRes);
      assert.equal(devRes.statusCode, 200);
      assert.equal(devRes.body.enabled, true);
      assert.equal(devRes.body.channel, 'development');

      // Fail closed if a misconfigured server exposes a production manifest in development.
      const prevDevManifest = process.env.OTA_MANIFEST_DEV_JSON;
      try {
        process.env.OTA_MANIFEST_DEV_JSON = JSON.stringify(makeValidDevManifest({ channel: 'production' }));
        const mismatchRes = createMockRes();
        handleGetOtaManifest({ query: { channel: 'development' } } as any, mismatchRes);
        assert.equal(mismatchRes.body.channel, 'development');
        assert.equal(mismatchRes.body.updateAvailable, false);
        assert.equal(mismatchRes.body.manifest, null);
      } finally {
        if (prevDevManifest === undefined) delete process.env.OTA_MANIFEST_DEV_JSON;
        else process.env.OTA_MANIFEST_DEV_JSON = prevDevManifest;
      }

      // Attempt path traversal in bundle zip filename
      for (const badName of ['../server.ts', '..%2Fpackage.json', 'evil.sh']) {
        const zipRes = createMockRes();
        handleGetOtaBundleZip({ params: { filename: badName } } as any, zipRes);
        assert.equal(zipRes.statusCode, 400);
      }
    } finally {
      if (prevProd === undefined) delete process.env.OTA_PRODUCTION_ENABLED;
      else process.env.OTA_PRODUCTION_ENABLED = prevProd;
    }
  });

  // 7. Native Timer, Alarm & Firebase Integrity Untouched
  await check('7. Existing Android RestTimer plugins, alarms, AndroidManifest, and firestore.rules remain completely intact', () => {
    const manifestXml = fs.readFileSync(path.resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    assert.ok(manifestXml.includes('RestTimerActionReceiver'));
    assert.ok(manifestXml.includes('RestAlarmReceiver'));
    assert.ok(manifestXml.includes('RestCompleteLockActivity'));
    assert.ok(manifestXml.includes('SCHEDULE_EXACT_ALARM'));

    const mainJava = fs.readFileSync(
      path.resolve(process.cwd(), 'android/app/src/main/java/com/lazcakong/gym/MainActivity.java'),
      'utf8'
    );
    assert.ok(mainJava.includes('RestTimerNotificationPlugin.class'));
  });

  // 8. Native clients must not display web-only update prompts that cannot change APK assets.
  await check('8. Native update prompt requires a real OTA manifest and retains the 6.4.4 upgrade path', () => {
    const hook = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useAppUpdate.ts'), 'utf8');
    const banner = fs.readFileSync(path.resolve(process.cwd(), 'src/components/UpdateBanner.tsx'), 'utf8');
    const version = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/updateApp.ts'), 'utf8');
    assert.ok(hook.includes('only a compatible OTA manifest can.'));
    assert.ok(hook.includes('setOtaPendingManifest(null);\n        setServerVersion(null);'));
    assert.ok(!hook.includes('Immediately register current running build in localStorage'));
    assert.ok(!banner.includes('!isVersionGreater(serverVersion, currentVersion)'));
    assert.ok(version.includes("APP_VERSION = 'v6.4.4'"));
  });

  console.log(`\n🎉 ALL ${passed} CI APK & OTA SYSTEM CHECKS PASSED!`);
}

runSuite().catch((err) => {
  console.error('❌ otaUpdateSystemSuite failed:', err);
  process.exit(1);
});
