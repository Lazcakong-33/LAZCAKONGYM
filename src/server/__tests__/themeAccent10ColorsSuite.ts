import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_THEME_ACCENT,
  THEME_PALETTE_LIST,
  applyThemeToRoot,
  getContrastRatio,
  getThemeConfig,
  normalizeThemeAccent,
} from '../../utils/theme';

const EXPECTED_PALETTE: ReadonlyArray<{ id: string; name: string; primary: string }> = [
  { id: 'smartfit', name: 'Verde Lima Elite', primary: '#CCFF00' },
  { id: 'violet_elite', name: 'Violeta Elite', primary: '#9D4EDD' },
  { id: 'cyan_ice', name: 'Cian Ice', primary: '#35C9FF' },
  { id: 'fuchsia_pro', name: 'Fucsia Pro', primary: '#FF4FA3' },
  { id: 'turquoise_fit', name: 'Turquesa Fit', primary: '#00D1C7' },
  { id: 'gold_premium', name: 'Dorado Premium', primary: '#FFB703' },
  { id: 'titan_red', name: 'Rojo Titan', primary: '#FF4545' },
  { id: 'royal_blue', name: 'Azul Royal', primary: '#4F7CFF' },
  { id: 'power_orange', name: 'Naranja Power', primary: '#FF8533' },
  { id: 'rose_quartz', name: 'Rosa Quartz', primary: '#FF80BF' },
];

function runSuite() {
  console.log('=== LAZCAKONG GYM 7.0 — 10-COLOR THEME ACCENT SUITE ===');

  // 1. Exact 10 official colors, names, HEXs
  assert.equal(THEME_PALETTE_LIST.length, 10, 'Debe existir exactamente 10 temas oficiales');
  for (let i = 0; i < EXPECTED_PALETTE.length; i += 1) {
    const expected = EXPECTED_PALETTE[i];
    const actual = THEME_PALETTE_LIST[i];
    assert.equal(actual.id, expected.id, `ID correcto en posición ${i}`);
    assert.equal(actual.name, expected.name, `Nombre correcto para ${expected.id}`);
    assert.equal(actual.primary, expected.primary, `HEX correcto para ${expected.id}`);
  }
  console.log('✓ 1. Los 10 colores oficiales, nombres y códigos HEX coinciden exactamente');

  // 2. WCAG AA Contrast verification across all 10 themes
  for (const cfg of THEME_PALETTE_LIST) {
    const onDarkCard = getContrastRatio(cfg.readableText, '#171717');
    const onDarkBg = getContrastRatio(cfg.readableText, '#090909');
    const btnContrast = getContrastRatio(cfg.contrastText, cfg.primary);
    assert.ok(
      onDarkCard >= 4.5,
      `${cfg.name}: readableText ${cfg.readableText} sobre #171717 debe cumplir >= 4.5 (actual ${onDarkCard.toFixed(2)})`
    );
    assert.ok(
      onDarkBg >= 4.5,
      `${cfg.name}: readableText ${cfg.readableText} sobre #090909 debe cumplir >= 4.5 (actual ${onDarkBg.toFixed(2)})`
    );
    assert.ok(
      btnContrast >= 4.5,
      `${cfg.name}: contrastText ${cfg.contrastText} sobre ${cfg.primary} debe cumplir >= 4.5 (actual ${btnContrast.toFixed(2)})`
    );
  }
  console.log('✓ 2. Los 10 temas cumplen contraste WCAG AA >= 4.5:1 en botones y texto legible');

  // 3. Normalization (ID, HEX case-insensitive, legacy IDs, invalid fallback)
  assert.equal(DEFAULT_THEME_ACCENT, 'smartfit');
  assert.equal(normalizeThemeAccent('violet_elite'), 'violet_elite');
  assert.equal(normalizeThemeAccent('#9d4edd'), 'violet_elite');
  assert.equal(normalizeThemeAccent('#35C9FF'), 'cyan_ice');
  assert.equal(normalizeThemeAccent('gorilla'), 'smartfit');
  assert.equal(normalizeThemeAccent('electric'), 'smartfit');
  assert.equal(normalizeThemeAccent('amber'), 'smartfit');
  assert.equal(normalizeThemeAccent('unknown_theme'), 'smartfit');
  assert.equal(getThemeConfig('power_orange').primary, '#FF8533');
  console.log('✓ 3. Normalización por ID, HEX, legacy y fallback por defecto verificada');

  // 4. CSS root property application via mock document.documentElement
  const cssVars = new Map<string, string>();
  const attrs = new Map<string, string>();
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      style: {
        setProperty: (k: string, v: string) => cssVars.set(k, v),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
    },
  };
  applyThemeToRoot('fuchsia_pro');
  assert.equal(cssVars.get('--accent-primary'), '#FF4FA3');
  assert.equal(cssVars.get('--accent-contrast-text'), '#090909');
  assert.equal(cssVars.get('--accent-readable-text'), '#FF4FA3');
  assert.equal(attrs.get('data-theme-accent'), 'fuchsia_pro');

  applyThemeToRoot('violet_elite');
  assert.equal(cssVars.get('--accent-primary'), '#9D4EDD');
  assert.equal(cssVars.get('--accent-contrast-text'), '#FFFFFF');
  assert.equal(cssVars.get('--accent-readable-text'), '#C084FC');
  assert.equal(attrs.get('data-theme-accent'), 'violet_elite');
  delete (globalThis as Record<string, unknown>).document;
  console.log('✓ 4. applyThemeToRoot actualiza variables CSS globales (--accent-*) y contraste por tema');

  // 5. Responsive grid, preview without save, explicit save, revert on leave, per-athlete key
  const settingsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/SettingsCloudView.tsx'),
    'utf8'
  );
  const themeCtxSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/context/ThemeContext.tsx'),
    'utf8'
  );
  assert.ok(
    settingsSrc.includes('ACENTO LUMÍNICO — PERSONALIZA TU APP') &&
      settingsSrc.includes('grid-cols-2 md:grid-cols-3 lg:grid-cols-5') &&
      settingsSrc.includes('SELECCIONADO') &&
      settingsSrc.includes('GUARDAR CAMBIOS DE PERFIL') &&
      settingsSrc.includes('previewThemeAccent') &&
      settingsSrc.includes('revertPreviewRef.current()') &&
      settingsSrc.includes('setThemeAccent(draftThemeAccent)'),
    'SettingsCloudView debe incluir grilla 2/3/5 cols, preview inmediato, revert al salir y guardado solo al pulsar GUARDAR CAMBIOS DE PERFIL'
  );
  assert.ok(
    themeCtxSrc.includes('lazcakon_${profileId}_theme_accent') &&
      themeCtxSrc.includes('previewThemeAccent') &&
      themeCtxSrc.includes('revertThemePreview'),
    'ThemeContext debe aislar preferencias por profileId y separar vista previa del guardado'
  );
  console.log('✓ 5. Selector 2/3/5 cols, vista previa inmediata, guardado explícito, reversión y aislamiento por atleta');

  // 6. Global propagation check across all refactored views & dashboards
  const viewsToCheck = [
    'src/views/ProgresoView.tsx',
    'src/views/ActiveWorkoutView.tsx',
    'src/views/MapaMuscularView.tsx',
    'src/components/Navigation.tsx',
    'src/components/CentroDeRendimientoDashboard.tsx',
    'src/components/OneRMProgressionChart.tsx',
    'src/components/EliteChallengesPanel.tsx',
    'src/components/EliteBackupRestorePanel.tsx',
    'src/components/ExerciseDetailModal.tsx',
    'src/components/AssociatedExerciseCard.tsx',
    'src/components/MuscleGroupCardsGrid.tsx',
    'src/components/BiomechanicalTelemetryHUD.tsx',
  ];
  for (const rel of viewsToCheck) {
    const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    assert.ok(
      content.includes('accent') || content.includes('--accent-'),
      `${rel} debe usar tokens dinámicos de acento`
    );
    assert.ok(
      !content.includes('#b8e600') && !content.includes('#B8E600'),
      `${rel} no debe contener hover hardcoded #b8e600/#B8E600`
    );
  }
  console.log('✓ 6. Propagación global verificada en vistas, navegación, gráficas y modales');

  console.log('======================================================');
  console.log('   10/10 THEME ACCENT SUITE: ALL CHECKS PASSED        ');
  console.log('======================================================');
}

runSuite();
