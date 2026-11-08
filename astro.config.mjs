import { defineConfig } from "astro/config";

export default defineConfig({
  // One small stylesheet: inline it so the first paint never waits on a CSS request.
  build: { inlineStylesheets: "always" },
  site: "https://hemangkhatri.khatrihemang07.workers.dev",
  output: "static",
});
