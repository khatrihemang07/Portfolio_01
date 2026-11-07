// Checks every link on the built home page: external URLs over the network,
// #fragments against the ids on the page, local paths against dist, and the
// mailto address assembled from the Contact data attributes. Not part of
// `pnpm verify`, because the network is not reliable enough for a gate.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const page = join(dist, "index.html");
const TIMEOUT_MS = 15_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!existsSync(page)) {
  console.error(`Missing ${page}. Run pnpm build first.`);
  process.exit(1);
}

const html = readFileSync(page, "utf8");
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = [
  ...new Set([...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1])),
];
const canonical = html.match(
  /<link\b[^>]*rel="canonical"[^>]*\shref="([^"]+)"/,
)?.[1];
const selfOrigin = canonical ? new URL(canonical).origin : null;

// A row is { status: "ok" | "warn" | "fail", kind, target, detail }.
const rows = [];

function describeError(error) {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return `no response within ${TIMEOUT_MS / 1000} s`;
  }
  return error.cause?.code ?? error.message;
}

async function request(url, method) {
  return fetch(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "portfolio-link-check/1.0" },
  });
}

// HEAD first, GET when HEAD is refused, fails or returns an error status.
async function probe(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await request(url, method);
      await res.body?.cancel();
      if (res.status < 400 || method === "GET") return { status: res.status };
    } catch (error) {
      if (method === "GET") return { error: describeError(error) };
    }
  }
  return { error: "no result" };
}

async function checkExternal(url) {
  const result = await probe(url);
  const host = new URL(url).hostname;
  if (result.error) return { status: "fail", detail: result.error };
  if (result.status < 400)
    return { status: "ok", detail: String(result.status) };
  // GitHub throttles automated requests with 429 and sometimes 403 to bots.
  if (
    host === "github.com" &&
    (result.status === 429 || result.status === 403)
  ) {
    return {
      status: "warn",
      detail: `${result.status} from github.com (rate or bot limit, not counted as a failure)`,
    };
  }
  return { status: "fail", detail: String(result.status) };
}

function checkLocal(href) {
  const path = href.split(/[?#]/)[0];
  const file =
    path === "" || path === "/" ? "index.html" : path.replace(/^\//, "");
  return existsSync(join(dist, file))
    ? { status: "ok", detail: "file in dist" }
    : { status: "fail", detail: `no file dist/${file}` };
}

for (const href of hrefs) {
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    rows.push({
      status: ids.has(id) ? "ok" : "fail",
      kind: "fragment",
      target: href,
      detail: ids.has(id) ? "id exists" : `no element with id "${id}"`,
    });
  } else if (href.startsWith("https://") || href.startsWith("http://")) {
    if (new URL(href).origin === selfOrigin) {
      rows.push({
        status: "ok",
        kind: "self",
        target: href,
        detail: "same origin, not requested",
      });
    } else {
      rows.push({
        status: "pending",
        kind: "external",
        target: href,
        detail: "",
      });
    }
  } else if (href.startsWith("/") || !href.includes(":")) {
    rows.push({ kind: "local", target: href, ...checkLocal(href) });
  } else {
    rows.push({
      status: "warn",
      kind: "other",
      target: href,
      detail: "unsupported scheme, not checked",
    });
  }
}

// The Contact address is assembled in the browser, so the static HTML has no
// mailto href. Check the address the script would build from the data attributes.
for (const [, user, domain] of html.matchAll(
  /data-mail-user="([^"]+)"\s+data-mail-domain="([^"]+)"/g,
)) {
  const address = `${user}@${domain}`;
  rows.push({
    status: EMAIL.test(address) ? "ok" : "fail",
    kind: "mailto",
    target: `mailto:${address}`,
    detail: EMAIL.test(address)
      ? "address syntax ok (built in the browser, not sent)"
      : "address is not a valid email",
  });
}

// Requests run one at a time so the check stays gentle on GitHub.
for (const row of rows) {
  if (row.status !== "pending") continue;
  Object.assign(row, await checkExternal(row.target));
}

const widths = { status: 6, kind: 8, target: 6 };
for (const row of rows) {
  widths.target = Math.max(widths.target, row.target.length);
}
const line = (status, kind, target, detail) =>
  `${status.padEnd(widths.status)}  ${kind.padEnd(widths.kind)}  ${target.padEnd(widths.target)}  ${detail}`;

console.log(line("STATUS", "KIND", "TARGET", "DETAIL"));
console.log(
  line(
    "-".repeat(widths.status),
    "-".repeat(widths.kind),
    "-".repeat(widths.target),
    "------",
  ),
);
for (const row of rows) {
  console.log(line(row.status.toUpperCase(), row.kind, row.target, row.detail));
}

const count = (status) => rows.filter((row) => row.status === status).length;
console.log(
  `\n${rows.length} links: ${count("ok")} ok, ${count("warn")} warn, ${count("fail")} fail`,
);
process.exit(count("fail") > 0 ? 1 : 0);
