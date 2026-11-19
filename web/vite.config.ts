import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = 'http://localhost:4000';
const configDir = fileURLToPath(new URL('.', import.meta.url));
const pwaDir = path.resolve(configDir, '../pwa');

const contentTypes: Record<string, string> = {
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serves the shared `pwa/` assets in dev and copies them into the build output. */
function pwaAssets(): Plugin {
  return {
    name: 'chatime-pwa-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const file =
          pathname === '/sw.js'
            ? 'sw.js'
            : pathname === '/manifest.webmanifest'
              ? 'manifest.webmanifest'
              : pathname.startsWith('/icons/')
                ? pathname.slice(1)
                : null;
        if (!file) return next();

        const source = path.join(pwaDir, file);
        if (!source.startsWith(pwaDir + path.sep) || !existsSync(source) || !statSync(source).isFile()) return next();

        res.setHeader('Content-Type', contentTypes[path.extname(source)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        if (pathname === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
        createReadStream(source).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.join(configDir, 'dist');
      mkdirSync(path.join(outDir, 'icons'), { recursive: true });
      cpSync(path.join(pwaDir, 'manifest.webmanifest'), path.join(outDir, 'manifest.webmanifest'));
      cpSync(path.join(pwaDir, 'sw.js'), path.join(outDir, 'sw.js'));
      cpSync(path.join(pwaDir, 'icons'), path.join(outDir, 'icons'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaAssets()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
    },
  },
});
