# LazcaKong Gym — biblioteca local integrada

Este es el proyecto completo de la aplicación con la nueva biblioteca incorporada, no un archivo para adjuntar al chat de Gemini.

## Contenido integrado

- `src/data/exerciseLibrary.json`: 669 ejercicios únicos, con `id` y `sourceId` estables.
- `public/exercise-library/`: 669 animaciones WebP originales y 669 miniaturas. Los GIF de la biblioteca de respaldo no se duplican en la aplicación.
- `src/data/exerciseAliases.json`: referencias compatibles con los ID y nombres anteriores.
- `docs/CORRESPONDENCIAS_BIBLIOTECA_669.json`: 668 correspondencias por ID exacto y 356 entradas del antiguo catálogo que quedan fuera de la biblioteca nueva. Este último número corresponde al catálogo anterior, no a ejercicios detectados en tus rutinas personales.

La biblioteca, las fichas, los selectores y el entrenamiento utilizan recursos locales. Las fichas reproducen los movimientos dentro de la aplicación. Las tarjetas muestran miniaturas y animan al pasar el puntero; en móvil, tocar abre el detalle animado.

## Rutinas e historial

No hay migración ni borrado automático de datos. Se conservan los ID originales de los ejercicios de las rutinas y las claves de los récords e historiales. La actualización resuelve sus imágenes mediante una capa de compatibilidad de solo lectura.

Los ejercicios sin correspondencia segura permanecen en la rutina y aparecen en «Ejercicios conservados sin animación vinculada». Los nombres duplicados no se enlazan arbitrariamente. Las fotos y los enlaces personales permanecen disponibles.

## Llevar esta versión a Google AI Studio

1. Extraer todo el ZIP, incluida `public/exercise-library`.
2. Usar el repositorio GitHub vinculado a tu app. Copiar estos archivos a una rama de trabajo conservando la estructura del proyecto y revisar el diff. No subir este ZIP como un único archivo al repositorio: hay que subir sus archivos extraídos.
3. Confirmar los cambios en esa rama. En Google AI Studio, traer los cambios con su sincronización de GitHub. Si trabajas con una app nueva de prueba, puedes importar el repositorio o la rama cuando esa opción esté disponible en tu interfaz.
4. Probar primero las rutinas existentes, la biblioteca y el entrenamiento. El paquete no ejecuta despliegues ni cambia reglas de Firebase.

El historial real vive en los datos del perfil (almacenamiento local/Firebase), no en este ZIP. No desinstales la app, no borres sus datos ni ejecutes una restauración de fábrica para integrar la biblioteca.

## Desarrollo y comprobaciones

```sh
npm ci
npm run lint
npm run build
node --import tsx scripts/verify-library-669.ts
node --import tsx scripts/verify-library-render.tsx
node node_modules/jest/bin/jest.js src/utils/__tests__/eliteBackupEngine.jest.test.ts src/utils/__tests__/updateAppSafety.jest.test.ts --runInBand
```

Se incluye `package-lock.json` para reproducir la instalación. Se añadió la dependencia `react-is`, requerida por los gráficos existentes, y se alineó `esbuild` con la versión de Vite utilizada por este proyecto. Se retiró el `bun.lock` anterior para evitar dos resoluciones de dependencias incompatibles; usa npm y el lockfile incluido.

Pruebas realizadas: catálogo único, existencia de los 1.338 recursos, correspondencias antiguas, conservación de ID y prescripciones, ausencia de enlaces externos en el catálogo, render de grupos y ficha animada, TypeScript, compilación y 4 pruebas existentes de respaldo/actualización segura. El navegador automatizado no pudo iniciarse en este entorno, por lo que falta una revisión interactiva en móvil/escritorio.

No se ha publicado esta versión ni se han modificado usuarios, reglas o datos de producción.
