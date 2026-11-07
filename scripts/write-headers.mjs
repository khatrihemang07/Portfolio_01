// Writes dist/_headers after `astro build`. The Content-Security-Policy must list
// the hash of every inline <script> and <style> in the built HTML, and those
// only exist once the build has run, so the file is generated, never hand-kept.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

// Inline means no src. JSON-LD is data, never executed, so it is not hashed.
function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(
      ([, attrs]) =>
        !/\ssrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs),
    )
    .map(([, , text]) => text);
}

function inlineStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
    ([, text]) => text,
  );
}

// The hash is over the exact text between the tags, as the browser sees it.
const sourceOf = (text) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

const files = htmlFiles(dist);
if (files.length === 0) {
  throw new Error("No built HTML found in dist/. Run astro build first.");
}

const scriptHashes = new Set();
const styleHashes = new Set();
for (const file of files) {
  const html = readFileSync(file, "utf8");
  for (const text of inlineScripts(html)) scriptHashes.add(sourceOf(text));
  for (const text of inlineStyles(html)) styleHashes.add(sourceOf(text));
}

const sources = (...parts) => parts.flat().filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  `script-src ${sources("'self'", [...scriptHashes].sort(), "https://static.cloudflareinsights.com")}`,
  // style-src-attr allows style="" attributes. The tiles set style="--i: N" for
  // the staggered load-in, and an attribute cannot be hashed. Scripts never get
  // unsafe-inline, and style elements are hashed, so only the attribute form is open.
  `style-src ${sources("'self'", [...styleHashes].sort())}`,
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// The catch-all block deliberately sets no Cache-Control. A path matching several
// blocks gets their values combined on Cloudflare Pages, so a Cache-Control here
// would be merged into the hashed-asset rule and cancel its immutable caching.
// Pages already serves HTML with a revalidating default.
const headers = `/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: ${csp}
`;

writeFileSync(join(dist, "_headers"), headers);
console.log(
  `Wrote dist/_headers: ${files.length} HTML files, ${scriptHashes.size} script hash(es), ${styleHashes.size} style hash(es).`,
);
