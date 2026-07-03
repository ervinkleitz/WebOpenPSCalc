import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Allows importing the repo-root CHANGELOG.md (?raw) from outside this
// project's own directory -- this frontend lives two levels under the
// actual repo root.
const repoRoot = path.resolve(__dirname, "../..");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");

export default defineConfig({
  plugins: [
    react(),
    {
      // Vite's dev-server file watcher only tracks files under this
      // project's own root by default -- CHANGELOG.md living outside it
      // (fs.allow only grants read access, not watch coverage) meant
      // edits were silently ignored until a manual server restart.
      // Explicitly watching it + forcing a full reload on change fixes that.
      name: "watch-external-changelog",
      configureServer(server) {
        server.watcher.add(changelogPath);
        server.watcher.on("change", (file) => {
          if (path.normalize(file) === path.normalize(changelogPath)) {
            server.ws.send({ type: "full-reload" });
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/stats/data": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/stats/ping": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
    fs: {
      allow: [repoRoot],
    },
  },
});
