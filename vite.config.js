import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The production policy is strict: no inline scripts, no eval, nothing loaded
 * from the network, and the page cannot be framed or navigated away from.
 * `default-src 'none'` means anything not listed below is refused.
 *
 * Development needs a looser policy purely because Vite's HMR client injects
 * inline script and talks to its dev server over a websocket - which is
 * exactly why the two are kept separate rather than shipping one policy that
 * has to satisfy both.
 */
const CSP = {
  production: [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' gdmedia: data: blob:",
    "media-src 'self' gdmedia: blob:",
    "font-src 'self'",
    "connect-src 'self' gdmedia:",
    "base-uri 'none'",
    "form-action 'none'",
    // frame-ancestors is only honoured as an HTTP header, not via <meta>, and
    // would just log a warning. Framing is prevented structurally instead:
    // the app loads from file://, has no iframes, and webviews are blocked.
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; '),
  development: [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' gdmedia: data: blob:",
    "media-src 'self' gdmedia: blob:",
    "font-src 'self' data:",
    "connect-src 'self' gdmedia: ws://localhost:5173 http://localhost:5173",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; '),
};

function cspPlugin() {
  return {
    name: 'gd-csp',
    transformIndexHtml(html, ctx) {
      const policy = ctx.server ? CSP.development : CSP.production;
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  // Relative base so the built bundle loads over file:// inside the packaged app.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
