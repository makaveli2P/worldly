import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

type Seo = typeof import('./src/data/seo');

// Search and social files, from src/data/seo.ts (loaded with runnerImport, as above).
//
// - index.html: the head tags (title, description, canonical link, Open Graph, Twitter, JSON-LD) and a
//   short summary for crawlers that do not run JavaScript. The dev server and the build both add them.
// - The build only: /country/<slug>/index.html for each country, made from the final index.html (with the
//   hashed asset names), and /sitemap.xml and /robots.txt. The dev server makes the last two on request.
function worldlySeo(): Plugin {
  let root = '';
  let publicDir = '';
  let outDir = '';
  let module: Promise<Seo> | null = null;
  const load = () => {
    module ??= runnerImport<Seo>(join(root, 'src/data/seo.ts'), { root, logLevel: 'error' }).then((r) => r.module);
    return module;
  };
  const countries = () => JSON.parse(readFileSync(join(publicDir, 'data', 'countries.json'), 'utf8'));
  const textFiles = async (): Promise<Record<string, { type: string; body: string }>> => {
    const seo = await load();
    return {
      'sitemap.xml': {
        type: 'application/xml; charset=utf-8',
        body: seo.buildSitemap(seo.sitePaths(countries()), seo.isoDate(new Date())),
      },
      'robots.txt': { type: 'text/plain; charset=utf-8', body: seo.buildRobots() },
    };
  };
  return {
    name: 'worldly-seo',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
      outDir = resolve(config.root, config.build.outDir);
    },
    configurePreviewServer(server) {
      // Vercel serves /country/japan from country/japan/index.html. vite preview does that only for
      // /country/japan/ (with the slash), so this middleware adds the file name.
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split(/(?=\?)/);
        if (/^\/country\/[^/]+$/.test(path) && existsSync(join(outDir, path, 'index.html'))) {
          req.url = `${path}/index.html${query ?? ''}`;
        }
        next();
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0].slice(1) ?? '';
        if (path !== 'sitemap.xml' && path !== 'robots.txt') return next();
        textFiles().then(
          (files) => {
            res.setHeader('Content-Type', files[path].type);
            res.end(files[path].body);
          },
          (err: unknown) => next(err),
        );
      });
    },
    transformIndexHtml: {
      // After the transforms of Vite, so that Vite does not touch the JSON-LD script.
      order: 'post',
      handler: async (html) => (await load()).renderHomePage(html, countries()),
    },
    generateBundle: {
      // After vite:build-html writes index.html with the hashed asset names.
      order: 'post',
      async handler(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || index.type !== 'asset') return this.error('worldly-seo: the bundle has no index.html');
        const template = typeof index.source === 'string' ? index.source : new TextDecoder().decode(index.source);
        const seo = await load();
        const all = countries();
        for (const [fileName, source] of seo.countryPages(template, all)) this.emitFile({ type: 'asset', fileName, source });
        for (const [fileName, file] of Object.entries(await textFiles())) {
          this.emitFile({ type: 'asset', fileName, source: file.body });
        }
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose server-only env (NEWSDATA_API_KEY) to api handlers in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [apiDev(), worldlyData(), worldlySeo()],
    // Scan only the app, not the design mockups in mockups/.
    optimizeDeps: { entries: ['index.html'] },
    build: { chunkSizeWarningLimit: 700 },
  };
});
