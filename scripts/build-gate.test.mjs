import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "src", "content", "projects");
const invalidFile = join(contentDir, "zz-gate-invalid.yaml");

const invalidCases = [
  [
    "only one Fact",
    `name: gate
pitch: Gate pitch.
body: Gate body.
facts:
  - text: "Only fact"
    source: "Gate source."
stack: Gate stack
repo: https://github.com/example/gate
image: ../../assets/projects/markuli.png
alt: "Gate alt text."
order: 99
`,
    "facts",
  ],
  [
    "three Facts",
    `name: gate
pitch: Gate pitch.
body: Gate body.
facts:
  - text: "First fact"
    source: "Gate source."
  - text: "Second fact"
    source: "Gate source."
  - text: "Third fact"
    source: "Gate source."
stack: Gate stack
repo: https://github.com/example/gate
image: ../../assets/projects/markuli.png
alt: "Gate alt text."
order: 99
`,
    "facts",
  ],
  [
    "empty alt",
    `name: gate
pitch: Gate pitch.
body: Gate body.
facts:
  - text: "First fact"
    source: "Gate source."
  - text: "Second fact"
    source: "Gate source."
stack: Gate stack
repo: https://github.com/example/gate
image: ../../assets/projects/markuli.png
alt: ""
order: 99
`,
    "alt",
  ],
  [
    "missing pitch",
    `name: gate
body: Gate body.
facts:
  - text: "First fact"
    source: "Gate source."
  - text: "Second fact"
    source: "Gate source."
stack: Gate stack
repo: https://github.com/example/gate
image: ../../assets/projects/markuli.png
alt: "Gate alt text."
order: 99
`,
    "pitch",
  ],
  [
    "a Fact with a missing source",
    `name: gate
pitch: Gate pitch.
body: Gate body.
facts:
  - text: "First fact"
  - text: "Second fact"
    source: "Gate source."
stack: Gate stack
repo: https://github.com/example/gate
image: ../../assets/projects/markuli.png
alt: "Gate alt text."
order: 99
`,
    "facts.0.source",
  ],
  [
    "an invalid repo URL",
    `name: gate
pitch: Gate pitch.
body: Gate body.
facts:
  - text: "First fact"
    source: "Gate source."
  - text: "Second fact"
    source: "Gate source."
stack: Gate stack
repo: not a url
image: ../../assets/projects/markuli.png
alt: "Gate alt text."
order: 99
`,
    "repo",
  ],
];

// Always remove the temporary invalid Project, even if the run is interrupted.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    rmSync(invalidFile, { force: true });
    process.exit(1);
  });
}
process.on("exit", () => rmSync(invalidFile, { force: true }));

function runBuild() {
  return spawnSync("pnpm", ["exec", "astro", "build"], {
    cwd: root,
    encoding: "utf8",
    timeout: 240_000,
  });
}

// The Site is built once and shared by every test that reads dist/.
let sharedBuild;
function buildOnce() {
  sharedBuild ??= runBuild();
  return sharedBuild;
}

test("no Fact source is still marked unverified", () => {
  for (const file of readdirSync(contentDir)) {
    const text = readFileSync(join(contentDir, file), "utf8");
    assert.doesNotMatch(
      text,
      /UNVERIFIED|Not yet re-verified/i,
      `${file} still has an unverified Fact source`,
    );
  }
});

test("no temporary invalid Project is left behind", () => {
  assert.throws(() => readFileSync(invalidFile), { code: "ENOENT" });
});

for (const [label, yaml, field] of invalidCases) {
  test(`build fails when a Project has ${label}`, () => {
    try {
      writeFileSync(invalidFile, yaml);
      const result = runBuild();
      const output = `${result.stdout}\n${result.stderr}`;
      assert.notEqual(
        result.status,
        0,
        `expected astro build to fail\n${output}`,
      );
      // The failure must come from the schema, name the invalid file and the field.
      assert.match(output, /does not match collection schema/);
      assert.match(output, /zz-gate-invalid/);
      assert.ok(
        output.includes(`${field}`),
        `expected the error to name the field "${field}"\n${output}`,
      );
    } finally {
      rmSync(invalidFile, { force: true });
    }
  });
}

test("build succeeds with only the real markuli entry and renders its Card", () => {
  const result = buildOnce();
  assert.equal(
    result.status,
    0,
    `astro build failed\n${result.stdout}\n${result.stderr}`,
  );

  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  assert.ok(html.includes("Hemang Khatri"), "expected the name tile");
  assert.ok(html.includes("markuli"), "expected the markuli Card");
  assert.ok(html.includes("<article"), "expected an article Card");
  assert.ok(
    html.includes(
      'href="https://github.com/khatrihemang07/markuli/releases/latest"',
    ),
    "expected the Download link to the latest release",
  );
  assert.ok(
    html.includes('href="https://github.com/khatrihemang07/markuli"'),
    "expected the Source link",
  );
});

describe("built Site with three Cards", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const html = () => readFileSync(join(root, "dist", "index.html"), "utf8");
  const articles = () => html().match(/<article[\s\S]*?<\/article>/g) ?? [];
  const cardOf = (name) =>
    articles().find((article) => article.includes(`<h3>${name}</h3>`)) ?? "";
  const downloadLinks = () =>
    [
      ...html().matchAll(/<a [^>]*href="([^"]+)"[^>]*>\s*Download\s*<\/a>/g),
    ].map((match) => match[1]);

  test("exactly 3 article Cards", () => {
    assert.equal(html().match(/<article[\s>]/g)?.length, 3);
  });

  test("Cards are ordered markuli, Mnemora, localAIWrapper", () => {
    const page = html();
    const at = (name) => page.indexOf(`<h3>${name}</h3>`);
    assert.ok(at("markuli") > -1, "expected a markuli Card");
    assert.ok(at("Mnemora") > at("markuli"), "expected Mnemora after markuli");
    assert.ok(
      at("localAIWrapper") > at("Mnemora"),
      "expected localAIWrapper after Mnemora",
    );
  });

  test("exactly 2 Download links, to the exact latest-release URLs of markuli and Mnemora", () => {
    assert.deepEqual(downloadLinks(), [
      "https://github.com/khatrihemang07/markuli/releases/latest",
      "https://github.com/khatrihemang07/Mnemora_v1/releases/latest",
    ]);
  });

  test("localAIWrapper has no Download link", () => {
    assert.doesNotMatch(cardOf("localAIWrapper"), />\s*Download\s*</);
  });

  test("every target=_blank link also has rel=noopener", () => {
    const blankLinks = html().match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
    assert.equal(
      blankLinks.length,
      6,
      "expected 3 Source, 2 Download and the GitHub link",
    );
    for (const link of blankLinks) {
      assert.match(link, /rel="noopener"/, `missing rel="noopener": ${link}`);
    }
  });

  test("each Card has exactly one img", () => {
    for (const article of articles()) {
      assert.equal(article.match(/<img[\s>]/g)?.length, 1);
    }
  });

  test("each Card's picture offers AVIF and WebP at 480w, 960w and 1440w", () => {
    for (const article of articles()) {
      for (const type of ["image/avif", "image/webp"]) {
        const source = article
          .match(/<source[^>]*>/g)
          ?.find((tag) => tag.includes(`type="${type}"`));
        assert.ok(source, `expected a ${type} source in a Card`);
        for (const width of ["480w", "960w", "1440w"]) {
          assert.match(
            source,
            new RegExp(`\\s${width}[,"]`),
            `${type} is missing ${width}`,
          );
        }
      }
    }
  });

  test("the first img is eager and the other two are lazy", () => {
    const loading = articles().map(
      (article) => article.match(/<img[^>]*loading="([^"]+)"/)?.[1],
    );
    assert.deepEqual(loading, ["eager", "lazy", "lazy"]);
  });

  test("localAIWrapper text does not mention subscriptions or API keys", () => {
    const text = cardOf("localAIWrapper").toLowerCase();
    assert.ok(!text.includes("subscription"), "found the word subscription");
    assert.ok(!/api key/.test(text), "found the words API key");
  });
});

const page = () => readFileSync(join(root, "dist", "index.html"), "utf8");
const textOf = (fragment) =>
  fragment
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
const linkTags = () => page().match(/<link\b[^>]*>/g) ?? [];
const builtCss = () =>
  [
    ...linkTags()
      .filter((tag) => /rel="stylesheet"/.test(tag))
      .map((tag) =>
        readFileSync(
          join(root, "dist", tag.match(/href="([^"]+)"/)[1]),
          "utf8",
        ),
      ),
    ...[...page().matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
      (match) => match[1],
    ),
  ].join("\n");
// Built CSS is minified, so media rules are read by brace matching.
const mediaBlocks = (css, condition) => {
  const blocks = [];
  const flat = css.replace(/\s+/g, "");
  const needle = `@media${condition.replace(/\s+/g, "")}{`;
  let at = flat.indexOf(needle);
  while (at > -1) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < flat.length; end++) {
      if (flat[end] === "{") depth++;
      if (flat[end] === "}" && --depth === 0) break;
    }
    blocks.push(flat.slice(at + needle.length, end));
    at = flat.indexOf(needle, end);
  }
  return blocks;
};
// Hoisted Astro scripts are usually inlined, but external module files are read too.
const builtJs = () =>
  [
    ...[...page().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1],
    ),
    ...[...page().matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((match) =>
      readFileSync(join(root, "dist", match[1]), "utf8"),
    ),
  ].join("\n");

describe("built full page: look, feel and content", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const sectionOf = (id) =>
    page().match(
      new RegExp(`<section[^>]*\\sid="${id}"[\\s\\S]*?</section>`),
    )?.[0] ?? "";
  const visibleText = () =>
    textOf(
      page()
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, ""),
    );

  test("exactly one h1, and its text is Hemang Khatri", () => {
    const headings = [...page().matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(
      (match) => textOf(match[1]),
    );
    assert.deepEqual(headings, ["Hemang Khatri"]);
  });

  test("the lede is the approved text", () => {
    assert.ok(
      page().includes(
        "I build fast, small tools: native apps and the backends behind them. Backend engineer by day, Rust tinkerer by night.",
      ),
      "expected the approved lede",
    );
  });

  test("the Call to Action reads Available for work and projects and links to #contact", () => {
    const link = (page().match(/<a\b[\s\S]*?<\/a>/g) ?? []).find(
      (anchor) => textOf(anchor) === "Available for work and projects",
    );
    assert.ok(link, "expected a link with the Call to Action text");
    assert.match(link, /href="#contact"/);
  });

  test("two Stat Tiles: 3 public projects, and Rust · Go · TS what I build with", () => {
    const values = [
      ...page().matchAll(/<[^>]*class="stat-value"[^>]*>([\s\S]*?)<\/[^>]+>/g),
    ].map((match) => textOf(match[1]));
    const labels = [
      ...page().matchAll(/<[^>]*class="stat-label"[^>]*>([\s\S]*?)<\/[^>]+>/g),
    ].map((match) => textOf(match[1]));
    assert.deepEqual(values, ["3", "Rust · Go · TS"]);
    assert.deepEqual(labels, ["public projects", "what I build with"]);
  });

  test("sections work, about and contact exist with their headings", () => {
    for (const [id, heading] of [
      ["work", "Selected work"],
      ["about", "About"],
      ["contact", "Say hello"],
    ]) {
      const section = sectionOf(id);
      assert.ok(section, `expected a section with id ${id}`);
      assert.deepEqual(
        [...section.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((match) =>
          textOf(match[1]),
        ),
        [heading],
      );
    }
  });

  test("About has the approved text", () => {
    assert.ok(
      sectionOf("about").includes(
        "I like software that starts instantly, keeps your data on your own device and does one job well. By day I build event-driven financial-data pipelines in Go. On my own time I make local-first apps in Rust and TypeScript.",
      ),
    );
  });

  test("the Timeline has exactly the three approved lines", () => {
    const items = [
      ...sectionOf("about").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g),
    ].map((match) => textOf(match[1]));
    assert.deepEqual(items, [
      "Shiprocket · Software Engineer, 2025 - now",
      "IIT Kanpur · M.Tech, Computer Science",
      "GEC Gandhinagar · B.E., Computer Engineering",
    ]);
  });

  test("the email address is never a plain string in the HTML", () => {
    assert.ok(!page().includes("khatrihemang07@gmail.com"));
    assert.doesNotMatch(page(), /@gmail/);
  });

  test("the email is a mailto mechanism with a real Copy button", () => {
    assert.match(page(), /mailto:/, "expected a mailto mechanism");
    const contact = sectionOf("contact");
    assert.match(contact, /data-mail-user="khatrihemang07"/);
    assert.match(contact, /data-mail-domain="gmail\.com"/);
    const copy = contact.match(/<button\b[^>]*>\s*Copy\s*<\/button>/)?.[0];
    assert.ok(copy, "expected a Copy button in Contact");
    assert.match(copy, /type="button"/);
  });

  test("a noscript fallback shows the address obfuscated", () => {
    const noscript =
      page().match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
    assert.ok(
      noscript.includes("khatrihemang07 [at] gmail [dot] com"),
      "expected the obfuscated address in a noscript fallback",
    );
  });

  test("the GitHub link opens in a new tab with noopener", () => {
    const link = (page().match(/<a\b[^>]*>/g) ?? []).find((tag) =>
      tag.includes('href="https://github.com/khatrihemang07"'),
    );
    assert.ok(link, "expected a GitHub link");
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="[^"]*noopener[^"]*"/);
  });

  test("no tel: link, no phone-like number, no resume or CV link", () => {
    assert.doesNotMatch(page(), /href="tel:/i);
    assert.doesNotMatch(
      visibleText(),
      /\+?\d[\d ().-]{6,}\d/,
      "expected no phone-like number in the visible text",
    );
    for (const anchor of page().match(/<a\b[\s\S]*?<\/a>/g) ?? []) {
      assert.doesNotMatch(
        anchor,
        /r[ée]sum[ée]|resume|\bcv\b/i,
        `unexpected link: ${anchor}`,
      );
    }
  });

  test("an inline head script reads localStorage and sets data-theme, before any stylesheet or body", () => {
    const html = page();
    const script = [
      ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
    ].find((match) => match[1].includes("localStorage"));
    assert.ok(script, "expected an inline script that reads localStorage");
    assert.match(script[1], /data-theme|dataset\.theme/);
    assert.ok(
      script.index < html.indexOf("</head>"),
      "expected the script in <head>",
    );
    const later = [
      html.indexOf('rel="stylesheet"'),
      html.indexOf("<style"),
      html.indexOf("<body"),
    ].filter((index) => index > -1);
    assert.ok(
      later.every((index) => script.index < index),
      "expected the theme script before any stylesheet or body content",
    );
  });

  test("built CSS has dark mode, reduced motion and backdrop-filter", () => {
    const css = builtCss();
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /backdrop-filter:/);
  });

  test("no request to a third-party font or style host", () => {
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
      assert.ok(!page().includes(host), `found ${host} in the HTML`);
      assert.ok(!builtCss().includes(host), `found ${host} in the CSS`);
    }
    assert.doesNotMatch(
      page(),
      /<(link|script|img|source)\b(?![^>]*rel="canonical")[^>]*\s(href|src|srcset)="https?:\/\//,
    );
    assert.doesNotMatch(builtCss(), /url\(\s*["']?https?:/);
  });

  test("at least one woff2 font is preloaded with crossorigin", () => {
    const preloads = linkTags().filter(
      (tag) =>
        /rel="preload"/.test(tag) &&
        /as="font"/.test(tag) &&
        /\.woff2"/.test(tag) &&
        /crossorigin/.test(tag),
    );
    assert.ok(
      preloads.length >= 1 && preloads.length <= 2,
      `found ${preloads.length}`,
    );
  });

  test("every font-face uses font-display: swap and the latin subset", () => {
    const faces = builtCss().split("@font-face").slice(1);
    assert.ok(
      faces.length >= 2,
      "expected at least a Fraunces and an Inter face",
    );
    for (const face of faces) {
      const block = face.slice(0, face.indexOf("}"));
      assert.match(block, /font-display:\s*swap/);
      assert.doesNotMatch(block, /U\+0100/, "found a latin-ext unicode-range");
    }
  });
});

describe("built navigation: Dock and Ruler", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const navOf = (label) =>
    page().match(
      new RegExp(`<nav[^>]*aria-label="${label}"[\\s\\S]*?</nav>`),
    )?.[0] ?? "";
  const hrefsOf = (nav) =>
    [...nav.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((match) => match[1]);
  const articleIds = () =>
    [...page().matchAll(/<article\b[^>]*\sid="([^"]+)"/g)].map(
      (match) => match[1],
    );
  const idCount = (id) =>
    [...page().matchAll(/\sid="([^"]+)"/g)].filter((match) => match[1] === id)
      .length;

  test("the Dock is a nav with exactly four links to top, work, about, contact in order", () => {
    assert.deepEqual(hrefsOf(navOf("Dock")), [
      "#top",
      "#work",
      "#about",
      "#contact",
    ]);
  });

  test("the Dock has one theme button with an accessible name containing theme", () => {
    const buttons = navOf("Dock").match(/<button\b[^>]*>/g) ?? [];
    assert.equal(buttons.length, 1, "expected exactly one button in the Dock");
    assert.match(buttons[0], /type="button"/);
    assert.match(buttons[0], /aria-label="[^"]*theme[^"]*"/i);
  });

  test("the Ruler is a nav with seven ticks: top, work, three projects, about, contact", () => {
    assert.deepEqual(hrefsOf(navOf("Ruler")), [
      "#top",
      "#work",
      "#project-markuli",
      "#project-mnemora",
      "#project-localaiwrapper",
      "#about",
      "#contact",
    ]);
  });

  test("every Dock and Ruler target id exists exactly once in the HTML", () => {
    const targets = [...hrefsOf(navOf("Dock")), ...hrefsOf(navOf("Ruler"))];
    // Guard against passing vacuously while the navs are missing.
    assert.equal(targets.length, 11, "expected 4 Dock and 7 Ruler targets");
    for (const href of targets) {
      const id = href.slice(1);
      assert.equal(
        idCount(id),
        1,
        `expected exactly one element with id ${id}`,
      );
    }
  });

  test("the top of the page is id top, and each Card article carries its project id", () => {
    assert.equal(idCount("top"), 1);
    assert.deepEqual(articleIds(), [
      "project-markuli",
      "project-mnemora",
      "project-localaiwrapper",
    ]);
  });

  test("the built CSS hides the Ruler in a max-width media query under 860px", () => {
    // The minifier may write the range as (width<=859.98px); both spellings are the same query.
    const blocks = [
      ...mediaBlocks(builtCss(), "(max-width: 859.98px)"),
      ...mediaBlocks(builtCss(), "(width<=859.98px)"),
    ];
    assert.ok(
      blocks.some((block) => block.includes(".ruler{display:none}")),
      "expected .ruler{display:none} inside @media (max-width: 859.98px)",
    );
  });

  test("reduced motion turns off the Dock highlight, Ruler ticks and smooth scrolling", () => {
    const blocks = mediaBlocks(
      builtCss(),
      "(prefers-reduced-motion: reduce)",
    ).join("");
    assert.ok(
      blocks.includes(".dock-highlight"),
      "expected the Dock highlight",
    );
    assert.ok(blocks.includes(".tick-bar"), "expected the Ruler tick bars");
    assert.ok(
      blocks.includes("scroll-behavior:auto"),
      "expected scroll-behavior: auto",
    );
  });

  test("the page reserves bottom padding of at least 5rem for the Dock", () => {
    const css = builtCss().replace(/\s+/g, "");
    const clearance = css.match(/--dock-clearance:([\d.]+)rem/);
    assert.ok(clearance, "expected a --dock-clearance token in rem");
    assert.ok(
      Number(clearance[1]) >= 5,
      `clearance ${clearance[1]}rem is under 5rem`,
    );
    const mainRules = [...css.matchAll(/[{}]main\{([^}]*)\}/g)].map(
      (match) => match[1],
    );
    assert.ok(
      mainRules.some((rule) => rule.includes("var(--dock-clearance)")),
      "expected main padding to use --dock-clearance",
    );
  });

  test("the bundled navigation script writes localStorage key theme", () => {
    // The minifier may use quotes or template literals for the key.
    assert.match(builtJs(), /localStorage\.setItem\(\s*["'`]theme["'`]/);
  });
});

// Release output: metadata, 404, sitemap, robots, headers and the transfer budget.
const SITE = "https://hemangkhatri.pages.dev";
const distPath = (...parts) => join(root, "dist", ...parts);
const readDist = (...parts) => readFileSync(distPath(...parts), "utf8");

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function runFullBuild() {
  return spawnSync("pnpm", ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    timeout: 240_000,
  });
}

// The attribute order follows the page source, so match the attribute by name.
function metaTags(html) {
  return html.match(/<meta\b[^>]*>/g) ?? [];
}
function metaContent(html, attribute, value) {
  const tag = metaTags(html).find((meta) =>
    new RegExp(`\\s${attribute}="${value}"`).test(meta),
  );
  return tag?.match(/\scontent="([^"]*)"/)?.[1];
}

// A _headers block is a path line followed by indented "Name: value" lines.
function parseHeaders(text) {
  const blocks = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      blocks.set(current, new Map());
      continue;
    }
    const at = line.indexOf(":");
    blocks
      .get(current)
      ?.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  return blocks;
}

function parseCsp(csp) {
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

// CSP source expressions are quoted, so the token is 'sha256-...'.
const sha256 = (text) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// Inline blocks are the ones the browser runs or applies without a request.
function inlineScriptTexts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(
      ([, attrs]) =>
        !/\ssrc=/.test(attrs) && !/type="application\/ld\+json"/.test(attrs),
    )
    .map(([, , text]) => text);
}
function inlineStyleTexts(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
    ([, text]) => text,
  );
}

describe("launch hardening: built release output", () => {
  before(() => {
    const result = runFullBuild();
    assert.equal(
      result.status,
      0,
      `pnpm run build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const htmlFiles = () =>
    walkFiles(join(root, "dist")).filter((file) => file.endsWith(".html"));
  const headerBlocks = () => {
    assert.ok(existsSync(distPath("_headers")), "expected dist/_headers");
    return parseHeaders(readDist("_headers"));
  };
  const globalHeaders = () => headerBlocks().get("/*") ?? new Map();
  const csp = () => globalHeaders().get("content-security-policy") ?? "";
  const head = () => readDist("index.html");

  test("_headers exists in dist and has an /_astro/* block", () => {
    assert.ok(headerBlocks().has("/_astro/*"), "expected an /_astro/* block");
  });

  test("hashed assets are cached for a year and immutable", () => {
    assert.equal(
      headerBlocks().get("/_astro/*")?.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  });

  test("the catch-all block sets no Cache-Control, so it cannot merge into the immutable rule", () => {
    assert.equal(globalHeaders().get("cache-control"), undefined);
  });

  test("every page gets nosniff, frame denial, a referrer policy and a permissions policy", () => {
    const headers = globalHeaders();
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(
      headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    assert.equal(
      headers.get("permissions-policy"),
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });

  test("the CSP lists the hash of every inline script and style in every built HTML file, 404 included", () => {
    const directives = parseCsp(csp());
    const scriptTokens = new Set(directives.get("script-src") ?? []);
    const styleTokens = new Set(directives.get("style-src") ?? []);
    const pages = htmlFiles();
    assert.ok(
      pages.some((file) => file.endsWith("404.html")),
      "expected 404.html",
    );
    let scriptHashes = 0;
    let styleHashes = 0;
    for (const file of pages) {
      const html = readFileSync(file, "utf8");
      for (const text of inlineScriptTexts(html)) {
        scriptHashes++;
        assert.ok(
          scriptTokens.has(sha256(text)),
          `${file}: inline script hash missing from script-src`,
        );
      }
      for (const text of inlineStyleTexts(html)) {
        styleHashes++;
        assert.ok(
          styleTokens.has(sha256(text)),
          `${file}: inline style hash missing from style-src`,
        );
      }
    }
    // Guard against passing vacuously: the no-flash theme script must exist.
    assert.ok(scriptHashes >= 1, "expected at least one inline script");
    assert.ok(styleHashes + scriptHashes >= 1, "expected inline blocks");
  });

  test("the CSP has exactly the approved directives", () => {
    const directives = parseCsp(csp());
    assert.deepEqual([...directives.keys()].sort(), [
      "base-uri",
      "connect-src",
      "default-src",
      "font-src",
      "form-action",
      "frame-ancestors",
      "img-src",
      "object-src",
      "script-src",
      "style-src",
      "style-src-attr",
    ]);
    assert.deepEqual(directives.get("default-src"), ["'self'"]);
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:"]);
    assert.deepEqual(directives.get("font-src"), ["'self'"]);
    assert.deepEqual(directives.get("connect-src"), [
      "'self'",
      "https://cloudflareinsights.com",
    ]);
    assert.deepEqual(directives.get("object-src"), ["'none'"]);
    assert.deepEqual(directives.get("base-uri"), ["'none'"]);
    assert.deepEqual(directives.get("form-action"), ["'none'"]);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(directives.get("style-src-attr"), ["'unsafe-inline'"]);
    for (const [name, allowed] of [
      ["script-src", ["'self'", "https://static.cloudflareinsights.com"]],
      ["style-src", ["'self'"]],
    ]) {
      const tokens = directives.get(name) ?? [];
      for (const token of allowed) {
        assert.ok(tokens.includes(token), `${name} is missing ${token}`);
      }
      for (const token of tokens) {
        assert.ok(
          allowed.includes(token) || token.startsWith("'sha256-"),
          `${name} has an unexpected token ${token}`,
        );
      }
    }
  });

  test("script-src never allows unsafe-inline or unsafe-eval, and nothing allows unsafe-eval", () => {
    const scripts = parseCsp(csp()).get("script-src") ?? [];
    assert.ok(
      !scripts.includes("'unsafe-inline'"),
      "script-src has unsafe-inline",
    );
    assert.ok(!csp().includes("'unsafe-eval'"), "the CSP has unsafe-eval");
  });

  test("the built HTML has no inline event handler attributes", () => {
    for (const file of htmlFiles()) {
      assert.doesNotMatch(
        readFileSync(file, "utf8"),
        /\son[a-z]+="/i,
        `${file} has an inline event handler`,
      );
    }
  });

  test("hashed assets exist under /_astro/", () => {
    assert.ok(existsSync(join(root, "dist", "_astro")), "expected dist/_astro");
  });

  test("404.html, sitemap.xml, robots.txt, favicon.svg and og.png exist in dist", () => {
    for (const file of [
      "404.html",
      "sitemap.xml",
      "robots.txt",
      "favicon.svg",
      "og.png",
    ]) {
      assert.ok(existsSync(distPath(file)), `expected dist/${file}`);
    }
  });

  test("index.html has exactly one canonical link to the home URL", () => {
    const canonicals = head().match(/<link\b[^>]*rel="canonical"[^>]*>/g) ?? [];
    assert.equal(canonicals.length, 1, "expected exactly one canonical");
    assert.match(canonicals[0], new RegExp(`href="${SITE}/"`));
  });

  test("the title and description are the approved Metadata", () => {
    assert.ok(
      head().includes(
        "<title>Hemang Khatri · Backend engineer and app builder</title>",
      ),
      "expected the approved title",
    );
    assert.equal(
      metaContent(head(), "name", "description"),
      "Portfolio of Hemang Khatri: fast native apps and backend tools, including markuli, Mnemora and localAIWrapper.",
    );
  });

  test("Open Graph tags are complete, with an absolute https image", () => {
    const page = head();
    assert.equal(metaContent(page, "property", "og:type"), "website");
    assert.equal(
      metaContent(page, "property", "og:title"),
      "Hemang Khatri · Backend engineer and app builder",
    );
    assert.equal(
      metaContent(page, "property", "og:description"),
      "Portfolio of Hemang Khatri: fast native apps and backend tools, including markuli, Mnemora and localAIWrapper.",
    );
    assert.equal(metaContent(page, "property", "og:url"), `${SITE}/`);
    const images = metaTags(page).filter((tag) =>
      /property="og:image"/.test(tag),
    );
    assert.equal(images.length, 1, "expected exactly one og:image");
    assert.equal(metaContent(page, "property", "og:image"), `${SITE}/og.png`);
    assert.equal(metaContent(page, "property", "og:image:width"), "1200");
    assert.equal(metaContent(page, "property", "og:image:height"), "630");
    assert.equal(
      metaContent(page, "property", "og:image:alt"),
      "Hemang Khatri: fast native apps and the backends behind them. markuli, Mnemora, localAIWrapper.",
    );
  });

  test("Twitter card is summary_large_image with title, description and image", () => {
    const page = head();
    assert.equal(
      metaContent(page, "name", "twitter:card"),
      "summary_large_image",
    );
    assert.ok(
      metaContent(page, "name", "twitter:title"),
      "expected twitter:title",
    );
    assert.ok(
      metaContent(page, "name", "twitter:description"),
      "expected twitter:description",
    );
    assert.equal(metaContent(page, "name", "twitter:image"), `${SITE}/og.png`);
  });

  test("theme-color is set for light and dark through media attributes", () => {
    const themeColors = metaTags(head()).filter((tag) =>
      /name="theme-color"/.test(tag),
    );
    assert.equal(themeColors.length, 2, "expected two theme-color metas");
    assert.ok(
      themeColors.some(
        (tag) =>
          tag.includes('content="#fbf9ff"') &&
          tag.includes('media="(prefers-color-scheme: light)"'),
      ),
      "expected the light theme-color",
    );
    assert.ok(
      themeColors.some(
        (tag) =>
          tag.includes('content="#0d0a1c"') &&
          tag.includes('media="(prefers-color-scheme: dark)"'),
      ),
      "expected the dark theme-color",
    );
  });

  test("the SVG favicon is linked", () => {
    assert.ok(
      head().includes(
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg"',
      ),
      "expected the SVG favicon link",
    );
  });

  test("favicon.svg is paths only: a gradient and an H, with no text or fonts", () => {
    const svg = readDist("favicon.svg");
    assert.match(svg, /<svg\b/);
    assert.match(svg, /linearGradient/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<text\b|font-family|@font-face/i);
  });

  test("the Person JSON-LD parses, has exactly the approved keys, and no email or phone", () => {
    const blocks = [
      ...head().matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    assert.equal(blocks.length, 1, "expected one JSON-LD block");
    const data = JSON.parse(blocks[0][1]);
    assert.deepEqual(Object.keys(data).sort(), [
      "@context",
      "@type",
      "jobTitle",
      "name",
      "sameAs",
      "url",
    ]);
    assert.equal(data["@type"], "Person");
    assert.equal(data.name, "Hemang Khatri");
    assert.equal(data.jobTitle, "Software Engineer");
    assert.equal(data.url, `${SITE}/`);
    assert.deepEqual(data.sameAs, ["https://github.com/khatrihemang07"]);
    assert.doesNotMatch(blocks[0][1], /email|telephone|mailto:/i);
    assert.doesNotMatch(blocks[0][1], /\+?\d[\d ().-]{6,}\d/);
  });

  test("the 404 page is branded, noindex, and links home with the approved copy", () => {
    const page = readDist("404.html");
    assert.equal(metaContent(page, "name", "robots"), "noindex");
    const heading = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    assert.equal(heading.replace(/<[^>]*>/g, "").trim(), "Nothing here.");
    assert.match(page, /<a [^>]*href="\/"[^>]*>\s*Back to the work\.\s*<\/a>/);
    assert.match(page, /class="[^"]*\btile\b[^"]*"/, "expected a glass tile");
  });

  test("sitemap.xml is a valid sitemap with the home URL only and no lastmod", () => {
    const xml = readDist("sitemap.xml");
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(
      xml,
      /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
    );
    assert.equal(xml.match(/<url>/g)?.length, 1, "expected one url entry");
    assert.ok(xml.includes(`<loc>${SITE}/</loc>`), "expected the home URL");
    assert.doesNotMatch(xml, /lastmod/);
  });

  test("robots.txt allows all crawlers and points at the sitemap", () => {
    const robots = readDist("robots.txt");
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Allow: \/$/m);
    assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, "m"));
  });

  test("transfer budget: gzip (level 9) of dist html, css, js and woff2 is at most 150,000 bytes", () => {
    const files = walkFiles(join(root, "dist")).filter((file) =>
      /\.(html|css|js|woff2)$/.test(file),
    );
    const sizes = files.map((file) => [
      file.slice(join(root, "dist").length + 1),
      gzipSync(readFileSync(file), { level: 9 }).length,
    ]);
    const total = sizes.reduce((sum, [, size]) => sum + size, 0);
    assert.ok(
      total <= 150_000,
      `transfer is ${total} bytes gzip, over the 150,000 budget:\n${sizes
        .map(([name, size]) => `${size}\t${name}`)
        .join("\n")}`,
    );
  });
});
