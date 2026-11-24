# LAZCAKONG ZERO COST — fase 1 (no desplegar)
Base: bd79b918571cdf5138f712703f9928839b6f4fed (ci/android-apk-ota). No cambia main, Firebase, firma Android ni manifiesto OTA activo.

## Implementado
- Guard de servidor opt-in: LAZCAKONG_ZERO_COST_MODE=true impide que los consumidores de getServerGeminiApiKey reciban una clave, incluso si hay claves configuradas. No elimina claves ni modifica facturación.
- Auditoría local sin red: node scripts/zero-cost-preflight.mjs (después de npm ci y npm run build para medir dist).
- Prueba del guard (Node 22 con strip types): node --experimental-strip-types --test scripts/zero-cost-guard.test.mjs.
- El Coach tiene un motor local existente. Validar el flujo real con 503 y modo sin IA. Escáner e importaciones IA pueden quedar indisponibles; no anunciar equivalencia hasta probar alternativas.
- No se ha ejecutado un build ni desplegado el servidor.

## Bloqueos antes de pasar a costo cero
1. Firebase: confirmar plan, cuotas, tipo y elegibilidad de la base nombrada ai-studio-lazcakongym-dedcb625-f047-4947-ace1-3fbed6d67760 del proyecto forward-cortex-1ds98; verificar uso de Storage. Mantener UID, reglas y datos; si se requiere migrar a (default), hacer respaldo y restauración de prueba con conteos e integridad, nunca copiar datos de atletas a GitHub.
2. Cloudflare Free: crear entorno de prueba aislado; evaluar dist (25 MiB/archivo, 20 000 archivos). Portar las rutas de Express con autenticación, control de acceso, CORS y secretos de servidor a runtime compatible; Firebase Admin requiere validación, no asumir compatibilidad. No publicar una SPA estática como reemplazo funcional. Evaluar llamadas Firestore REST autenticadas y trabajo en segundo plano.
3. Push: revisar VAPID y planificador Cloud Tasks/QStash; mantener notificaciones locales nativas y probar notificaciones remotas reales con teléfono bloqueado. Nunca exponer claves.
4. OTA: conservar com.lazcakong.gym, certificado y versionCode ascendente; conservar manifiesto y host antiguos mientras se prueba nuevo origen. El cambio de endpoint en APK instalada debe llegar por canal OTA existente o actualización firmada. No activar manifiesto estable hasta validar descarga, checksum, rollback y compatibilidad.
5. IA: modo local por defecto en infraestructura de costo cero. API gratis opcional únicamente en proyecto sin facturación, con cuotas duras, modelo disponible y sin datos sensibles; verificar privacidad. No habilitar uso remoto por defecto.
6. Probar login Google, vinculación UID, rutinas/historial, roles, invitaciones, notificaciones, OTA y webhook si se utiliza, con usuarios de prueba. Confirmar reversión y continuidad. Solo entonces cancelar los servicios que no se requieren.

## Operación
No hacer deploy, no modificar reglas, no desactivar Cloud Billing desde esta rama. No incluir credenciales. Mantener el origen productivo hasta que la alternativa esté probada. Los límites gratuitos no garantizan capacidad ilimitada.
