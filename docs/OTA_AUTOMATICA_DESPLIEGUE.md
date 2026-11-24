# LAZCAKONG GYM — Actualización automática sin reinstalar APK

## Qué se automatiza

Las instalaciones **Capacitor Android compatibles** buscan un manifiesto OTA al arrancar, al volver a primer plano (con límite de consultas) y periódicamente (cada 15 minutos mientras están abiertas).
Si existe una versión web más reciente compatible, la app comprueba HTTPS/SHA-256/canal/Capacitor/nativeVersion y, cuando **no hay entrenamiento activo ni sincronizaciones offline pendientes**, descarga el bundle una sola vez y llama a `CapacitorUpdater.next()`. No hace falta pulsar ningún botón.
Capgo activa el bundle al cambiar la app a segundo plano o reiniciarla. `notifyAppReady()` verifica el arranque y conserva rollback.
En PWA, el Service Worker nuevo se activa automáticamente si la sesión está en estado seguro.

La opción nativa `autoUpdate: false` de `capacitor.config.ts` es **intencional**: desactiva el servidor externo por defecto del plugin Capgo, mientras el verificador **propio de LAZCAKONG GYM** llama a `download()` y `next()`. Cambiarla a `true` sin configurar `updateUrl` provocaría comprobaciones contra otro servidor y no es la solución.

La descarga no borra rutinas, perfiles, historial, Firebase Auth ni Firestore. La función comprueba estado local antes de instalar, aunque se debe validar también con datos de prueba en Android antes de activar cualquier distribución masiva.

## Etapa actual

- Canal `development`: GitHub Releases + índice `ota-development`. Solo para pruebas.
- Canal `production`: expresamente deshabilitado por configuración hasta comprobar en un dispositivo y hacer la publicación protegida.
- No hay despliegue automático de producción desde GitHub Actions; el build de desarrollo no implica que usuarios de producción reciban los cambios.

## Migración imprescindible para instalaciones antiguas

Una APK que nunca incluyó `@capgo/capacitor-updater` o el verificador GitHub/Cloud Run **no puede recibir ese código por OTA**. Necesita **una última actualización de APK firmada con el mismo certificado** para incorporar el mecanismo. No hay una instrucción web o push que permita saltar la protección de instalación de Android.

- Instalar una vez una APK de confianza firmada igual que la actual, con el mismo `applicationId=com.lazcakong.gym`, sin desinstalar ni borrar datos.
- Una versión que ya soporta OTA manual puede requerir **una aprobación inicial** para adquirir esta nueva lógica automática.
- Si hay un conflicto de certificado, **no desinstalar**; hay que resolver la cadena de firma o distribuir por una tienda que gestione la firma.

## Requisitos antes de activar para todos los atletas

1. Confirmar en Android real: aplicación existente -> manifest compatible -> descarga ZIP -> SHA-256 -> `next()` -> segundo plano/reinicio -> versión realmente ejecutada -> `notifyAppReady()`. Repetir con entrenamiento activo, cola offline y sin red. Verificar que una sesión iniciada no se pierda al reabrir.
2. Compilar el **bundle de producción** con `VITE_OTA_CHANNEL=production`, `VITE_OTA_PRODUCTION_ENABLED=true`, `VITE_APP_VERSION=<versión>` y backend correcto. Nunca publicar el bundle de desarrollo como si fuese producción.
3. Para producción, publicar ZIP HTTPS permanente y manifest SHA-256 coincidente, exigir `contentsPolicy=web_assets_only`, Capacitor 8 y nativeVersion compatible; no distribuir cambios nativos de Java/Gradle/AndroidManifest/plugins vía OTA.
4. Autorizar en Cloud Run el canal `OTA_PRODUCTION_ENABLED=true` y suministrar `OTA_MANIFEST_PRODUCTION_JSON` solo cuando las pruebas anteriores sean satisfactorias. Comprobar `/api/ota/manifest?channel=production&nativeVersionCode=1` y validar origen, `channel=production` y versión. **No tocar datos de Firestore, usuarios ni reglas.**
5. Enviar la nueva APK a quienes tengan una versión antigua, preferiblemente mediante Play Store/App Distribution con firma compatible y control de despliegue. La autoactualización de APK nativa depende de tienda o administración del dispositivo; OTA modifica solo recursos web.
6. Establecer supervisión de fallos, capacidad para retirar el manifiesto inmediatamente (kill switch) y reversión de un bundle defectuoso. Hacer una prueba gradual antes de habilitar el 100% de usuarios.

**Estado de seguridad:** el repositorio no realiza publicación general ni habilita el canal `production` por el hecho de fusionar un cambio en la rama de CI. 
