/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds into ../site next to the data the tracker writes (site/data), the boundaries (site/geo) and the headshots
// (site/img), so `python3 tracker.py --serve 8077` serves the React page with no other changes.
// `npm run dev` serves the page on :5173 and forwards data/geo/img requests to a running tracker on :8077.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../site",
    emptyOutDir: false,        // never touch site/data, site/geo, site/img or classic.html
    assetsDir: "app",          // `npm run build` clears site/app first
    sourcemap: true,
    target: "es2020",
    chunkSizeWarningLimit: 900,   // MapLibre alone is ~800 kB; it gets its own file so it stays cached across deploys
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"], react: ["react", "react-dom"] } } },
  },
  server: {
    proxy: Object.fromEntries(["/data", "/geo", "/img"].map(p => [p, "http://127.0.0.1:8077"])),
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
