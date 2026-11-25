import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import productionFirebaseConfig from './src/firebase-applet-config.json' with { type: 'json' };

// Plugin to serve PWA headers and MIME types correctly
function pwaHeadersPlugin(): Plugin {
  return {
    name: 'pwa-headers-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Allow CORS for external tools, PWABuilder, and WebAPK minting
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const url = req.url?.split('?')[0];

        // Ensure mobile browsers and PWAs never cache sw.js, index.html, or manifest
        if (
          url === '/' ||
          url === '/index.html' ||
          url === '/sw.js' ||
          url === '/manifest.json' ||
          url === '/manifest.webmanifest' ||
          url === '/api/version'
        ) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }

        if (url === '/api/version' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              version: '7.0.0',
              buildId: '7.0.0-ota-release',
              buildDate: new Date().toISOString(),
            })
          );
          return;
        }

        if (url === '/api/gemini/generate-routine' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const { generateAIRoutine } = await import('./src/server/geminiRoutineGenerator.ts');
              const params = JSON.parse(body || '{}');
              const routine = await generateAIRoutine(params);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, routine }));
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        if (url === '/api/gemini/scan-machine' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const { scanGymMachineWithGemini } = await import('./src/server/geminiMachineScanner.ts');
              const params = JSON.parse(body || '{}');
              const result = await scanGymMachineWithGemini(params);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, result }));
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        if (url === '/api/webhooks/mercadopago' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const { handleMercadoPagoWebhook } = await import('./src/server/mercadopagoWebhook.ts');
              let parsedBody: any = {};
              try {
                parsedBody = body ? JSON.parse(body) : {};
              } catch {}

              const queryString = req.url?.includes('?') ? req.url.split('?')[1] : '';
              const queryParams: Record<string, string> = {};
              if (queryString) {
                new URLSearchParams(queryString).forEach((val, key) => {
                  queryParams[key] = val;
                });
              }

              const mockReq: any = {
                body: parsedBody,
                query: queryParams,
                headers: req.headers,
              };

              let ended = false;
              const mockRes: any = {
                statusCode: 200,
                status(code: number) {
                  this.statusCode = code;
                  res.statusCode = code;
                  return this;
                },
                json(data: any) {
                  if (ended) return;
                  ended = true;
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = this.statusCode || 200;
                  res.end(JSON.stringify(data));
                },
                send(data: any) {
                  if (ended) return;
                  ended = true;
                  res.statusCode = this.statusCode || 200;
                  res.end(typeof data === 'string' ? data : JSON.stringify(data));
                },
              };

              await handleMercadoPagoWebhook(mockReq, mockRes);
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isAppPreview = mode === 'cloudflare-preview';
  let previewFirebaseConfig: (Partial<typeof productionFirebaseConfig> & { databaseURL?: string }) | undefined;
  if (isAppPreview) {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    try {
      previewFirebaseConfig = JSON.parse(env.VITE_PREVIEW_FIREBASE_CONFIG ?? '');
    } catch {
      throw new Error('Set VITE_PREVIEW_FIREBASE_CONFIG to the web configuration of an isolated Firebase test project.');
    }
    if (
      !previewFirebaseConfig?.projectId ||
      previewFirebaseConfig.projectId === productionFirebaseConfig.projectId ||
      previewFirebaseConfig.apiKey === productionFirebaseConfig.apiKey ||
      previewFirebaseConfig.authDomain !== `${previewFirebaseConfig.projectId}.firebaseapp.com` ||
      !previewFirebaseConfig.apiKey ||
      !previewFirebaseConfig.appId ||
      previewFirebaseConfig.databaseURL ||
      (previewFirebaseConfig.storageBucket &&
        ![`${previewFirebaseConfig.projectId}.appspot.com`, `${previewFirebaseConfig.projectId}.firebasestorage.app`].includes(previewFirebaseConfig.storageBucket))
    ) {
      throw new Error('Cloudflare preview requires an isolated Firebase project with its own web credentials and default auth domain.');
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      pwaHeadersPlugin(),
      ...(isAppPreview ? [{
        name: 'isolated-firebase-preview',
        enforce: 'pre' as const,
        resolveId(source: string, importer?: string) {
          if (source === './firebase-applet-config.json' && importer?.endsWith('/src/firebase.ts')) {
            return '\0isolated-firebase-preview';
          }
        },
        load(id: string) {
          if (id === '\0isolated-firebase-preview') {
            return `export default ${JSON.stringify(previewFirebaseConfig)};`;
          }
        },
      }] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    define: {
      ...(isAppPreview ? {
        'import.meta.env.VITE_COACH_LOCAL_ONLY': JSON.stringify('true'),
        'import.meta.env.VITE_COACH_WORKERS_AI': JSON.stringify('true'),
      } : {}),
    },
    build: {
      outDir: isAppPreview ? 'dist-app-preview' : 'dist',
      sourcemap: false,
    },
  };
});
