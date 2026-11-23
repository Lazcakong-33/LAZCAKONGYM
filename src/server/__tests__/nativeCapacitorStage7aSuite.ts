/**
 * LAZCAKONG GYM 7.0 — ETAPA 7A: NATIVE EXPERIENCE PRO (CAPACITOR) SUITE
 *
 * Verifies Capacitor 8 configuration, Android & iOS project generation, gorilla icons/splash,
 * Cloud Run API origin routing & CORS, native Google Sign-In UID preservation adapter,
 * native local notifications/haptics safety, and 100% Web/PWA preservation.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import capacitorConfig from '../../../capacitor.config.ts';
import { DEFAULT_BACKEND_ORIGIN, resolveApiUrl } from '../../utils/apiUrl.ts';
import { getGoogleWebClientId } from '../../utils/nativeAuth.ts';
import {
  computeNativeNotificationId,
  isCapacitorNativeRuntime,
  scheduleNativeRestNotification,
} from '../../utils/nativeNotifications.ts';
import { detectRuntimePlatform } from '../../utils/capacitorPlatform.ts';

const ROOT = process.cwd();

interface TestCaseResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestCaseResult[] = [];

async function runCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, detail: err?.message || String(err) });
    console.error(`❌ FAIL: ${name} -> ${err?.message || err}`);
  }
}

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  console.log('\n=== LAZCAKONG GYM 7.0 — ETAPA 7A CAPACITOR SUITE ===\n');

  await runCase('1. capacitor.config.ts matches LAZCAKONG GYM / com.lazcakong.gym / dist', () => {
    assert.equal(capacitorConfig.appId, 'com.lazcakong.gym');
    assert.equal(capacitorConfig.appName, 'LAZCAKONG GYM');
    assert.equal(capacitorConfig.webDir, 'dist');
    assert.equal(capacitorConfig.server?.androidScheme, 'https');
    assert.equal(capacitorConfig.server?.iosScheme, 'capacitor');
    assert.equal(capacitorConfig.plugins?.SplashScreen?.backgroundColor, '#090909');
  });

  await runCase('2. Android project generated with manifest permissions, adaptive icons, and splash assets', () => {
    const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
    assert.ok(gradle.includes('applicationId "com.lazcakong.gym"'));
    assert.ok(gradle.includes('namespace = "com.lazcakong.gym"'));

    const stringsXml = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/res/values/strings.xml'),
      'utf8'
    );
    assert.ok(stringsXml.includes('<string name="app_name">LAZCAKONG GYM</string>'));
    assert.ok(stringsXml.includes('<string name="package_name">com.lazcakong.gym</string>'));

    const manifest = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    for (const perm of [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.WAKE_LOCK',
      'ic_stat_lazcakong',
    ]) {
      assert.ok(manifest.includes(perm), `Missing AndroidManifest entry: ${perm}`);
    }

    const iconBg = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/res/values/ic_launcher_background.xml'),
      'utf8'
    );
    assert.ok(iconBg.includes('#090909'));

    for (const relAsset of [
      'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
      'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
      'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
      'android/app/src/main/res/drawable/ic_stat_lazcakong.png',
      'android/app/src/main/res/drawable/splash.png',
      'android/app/src/main/res/drawable-port-xxhdpi/splash.png',
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, relAsset)), `Missing Android asset: ${relAsset}`);
      assert.ok(fs.statSync(path.join(ROOT, relAsset)).size > 100, `Empty Android asset: ${relAsset}`);
    }
  });

  await runCase('3. iOS Xcode & Swift Package Manager structure prepared cleanly', () => {
    const infoPlist = fs.readFileSync(path.join(ROOT, 'ios/App/App/Info.plist'), 'utf8');
    assert.ok(infoPlist.includes('LAZCAKONG GYM'));
    assert.ok(
      fs.existsSync(path.join(ROOT, 'ios/App/CapApp-SPM/Package.swift')),
      'Missing iOS CapApp-SPM Package.swift'
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')),
      'Missing iOS AppIcon PNG'
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png')),
      'Missing iOS Splash PNG'
    );
  });

  await runCase('4. Cloud Run API URL routing keeps relative /api on Web and prefixes Cloud Run on Capacitor native', () => {
    assert.equal(resolveApiUrl('/api/auth/session-init', { forceNative: false }), '/api/auth/session-init');
    assert.equal(
      resolveApiUrl('/api/auth/session-init', { forceNative: true }),
      `${DEFAULT_BACKEND_ORIGIN}/api/auth/session-init`
    );
    assert.equal(
      resolveApiUrl('/api/coach/chat', {
        forceNative: true,
        baseUrl: 'https://custom-cloud-run.a.run.app/',
      }),
      'https://custom-cloud-run.a.run.app/api/coach/chat'
    );
    assert.equal(
      resolveApiUrl('https://already-absolute.run.app/api/test', { forceNative: true }),
      'https://already-absolute.run.app/api/test'
    );

    const srcFiles = collectSourceFiles(path.join(ROOT, 'src'));
    const directUnwrappedFetches: string[] = [];
    for (const file of srcFiles) {
      const text = fs.readFileSync(file, 'utf8');
      if (/fetch\(\s*['"`]\/api\//.test(text)) {
        directUnwrappedFetches.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(
      directUnwrappedFetches,
      [],
      `Found unwrapped direct fetch('/api/...') calls: ${directUnwrappedFetches.join(', ')}`
    );
  });

  await runCase('5. Express server.ts configures CORS for Capacitor WebView origins and Bearer headers', () => {
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    const corsConfigSrc = fs.readFileSync(path.join(ROOT, 'src/server/corsConfig.ts'), 'utf8');
    const combinedCorsSrc = `${serverSrc}\n${corsConfigSrc}`;
    for (const expected of [
      'https://localhost',
      'capacitor://localhost',
      'ionic://localhost',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Headers',
      'Authorization',
      "req.method === 'OPTIONS'",
    ]) {
      assert.ok(combinedCorsSrc.includes(expected), `Missing CORS pattern in server/corsConfig: ${expected}`);
    }
  });

  await runCase('6. Native Google Sign-In adapter preserves Firebase UIDs via signInWithCredential & webClientId', () => {
    const webClientId = getGoogleWebClientId();
    assert.ok(webClientId.endsWith('.apps.googleusercontent.com'), 'Expected valid Google OAuth Client ID');
    const nativeAuthSrc = fs.readFileSync(path.join(ROOT, 'src/utils/nativeAuth.ts'), 'utf8');
    assert.ok(nativeAuthSrc.includes('GoogleAuthProvider.credential'));
    assert.ok(nativeAuthSrc.includes('signInWithCredential'));
    assert.ok(nativeAuthSrc.includes('linkWithCredential'));
  });

  await runCase('7. Native notifications & haptics adapters fail-safe in Web/Node SSR and generate deterministic IDs', async () => {
    assert.equal(isCapacitorNativeRuntime(), false);
    const id1 = computeNativeNotificationId('rest-1700000000000-abc');
    const id2 = computeNativeNotificationId('rest-1700000000000-abc');
    assert.equal(id1, id2);
    assert.ok(id1 >= 100000 && id1 < 2147483647);

    const scheduledInWeb = await scheduleNativeRestNotification({
      targetEndTime: Date.now() + 30000,
      restId: 'rest-test-1',
      mode: 'sound',
      restEndAlertEnabled: true,
    });
    assert.equal(scheduledInWeb, false);
  });

  await runCase('8. Web & PWA infrastructure remains 100% operational alongside Capacitor shell', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/sw.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'public/manifest.json')));
    const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8');
    assert.ok(mainSrc.includes("navigator.serviceWorker"));
    assert.ok(mainSrc.includes('runtimePlatform.hasServiceWorkerSupport'));
    const platformNode = detectRuntimePlatform();
    assert.equal(platformNode.platform, 'web');
    assert.equal(platformNode.isCapacitorNative, false);
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\nResumen Stage 7A: ${results.length - failed.length}/${results.length} pruebas aprobadas.`);
  if (failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

void main();
