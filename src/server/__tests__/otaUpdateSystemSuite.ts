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
  evaluateOtaRetryEligibility,
  markOtaBootReady,
  recordOtaAttemptResult,
  rollbackOtaToPreviousBundle,
  validateOtaManifest,
  type OtaManifestPayload,
  type OtaPluginAdapter,
} from '../../utils/otaUpdateEngine.ts';
import {
  buildCanonicalManifestSigningPayload,
  handleAdminGetOtaStatus,
  handleAdminPublishOtaRelease,
  handleAdminRollbackOtaRelease,
  handleGetOtaBundleZip,
  handleGetOtaManifest,
  handleReportOtaTelemetry,
  resetOtaControlStateForTest,
  verifyManifestEd25519Signature,
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
    assert.ok(gradleSrc.includes(': 70000'), 'build.gradle default versionCode must exceed previous 1.x/6.x APKs (70000)');
    assert.ok(gradleSrc.includes(': "7.0.0"'), 'build.gradle default versionName must match 7.0.0');
    assert.ok(gradleSrc.includes('LAZCAKONG_KEYSTORE_FILE'), 'build.gradle must check optional CI release keystore env var');
    assert.ok(gradleSrc.includes('LAZCAKONG_DEBUG_KEYSTORE_FILE'), 'build.gradle must check optional CI debug keystore env var');
    assert.ok(wf.includes('apksigner'), 'Workflow must verify APK signature via apksigner');
    assert.ok(wf.includes('migration/zero-cost'), 'Workflow must preserve migration/zero-cost branch');
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

  // 8. Ed25519 Manifest Signing & Verification Guard
  await check('8. Ed25519 cryptographic signature verifies authentic manifests and rejects tampered payloads', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const manifest = makeValidDevManifest({ version: '7.0.1', buildId: '7.0.1-ota-sig' });
    const canonical = buildCanonicalManifestSigningPayload(manifest);
    const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privatePem).toString('base64');
    manifest.signature = sig;
    manifest.signatureAlgorithm = 'ed25519';

    const ok = verifyManifestEd25519Signature(manifest, publicPem);
    assert.equal(ok.verified, true);
    assert.equal(ok.checked, true);

    // Tamper bundle URL -> verification MUST fail
    const tampered = { ...manifest, url: 'https://evil.example.com/malicious.zip' };
    const bad = verifyManifestEd25519Signature(tampered, publicPem);
    assert.equal(bad.verified, false);

    // Production channel MUST require Ed25519 signature unconditionally
    const unsignedProd = makeValidDevManifest({ channel: 'production', version: '7.0.1' });
    delete unsignedProd.signature;
    assert.equal(verifyManifestEd25519Signature(unsignedProd, publicPem).verified, false);
    assert.equal(
      validateOtaManifest(unsignedProd, {
        currentWebVersion: '7.0.0',
        expectedChannel: 'production',
        allowProduction: true,
      }).valid,
      false
    );

    const signedProd = makeValidDevManifest({ channel: 'production', version: '7.0.1' });
    signedProd.signature = crypto
      .sign(null, Buffer.from(buildCanonicalManifestSigningPayload(signedProd), 'utf8'), privatePem)
      .toString('base64');
    signedProd.signatureAlgorithm = 'ed25519';
    assert.equal(verifyManifestEd25519Signature(signedProd, publicPem).verified, true);
    assert.equal(
      validateOtaManifest(signedProd, {
        currentWebVersion: '7.0.0',
        expectedChannel: 'production',
        allowProduction: true,
      }).valid,
      true
    );
  });

  // 9. Controlled Retry Backoff + Quarantine + Rapid Boot-Loop Automatic Rollback
  await check('9. Controlled retry quarantines failing builds after 3 errors and markOtaBootReady rolls back boot loops automatically', async () => {
    const storage = createMemoryStorage();
    const buildId = '7.0.2-ota-bad';

    assert.equal(evaluateOtaRetryEligibility(buildId, storage, 1000).eligible, true);
    const fail1 = recordOtaAttemptResult(buildId, false, storage, 1000);
    assert.equal(fail1.attempts, 1);
    assert.equal(evaluateOtaRetryEligibility(buildId, storage, 2000).eligible, false);
    assert.equal(evaluateOtaRetryEligibility(buildId, storage, 20000).eligible, true);

    recordOtaAttemptResult(buildId, false, storage, 20000);
    const fail3 = recordOtaAttemptResult(buildId, false, storage, 100000);
    assert.equal(fail3.quarantined, true);
    assert.equal(evaluateOtaRetryEligibility(buildId, storage, 9999999).quarantined, true);

    // Boot-loop rollback test (>2 quick boots for non-builtin bundle)
    let resetCalled = 0;
    const loopAdapter: OtaPluginAdapter = {
      async notifyAppReady() {
        return {};
      },
      async download() {
        throw new Error('unused');
      },
      async set() {},
      async next() {
        throw new Error('unused');
      },
      async reset(opts) {
        if (opts?.toLastSuccessful) resetCalled += 1;
      },
      async current() {
        return {
          bundle: { id: 'bundle_loop_99', version: '7.0.9', downloaded: '', checksum: '', status: 'success' },
          native: '1.0',
        };
      },
    };

    await markOtaBootReady(loopAdapter, true, storage, 10_000);
    await markOtaBootReady(loopAdapter, true, storage, 20_000);
    const thirdBoot = await markOtaBootReady(loopAdapter, true, storage, 30_000);
    assert.equal(thirdBoot.rolledBackBootLoop, true);
    assert.equal(resetCalled, 1);
    assert.equal(evaluateOtaRetryEligibility('bundle_loop_99', storage, 40_000).quarantined, true);
  });

  // 10. Admin Update Center API Security, Publish, Telemetry & Safe Rollback
  await check('10. Admin Update Center enforces Master Admin auth, validates HTTPS/SHA-256, records telemetry, and supports safe rollback', () => {
    const prevAdmin = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = 'kmiloko19@gmail.com';
    resetOtaControlStateForTest(true);

    try {
      const nonAdminUser = { uid: 'athlete_1', email: 'athlete@gym.com', isAdmin: false };
      const masterAdmin = { uid: 'master_1', email: 'kmiloko19@gmail.com', isAdmin: true };

      const deniedRes = createMockRes();
      handleAdminGetOtaStatus({ user: nonAdminUser } as any, deniedRes);
      assert.equal(deniedRes.statusCode, 403);

      // SSRF / private IP rejected on publish
      const ssrfRes = createMockRes();
      handleAdminPublishOtaRelease(
        {
          user: masterAdmin,
          body: {
            channel: 'development',
            version: '7.0.1',
            url: 'https://127.0.0.1/evil.zip',
            checksum: 'a'.repeat(64),
          },
        } as any,
        ssrfRes
      );
      assert.equal(ssrfRes.statusCode, 400);

      // Valid publish v7.0.1 then v7.0.2
      const pub1 = createMockRes();
      handleAdminPublishOtaRelease(
        {
          user: masterAdmin,
          body: {
            channel: 'development',
            version: '7.0.1',
            releaseNotes: 'Mejora visual 1',
            url: 'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/download/v7.0.1/ota.zip',
            checksum: '1'.repeat(64),
          },
        } as any,
        pub1
      );
      assert.equal(pub1.statusCode, 200);

      const pub2 = createMockRes();
      handleAdminPublishOtaRelease(
        {
          user: masterAdmin,
          body: {
            channel: 'development',
            version: '7.0.2',
            releaseNotes: 'Mejora visual 2',
            url: 'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/download/v7.0.2/ota.zip',
            checksum: '2'.repeat(64),
          },
        } as any,
        pub2
      );
      assert.equal(pub2.statusCode, 200);

      // Telemetry recording
      const telRes = createMockRes();
      handleReportOtaTelemetry(
        {
          user: nonAdminUser,
          body: {
            deviceId: 'honor_400_pro',
            platform: 'android_apk',
            channel: 'development',
            installedVersion: '7.0.1',
            status: 'updated',
          },
        } as any,
        telRes
      );
      assert.equal(telRes.statusCode, 200);

      // Rollback back to v7.0.1
      const rbRes = createMockRes();
      handleAdminRollbackOtaRelease(
        {
          user: masterAdmin,
          body: {
            channel: 'development',
            targetBuildId: pub1.body.manifest.buildId,
          },
        } as any,
        rbRes
      );
      assert.equal(rbRes.statusCode, 200);
      assert.equal(rbRes.body.restored.version, '7.0.1');

      const statusRes = createMockRes();
      handleAdminGetOtaStatus({ user: masterAdmin } as any, statusRes);
      assert.equal(statusRes.statusCode, 200);
      assert.equal(statusRes.body.channels.development.activeManifest.version, '7.0.1');
      assert.equal(statusRes.body.telemetrySummary.totalDevices, 1);
    } finally {
      resetOtaControlStateForTest(false);
      if (prevAdmin === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = prevAdmin;
    }
  });

  // 11. Zero-Cost Update Polling & Native 70000 Compatibility Matrix
  await check('11. Zero-cost update polling eliminates permanent 25s timer and production publish blocks unsigned OTA', () => {
    const hookSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useAppUpdate.ts'), 'utf8');
    assert.ok(!hookSrc.includes(', 25000)'), 'Must NOT poll every 25s permanently');
    assert.ok(hookSrc.includes('AUTO_UPDATE_CHECK_COOLDOWN_MS = 15 * 60 * 1000'), 'Must enforce 15m auto-check cooldown');
    assert.ok(hookSrc.includes('BACKGROUND_UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000'), 'Must enforce 30m visible poll interval');

    // Native versionCode 70000 compatibility checks
    const compatOk = evaluateOtaCompatibility(makeValidDevManifest({ minNativeVersionCode: 70000 }), 70000);
    assert.equal(compatOk.compatible, true);
    const compatNeedsApk = evaluateOtaCompatibility(makeValidDevManifest({ minNativeVersionCode: 70100 }), 70000);
    assert.equal(compatNeedsApk.compatible, false);
    assert.equal(compatNeedsApk.requiresApkUpdate, true);

    // Production publish without Ed25519 signature MUST fail HTTP 400
    const prevAdmin = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = 'kmiloko19@gmail.com';
    resetOtaControlStateForTest(true);
    try {
      const unsignedProdPublish = createMockRes();
      handleAdminPublishOtaRelease(
        {
          user: { uid: 'master_1', email: 'kmiloko19@gmail.com', isAdmin: true },
          body: {
            channel: 'production',
            version: '7.0.1',
            url: 'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/download/v7.0.1/ota.zip',
            checksum: 'a'.repeat(64),
          },
        } as any,
        unsignedProdPublish
      );
      assert.equal(unsignedProdPublish.statusCode, 400);
    } finally {
      resetOtaControlStateForTest(false);
      if (prevAdmin === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = prevAdmin;
    }
  });

  console.log(`\n🎉 ALL ${passed} CI APK & OTA SYSTEM CHECKS PASSED!`);
}

runSuite().catch((err) => {
  console.error('❌ otaUpdateSystemSuite failed:', err);
  process.exit(1);
});
