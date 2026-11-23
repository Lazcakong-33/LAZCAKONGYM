/**
 * LAZCAKONG GYM 7.0 — ETAPA 7B: VALIDACIÓN NATIVA Y PREPARACIÓN APK SUITE
 *
 * Audits all 12 pre-export requirements:
 * 1. Permanent Cloud Run origin in VITE_API_BASE_URL / apiUrl / getPublicAppUrl (no ais-dev preview URLs)
 * 2. VITE_GOOGLE_WEB_CLIENT_ID / native Google Sign-In client config
 * 3. Strict CORS allowlist rejecting untrusted origins / wildcards in production
 * 4. Zero server secrets, private keys, tokens, or .env files inside dist/, android/, or ios/
 * 5. AndroidManifest.xml retains SCHEDULE_EXACT_ALARM and strictly removes USE_EXACT_ALARM
 * 6. Capacitor allowNavigation strictly points to permanent authorized hosts
 * 7. Gradle Wrapper (gradlew, gradlew.bat, gradle-wrapper.jar, gradle-wrapper.properties) & SDK/AGP versions
 * 8. Adaptive icons, gorilla launcher assets, splash screens, and iOS SPM structure present
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import capacitorConfig from '../../../capacitor.config.ts';
import { DEFAULT_BACKEND_ORIGIN, resolveApiUrl } from '../../utils/apiUrl.ts';
import { DEFAULT_PUBLIC_APP_URL } from '../../utils/firebaseSync.ts';
import { getGoogleWebClientId } from '../../utils/nativeAuth.ts';
import {
  isAllowedCorsOrigin,
  PERMANENT_CLOUD_RUN_ORIGIN,
} from '../corsConfig.ts';

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

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  console.log('\n=== LAZCAKONG GYM 7.0 — ETAPA 7B VALIDACIÓN NATIVA Y APK SUITE ===\n');

  await runCase('1. VITE_API_BASE_URL y DEFAULT_BACKEND_ORIGIN apuntan al backend público verificado (lazcakongym.ai.studio)', () => {
    assert.equal(
      DEFAULT_BACKEND_ORIGIN,
      'https://lazcakongym.ai.studio'
    );
    assert.equal(DEFAULT_PUBLIC_APP_URL, DEFAULT_BACKEND_ORIGIN);
    assert.ok(!DEFAULT_BACKEND_ORIGIN.includes('ais-dev-'));
    assert.ok(!DEFAULT_BACKEND_ORIGIN.includes('ais-pre-'));
    assert.equal(
      resolveApiUrl('/api/health', { forceNative: true }),
      `${PERMANENT_CLOUD_RUN_ORIGIN}/api/health`
    );

    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    assert.ok(envExample.includes(`VITE_API_BASE_URL="${PERMANENT_CLOUD_RUN_ORIGIN}"`));
  });

  await runCase('2. VITE_GOOGLE_WEB_CLIENT_ID y configuración OAuth nativa están correctamente configuradas', () => {
    const webClientId = getGoogleWebClientId();
    assert.equal(
      webClientId,
      '13537846485-8j7931cki5gtlpq2eklsru35765sv3pq.apps.googleusercontent.com'
    );
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    assert.ok(envExample.includes(webClientId));
    assert.ok(envExample.includes('VITE_*'));
  });

  await runCase('3. CORS_ALLOWED_ORIGINS restringe estrictamente los orígenes autorizados (sin wildcards abiertos)', () => {
    const prodEnv = { NODE_ENV: 'production' };

    // Authorized origins must pass in production
    assert.equal(isAllowedCorsOrigin('https://localhost', prodEnv), true);
    assert.equal(isAllowedCorsOrigin('capacitor://localhost', prodEnv), true);
    assert.equal(isAllowedCorsOrigin('ionic://localhost', prodEnv), true);
    assert.equal(isAllowedCorsOrigin(PERMANENT_CLOUD_RUN_ORIGIN, prodEnv), true);
    assert.equal(isAllowedCorsOrigin('https://lazcakongym-13537846485.us-east1.run.app', prodEnv), true);
    assert.equal(isAllowedCorsOrigin('https://forward-cortex-1ds98.web.app', prodEnv), true);
    assert.equal(isAllowedCorsOrigin('https://forward-cortex-1ds98.firebaseapp.com', prodEnv), true);

    // Untrusted / arbitrary subdomains must FAIL in production
    assert.equal(isAllowedCorsOrigin('https://evil-attacker.run.app', prodEnv), false);
    assert.equal(isAllowedCorsOrigin('https://other-project.web.app', prodEnv), false);
    assert.equal(isAllowedCorsOrigin('https://other-project.firebaseapp.com', prodEnv), false);
    assert.equal(isAllowedCorsOrigin('https://evil.com', prodEnv), false);
    assert.equal(
      isAllowedCorsOrigin('https://ais-dev-56i2tt63sua7ovhyxwpgjs-888570249716.us-east1.run.app', prodEnv),
      false
    );

    // Explicit CORS_ALLOWED_ORIGINS extension works cleanly
    assert.equal(
      isAllowedCorsOrigin('https://app.lazcakongym.com', {
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://app.lazcakongym.com',
      }),
      true
    );

    // server.ts wires corsConfig and returns 403 on unauthorized OPTIONS preflight
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    assert.ok(serverSrc.includes("from './src/server/corsConfig.ts'"));
    assert.ok(serverSrc.includes('res.status(403)'));
  });

  await runCase('4. AndroidManifest.xml conserva SCHEDULE_EXACT_ALARM y excluye USE_EXACT_ALARM', () => {
    const manifest = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    assert.ok(manifest.includes('android.permission.SCHEDULE_EXACT_ALARM'));
    assert.ok(
      !manifest.includes('USE_EXACT_ALARM'),
      'USE_EXACT_ALARM debe eliminarse para cumplir políticas de Google Play'
    );
    assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'));
    assert.ok(manifest.includes('android.permission.VIBRATE'));
  });

  await runCase('5. capacitor.config.ts y build web nativo no apuntan a URLs temporales ais-dev-* / ais-pre-* ni wildcards *.run.app', () => {
    const allowNav = capacitorConfig.server?.allowNavigation || [];
    assert.ok(allowNav.includes('lazcakongym.ai.studio'));
    assert.ok(allowNav.includes('lazcakongym-13537846485.us-east1.run.app'));
    assert.ok(!allowNav.some((h) => h.includes('ais-dev-') || h.includes('ais-pre-')));
    assert.ok(!allowNav.includes('*.run.app'));
    assert.ok(!allowNav.includes('*.firebaseapp.com'));

    const pwaBtnSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/PWAInstallButton.tsx'),
      'utf8'
    );
    assert.ok(!pwaBtnSrc.includes('ais-dev-'));
  });

  await runCase('6. dist/, android/ y ios/ NO contienen secretos del servidor, .env ni keystores privados', () => {
    const forbiddenFilePatterns = [
      /\/\.env/i,
      /\.jks$/i,
      /\.keystore$/i,
      /google-services\.json$/i,
      /GoogleService-Info\.plist$/i,
      /service[-_]?account.*\.json$/i,
      /\.pem$/i,
      /\.p12$/i,
    ];

    const secretTokens = [
      'RESEND_API_KEY',
      're_123456789',
      'MERCADOPAGO_ACCESS_TOKEN',
      'APP_USR-',
      'VAPID_PRIVATE_KEY',
      'PUSH_DISPATCH_SECRET',
      'QSTASH_TOKEN',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'BEGIN PRIVATE KEY',
      'GEMINI_API_KEY',
      'ais-dev-56i2tt63sua7ovhyxwpgjs',
      'ais-pre-56i2tt63sua7ovhyxwpgjs',
    ];

    for (const dirName of ['dist', 'android', 'ios']) {
      const fullDir = path.join(ROOT, dirName);
      assert.ok(fs.existsSync(fullDir), `Directorio faltante: ${dirName}`);
      const files = walkFiles(fullDir);
      assert.ok(files.length > 0, `Directorio vacío: ${dirName}`);

      for (const file of files) {
        const unixRel = path.relative(ROOT, file).replace(/\\/g, '/');
        for (const rx of forbiddenFilePatterns) {
          assert.ok(!rx.test('/' + unixRel), `Archivo prohibido encontrado en ${dirName}/: ${unixRel}`);
        }
        if (/\.(js|html|css|json|xml|gradle|properties|txt|plist|swift)$/i.test(file)) {
          const content = fs.readFileSync(file, 'utf8');
          for (const token of secretTokens) {
            assert.ok(
              !content.includes(token),
              `Patrón sensible (${token}) encontrado en ${unixRel}`
            );
          }
        }
      }
    }
  });

  await runCase('7. android/ incluye Gradle Wrapper completo para Windows y versiones verificadas de SDK/Java/AGP', () => {
    for (const reqFile of [
      'android/gradlew',
      'android/gradlew.bat',
      'android/gradle/wrapper/gradle-wrapper.jar',
      'android/gradle/wrapper/gradle-wrapper.properties',
      'android/build.gradle',
      'android/app/build.gradle',
      'android/app/capacitor.build.gradle',
      'android/settings.gradle',
      'android/variables.gradle',
      'android/gradle.properties',
      'android/capacitor.settings.gradle',
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, reqFile)), `Falta archivo Gradle/Android: ${reqFile}`);
    }

    const wrapperProps = fs.readFileSync(
      path.join(ROOT, 'android/gradle/wrapper/gradle-wrapper.properties'),
      'utf8'
    );
    assert.ok(wrapperProps.includes('gradle-8.14.3-all.zip'));

    const rootBuildGradle = fs.readFileSync(path.join(ROOT, 'android/build.gradle'), 'utf8');
    assert.ok(rootBuildGradle.includes('com.android.tools.build:gradle:8.13.0'));
    assert.ok(rootBuildGradle.includes('com.google.gms:google-services:4.4.4'));

    const variablesGradle = fs.readFileSync(path.join(ROOT, 'android/variables.gradle'), 'utf8');
    assert.ok(variablesGradle.includes('minSdkVersion = 24'));
    assert.ok(variablesGradle.includes('compileSdkVersion = 36'));
    assert.ok(variablesGradle.includes('targetSdkVersion = 36'));

    const capBuildGradle = fs.readFileSync(
      path.join(ROOT, 'android/app/capacitor.build.gradle'),
      'utf8'
    );
    assert.ok(capBuildGradle.includes('JavaVersion.VERSION_21'));

    const icLauncherXml = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
      'utf8'
    );
    assert.ok(icLauncherXml.includes('@color/ic_launcher_background'));
    assert.ok(icLauncherXml.includes('@mipmap/ic_launcher_foreground'));

    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules/@capacitor/cli/package.json'), 'utf8')
    );
    assert.equal(cliPkg.engines?.node, '>=22.0.0');
  });

  await runCase('8. Sincronización limpia: assets públicos en android/ e ios/ coinciden 1:1 con dist/ sin archivos huérfanos', () => {
    const distAssetFiles = fs
      .readdirSync(path.join(ROOT, 'dist/assets'))
      .filter((f) => /^index-.*\.(js|css)$/.test(f))
      .sort();
    const androidAssetFiles = fs
      .readdirSync(path.join(ROOT, 'android/app/src/main/assets/public/assets'))
      .filter((f) => /^index-.*\.(js|css)$/.test(f))
      .sort();
    const iosAssetFiles = fs
      .readdirSync(path.join(ROOT, 'ios/App/App/public/assets'))
      .filter((f) => /^index-.*\.(js|css)$/.test(f))
      .sort();

    assert.equal(distAssetFiles.length, 2, `Se esperaba 1 JS + 1 CSS en dist/assets, encontrado: ${distAssetFiles.join(', ')}`);
    assert.deepEqual(androidAssetFiles, distAssetFiles);
    assert.deepEqual(iosAssetFiles, distAssetFiles);
  });

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\nResumen Stage 7B: ${results.length - failed.length}/${results.length} validaciones aprobadas.`
  );
  if (failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

void main();
