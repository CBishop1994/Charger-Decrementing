import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { appbuilderApiDevServer } from "./vite-plugins/appbuilder-api-dev-server";

/**
 * Mirror vercel.json inventory rewrites in local `npm run dev`.
 * Production uses vercel.json; the file-based Vite API plugin only
 * sees real files under api/, so without this middleware
 * /api/consumables etc. 404 after consolidation into api/inventory.ts.
 */
function inventoryApiRewrites(): Plugin {
  const rules: Array<{ pattern: RegExp; build: (m: RegExpMatchArray) => string }> = [
    {
      pattern: /^\/api\/health\/?$/,
      build: () => "/api/inventory?resource=health",
    },
    {
      pattern: /^\/api\/dashboard\/?$/,
      build: () => "/api/inventory?resource=dashboard",
    },
    {
      pattern: /^\/api\/seed\/?$/,
      build: () => "/api/inventory?resource=seed",
    },
    {
      pattern: /^\/api\/print\/?$/,
      build: () => "/api/inventory?resource=print",
    },
    {
      pattern: /^\/api\/scan\/?$/,
      build: () => "/api/inventory?resource=scan",
    },
    {
      pattern: /^\/api\/transactions\/?$/,
      build: () => "/api/inventory?resource=transactions",
    },
    {
      pattern: /^\/api\/consumables\/(\d+)\/adjust\/?$/,
      build: (m) =>
        `/api/inventory?resource=consumables&id=${m[1]}&action=adjust`,
    },
    {
      pattern: /^\/api\/consumables\/(\d+)\/?$/,
      build: (m) => `/api/inventory?resource=consumables&id=${m[1]}`,
    },
    {
      pattern: /^\/api\/consumables\/?$/,
      build: () => "/api/inventory?resource=consumables",
    },
    {
      pattern: /^\/api\/bin-locations\/(\d+)\/?$/,
      build: (m) => `/api/inventory?resource=bin-locations&id=${m[1]}`,
    },
    {
      pattern: /^\/api\/bin-locations\/?$/,
      build: () => "/api/inventory?resource=bin-locations",
    },
    {
      pattern: /^\/api\/printers\/(\d+)\/?$/,
      build: (m) => `/api/inventory?resource=printers&id=${m[1]}`,
    },
    {
      pattern: /^\/api\/printers\/?$/,
      build: () => "/api/inventory?resource=printers",
    },
    {
      pattern: /^\/api\/approved-emails\/(\d+)\/?$/,
      build: (m) => `/api/inventory?resource=approved-emails&id=${m[1]}`,
    },
    {
      pattern: /^\/api\/approved-emails\/?$/,
      build: () => "/api/inventory?resource=approved-emails",
    },
    {
      pattern: /^\/api\/stock-orders\/(\d+)\/deliver\/?$/,
      build: (m) =>
        `/api/inventory?resource=stock-orders&id=${m[1]}&action=deliver`,
    },
    {
      pattern: /^\/api\/stock-orders\/(\d+)\/cancel\/?$/,
      build: (m) =>
        `/api/inventory?resource=stock-orders&id=${m[1]}&action=cancel`,
    },
    {
      pattern: /^\/api\/stock-orders\/(\d+)\/?$/,
      build: (m) => `/api/inventory?resource=stock-orders&id=${m[1]}`,
    },
    {
      pattern: /^\/api\/stock-orders\/?$/,
      build: () => "/api/inventory?resource=stock-orders",
    },
  ];

  return {
    name: "inventory-api-rewrites",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();
        const qIdx = req.url.indexOf("?");
        const pathname = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
        const search = qIdx === -1 ? "" : req.url.slice(qIdx + 1);
        for (const rule of rules) {
          const m = pathname.match(rule.pattern);
          if (!m) continue;
          const dest = rule.build(m);
          const destQ = dest.includes("?") ? dest.slice(dest.indexOf("?") + 1) : "";
          const destPath = dest.includes("?") ? dest.slice(0, dest.indexOf("?")) : dest;
          const merged = [destQ, search].filter(Boolean).join("&");
          req.url = merged ? `${destPath}?${merged}` : destPath;
          break;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  plugins: [
    react(),
    tailwindcss(),
    inventoryApiRewrites(),
    appbuilderApiDevServer(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // strictPort: a stale "npm run dev" leaves Vite drifting to 5174/5175 and the
    // saved app.url (which routes to the bare host = primary port) intermittently
    // 502s. Crash on conflict instead so the wake handler sees a real error.
    strictPort: true,
    // allowedHosts must be true: sandboxes are accessed via dynamic Vercel-assigned hostnames
    allowedHosts: true,
    // The preview iframe loads the app through the vercel.run edge proxy on
    // 443 (wss), not directly on 5173. Without this, Vite's HMR client opens
    // its WebSocket against :5173 (the dev-server port), which the proxy does
    // not expose — the socket drops, the client logs "server connection lost.
    // Polling for restart...", and forces a full page reload on reconnect, so
    // the preview appears to refresh even though nothing changed.
    hmr: { clientPort: 443, protocol: "wss" },
  },
});
