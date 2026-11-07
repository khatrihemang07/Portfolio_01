import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

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

describe("built full page: look, feel and content", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const page = () => readFileSync(join(root, "dist", "index.html"), "utf8");
  const textOf = (fragment) =>
    fragment
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const sectionOf = (id) =>
    page().match(
      new RegExp(`<section[^>]*\\sid="${id}"[\\s\\S]*?</section>`),
    )?.[0] ?? "";
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
      /<(link|script|img|source)\b[^>]*\s(href|src|srcset)="https?:\/\//,
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
