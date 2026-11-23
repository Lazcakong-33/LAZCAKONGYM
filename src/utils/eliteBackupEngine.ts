import {
  BodyWeightEntry,
  CompletedWorkout,
  Exercise,
  PersonalRecord,
  Profile,
  Routine,
} from '../types';
import { getLocalDateKey } from './calorieCalculator';
import { consolidateWeeklyRoutines } from './csvImporter';
import { purgeAndSanitizeWorkoutHistory } from './historySanitizer';
import {
  PreImportBackupSnapshot,
  StorageLike,
  createPreImportBackupSnapshot,
} from './safeImportPersistence';
export type { StorageLike };
import { normalizeText } from './workoutAnalyticsEngine';

export const ELITE_BACKUP_SCHEMA_VERSION = '2.0.0';
export const SUPPORTED_LEGACY_BACKUP_VERSIONS = new Set(['2.0.0', '3.0.0']);
export const STORAGE_SCHEMA_VERSION = '2026.11.0';
export const STORAGE_SCHEMA_KEY = 'lazcakon_storage_schema_version';

const SENSITIVE_KEY_PATTERN =
  /^(pin|password|passwd|secret|token|apikey|api_key|privatekey|credential|authToken|refreshToken)$/i;

export interface SanitizedAthleteMetadata {
  profileId: string;
  name: string;
  avatar: string;
  goal: string;
  weeklyTargetDays: number;
  weightKg?: number;
  heightCm?: number;
  weightUnit: 'kg' | 'lb';
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  themeAccent?: string;
  createdAt?: string;
}

export interface EliteBackupPayloadData {
  routines: Routine[];
  customExercises: Exercise[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  bodyWeightLogs: BodyWeightEntry[];
  customLinks: Record<string, { id: string; title: string; url: string }[]>;
  selectedAlternatives: Record<string, boolean>;
  monthlyArchives: Record<string, unknown>;
}

export interface EliteBackupCounts {
  routines: number;
  customExercises: number;
  history: number;
  prs: number;
  bodyWeightLogs: number;
  customLinkGroups: number;
  selectedAlternatives: number;
  monthlyArchives: number;
}

export interface EliteBackupDocumentV2 {
  app: 'LAZCAKONGYM';
  schemaVersion: string;
  backupType: 'athlete_full_recoverable';
  backupId: string;
  exportedAt: string;
  athlete: SanitizedAthleteMetadata;
  data: EliteBackupPayloadData;
  integrity: {
    algorithm: 'FNV1a-32+Length';
    checksum: string;
    counts: EliteBackupCounts;
  };
}

export type BackupRestoreStrategy = 'merge_safe' | 'replace_authorized';

export interface BackupRestoreConflictSummary {
  conflictingRoutineTitles: string[];
  collidingWorkoutDates: string[];
  higherExistingPrKeys: string[];
  duplicateBodyWeightIds: string[];
}

export interface BackupInspectionResult {
  valid: boolean;
  error?: string;
  legacyFormat: boolean;
  schemaVersion: string;
  backupId: string;
  exportedAt: string;
  integrityStatus: 'verified' | 'legacy_unhashed' | 'corrupted' | 'invalid_schema';
  sourceProfileId: string;
  sourceAthleteName: string;
  targetProfileId: string;
  crossProfileDetected: boolean;
  counts: {
    backup: EliteBackupCounts;
    willAdd: {
      routines: number;
      history: number;
      prs: number;
      bodyWeightLogs: number;
      customLinks: number;
      selectedAlternatives: number;
      monthlyArchives: number;
    };
    existingBefore: {
      routines: number;
      history: number;
      prs: number;
      bodyWeightLogs: number;
    };
  };
  conflicts: BackupRestoreConflictSummary;
  parsedBackup?: EliteBackupDocumentV2;
}

export interface ExecuteSafeBackupRestoreParams {
  rawJson: string;
  targetProfile: Profile;
  currentState: {
    routines: Routine[];
    history: CompletedWorkout[];
    prs: Record<string, PersonalRecord>;
    bodyWeightLogs: BodyWeightEntry[];
    customLinks: Record<string, { id: string; title: string; url: string }[]>;
    selectedAlternatives: Record<string, boolean>;
  };
  strategy?: BackupRestoreStrategy;
  confirmed: boolean;
  confirmReplaceExplicit?: boolean;
  authorizeCrossProfile?: boolean;
  restorePreferences?: boolean;
  storage?: StorageLike | null;
}

export interface ExecuteSafeBackupRestoreResult {
  success: boolean;
  message: string;
  strategyUsed: BackupRestoreStrategy;
  inspection: BackupInspectionResult;
  backupSnapshot?: PreImportBackupSnapshot;
  nextState?: {
    routines: Routine[];
    history: CompletedWorkout[];
    prs: Record<string, PersonalRecord>;
    bodyWeightLogs: BodyWeightEntry[];
    customLinks: Record<string, { id: string; title: string; url: string }[]>;
    selectedAlternatives: Record<string, boolean>;
    profileUpdates?: Partial<Profile>;
  };
  addedCounts?: {
    routines: number;
    history: number;
    prs: number;
    bodyWeightLogs: number;
  };
  cloudPatch?: Record<string, unknown>;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {}
  return null;
}

/**
 * Recursively removes credentials, PINs, tokens, and PII secrets before any JSON export.
 */
export function stripSensitiveFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) || key === 'email') {
        continue;
      }
      if (val !== undefined) {
        cleaned[key] = stripSensitiveFields(val);
      }
    }
    return cleaned as T;
  }
  return value;
}

/**
 * Deterministic canonical JSON stringify (sorted keys) for reliable integrity checksums.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Dual-pass 32-bit FNV-1a checksum + UTF length signature (pure JS, sync, works in Node & Browser).
 */
export function computeDeterministicChecksum(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}-${input.length.toString(16)}`;
}

function collectMonthlyArchivesFromStorage(
  profileId: string,
  storage: StorageLike | null
): Record<string, unknown> {
  const archives: Record<string, unknown> = {};
  if (!storage) return archives;
  try {
    const monthsRaw = storage.getItem('lazcakon_historico_meses_disponibles');
    const months: string[] = monthsRaw ? JSON.parse(monthsRaw) : [];
    if (Array.isArray(months)) {
      for (const monthId of months) {
        const raw = storage.getItem(`lazcakon_historico_mensual_${monthId}`);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && (!parsed.userId || parsed.userId === profileId || parsed.userId === 'atleta_default')) {
          archives[monthId] = stripSensitiveFields(parsed);
        }
      }
    }
  } catch {}
  return archives;
}

function extractCustomExercisesCatalog(routines: Routine[]): Exercise[] {
  const byId = new Map<string, Exercise>();
  for (const r of routines) {
    if (!r || !Array.isArray(r.exercises)) continue;
    for (const ex of r.exercises) {
      if (!ex || !ex.id || !ex.name) continue;
      if (!byId.has(ex.id)) {
        byId.set(ex.id, stripSensitiveFields({ ...ex }));
      }
    }
  }
  return Array.from(byId.values());
}

/**
 * Generates a complete, schema-versioned, integrity-verified, credential-free JSON backup
 * strictly scoped to the authorized active athlete profile.
 */
export function createSanitizedProfileBackup(params: {
  profile: Profile;
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  bodyWeightLogs: BodyWeightEntry[];
  customLinks: Record<string, { id: string; title: string; url: string }[]>;
  selectedAlternatives: Record<string, boolean>;
  storage?: StorageLike | null;
}): EliteBackupDocumentV2 {
  const {
    profile,
    routines,
    history,
    prs,
    bodyWeightLogs,
    customLinks,
    selectedAlternatives,
    storage = getDefaultStorage(),
  } = params;

  const cleanRoutines = stripSensitiveFields(Array.isArray(routines) ? routines : []);
  const cleanHistory = stripSensitiveFields(Array.isArray(history) ? history : []);
  const cleanPrs = stripSensitiveFields(prs && typeof prs === 'object' ? prs : {});
  const cleanBodyWeight = stripSensitiveFields(Array.isArray(bodyWeightLogs) ? bodyWeightLogs : []);
  const cleanCustomLinks = stripSensitiveFields(
    customLinks && typeof customLinks === 'object' ? customLinks : {}
  );
  const cleanAlts = stripSensitiveFields(
    selectedAlternatives && typeof selectedAlternatives === 'object' ? selectedAlternatives : {}
  );
  const customExercises = extractCustomExercisesCatalog(cleanRoutines);
  const monthlyArchives = collectMonthlyArchivesFromStorage(profile.id, storage);

  const athlete: SanitizedAthleteMetadata = {
    profileId: profile.id,
    name: profile.name || 'Atleta',
    avatar: profile.avatar || '🦍',
    goal: profile.goal || 'Hipertrofia & Masa',
    weeklyTargetDays: Number(profile.weeklyTargetDays) || 5,
    weightKg: typeof profile.weightKg === 'number' ? profile.weightKg : undefined,
    heightCm: typeof profile.heightCm === 'number' ? profile.heightCm : undefined,
    weightUnit: profile.weightUnit === 'lb' ? 'lb' : 'kg',
    soundEnabled: profile.soundEnabled !== false,
    vibrationEnabled: profile.vibrationEnabled !== false,
    themeAccent: profile.themeAccent,
    createdAt: profile.createdAt,
  };

  const data: EliteBackupPayloadData = {
    routines: cleanRoutines,
    customExercises,
    history: cleanHistory,
    prs: cleanPrs,
    bodyWeightLogs: cleanBodyWeight,
    customLinks: cleanCustomLinks,
    selectedAlternatives: cleanAlts,
    monthlyArchives,
  };

  const counts: EliteBackupCounts = {
    routines: cleanRoutines.length,
    customExercises: customExercises.length,
    history: cleanHistory.length,
    prs: Object.keys(cleanPrs).length,
    bodyWeightLogs: cleanBodyWeight.length,
    customLinkGroups: Object.keys(cleanCustomLinks).length,
    selectedAlternatives: Object.keys(cleanAlts).length,
    monthlyArchives: Object.keys(monthlyArchives).length,
  };

  const exportedAt = new Date().toISOString();
  const backupId = `lzk-bak-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const corePayload = {
    app: 'LAZCAKONGYM' as const,
    schemaVersion: ELITE_BACKUP_SCHEMA_VERSION,
    backupType: 'athlete_full_recoverable' as const,
    backupId,
    exportedAt,
    athlete,
    data,
  };

  const checksum = computeDeterministicChecksum(canonicalStringify(corePayload));

  return {
    ...corePayload,
    integrity: {
      algorithm: 'FNV1a-32+Length',
      checksum,
      counts,
    },
  };
}

function normalizeWorkoutDateKey(w: Partial<CompletedWorkout>): string | null {
  if (!w || !w.date) return null;
  return getLocalDateKey(w.date) || String(w.date).slice(0, 10) || null;
}

function isBackupPrBetter(candidate: PersonalRecord, current?: PersonalRecord): boolean {
  if (!candidate || typeof candidate.maxWeight !== 'number') return false;
  if (!current) return true;
  if (candidate.maxWeight > current.maxWeight) return true;
  if (
    candidate.maxWeight === current.maxWeight &&
    (candidate.repsAtMaxWeight || 0) > (current.repsAtMaxWeight || 0)
  ) {
    return true;
  }
  return false;
}

/**
 * Parses, validates schema + integrity checksum, detects cross-profile ownership,
 * and computes exact non-mutating diff + conflicts BEFORE restoring.
 */
export function inspectBackupForRestore(params: {
  rawJson: string;
  targetProfile: Profile;
  currentState: {
    routines: Routine[];
    history: CompletedWorkout[];
    prs: Record<string, PersonalRecord>;
    bodyWeightLogs: BodyWeightEntry[];
    customLinks: Record<string, { id: string; title: string; url: string }[]>;
    selectedAlternatives: Record<string, boolean>;
  };
}): BackupInspectionResult {
  const { rawJson, targetProfile, currentState } = params;

  const emptyResult = (
    error: string,
    integrityStatus: BackupInspectionResult['integrityStatus'] = 'invalid_schema'
  ): BackupInspectionResult => ({
    valid: false,
    error,
    legacyFormat: false,
    schemaVersion: 'desconocida',
    backupId: '',
    exportedAt: '',
    integrityStatus,
    sourceProfileId: '',
    sourceAthleteName: '',
    targetProfileId: targetProfile.id,
    crossProfileDetected: false,
    counts: {
      backup: {
        routines: 0,
        customExercises: 0,
        history: 0,
        prs: 0,
        bodyWeightLogs: 0,
        customLinkGroups: 0,
        selectedAlternatives: 0,
        monthlyArchives: 0,
      },
      willAdd: {
        routines: 0,
        history: 0,
        prs: 0,
        bodyWeightLogs: 0,
        customLinks: 0,
        selectedAlternatives: 0,
        monthlyArchives: 0,
      },
      existingBefore: {
        routines: currentState.routines.length,
        history: currentState.history.length,
        prs: Object.keys(currentState.prs || {}).length,
        bodyWeightLogs: currentState.bodyWeightLogs.length,
      },
    },
    conflicts: {
      conflictingRoutineTitles: [],
      collidingWorkoutDates: [],
      higherExistingPrKeys: [],
      duplicateBodyWeightIds: [],
    },
  });

  if (!rawJson || !rawJson.trim()) {
    return emptyResult('El archivo de respaldo está vacío.');
  }

  let rawParsed: any;
  try {
    rawParsed = JSON.parse(rawJson);
  } catch {
    return emptyResult('El archivo no tiene un formato JSON válido.');
  }

  if (!rawParsed || typeof rawParsed !== 'object') {
    return emptyResult('Estructura JSON inválida.');
  }

  if (rawParsed.app && rawParsed.app !== 'LAZCAKONGYM') {
    return emptyResult(`Archivo pertenece a otra aplicación ("${String(rawParsed.app)}").`);
  }

  const schemaVer = String(rawParsed.schemaVersion || rawParsed.version || '');
  if (!schemaVer || !SUPPORTED_LEGACY_BACKUP_VERSIONS.has(schemaVer)) {
    return emptyResult(
      `Versión de esquema no compatible ("${schemaVer || 'sin versión'}").`,
      'invalid_schema'
    );
  }

  const isLegacy = schemaVer === '3.0.0' && !rawParsed.integrity?.checksum;
  let normalizedDoc: EliteBackupDocumentV2;

  if (!isLegacy) {
    if (!rawParsed.athlete || !rawParsed.data || !rawParsed.integrity?.checksum) {
      return emptyResult('Faltan bloques obligatorios de esquema v2.0.0 (athlete/data/integrity).');
    }

    const coreToVerify = {
      app: rawParsed.app,
      schemaVersion: rawParsed.schemaVersion,
      backupType: rawParsed.backupType,
      backupId: rawParsed.backupId,
      exportedAt: rawParsed.exportedAt,
      athlete: rawParsed.athlete,
      data: rawParsed.data,
    };

    const computed = computeDeterministicChecksum(canonicalStringify(coreToVerify));
    if (computed !== rawParsed.integrity.checksum) {
      return emptyResult(
        'Fallo de integridad: el archivo fue alterado o está corrupto (checksum no coincide).',
        'corrupted'
      );
    }

    normalizedDoc = stripSensitiveFields(rawParsed as EliteBackupDocumentV2);
  } else {
    // Legacy v3.0.0 format adaptation (with strict scrubbing of exposed profiles/PINs)
    const legacyProfile = rawParsed.profile || {};
    const legacyRoutines: Routine[] = Array.isArray(rawParsed.routines) ? rawParsed.routines : [];
    const legacyHistory: CompletedWorkout[] = Array.isArray(rawParsed.history) ? rawParsed.history : [];
    const legacyPrs: Record<string, PersonalRecord> =
      rawParsed.prs && typeof rawParsed.prs === 'object' ? rawParsed.prs : {};
    const legacyBw: BodyWeightEntry[] = Array.isArray(rawParsed.bodyWeightLogs)
      ? rawParsed.bodyWeightLogs
      : [];
    const legacyLinks =
      rawParsed.customLinks && typeof rawParsed.customLinks === 'object' ? rawParsed.customLinks : {};
    const legacyAlts =
      rawParsed.selectedAlternatives && typeof rawParsed.selectedAlternatives === 'object'
        ? rawParsed.selectedAlternatives
        : {};
    const legacyCustomEx = extractCustomExercisesCatalog(legacyRoutines);

    normalizedDoc = {
      app: 'LAZCAKONGYM',
      schemaVersion: '3.0.0',
      backupType: 'athlete_full_recoverable',
      backupId: `legacy-${Date.now()}`,
      exportedAt: String(rawParsed.exportedAt || new Date().toISOString()),
      athlete: {
        profileId: String(rawParsed.activeProfileId || legacyProfile.id || ''),
        name: String(legacyProfile.name || 'Atleta'),
        avatar: String(legacyProfile.avatar || '🦍'),
        goal: String(legacyProfile.goal || 'Hipertrofia & Masa'),
        weeklyTargetDays: Number(legacyProfile.weeklyTargetDays) || 5,
        weightKg: typeof legacyProfile.weightKg === 'number' ? legacyProfile.weightKg : undefined,
        heightCm: typeof legacyProfile.heightCm === 'number' ? legacyProfile.heightCm : undefined,
        weightUnit: legacyProfile.weightUnit === 'lb' ? 'lb' : 'kg',
        soundEnabled: legacyProfile.soundEnabled !== false,
        vibrationEnabled: legacyProfile.vibrationEnabled !== false,
        themeAccent: legacyProfile.themeAccent,
      },
      data: stripSensitiveFields({
        routines: legacyRoutines,
        customExercises: legacyCustomEx,
        history: legacyHistory,
        prs: legacyPrs,
        bodyWeightLogs: legacyBw,
        customLinks: legacyLinks,
        selectedAlternatives: legacyAlts,
        monthlyArchives: {},
      }),
      integrity: {
        algorithm: 'FNV1a-32+Length',
        checksum: 'legacy-unhashed',
        counts: {
          routines: legacyRoutines.length,
          customExercises: legacyCustomEx.length,
          history: legacyHistory.length,
          prs: Object.keys(legacyPrs).length,
          bodyWeightLogs: legacyBw.length,
          customLinkGroups: Object.keys(legacyLinks).length,
          selectedAlternatives: Object.keys(legacyAlts).length,
          monthlyArchives: 0,
        },
      },
    };
  }

  if (!Array.isArray(normalizedDoc.data.routines) || !Array.isArray(normalizedDoc.data.history)) {
    return emptyResult('Las colecciones de rutinas o historial del respaldo están dañadas.');
  }

  const sourceProfileId = normalizedDoc.athlete.profileId || '';
  const crossProfileDetected = Boolean(sourceProfileId && sourceProfileId !== targetProfile.id);

  // Compute exact non-destructive diff and conflicts
  const existingRoutineIds = new Set(currentState.routines.map((r) => r.id));
  const existingRoutineSignatures = new Set(
    currentState.routines.map((r) => `${normalizeText(r.dayName)}::${normalizeText(r.title)}`)
  );
  const conflictingRoutineTitles: string[] = [];
  let routinesToAdd = 0;

  for (const r of normalizedDoc.data.routines) {
    const sig = `${normalizeText(r.dayName)}::${normalizeText(r.title)}`;
    if (existingRoutineIds.has(r.id) || existingRoutineSignatures.has(sig)) {
      conflictingRoutineTitles.push(r.title || r.id);
    } else {
      routinesToAdd++;
    }
  }

  const existingWorkoutIds = new Set(currentState.history.map((w) => w.id).filter(Boolean));
  const existingWorkoutSignatures = new Set(
    currentState.history.map((w) => {
      const dk = normalizeWorkoutDateKey(w) || '';
      const title = normalizeText(w.routineTitle);
      const vol = w.totalVolumeKg || 0;
      const sets = w.completedSetsCount || 0;
      const tStart = w.startTime || '';
      const tEnd = w.endTime || '';
      return `${dk}::${tStart}::${tEnd}::${title}::${vol}::${sets}`;
    })
  );
  const collidingWorkoutDates: string[] = [];
  let historyToAdd = 0;
  const seenBackupSignatures = new Set<string>();
  const seenBackupIds = new Set<string>();

  for (const w of normalizedDoc.data.history) {
    const dk = normalizeWorkoutDateKey(w);
    if (!dk) continue;
    const tStart = w.startTime || '';
    const tEnd = w.endTime || '';
    const sig = `${dk}::${tStart}::${tEnd}::${normalizeText(w.routineTitle)}::${w.totalVolumeKg || 0}::${w.completedSetsCount || 0}`;
    // ID-authoritative: If an ID exists, only match on ID collision; fallback to signature only when ID is missing
    const isDuplicate = w.id
      ? existingWorkoutIds.has(w.id) || seenBackupIds.has(w.id)
      : existingWorkoutSignatures.has(sig) || seenBackupSignatures.has(sig);

    if (isDuplicate) {
      if (!collidingWorkoutDates.includes(dk)) collidingWorkoutDates.push(dk);
    } else {
      if (w.id) seenBackupIds.add(w.id);
      seenBackupSignatures.add(sig);
      historyToAdd++;
    }
  }

  const higherExistingPrKeys: string[] = [];
  let prsToAddOrUpgrade = 0;
  for (const [key, candidate] of Object.entries(normalizedDoc.data.prs || {})) {
    const existing = currentState.prs?.[key];
    if (isBackupPrBetter(candidate, existing)) {
      prsToAddOrUpgrade++;
    } else if (existing) {
      higherExistingPrKeys.push(candidate?.exerciseName || key);
    }
  }

  const existingBwIds = new Set(currentState.bodyWeightLogs.map((b) => b.id));
  const duplicateBodyWeightIds: string[] = [];
  let bwToAdd = 0;
  for (const bw of normalizedDoc.data.bodyWeightLogs || []) {
    if (existingBwIds.has(bw.id)) {
      duplicateBodyWeightIds.push(bw.id);
    } else {
      bwToAdd++;
    }
  }

  let newLinkGroups = 0;
  for (const [exId, links] of Object.entries(normalizedDoc.data.customLinks || {})) {
    const cur = currentState.customLinks?.[exId] || [];
    const curUrls = new Set(cur.map((l) => l.url));
    if (Array.isArray(links) && links.some((l) => !curUrls.has(l.url))) {
      newLinkGroups++;
    }
  }

  let newAlts = 0;
  for (const key of Object.keys(normalizedDoc.data.selectedAlternatives || {})) {
    if (currentState.selectedAlternatives?.[key] === undefined) {
      newAlts++;
    }
  }

  const backupCounts: EliteBackupCounts = {
    routines: normalizedDoc.data.routines.length,
    customExercises: (normalizedDoc.data.customExercises || []).length,
    history: normalizedDoc.data.history.length,
    prs: Object.keys(normalizedDoc.data.prs || {}).length,
    bodyWeightLogs: (normalizedDoc.data.bodyWeightLogs || []).length,
    customLinkGroups: Object.keys(normalizedDoc.data.customLinks || {}).length,
    selectedAlternatives: Object.keys(normalizedDoc.data.selectedAlternatives || {}).length,
    monthlyArchives: Object.keys(normalizedDoc.data.monthlyArchives || {}).length,
  };

  return {
    valid: true,
    legacyFormat: isLegacy,
    schemaVersion: normalizedDoc.schemaVersion,
    backupId: normalizedDoc.backupId,
    exportedAt: normalizedDoc.exportedAt,
    integrityStatus: isLegacy ? 'legacy_unhashed' : 'verified',
    sourceProfileId,
    sourceAthleteName: normalizedDoc.athlete.name,
    targetProfileId: targetProfile.id,
    crossProfileDetected,
    counts: {
      backup: backupCounts,
      willAdd: {
        routines: routinesToAdd,
        history: historyToAdd,
        prs: prsToAddOrUpgrade,
        bodyWeightLogs: bwToAdd,
        customLinks: newLinkGroups,
        selectedAlternatives: newAlts,
        monthlyArchives: backupCounts.monthlyArchives,
      },
      existingBefore: {
        routines: currentState.routines.length,
        history: currentState.history.length,
        prs: Object.keys(currentState.prs || {}).length,
        bodyWeightLogs: currentState.bodyWeightLogs.length,
      },
    },
    conflicts: {
      conflictingRoutineTitles,
      collidingWorkoutDates,
      higherExistingPrKeys,
      duplicateBodyWeightIds,
    },
    parsedBackup: normalizedDoc,
  };
}

/**
 * Safely executes backup restoration strictly isolated to `targetProfile.id`:
 * 1. Re-validates structure, checksum, and profile authorization.
 * 2. Requires explicit confirmation (`confirmed: true`) and cross-profile auth when IDs differ.
 * 3. Creates an automatic pre-restore snapshot FIRST.
 * 4. Defaults to `'merge_safe'` (non-destructive reconciliation: zero loss of existing history, routines, PRs, or Muscle Map).
 * 5. Allows `'replace_authorized'` ONLY with `confirmReplaceExplicit === true`.
 */
export function executeSafeBackupRestore(
  params: ExecuteSafeBackupRestoreParams
): ExecuteSafeBackupRestoreResult {
  const {
    rawJson,
    targetProfile,
    currentState,
    strategy = 'merge_safe',
    confirmed,
    confirmReplaceExplicit = false,
    authorizeCrossProfile = false,
    restorePreferences = false,
    storage = getDefaultStorage(),
  } = params;

  const inspection = inspectBackupForRestore({ rawJson, targetProfile, currentState });
  if (!inspection.valid || !inspection.parsedBackup) {
    return {
      success: false,
      message: inspection.error || 'Archivo de respaldo inválido.',
      strategyUsed: strategy,
      inspection,
    };
  }

  if (!confirmed) {
    return {
      success: false,
      message: 'Se requiere confirmación explícita del atleta antes de restaurar.',
      strategyUsed: strategy,
      inspection,
    };
  }

  if (inspection.crossProfileDetected && !authorizeCrossProfile) {
    return {
      success: false,
      message: `Bloqueado por aislamiento de perfiles: el respaldo pertenece a "${inspection.sourceAthleteName}" (${inspection.sourceProfileId}) y no coincide con el perfil activo (${targetProfile.id}). Autoriza explícitamente si deseas importarlo aquí.`,
      strategyUsed: strategy,
      inspection,
    };
  }

  if (strategy === 'replace_authorized' && !confirmReplaceExplicit) {
    return {
      success: false,
      message: 'El modo reemplazo completo requiere confirmación explícita adicional.',
      strategyUsed: strategy,
      inspection,
    };
  }

  const doc = inspection.parsedBackup;
  const targetProfileId = targetProfile.id;
  const athleteWeightKg = targetProfile.weightKg || doc.athlete.weightKg || 95;

  // STEP 1: Mandatory pre-restore safety snapshot
  const backupSnapshot = createPreImportBackupSnapshot(
    targetProfileId,
    targetProfile.name,
    currentState,
    `Respaldo automático previo a restaurar JSON (${doc.backupId})`,
    storage
  );

  let nextRoutines: Routine[];
  let nextHistory: CompletedWorkout[];
  let nextPrs: Record<string, PersonalRecord>;
  let nextBodyWeightLogs: BodyWeightEntry[];
  let nextCustomLinks: Record<string, { id: string; title: string; url: string }[]>;
  let nextSelectedAlternatives: Record<string, boolean>;

  let addedRoutinesCount = 0;
  let addedHistoryCount = 0;
  let addedPrsCount = 0;
  let addedBwCount = 0;

  if (strategy === 'replace_authorized') {
    nextRoutines = consolidateWeeklyRoutines(doc.data.routines);
    nextHistory = purgeAndSanitizeWorkoutHistory(doc.data.history, athleteWeightKg).cleanedHistory;
    nextPrs = { ...(doc.data.prs || {}) };
    nextBodyWeightLogs = [...(doc.data.bodyWeightLogs || [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    nextCustomLinks = { ...(doc.data.customLinks || {}) };
    nextSelectedAlternatives = { ...(doc.data.selectedAlternatives || {}) };

    addedRoutinesCount = nextRoutines.length;
    addedHistoryCount = nextHistory.length;
    addedPrsCount = Object.keys(nextPrs).length;
    addedBwCount = nextBodyWeightLogs.length;
  } else {
    // MERGE_SAFE (default non-destructive reconciliation)
    const existingRoutineIds = new Set(currentState.routines.map((r) => r.id));
    const existingRoutineSigs = new Set(
      currentState.routines.map((r) => `${normalizeText(r.dayName)}::${normalizeText(r.title)}`)
    );
    const routinesToAppend: Routine[] = [];
    for (const r of doc.data.routines) {
      const sig = `${normalizeText(r.dayName)}::${normalizeText(r.title)}`;
      if (!existingRoutineIds.has(r.id) && !existingRoutineSigs.has(sig)) {
        routinesToAppend.push(r);
        addedRoutinesCount++;
      }
    }
    nextRoutines = consolidateWeeklyRoutines([...currentState.routines, ...routinesToAppend]);

    // Preserve 100% of existing sessions; only append sessions not matching an existing ID or identical workout signature
    const existingWorkoutIds = new Set(currentState.history.map((w) => w.id).filter(Boolean));
    const existingWorkoutSignatures = new Set(
      currentState.history.map((w) => {
        const dk = normalizeWorkoutDateKey(w) || '';
        const title = normalizeText(w.routineTitle);
        const vol = w.totalVolumeKg || 0;
        const sets = w.completedSetsCount || 0;
        const tStart = w.startTime || '';
        const tEnd = w.endTime || '';
        return `${dk}::${tStart}::${tEnd}::${title}::${vol}::${sets}`;
      })
    );
    const nonCollidingIncoming: CompletedWorkout[] = [];
    const seenNewSignatures = new Set<string>();
    const seenNewIds = new Set<string>();
    for (const w of doc.data.history) {
      const dk = normalizeWorkoutDateKey(w);
      if (!dk) continue;
      const tStart = w.startTime || '';
      const tEnd = w.endTime || '';
      const sig = `${dk}::${tStart}::${tEnd}::${normalizeText(w.routineTitle)}::${w.totalVolumeKg || 0}::${w.completedSetsCount || 0}`;
      // ID-authoritative: If an ID exists, only match on ID collision; fallback to signature only when ID is missing
      const isDuplicate = w.id
        ? existingWorkoutIds.has(w.id) || seenNewIds.has(w.id)
        : existingWorkoutSignatures.has(sig) || seenNewSignatures.has(sig);
      if (isDuplicate) continue;
      if (w.id) seenNewIds.add(w.id);
      seenNewSignatures.add(sig);
      nonCollidingIncoming.push(w);
    }
    addedHistoryCount = nonCollidingIncoming.length;
    const sanitizedIncoming =
      nonCollidingIncoming.length > 0
        ? purgeAndSanitizeWorkoutHistory(nonCollidingIncoming, athleteWeightKg).cleanedHistory
        : [];
    nextHistory = [...currentState.history, ...sanitizedIncoming].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Monotonic PR reconciliation
    nextPrs = { ...(currentState.prs || {}) };
    for (const [key, candidate] of Object.entries(doc.data.prs || {})) {
      if (isBackupPrBetter(candidate, nextPrs[key])) {
        nextPrs[key] = candidate;
        addedPrsCount++;
      }
    }

    // BodyWeightLogs merge by ID
    const bwById = new Map<string, BodyWeightEntry>();
    for (const entry of currentState.bodyWeightLogs || []) {
      if (entry?.id) bwById.set(entry.id, entry);
    }
    for (const entry of doc.data.bodyWeightLogs || []) {
      if (entry?.id && !bwById.has(entry.id)) {
        bwById.set(entry.id, entry);
        addedBwCount++;
      }
    }
    nextBodyWeightLogs = Array.from(bwById.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Custom links deduplicated merge by URL
    nextCustomLinks = { ...(currentState.customLinks || {}) };
    for (const [exId, links] of Object.entries(doc.data.customLinks || {})) {
      const existing = nextCustomLinks[exId] || [];
      const urls = new Set(existing.map((l) => l.url));
      const newOnes = (Array.isArray(links) ? links : []).filter((l) => l?.url && !urls.has(l.url));
      if (newOnes.length > 0) {
        nextCustomLinks[exId] = [...existing, ...newOnes];
      }
    }

    // Alternatives: keep current choices, fill missing keys from backup
    nextSelectedAlternatives = {
      ...(doc.data.selectedAlternatives || {}),
      ...(currentState.selectedAlternatives || {}),
    };
  }

  let profileUpdates: Partial<Profile> | undefined;
  if (restorePreferences && doc.athlete) {
    profileUpdates = {
      goal: doc.athlete.goal || targetProfile.goal,
      weeklyTargetDays: doc.athlete.weeklyTargetDays || targetProfile.weeklyTargetDays,
      weightUnit: doc.athlete.weightUnit || targetProfile.weightUnit,
      soundEnabled: doc.athlete.soundEnabled,
      vibrationEnabled: doc.athlete.vibrationEnabled,
      ...(typeof doc.athlete.weightKg === 'number' ? { weightKg: doc.athlete.weightKg } : {}),
      ...(typeof doc.athlete.heightCm === 'number' ? { heightCm: doc.athlete.heightCm } : {}),
      ...(doc.athlete.themeAccent ? { themeAccent: doc.athlete.themeAccent as Profile['themeAccent'] } : {}),
    };
  }

  // Persist strictly inside targetProfileId keys
  if (storage) {
    try {
      storage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(nextRoutines));
      storage.setItem(`lazcakon_${targetProfileId}_history`, JSON.stringify(nextHistory));
      storage.setItem(`lazcakon_${targetProfileId}_prs`, JSON.stringify(nextPrs));
      storage.setItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify(nextBodyWeightLogs));
      storage.setItem(`lazcakon_${targetProfileId}_custom_links`, JSON.stringify(nextCustomLinks));
      storage.setItem(
        `lazcakon_${targetProfileId}_alternatives`,
        JSON.stringify(nextSelectedAlternatives)
      );

      // Restore monthly archives non-destructively
      if (doc.data.monthlyArchives && typeof doc.data.monthlyArchives === 'object') {
        const monthsRaw = storage.getItem('lazcakon_historico_meses_disponibles');
        const monthsSet = new Set<string>(monthsRaw ? JSON.parse(monthsRaw) : []);
        for (const [monthId, record] of Object.entries(doc.data.monthlyArchives)) {
          const key = `lazcakon_historico_mensual_${monthId}`;
          if (!storage.getItem(key) || strategy === 'replace_authorized') {
            storage.setItem(key, JSON.stringify({ ...(record as object), userId: targetProfileId }));
          }
          monthsSet.add(monthId);
        }
        storage.setItem('lazcakon_historico_meses_disponibles', JSON.stringify(Array.from(monthsSet)));
      }
    } catch {}
  }

  const cloudPatch: Record<string, unknown> = {
    routines: nextRoutines,
    history: nextHistory,
    prs: nextPrs,
    bodyWeightLogs: nextBodyWeightLogs,
    customLinks: nextCustomLinks,
    selectedAlternatives: nextSelectedAlternatives,
  };

  return {
    success: true,
    message:
      strategy === 'replace_authorized'
        ? `Respaldo restaurado en modo reemplazo (${addedRoutinesCount} rutinas, ${addedHistoryCount} sesiones, ${addedPrsCount} PRs). Respaldo previo guardado.`
        : `Fusión segura completada sin pérdidas (+${addedRoutinesCount} rutinas, +${addedHistoryCount} sesiones, +${addedPrsCount} PRs, +${addedBwCount} registros de peso).`,
    strategyUsed: strategy,
    inspection,
    backupSnapshot,
    nextState: {
      routines: nextRoutines,
      history: nextHistory,
      prs: nextPrs,
      bodyWeightLogs: nextBodyWeightLogs,
      customLinks: nextCustomLinks,
      selectedAlternatives: nextSelectedAlternatives,
      profileUpdates,
    },
    addedCounts: {
      routines: addedRoutinesCount,
      history: addedHistoryCount,
      prs: addedPrsCount,
      bodyWeightLogs: addedBwCount,
    },
    cloudPatch,
  };
}

/**
 * Safe, idempotent storage schema migration executed on app startup / version upgrade.
 * GUARANTEES zero data deletion of routines, workouts, PRs, bodyweight logs, or Muscle Map history.
 */
export function ensureSafeStorageMigration(
  storage: StorageLike | null = getDefaultStorage()
): {
  migrated: boolean;
  previousSchemaVersion: string | null;
  currentSchemaVersion: string;
} {
  if (!storage) {
    return {
      migrated: false,
      previousSchemaVersion: null,
      currentSchemaVersion: STORAGE_SCHEMA_VERSION,
    };
  }

  let prevVersion: string | null = null;
  try {
    prevVersion = storage.getItem(STORAGE_SCHEMA_KEY);
    // Neutralize the legacy destructive one-time cleanup flag safely so fresh browsers NEVER wipe perfil_1
    storage.setItem('lazcakon_cristobal_data_cleaned_v4', 'true');

    if (prevVersion !== STORAGE_SCHEMA_VERSION) {
      storage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);
      return {
        migrated: true,
        previousSchemaVersion: prevVersion,
        currentSchemaVersion: STORAGE_SCHEMA_VERSION,
      };
    }
  } catch {}

  return {
    migrated: false,
    previousSchemaVersion: prevVersion,
    currentSchemaVersion: STORAGE_SCHEMA_VERSION,
  };
}
