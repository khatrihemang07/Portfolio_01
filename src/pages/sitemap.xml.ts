import type { APIContext } from "astro";

// The Site is one page, so the sitemap lists the home URL only and omits lastmod.
export function GET({ site }: APIContext): Response {
  if (!site) {
    throw new Error("Set `site` in astro.config.mjs to build the sitemap.");
  }
  const home = new URL("/", site).href;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${home}</loc>
  </url>
</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
