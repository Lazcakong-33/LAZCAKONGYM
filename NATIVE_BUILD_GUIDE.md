# LAZCAKONG GYM — Guía de Compilación Nativa (Android & iOS · Capacitor 8)

Esta guía describe el flujo validado (Etapa 7B) para abrir, configurar y compilar la app nativa **LAZCAKONG GYM** (`com.lazcakong.gym`) en Windows (Android Studio) y macOS (Xcode).

---

## 1. Identificadores y arquitectura

- **Nombre de la app:** `LAZCAKONG GYM`
- **App ID / Bundle ID:** `com.lazcakong.gym`
- **Directorio web compilado (`webDir`):** `dist`
- **Backend permanente Cloud Run (`VITE_API_BASE_URL`):** `https://lazcakongym.ai.studio` *(servicio Cloud Run `lazcakongym` en `forward-cortex-1ds98`, URL directa `https://lazcakongym-13537846485.us-east1.run.app`)*
- **Proyecto Firebase:** `forward-cortex-1ds98` (base de datos `ai-studio-lazcakongym-dedcb625-f047-4947-ace1-3fbed6d67760`)
- **Web OAuth Client ID (`VITE_GOOGLE_WEB_CLIENT_ID`):** `13537846485-8j7931cki5gtlpq2eklsru35765sv3pq.apps.googleusercontent.com` *(valor público de cliente; nunca coloques secretos en variables `VITE_*` porque quedan incluidos en el bundle compilado `dist/`)*.

---

## 2. Versiones y requisitos verificados en Windows

- **Node.js:** `>= 22.0.0` (verificado en entorno con `v22.23.2`, requerido por `@capacitor/cli` `8.6.2`) y `npm >= 10` (o `bun` compatible con `bun.lock`).
- **Java JDK:** **JDK 21** (obligatorio para Gradle `8.14.3` y `JavaVersion.VERSION_21` en `android/app/capacitor.build.gradle`; Android Studio Ladybug / Meerkat / Narwhal lo incluye integrado como *JetBrains Runtime 21*).
- **Android Studio:** Ladybug (`2024.2+`) / Meerkat / Narwhal o superior en **Windows 10/11**.
- **Android SDK (verificado en `android/variables.gradle`):**
  - `compileSdkVersion`: **36** (Android 16 / API 36 Platform + Build-Tools 36.x)
  - `targetSdkVersion`: **36**
  - `minSdkVersion`: **24** (Android 7.0+)
- **Gradle & Plugins (verificados en `android/build.gradle` y `gradle-wrapper.properties`):**
  - **Gradle Wrapper:** `8.14.3` (`gradlew` / `gradlew.bat`)
  - **Android Gradle Plugin (AGP):** `8.13.0`
  - **Google Services Gradle Plugin:** `4.4.4`

---

## 3. Procedimiento exacto en Windows para generar el primer APK de prueba (Honor 400 Pro)

1. **Descomprime el archivo ZIP del proyecto** en una ruta corta sin espacios ni acentos (ejemplo recomendado: `C:\lazcakong-gym`).
2. **Opcional (si deseas sobrescribir defaults):** copia `.env.example` a `.env` manteniendo únicamente valores públicos en `VITE_*`:
   - `VITE_API_BASE_URL="https://lazcakongym.ai.studio"` *(NUNCA un URL temporal `ais-dev-*` ni proxy `ais-pre-*` con cookie check)*.
   - `VITE_GOOGLE_WEB_CLIENT_ID="13537846485-8j7931cki5gtlpq2eklsru35765sv3pq.apps.googleusercontent.com"`
3. **Abre PowerShell o Terminal en `C:\lazcakong-gym`** e instala dependencias y sincroniza Capacitor *(indispensable para que `android/capacitor.settings.gradle` encuentre `../node_modules/@capacitor/*`)*:
   ```powershell
   npm install
   npm run build
   npx cap sync android
   ```
4. **Abre Android Studio en Windows**:
   - Selecciona **Open** → elige la carpeta `C:\lazcakong-gym\android`.
   - Verifica en **File > Settings > Build, Execution, Deployment > Build Tools > Gradle** que **Gradle JDK** esté configurado en **JetBrains Runtime 21 (JDK 21)**.
   - Verifica en **Tools > SDK Manager** que estén instalados **Android SDK Platform 36** y **Android SDK Build-Tools**.
   - Espera a que termine **Gradle Sync** en la barra inferior.
5. **Configura Google Sign-In nativo (pasos pendientes con tu keystore local):**
   - El login con **Correo + Contraseña** funciona de inmediato contra Firebase Authentication (`forward-cortex-1ds98`) manteniendo los UIDs actuales.
   - Para activar **"Continuar con Google"** nativamente sin error `DEVELOPER_ERROR (10)`:
     1. En PowerShell dentro de `C:\lazcakong-gym\android`, obtén tus huellas **SHA-1** y **SHA-256** (debug para pruebas y release para producción):
        ```powershell
        .\gradlew.bat signingReport
        ```
     2. Copia el **SHA-1** y **SHA-256** del bloque `Variant: debug` (y más adelante del keystore de `release`).
     3. Entra a **Firebase Console** → proyecto **`forward-cortex-1ds98`** → **Configuración del proyecto > Tus apps > Agregar app > Android**.
     4. Ingresa paquete Android **`com.lazcakong.gym`** y registra las huellas **SHA-1** y **SHA-256**.
     5. Descarga el archivo **`google-services.json`** y colócalo exactamente en:
        ```text
        android\app\google-services.json
        ```
     6. En Android Studio haz clic en **Sync Project with Gradle Files** (el plugin `com.google.gms.google-services` se activará automáticamente).
6. **Genera el primer APK de prueba**:
   - En el menú superior de Android Studio haz clic en **Build > Build App(s) / APK(s) > Build APK(s)**.
   - Al finalizar verás la notificación *"APK(s) generated successfully"* → clic en **locate** para abrir:
     ```text
     android\app\build\outputs\apk\debug\app-debug.apk
     ```
7. **Instala y prueba en tu Honor 400 Pro**:
   - **Opción A (USB directa desde Android Studio):** en tu Honor 400 Pro ve a *Ajustes > Acerca del teléfono* (toca 7 veces *Número de compilación*), entra a *Opciones de desarrollador* y activa **Depuración USB**; conéctalo por USB, acepta el diálogo RSA, elige tu Honor 400 Pro en la barra superior de Android Studio y pulsa **Run ▶**.
   - **Opción B (instalación manual del APK):** copia `app-debug.apk` al teléfono y ábrelo aceptando *"Instalar aplicaciones de origen desconocido"* si Android lo solicita.

---

## 4. Permisos Android y cumplimiento Google Play

El archivo `android/app/src/main/AndroidManifest.xml` conserva únicamente los permisos necesarios y compatibles con las políticas de Google Play:
- `INTERNET`, `ACCESS_NETWORK_STATE`
- `VIBRATE`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`
- `SCHEDULE_EXACT_ALARM` *(temporizador de descanso en entrenamientos; se excluyó `USE_EXACT_ALARM`, reservado exclusivamente a apps de reloj/calendario)*.

---

## 5. Estructura iOS (para Xcode en macOS)

La carpeta `ios/` queda lista con Swift Package Manager (`ios/App/CapApp-SPM`). En macOS con Xcode y CocoaPods:

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios
```

En **Signing & Capabilities** selecciona tu Apple Developer Team con Bundle ID **`com.lazcakong.gym`**, agrega **`GoogleService-Info.plist`** al target `App`, configura `REVERSED_CLIENT_ID` en **URL Types** y define `VITE_GOOGLE_IOS_CLIENT_ID` al compilar.
