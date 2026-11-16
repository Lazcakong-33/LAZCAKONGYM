# LazcaKong Gym

Aplicación de entrenamiento con biblioteca local de **669 ejercicios**, 669 animaciones WebP y 669 miniaturas. Interfaz negro/grafito y verde lima, rutinas, entrenamiento, mapa muscular, progreso e importación/exportación.

## Ejecutar

Requiere Node.js 22 o superior y npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Configura `GEMINI_API_KEY` en los secretos del servidor para las funciones de IA. `GEMINI_MODEL` permite elegir el modelo disponible en tu cuenta; por defecto se usa `gemini-3.8-flash`. No publiques claves ni uses variables `VITE_` para secretos.

```sh
npm run lint
npm run build
npm start
```

## Biblioteca y datos existentes

Los recursos están en `public/exercise-library/`. No hace falta subir el ZIP al chat de Gemini. Importa o sincroniza los archivos del repositorio desde Google AI Studio, conservando también la carpeta `public`.

Los ID de rutinas, historial y récords se conservan. La compatibilidad enlaza 668 ID del catálogo anterior sin migrar ni borrar datos. Los ejercicios sin correspondencia segura permanecen disponibles y no reciben una animación arbitraria. Consulta [LEEME_BIBLIOTECA_669.md](LEEME_BIBLIOTECA_669.md).

## Verificar

```sh
node --import tsx scripts/verify-library-669.ts
node --import tsx scripts/verify-library-render.tsx
node --import tsx scripts/verify_real_backup_engine.ts
node node_modules/jest/bin/jest.js src/utils/__tests__/eliteBackupEngine.jest.test.ts src/utils/__tests__/updateAppSafety.jest.test.ts --runInBand
```

La compilación genera `dist`; las rutas `/api` requieren el servidor Node. `vite preview` por sí solo no ejecuta las funciones del servidor.

Esta integración no despliega Firebase ni migra usuarios. Las reglas incluidas son código para revisión y pruebas; no se han aplicado a producción. No borres el almacenamiento del navegador ni desinstales la aplicación para actualizarla.

La llamada real a Gemini necesita una clave válida; el mensaje «Invalid argument» del editor de AI Studio no se puede diagnosticar únicamente con ese texto.

## Configuración de esta versión pública

Los archivos Firebase incluidos contienen valores de demostración. Configura las variables `VITE_FIREBASE_*` para el navegador y `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_ID` y `ADMIN_EMAILS` en el servidor antes de usar una cuenta real. Sin `ADMIN_EMAILS`, el servidor no autoriza administradores. Las variables `VITE_` son públicas: nunca pongas allí claves de Gemini, Resend ni credenciales de servicio.

Las reglas Firestore contienen `admin@example.invalid` como marcador de plantilla; requieren revisión y configuración separada antes de cualquier despliegue. No se han modificado servicios ni reglas de producción. Conserva la configuración privada de tu instalación actual al integrar este código.
