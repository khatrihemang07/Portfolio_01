import { defineConfig } from "astro/config";

export default defineConfig({
  // One small stylesheet: inline it so the first paint never waits on a CSS request.
  build: { inlineStylesheets: "always" },
  site: "https://me.hemangkhatri.workers.dev",
  output: "static",
});
