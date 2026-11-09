import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";

// Emits sw.js with the build's own file list, so the app shell works offline after one visit.
// The worker only serves this site's files; API requests (Firebase, Gemini) go straight to the network.
function offlineShell(): Plugin {
  return {
    name: "offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map")).map((f) => `/${f}`).sort();
      const version = createHash("sha256").update(["/favicon.svg", ...files].join("\n")).digest("hex").slice(0, 12);
      const source = `// Generated at build time by vite.config.ts.
const VERSION = "second-look-${version}";
const FILES = ${JSON.stringify(["/", "/favicon.svg", ...files.filter((f) => f !== "/index.html")])};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("second-look-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({ plugins: [offlineShell()] });
