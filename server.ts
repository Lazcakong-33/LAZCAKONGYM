import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_EMAILS) {
  process.env.ADMIN_EMAIL = 'kmiloko19@gmail.com';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000', 10);
const distPath = path.resolve(__dirname, 'dist');

// Middleware (allowing up to 25mb for base64 gym equipment photos from mobile webviews)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

import { isAllowedCorsOrigin } from './src/server/corsConfig.ts';

// CORS middleware strictly restricted to authorized Web, Cloud Run, and Capacitor Native Shell origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, Cache-Control, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    if (origin && !isAllowedCorsOrigin(origin)) {
      res.status(403).json({ success: false, error: 'Origen no autorizado por CORS.' });
      return;
    }
    res.status(204).end();
    return;
  }
  next();
});

// Basic Health Check endpoints for Cloud Run & load balancers
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/_ah/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Gemini AI Routine Generator API
app.post('/api/gemini/generate-routine', async (req, res) => {
  try {
    const { generateAIRoutine } = await import('./src/server/geminiRoutineGenerator.ts');
    const routine = await generateAIRoutine(req.body);
    const generationSource = routine.id.startsWith('rutina-local-') ? 'local' : 'gemini';
    res.status(200).json({
      success: true,
      routine,
      generationSource,
      generationNotice: generationSource === 'local'
        ? 'Gemini no está disponible o no respondió. Se creó una rutina local del catálogo, sin generar una respuesta con IA.'
        : 'Rutina generada por Gemini.',
    });
  } catch (error: any) {
    console.error('Error generating AI routine:', error);
    res.status(500).json({ success: false, error: error.message || 'Error generating routine' });
  }
});

// Gemini Vision Smart Fit Equipment Scanner API
app.post('/api/gemini/scan-machine', async (req, res) => {
  try {
    const { scanGymMachineWithGemini } = await import('./src/server/geminiMachineScanner.ts');
    const result = await scanGymMachineWithGemini(req.body);
    res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('[Gemini Machine Scanner] Error processing equipment scan:', error);
    res.status(200).json({
      success: true,
      result: {
        identifiedMachine: 'Estación de Poleas / Máquina Smart Fit',
        machineBrand: 'Matrix Fitness / Smart Fit',
        equipmentType: 'Máquina guiada',
        replacementExerciseName: `Variante en máquina para ${req.body?.currentExercise?.targetMuscles || 'General'}`,
        targetMuscles: req.body?.currentExercise?.targetMuscles || 'General',
        repRange: req.body?.currentExercise?.repRange || '8 - 12 reps',
        restSeconds: req.body?.currentExercise?.restSeconds || 90,
        objective: 'Mantener intensidad y estímulo biomecánico',
        techniqueCues: [
          'Ajusta el asiento para alinear las empuñaduras.',
          'Controla la fase excéntrica en 2 segundos.',
          'Mantén el core activo.'
        ],
        equivalenceRationale: 'Sustituto inteligente automático para equipamiento ocupado.',
        smartFitSetupTip: 'Verifica el pasador de selección de peso.'
      }
    });
  }
});

// Gemini Vision Routine Extractor API (Excel/PDF/Image Routine Extraction)
app.post('/api/extraer-rutina-ia', async (req, res) => {
  try {
    const { extractRoutineWithVision } = await import('./src/server/geminiVisionRoutineExtractor.ts');
    const result = await extractRoutineWithVision(req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error('[Extraer Rutina IA] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error al extraer rutina con IA' });
  }
});

// Multi-image OCR Routine Analyzer API (PNG, JPG/JPEG, WEBP -> editable preview, never auto-saves)
app.post('/api/routines/analyze-images', async (req, res) => {
  try {
    const { analyzeRoutineImagesWithVision } = await import('./src/server/geminiVisionRoutineExtractor.ts');
    const result = await analyzeRoutineImagesWithVision(req.body?.images || []);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error('[Analyze Routine Images OCR] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al analizar las imágenes de la rutina',
    });
  }
});

// Unified PDF & Visual Document Analyzer API (PDF, PNG, JPG/JPEG, WEBP -> editable preview, never auto-saves)
app.post('/api/routines/analyze-document', async (req, res) => {
  try {
    const { analyzeRoutineImagesWithVision } = await import('./src/server/geminiVisionRoutineExtractor.ts');
    const files = Array.isArray(req.body?.files)
      ? req.body.files
      : req.body?.file
      ? [{ data: req.body.file, mimeType: req.body.mimeType || 'application/pdf', fileName: req.body.fileName }]
      : [];
    const result = await analyzeRoutineImagesWithVision(files);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error('[Analyze Routine Document] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al analizar el documento PDF',
    });
  }
});

// Mercado Pago Webhook / IPN Endpoint
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { handleMercadoPagoWebhook } = await import('./src/server/mercadopagoWebhook.ts');
    await handleMercadoPagoWebhook(req, res);
  } catch (error: any) {
    console.error('[MercadoPago Webhook] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal webhook error' });
  }
});

// Daily Calories Burned (24h Isolated Report & MET Session Calculator) Endpoints
app.post('/api/calories/daily-report', async (req, res) => {
  try {
    const { handleGetDailyCaloriesReport } = await import('./src/server/dailyCaloriesController.ts');
    await handleGetDailyCaloriesReport(req, res);
  } catch (error: any) {
    console.error('[Daily Calories Report] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error processing daily calories report', dailyCaloriesBurned: 0 });
  }
});

app.post('/api/calories/calculate-session', async (req, res) => {
  try {
    const { handleCalculateSessionCalories } = await import('./src/server/dailyCaloriesController.ts');
    await handleCalculateSessionCalories(req, res);
  } catch (error: any) {
    console.error('[Calculate Session Calories] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error calculating session calories', caloriesBurned: 0 });
  }
});

app.post('/api/history/purge-corrupted', async (req, res) => {
  try {
    const { handlePurgeCorruptedHistory } = await import('./src/server/dailyCaloriesController.ts');
    await handlePurgeCorruptedHistory(req, res);
  } catch (error: any) {
    console.error('[Purge Corrupted History] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error purging corrupted workout history' });
  }
});

// RPE Autoregulation Prescription Endpoint (Serie a Serie)
app.post('/api/workout/autoregulate-set', async (req, res) => {
  try {
    const { handleAutoregulateSet } = await import('./src/server/rpeAutoregulationController.ts');
    await handleAutoregulateSet(req, res);
  } catch (error: any) {
    console.error('[RPE Autoregulation] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error processing RPE autoregulation' });
  }
});

// Authenticated read-only diagnostics for Coach IA (no API keys or athlete data returned).
app.post('/api/coach/status', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleCoachStatus } = await import('./src/server/coachController.ts');
    await verifyAuthTokenMiddleware(req, res, () => {
      Promise.resolve(handleCoachStatus(req, res)).catch((err: any) => {
        console.error('[Coach IA status] Diagnostic error:', err?.message || err);
        if (!res.headersSent) {
          res.status(503).json({
            success: false, code: 'coach/diagnostic-unavailable',
            error: 'No se pudo verificar el estado del Coach IA.',
          });
        }
      });
    });
  } catch (err: any) {
    console.error('[Coach IA status] Server error:', err?.message || err);
    if (!res.headersSent) {
      res.status(503).json({
        success: false, code: 'coach/diagnostic-unavailable',
        error: 'No se pudo consultar el estado del Coach IA.',
      });
    }
  }
});

// Coach LazcaKong IA Authenticated Chat Endpoint
app.post('/api/coach/chat', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleCoachChat } = await import('./src/server/coachController.ts');
    await verifyAuthTokenMiddleware(req, res, () => {
      Promise.resolve(handleCoachChat(req, res)).catch((err: any) => {
        console.error('[Coach LazcaKong IA] Unhandled async error:', err?.message || err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            code: 'coach/internal-error',
            retryable: true,
            error: 'Error interno al consultar Coach LazcaKong IA.',
          });
        }
      });
    });
  } catch (error: any) {
    console.error('[Coach LazcaKong IA] Server error:', error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        code: 'coach/server-error',
        retryable: true,
        error: error.message || 'Error al consultar Coach LazcaKong IA',
      });
    }
  }
});

// Web Push Configuration, Device Subscriptions & Persistent Rest Alarm Endpoints
app.get('/api/push/config', async (req, res) => {
  try {
    const { handleGetPushConfig } = await import('./src/server/pushController.ts');
    await handleGetPushConfig(req, res);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error leyendo configuración Web Push' });
  }
});

app.get('/api/push/status', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleGetPushStatus } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleGetPushStatus(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error consultando estado Web Push' });
  }
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleSubscribePush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleSubscribePush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error guardando suscripción Web Push' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleUnsubscribePush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleUnsubscribePush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error cancelando suscripción Web Push' });
  }
});

app.post('/api/push/schedule-rest', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleScheduleRestPush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleScheduleRestPush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, scheduled: false, error: error.message || 'Error programando aviso Web Push' });
  }
});

app.post('/api/push/cancel-rest', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleCancelRestPush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleCancelRestPush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error cancelando aviso Web Push' });
  }
});

app.post('/api/push/test-immediate', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleTestImmediatePush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleTestImmediatePush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, providerAccepted: false, error: error.message || 'Error en prueba push inmediata' });
  }
});

app.post('/api/push/test-scheduled-60s', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleTestScheduled60sPush } = await import('./src/server/pushController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleTestScheduled60sPush(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, scheduled: false, error: error.message || 'Error en prueba push 60 s' });
  }
});

app.post('/api/push/dispatch-rest-alarm', async (req, res) => {
  try {
    const { handleDispatchRestAlarmWebhook } = await import('./src/server/pushController.ts');
    await handleDispatchRestAlarmWebhook(req, res);
  } catch (error: any) {
    res.status(500).json({ success: false, providerAccepted: false, error: error.message || 'Error despachando Web Push' });
  }
});

// Legacy Email + PIN / Recovery Code linking to authenticated Firebase user (verifyIdToken + Firestore only)
app.post('/api/auth/migrate-legacy', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleMigrateLegacyAuth } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleMigrateLegacyAuth(req, res));
  } catch (error: any) {
    console.error('[Auth Migration API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error en vinculación de cuenta' });
  }
});

// Session initialization / Google & Password profile resolution (Starter Tier compatible, no Custom Claims)
app.post('/api/auth/session-init', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleSessionInit } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleSessionInit(req, res));
  } catch (error: any) {
    console.error('[Session Init API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error inicializando sesión' });
  }
});

// Server-side Invite Verification & Atomic Single-Use Registration (browser never reads/writes /invites)
app.post('/api/invites/verify', async (req, res) => {
  try {
    const { handleVerifyInvite } = await import('./src/server/authMigrationController.ts');
    await handleVerifyInvite(req, res);
  } catch (error: any) {
    console.error('[Invite Verify API] Server error:', error);
    res.status(500).json({ success: false, valid: false, status: 'not_found', error: error.message || 'Error verificando código' });
  }
});

app.post('/api/invites/register', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleRegisterWithInvite } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleRegisterWithInvite(req, res));
  } catch (error: any) {
    console.error('[Invite Register API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error creando cuenta' });
  }
});

// Single-use Invitation Redemption API (SHA-256 token hashing, atomic transaction, rate-limited)
app.post('/api/invites/redeem', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleRedeemInvite } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleRedeemInvite(req, res));
  } catch (error: any) {
    console.error('[Invite Redeem API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error al canjear invitación' });
  }
});

// Post-Migration Confirmation Endpoint (Zeroizes legacy PIN only after confirmed session)
app.post('/api/auth/confirm-migration', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleConfirmMigration } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleConfirmMigration(req, res));
  } catch (error: any) {
    console.error('[Confirm Migration API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error al confirmar migración' });
  }
});

// Admin-Only Invite Management & Athlete Deletion / Recovery / Update Broadcast
app.get('/api/admin/invites', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminListInvites } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminListInvites(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error listando invitaciones' });
  }
});

app.post('/api/admin/invites', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminCreateInvite } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminCreateInvite(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error creando invitación' });
  }
});

app.post('/api/admin/invites/batch', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminBatchCreateInvites } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminBatchCreateInvites(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error creando lote de invitaciones' });
  }
});

app.delete('/api/admin/invites/:token', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminRevokeInvite } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminRevokeInvite(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error revocando invitación' });
  }
});

app.delete('/api/admin/athletes/:athleteId', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminDeleteAthlete } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminDeleteAthlete(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error eliminando atleta' });
  }
});

app.post('/api/admin/broadcast-update', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminBroadcastUpdate } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminBroadcastUpdate(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error enviando broadcast' });
  }
});

// Admin Emergency Athlete Access Recovery API (Restricted exclusively to configured Master Admin)
app.post('/api/admin/recover-athlete', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminRecoverAthlete } = await import('./src/server/authMigrationController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminRecoverAthlete(req, res));
  } catch (error: any) {
    console.error('[Admin Recover Athlete API] Server error:', error);
    res.status(500).json({ success: false, error: error.message || 'Error en recuperación de atleta' });
  }
});

// Version endpoint to allow clients to verify freshness and lifecycle updates
app.get('/api/version', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  let broadcast: any = null;
  try {
    const { getServerBroadcastState } = await import('./src/server/authMigrationController.ts');
    broadcast = getServerBroadcastState();
  } catch {}
  res.status(200).json({
    version: broadcast?.version || '7.0.5',
    buildId: broadcast?.buildId || '7.0.5-ota-release',
    broadcastId: broadcast?.broadcastId || null,
    broadcastMessage: broadcast?.message || null,
    buildDate: broadcast?.updatedAt || new Date().toISOString(),
    apkDownloadUrl: 'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/latest/download/app-release.apk',
    features: ['elite-pwa-update-system', 'zero-destruction-cache', 'active-workout-protection', 'capacitor-ota-auto-update'],
  });
});

// Self-hosted Capacitor OTA Update Manifest & Bundle Endpoints (Development channel active; Production fail-closed)
app.get('/api/ota/manifest', async (req, res) => {
  try {
    const { handleGetOtaManifest } = await import('./src/server/otaUpdateController.ts');
    handleGetOtaManifest(req, res);
  } catch (error: any) {
    res.status(500).json({ success: false, enabled: false, updateAvailable: false, manifest: null, error: error.message || 'Error consultando manifiesto OTA' });
  }
});

app.get('/api/ota/bundles/:filename', async (req, res) => {
  try {
    const { handleGetOtaBundleZip } = await import('./src/server/otaUpdateController.ts');
    handleGetOtaBundleZip(req, res);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error sirviendo paquete OTA' });
  }
});

// Authenticated Device OTA Telemetry & Master Admin Update Center APIs
app.post('/api/ota/telemetry', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleReportOtaTelemetry } = await import('./src/server/otaUpdateController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleReportOtaTelemetry(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error registrando telemetría OTA' });
  }
});

app.get('/api/admin/ota/status', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminGetOtaStatus } = await import('./src/server/otaUpdateController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminGetOtaStatus(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error consultando estado OTA del sistema' });
  }
});

app.post('/api/admin/ota/publish', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminPublishOtaRelease } = await import('./src/server/otaUpdateController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminPublishOtaRelease(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error publicando actualización OTA' });
  }
});

app.post('/api/admin/ota/rollback', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminRollbackOtaRelease } = await import('./src/server/otaUpdateController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminRollbackOtaRelease(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error revirtiendo actualización OTA' });
  }
});

app.post('/api/admin/ota/sync-github', async (req, res) => {
  try {
    const { verifyAuthTokenMiddleware } = await import('./src/server/firebaseAdminServer.ts');
    const { handleAdminSyncGithubRelease } = await import('./src/server/otaUpdateController.ts');
    await verifyAuthTokenMiddleware(req, res, () => handleAdminSyncGithubRelease(req, res));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Error sincronizando GitHub Releases' });
  }
});

// Guarantee any unmatched /api/* route ALWAYS returns JSON (never HTML 404 or SPA index.html)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}`,
  });
});

// Guarantee any Express/JSON middleware or unhandled /api/* error returns JSON (never HTML <!DOCTYPE>)
app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const status =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  const message =
    err?.type === 'entity.parse.failed'
      ? 'El cuerpo de la solicitud no es JSON válido.'
      : err?.type === 'entity.too.large'
      ? 'La solicitud excede el tamaño máximo permitido.'
      : err?.message || 'Error interno del servidor API.';
  console.error('[API Error Middleware]:', status, message);
  res.status(status).json({
    success: false,
    error: message,
  });
});

async function startServer() {
  app.use('/exercise-library', express.static(path.resolve(__dirname, 'public/exercise-library')));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Explicit service worker route with strict no-cache headers
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(path.resolve(distPath, 'sw.js'));
    });

    // Serve static assets from dist
    app.use(
      express.static(distPath, {
        maxAge: '1d',
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.json') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        },
      })
    );

    // Never serve index.html for missing JS/CSS/font/image/manifest chunks (prevents MIME-type blank screens)
    app.get(/^\/assets\/.+/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).type('text/plain').send('Asset not found');
    });

    app.get('*', (req, res) => {
      if (/\.(js|mjs|css|map|png|jpg|jpeg|webp|svg|ico|woff2?|json|webmanifest)$/i.test(req.path)) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).type('text/plain').send('Static file not found');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LAZCAKONGYM] Server listening on http://0.0.0.0:${PORT}`);
    // Pre-warm auth modules in background so the first /api/auth/session-init call avoids dynamic import latency
    void Promise.all([
      import('./src/server/firebaseAdminServer.ts'),
      import('./src/server/authMigrationController.ts'),
    ]).catch(() => {});
  });

  process.on('SIGTERM', () => {
    console.log('[LAZCAKONGYM] SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('[LAZCAKONGYM] HTTP server closed');
    });
  });
}

startServer().catch((err) => {
  console.error('[LAZCAKONGYM] Failed to start server:', err);
  process.exit(1);
});
