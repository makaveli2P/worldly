import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, runnerImport, type Plugin } from 'vite';

// Runs api/*.ts handlers (Web-standard `export async function GET(request: Request)`)
// inside the Vite dev server, so `npm run dev` matches Vercel without `vercel dev`.
function apiDev(): Plugin {
  return {
    name: 'worldly-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end();
          }
          const response: Response = await handler(new Request(url, { method: req.method }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(String(err));
          res.statusCode = 500;
          res.end('api error');
        }
      });
    },
  };
}

type Precompute = typeof import('./src/data/precompute');
type TextureManifest = typeof import('./src/globe/textureManifest');

// Build-time data for the page, from TypeScript modules in src/. runnerImport loads them, so this
// config file has no runtime TypeScript imports (the coming native config loader of Vite needs that).
//
// - /data/labels.json and /data/countries-lite.json (src/data/precompute.ts): the build writes them,
//   and the dev server makes them on request. Each comes from the current public/data files, so they stay in step.
// - index.html asks for the first satellite texture before the module runs. Its name holds a content hash;
//   the plugin puts the current name from src/globe/textureManifest.ts into the page.
function worldlyData(): Plugin {
  let root = '';
  let publicDir = '';
  let modules: Promise<{ pre: Precompute; tex: TextureManifest }> | null = null;
  const load = () => {
    if (!modules) {
      const opts = { root, logLevel: 'error' as const };
      modules = Promise.all([
        runnerImport<Precompute>(join(root, 'src/data/precompute.ts'), opts),
        runnerImport<TextureManifest>(join(root, 'src/globe/textureManifest.ts'), opts),
      ]).then(([pre, tex]) => ({ pre: pre.module, tex: tex.module }));
    }
    return modules;
  };
  const read = (name: string) => JSON.parse(readFileSync(join(publicDir, 'data', name), 'utf8'));
  const files: Record<string, { from: string; make: (pre: Precompute) => unknown }> = {
    'data/labels.json': { from: 'world.json', make: (pre) => pre.buildLabelsFile(read('world.json')) },
    'data/countries-lite.json': { from: 'countries.json', make: (pre) => pre.liteCountries(read('countries.json')) },
  };
  const cache = new Map<string, { mtime: number; body: string }>();
  const body = async (path: string): Promise<string> => {
    const f = files[path];
    const mtime = statSync(join(publicDir, 'data', f.from)).mtimeMs;
    let hit = cache.get(path);
    if (!hit || hit.mtime !== mtime) {
      hit = { mtime, body: JSON.stringify(f.make((await load()).pre)) };
      cache.set(path, hit);
    }
    return hit.body;
  };
  return {
    name: 'worldly-data',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0].slice(1) ?? '';
        if (!(path in files)) return next();
        body(path).then(
          (text) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          },
          (err: unknown) => next(err),
        );
      });
    },
    transformIndexHtml: {
      // Before the %ENV% replacement of Vite, which does not know this name.
      order: 'pre',
      handler: async (html) => html.replaceAll('%WORLDLY_TEXTURE_FIRST%', (await load()).tex.TEXTURES.s.url),
    },
    async generateBundle() {
      for (const path of Object.keys(files)) this.emitFile({ type: 'asset', fileName: path, source: await body(path) });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose server-only env (NEWSDATA_API_KEY) to api handlers in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [apiDev(), worldlyData()],
    // Scan only the app, not the design mockups in mockups/.
    optimizeDeps: { entries: ['index.html'] },
    build: { chunkSizeWarningLimit: 700 },
  };
});
