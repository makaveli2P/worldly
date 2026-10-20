import { defineConfig, loadEnv, type Plugin } from 'vite';

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

export default defineConfig(({ mode }) => {
  // Expose server-only env (NEWSDATA_API_KEY) to api handlers in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [apiDev()], build: { chunkSizeWarningLimit: 700 } };
});
