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

// Slides per Project. The lead is still capturing more real Slides, so one is enough for now.
// TODO: raise MIN_SLIDES to 3 once every Project has its captured Slides (plan: 3 to 5).
const MIN_SLIDES = 1;
const MAX_SLIDES = 5;

// A valid Project entry, as text. Each invalid case swaps in one broken field.
const validProject = ({
  pitch = "pitch: Gate pitch.\n",
  story = 'story:\n  - "Gate story."\n',
  features = 'features:\n  - "One"\n  - "Two"\n  - "Three"\n',
  facts = [1, 2, 3, 4]
    .map((n) => `  - text: "Fact ${n}"\n    source: "Gate source."\n`)
    .join(""),
  hood = 'hood: "Gate hood."\n',
  slides = '  - image: ../../assets/projects/markuli.png\n    alt: "Gate alt text."\n    caption: "Gate caption."\n',
  repo = "repo: https://github.com/example/gate\n",
} = {}) =>
  `name: gate
${pitch}${story}${features}facts:
${facts}${hood}stack: Gate stack
${repo}slides:
${slides}order: 99
`;
const gateSlide = (n) =>
  `  - image: ../../assets/projects/markuli.png\n    alt: "Alt ${n}."\n    caption: "Caption ${n}."\n`;

const invalidCases = [
  [
    "only three Facts",
    validProject({
      facts: [1, 2, 3]
        .map((n) => `  - text: "Fact ${n}"\n    source: "Gate source."\n`)
        .join(""),
    }),
    "facts",
  ],
  [
    "five Facts",
    validProject({
      facts: [1, 2, 3, 4, 5]
        .map((n) => `  - text: "Fact ${n}"\n    source: "Gate source."\n`)
        .join(""),
    }),
    "facts",
  ],
  [
    "a Slide with empty alt",
    validProject({
      slides:
        '  - image: ../../assets/projects/markuli.png\n    alt: ""\n    caption: "Gate caption."\n',
    }),
    "slides.0.alt",
  ],
  [
    "a Slide with empty caption",
    validProject({
      slides:
        '  - image: ../../assets/projects/markuli.png\n    alt: "Gate alt."\n    caption: ""\n',
    }),
    "slides.0.caption",
  ],
  ["no Slides", validProject({ slides: "  []\n" }), "slides"],
  [
    "six Slides",
    validProject({ slides: [1, 2, 3, 4, 5, 6].map(gateSlide).join("") }),
    "slides",
  ],
  ["an empty story", validProject({ story: "story: []\n" }), "story"],
  [
    "a blank story paragraph",
    validProject({ story: 'story:\n  - ""\n' }),
    "story.0",
  ],
  [
    "only two features",
    validProject({ features: 'features:\n  - "One"\n  - "Two"\n' }),
    "features",
  ],
  ["a missing hood", validProject({ hood: "" }), "hood"],
  ["missing pitch", validProject({ pitch: "" }), "pitch"],
  [
    "a Fact with a missing source",
    validProject({
      facts: `  - text: "Fact 1"\n  - text: "Fact 2"\n    source: "s"\n  - text: "Fact 3"\n    source: "s"\n  - text: "Fact 4"\n    source: "s"\n`,
    }),
    "facts.0.source",
  ],
  ["an invalid repo URL", validProject({ repo: "repo: not a url\n" }), "repo"],
];

test("a Project with the maximum number of Slides is accepted by the schema", () => {
  try {
    writeFileSync(
      invalidFile,
      validProject({
        slides: Array.from({ length: MAX_SLIDES }, (_, i) =>
          gateSlide(i + 1),
        ).join(""),
      }),
    );
    const result = runBuild();
    assert.equal(
      result.status,
      0,
      `five Slides must be valid\n${result.stdout}\n${result.stderr}`,
    );
  } finally {
    rmSync(invalidFile, { force: true });
  }
});

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

test("no Showcase Image alt text is still a placeholder", () => {
  for (const file of readdirSync(contentDir)) {
    const text = readFileSync(join(contentDir, file), "utf8");
    assert.doesNotMatch(
      text,
      /^\s*(?:-\s+)?alt:\s*"?placeholder/im,
      `${file} still has a placeholder alt text`,
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

test("build succeeds with the real Projects and renders markuli's Project Block", () => {
  const result = buildOnce();
  assert.equal(
    result.status,
    0,
    `astro build failed\n${result.stdout}\n${result.stderr}`,
  );

  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  assert.ok(html.includes("Hemang Khatri"), "expected the name");
  assert.ok(html.includes("markuli"), "expected the markuli Project Block");
  assert.ok(html.includes("<article"), "expected an article Project Block");
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

const FACTS = {
  markuli: [
    "1.6 MB download",
    "11 MB idle RAM (Draw Mode off)",
    "0% idle CPU",
    "5 tools · 5 colours · 3 widths",
  ],
  Mnemora: [
    "Mac + Android",
    "1 SQLite file holds everything",
    "6.4 MB Mac download",
    "Journal and Todo work offline, no account",
  ],
  localAIWrapper: [
    "1 process per request",
    "Streaming and JSON-schema output",
    "3 CLI backends",
    "OpenAI chat-completions format",
  ],
};

describe("built Site with three Project Blocks", () => {
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
  const blockOf = (name) =>
    articles().find((article) => article.includes(`>${name}</h3>`)) ?? "";
  const downloadLinks = () =>
    [
      ...html().matchAll(/<a [^>]*href="([^"]+)"[^>]*>\s*Download\s*<\/a>/g),
    ].map((match) => match[1]);
  const attr = (tag, name) =>
    tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

  test("exactly 3 article Project Blocks", () => {
    assert.equal(html().match(/<article[\s>]/g)?.length, 3);
  });

  test("Project Blocks are ordered markuli, Mnemora, localAIWrapper", () => {
    const names = articles().map(
      (article) => article.match(/<h3[^>]*>([^<]*)<\/h3>/)?.[1],
    );
    assert.deepEqual(names, ["markuli", "Mnemora", "localAIWrapper"]);
  });

  test("exactly 2 Download links, to the exact latest-release URLs of markuli and Mnemora", () => {
    assert.deepEqual(downloadLinks(), [
      "https://github.com/khatrihemang07/markuli/releases/latest",
      "https://github.com/khatrihemang07/Mnemora_v1/releases/latest",
    ]);
  });

  test("localAIWrapper has no Download link", () => {
    assert.doesNotMatch(blockOf("localAIWrapper"), />\s*Download\s*</);
  });

  test("every target=_blank link also has rel=noopener", () => {
    const blankLinks = html().match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
    assert.equal(
      blankLinks.length,
      7,
      "expected 3 Source, 2 Download, the Contact GitHub link and the See more link",
    );
    for (const link of blankLinks) {
      assert.match(link, /rel="noopener"/, `missing rel="noopener": ${link}`);
    }
  });

  test("each Project Block has a tablist of Story, Features and Under the hood tabs", () => {
    for (const name of Object.keys(FACTS)) {
      const block = blockOf(name);
      assert.match(block, /<[a-z]+[^>]*role="tablist"/, `${name}: no tablist`);
      const tabs =
        block.match(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g) ?? [];
      assert.deepEqual(
        tabs.map(textOf),
        ["Story", "Features", "Under the hood"],
        `${name}: tabs`,
      );
    }
  });

  test("tabs and tabpanels are wired with aria-controls and aria-labelledby, with the first tab the only one in the tab order", () => {
    const allIds = [...html().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    for (const name of Object.keys(FACTS)) {
      const block = blockOf(name);
      const tabs = block.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
      const panels = block.match(/<[a-z]+[^>]*role="tabpanel"[^>]*>/g) ?? [];
      assert.equal(tabs.length, 3, `${name}: tabs`);
      assert.equal(panels.length, 3, `${name}: tabpanels`);
      tabs.forEach((tab, i) => {
        const panel = panels[i];
        assert.equal(
          attr(tab, "aria-controls"),
          attr(panel, "id"),
          `${name}: tab ${i} controls its panel`,
        );
        assert.equal(
          attr(panel, "aria-labelledby"),
          attr(tab, "id"),
          `${name}: panel ${i} is labelled by its tab`,
        );
        assert.equal(attr(tab, "aria-selected"), i === 0 ? "true" : "false");
        assert.equal(
          attr(tab, "tabindex"),
          i === 0 ? "0" : "-1",
          "roving tabindex",
        );
        for (const id of [attr(tab, "id"), attr(panel, "id")]) {
          assert.equal(
            allIds.filter((x) => x === id).length,
            1,
            `id ${id} is unique`,
          );
        }
      });
    }
  });

  test("without JavaScript every tab panel is visible", () => {
    for (const name of Object.keys(FACTS)) {
      const panels =
        blockOf(name).match(/<[a-z]+[^>]*role="tabpanel"[^>]*>/g) ?? [];
      assert.equal(panels.length, 3);
      for (const panel of panels) {
        assert.doesNotMatch(
          panel,
          /\shidden[\s>=]/,
          `${name}: panel hidden in HTML`,
        );
      }
    }
  });

  test("each Project Block lists exactly its four approved Facts", () => {
    for (const [name, facts] of Object.entries(FACTS)) {
      const list =
        blockOf(name).match(/<ul[^>]*class="facts"[\s\S]*?<\/ul>/)?.[0] ?? "";
      const items = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
        textOf(m[1]),
      );
      assert.deepEqual(items, facts, `${name}: Facts`);
    }
  });

  test("every tab panel is keyboard reachable, so screen-reader users can get into it", () => {
    for (const name of Object.keys(FACTS)) {
      const panels =
        blockOf(name).match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
      assert.equal(panels.length, 3, `${name}: tab panels`);
      for (const panel of panels)
        assert.match(panel, /tabindex="0"/, `${name}: ${panel}`);
    }
  });

  test("a Slide never carries an ARIA role that is invalid on its element (Lighthouse aria-allowed-role)", () => {
    // <figure role="group"> is not allowed; the carousel region already names the set.
    for (const name of Object.keys(FACTS)) {
      for (const figure of blockOf(name).match(/<figure\b[^>]*>/g) ?? []) {
        assert.ok(!/\brole=/.test(figure), `${name}: ${figure}`);
        assert.ok(!/aria-roledescription/.test(figure), `${name}: ${figure}`);
      }
    }
  });

  test(`each Project Block has ${MIN_SLIDES} to ${MAX_SLIDES} Slides, each with an image, non-empty alt and a non-empty caption`, () => {
    for (const name of Object.keys(FACTS)) {
      const figures = blockOf(name).match(/<figure[\s\S]*?<\/figure>/g) ?? [];
      assert.ok(
        figures.length >= MIN_SLIDES && figures.length <= MAX_SLIDES,
        `${name}: ${figures.length} Slides`,
      );
      for (const figure of figures) {
        const img = figure.match(/<img[^>]*>/)?.[0] ?? "";
        assert.ok(img, `${name}: Slide has no img`);
        assert.ok(
          (attr(img, "alt") ?? "").trim().length > 0,
          `${name}: empty alt`,
        );
        assert.ok(
          attr(img, "width") && attr(img, "height"),
          `${name}: img lacks dimensions`,
        );
        const caption =
          figure.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1] ?? "";
        assert.ok(textOf(caption).length > 0, `${name}: empty figcaption`);
      }
    }
  });

  test("each Gallery is a labelled, keyboard-scrollable carousel region", () => {
    for (const name of Object.keys(FACTS)) {
      const region =
        blockOf(name).match(/<[a-z]+[^>]*role="region"[^>]*>/)?.[0] ?? "";
      assert.ok(region, `${name}: no region`);
      assert.equal(attr(region, "aria-roledescription"), "carousel");
      assert.equal(attr(region, "aria-label"), `${name} screenshots`);
      assert.equal(attr(region, "tabindex"), "0");
    }
  });

  test("Gallery controls are rendered hidden, with accessible names, for the script to reveal", () => {
    for (const name of Object.keys(FACTS)) {
      const block = blockOf(name);
      const buttons =
        block.match(/<button[^>]*data-gallery-[a-z]+[^>]*>/g) ?? [];
      const labels = buttons.map((tag) => attr(tag, "aria-label"));
      assert.ok(labels.includes("Previous slide"), `${name}: previous`);
      assert.ok(labels.includes("Next slide"), `${name}: next`);
      assert.ok(labels.includes("Go to slide 1"), `${name}: dot 1`);
      const controls =
        block.match(/<div[^>]*data-gallery-controls[^>]*>/)?.[0] ?? "";
      assert.match(controls, /\shidden/, `${name}: controls start hidden`);
    }
  });

  test("each Slide's picture offers AVIF and WebP at 480w, 960w and 1440w", () => {
    for (const article of articles()) {
      for (const figure of article.match(/<figure[\s\S]*?<\/figure>/g) ?? []) {
        for (const type of ["image/avif", "image/webp"]) {
          const source = figure
            .match(/<source[^>]*>/g)
            ?.find((tag) => tag.includes(`type="${type}"`));
          assert.ok(source, `expected a ${type} source in a Slide`);
          for (const width of ["480w", "960w", "1440w"]) {
            assert.match(
              source,
              new RegExp(`\\s${width}[,"]`),
              `${type} is missing ${width}`,
            );
          }
        }
      }
    }
  });

  test("only the first Slide of the first Project is eager and high priority; every other image is lazy", () => {
    const imgs = [...html().matchAll(/<article[\s\S]*?<\/article>/g)].flatMap(
      (m) => m[0].match(/<img[^>]*>/g) ?? [],
    );
    assert.ok(imgs.length >= 3);
    imgs.forEach((img, i) => {
      assert.equal(
        attr(img, "loading"),
        i === 0 ? "eager" : "lazy",
        `img ${i}`,
      );
      if (i === 0) assert.equal(attr(img, "fetchpriority"), "high");
      else assert.notEqual(attr(img, "fetchpriority"), "high");
    });
  });

  test("each Project Block carries its Source link and a stack line", () => {
    for (const name of Object.keys(FACTS)) {
      assert.match(
        blockOf(name),
        /<a [^>]*href="https:\/\/github\.com\/khatrihemang07\/[^"]+"[^>]*>Source<\/a>/,
      );
    }
  });

  test("localAIWrapper text does not mention subscriptions or API keys", () => {
    const text = blockOf("localAIWrapper").toLowerCase();
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
        "I build AI tools, and I want to understand every layer under them: the model, the code and the machine it all runs on.",
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

  test("the Hero shows one small Hero Chip, Rust · Go · TS · AI, inside the intro, with no project count or Stat Tile", () => {
    const chips = [
      ...page().matchAll(/<li[^>]*class="hero-chip"[^>]*>([\s\S]*?)<\/li>/g),
    ].map((match) => textOf(match[1]));
    assert.deepEqual(chips, ["Rust · Go · TS · AI"]);
    const intro = page().match(
      /<div class="hero-intro[^"]*"[\s\S]*?<\/header>/,
    )?.[0];
    assert.ok(
      intro?.includes("hero-chip"),
      "chips live inside the intro block",
    );
    assert.ok(!/stat-tile|stat-value/.test(page()), "no big Stat Tiles remain");
    assert.doesNotMatch(visibleText(), /public projects?/);
  });

  test("no projectCount plumbing is left in the Hero or the page", () => {
    for (const file of ["components/Hero.astro", "pages/index.astro"]) {
      assert.doesNotMatch(
        readFileSync(join(root, "src", file), "utf8"),
        /projectCount/,
        file,
      );
    }
  });

  test("the bento mosaic is gone from the HTML and the CSS", () => {
    assert.doesNotMatch(page(), /class="[^"]*\b(bento|work-grid|about-grid)\b/);
    assert.doesNotMatch(builtCss(), /\.(bento|work-grid|about-grid)\b/);
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

  test("About is one single-column glass panel with the approved text and the Timeline inside", () => {
    const about = sectionOf("about");
    assert.ok(
      about.includes(
        "Most AI demos are a prompt box. Under a prompt box sits a lot of engineering: which model, how text becomes embeddings, what gets retrieved, when the model should call a tool, and how you'd know any of it is actually good. I care about all of those, and about the fundamentals under them: fast code, clear APIs, honest measurement. That's why I build in Rust and Go and measure my ideas against a baseline, and write up the experiments that failed.",
      ),
    );
    const panels = about.match(/<div[^>]*class="[^"]*\btile\b[^"]*"/g) ?? [];
    assert.equal(panels.length, 1, "one glass panel");
    assert.match(about, /<ul[^>]*class="timeline"/);
    assert.ok(
      about.indexOf("Most AI demos") < about.indexOf('class="timeline"'),
      "the Timeline follows the text",
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
      // A dotted IPv4 address (127.0.0.1 in the localAIWrapper copy) is not a phone number.
      visibleText().replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ""),
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

  test("Bricolage Grotesque and Inter are the preloaded fonts, and Fraunces is gone", () => {
    const preloads = linkTags().filter(
      (tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag),
    );
    const hrefs = preloads.map((tag) => tag.match(/href="([^"]+)"/)[1]);
    assert.ok(
      hrefs.some((h) => /bricolage-grotesque/i.test(h)),
      "Bricolage preload",
    );
    assert.ok(
      hrefs.some((h) => /inter/i.test(h)),
      "Inter preload",
    );
    assert.ok(!/fraunces/i.test(page()), "Fraunces in the HTML");
    assert.ok(!/fraunces/i.test(builtCss()), "Fraunces in the CSS");
    assert.ok(
      !walkFiles(join(root, "dist")).some((f) => /fraunces/i.test(f)),
      "a Fraunces file in dist",
    );
    assert.doesNotMatch(
      readFileSync(join(root, "package.json"), "utf8"),
      /fraunces/i,
    );
    assert.match(builtCss(), /--font-display:\s*"?Bricolage Grotesque/);
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
      "expected at least a Bricolage Grotesque and an Inter face",
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

  test("the top of the page is id top, and each Project Block article carries its project id", () => {
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
const SITE = "https://hemangkhatri.khatrihemang07.workers.dev";
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

// Aurora, glass and motion: what the owner reviewed, checked through the built CSS and HTML.
describe("built look and motion: aurora, glass, reveals and Dock", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const flat = () => builtCss().replace(/\s+/g, "");
  // Every top-level or nested style rule as [selector, body], read from minified CSS.
  const rulesOf = (css) =>
    [...css.matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)].map((match) => [
      match[1],
      match[2],
    ]);
  const ruleBodies = (css, selectorPart) =>
    rulesOf(css)
      .filter(([selector]) => selector.includes(selectorPart))
      .map(([, body]) => body);
  const navOf = (label) =>
    page().match(
      new RegExp(`<nav[^>]*aria-label="${label}"[\\s\\S]*?</nav>`),
    )?.[0] ?? "";

  const rgb = (hex) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const luminance = (channels) => {
    const [r, g, b] = channels.map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort(
      (x, y) => y - x,
    );
    return (hi + 0.05) / (lo + 0.05);
  };
  // Token values for one theme, read from the first rule that declares --muted after the marker.
  const tokensFor = (marker) => {
    const css = flat();
    const start = css.indexOf(marker);
    assert.ok(start > -1, `expected ${marker} in the built CSS`);
    const body = css.slice(start, css.indexOf("}", start));
    const token = (name) =>
      body.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`))?.[1];
    return {
      bg: token("bg"),
      fg: token("fg"),
      muted: token("muted"),
      mesh: ["violet", "pink", "amber", "mint"].map((n) => token(`mesh-${n}`)),
    };
  };

  test("the aurora does not use a fixed background attachment", () => {
    assert.ok(!/background-attachment:fixed/.test(flat()));
  });

  test("the aurora is its own fixed, non-interactive layer behind the page", () => {
    const layers = ruleBodies(flat(), "body:before").concat(
      ruleBodies(flat(), "body::before"),
    );
    assert.ok(layers.length > 0, "expected a body::before aurora layer");
    const layer = layers.join(";");
    assert.match(layer, /position:fixed/);
    assert.match(layer, /inset:0/);
    assert.match(layer, /z-index:-1/);
    assert.match(layer, /pointer-events:none/);
    assert.match(layer, /radial-gradient/);
    assert.match(layer, /will-change:transform|translateZ\(0\)|translate3d/);
  });

  test("the aurora does not animate", () => {
    const layer = [
      ...ruleBodies(flat(), "body:before"),
      ...ruleBodies(flat(), "body::before"),
    ].join(";");
    assert.ok(!/animation/.test(layer), "the aurora must not drift");
  });

  test("backdrop-filter blur is used only on the Dock", () => {
    const blurred = rulesOf(flat()).filter(([, body]) =>
      /backdrop-filter:blur/.test(body),
    );
    assert.ok(blurred.length > 0, "expected the Dock to keep a real blur");
    for (const [selector] of blurred) {
      assert.match(selector, /\.dock-list/, `blur on ${selector}`);
    }
  });

  test("tiles never transition or animate box-shadow, and hover only moves transform", () => {
    for (const [selector, body] of rulesOf(flat())) {
      if (!/\.tile|\.project-block/.test(selector)) continue;
      const transition = body.match(/transition:[^;]*/)?.[0] ?? "";
      assert.ok(
        !/box-shadow|all/.test(transition),
        `${selector} transitions ${transition}`,
      );
    }
    const hover = ruleBodies(flat(), ".tile:hover").join(";");
    assert.match(hover, /transform:/);
    assert.ok(
      !/box-shadow/.test(hover),
      "hover must not set box-shadow on the tile",
    );
  });

  test("the lifted shadow is pre-rendered on a pseudo-element whose opacity is faded", () => {
    const base = ruleBodies(flat(), ".tile:after").concat(
      ruleBodies(flat(), ".tile::after"),
    );
    assert.ok(
      base.some((body) => /box-shadow:/.test(body) && /opacity:0/.test(body)),
    );
    const hover = ruleBodies(flat(), ".tile:hover:after").concat(
      ruleBodies(flat(), ".tile:hover::after"),
    );
    assert.ok(hover.some((body) => /opacity:1/.test(body)));
  });

  test("spring easing is a linear() curve with a cubic-bezier fallback declared first", () => {
    const css = flat();
    const fallback = css.search(/--spring:cubic-bezier\(/);
    const spring = css.search(/--spring:linear\(/);
    assert.ok(fallback > -1, "expected a cubic-bezier --spring fallback");
    assert.ok(spring > fallback, "expected linear() after the fallback");
    assert.match(css, /@supports\(transition-timing-function:linear\(0,1\)\)/);
  });

  test("scroll reveals use view() timelines inside @supports, animating only transform-ish properties and opacity", () => {
    const css = flat();
    assert.match(css, /@supports\(animation-timeline:view\(\)\)/);
    const supports = css.slice(
      css.indexOf("@supports(animation-timeline:view())"),
    );
    assert.match(supports, /animation-timeline:view\(\)/);
    assert.match(supports, /animation-range:/);
    const keyframes = css.match(/@keyframesreveal\{[\s\S]*?\}\}/)?.[0] ?? "";
    assert.ok(keyframes, "expected @keyframes reveal");
    const properties = [...keyframes.matchAll(/([a-z-]+):/g)]
      .map((match) => match[1])
      .filter((name) => name !== "from" && name !== "to");
    for (const name of properties) {
      assert.ok(
        ["opacity", "transform", "translate", "scale"].includes(name),
        `reveal animates ${name}`,
      );
    }
  });

  test("reveals only run when motion is allowed, and are switched off under reduced motion", () => {
    const allowed = mediaBlocks(
      builtCss(),
      "(prefers-reduced-motion: no-preference)",
    ).join("");
    assert.match(allowed, /animation-timeline:view\(\)/);
    const reduced = mediaBlocks(
      builtCss(),
      "(prefers-reduced-motion: reduce)",
    ).join("");
    assert.match(reduced, /\.reveal[^{]*\{[^}]*animation:none/);
  });

  test("below-the-fold glass panels opt in to reveals, the Hero does not", () => {
    const html = page();
    const revealed = [
      ...html.matchAll(/<article\b[^>]*class="([^"]*)"/g),
    ].filter((match) => /\breveal\b/.test(match[1]));
    assert.equal(
      revealed.length,
      3,
      "expected all three Project Blocks to reveal",
    );
    assert.ok(/class="[^"]*\babout-panel\b[^"]*\breveal\b/.test(html));
  });

  test("the Hero name block and the Contact block sit on the aurora with no tile box", () => {
    const html = page();
    const h1Block = html.match(/<div class="([^"]*)"[^>]*>\s*<h1/)?.[1] ?? "";
    assert.ok(h1Block, "expected the block that holds the h1");
    assert.ok(!/\btile\b/.test(h1Block), `h1 block is a tile: ${h1Block}`);
    const contactBlock =
      html.match(/<section id="contact"[^>]*>\s*<div class="([^"]*)"/)?.[1] ??
      "";
    assert.ok(contactBlock);
    assert.ok(
      !/\btile\b/.test(contactBlock),
      `Contact block is a tile: ${contactBlock}`,
    );
    for (const name of [h1Block.split(" ")[0], contactBlock.split(" ")[0]]) {
      for (const body of ruleBodies(flat(), `.${name}`)) {
        assert.ok(
          !/box-shadow|backdrop-filter|border:1px/.test(body),
          `.${name} has a box`,
        );
      }
    }
  });

  test("muted and body text keep WCAG contrast on the page and on every aurora colour, in both themes", () => {
    for (const marker of [
      ":root{",
      ":root[data-theme=dark]{",
      ':root[data-theme="dark"]{',
    ]) {
      if (
        !flat().includes(marker) ||
        !/--mesh-violet/.test(
          flat().slice(
            flat().indexOf(marker),
            flat().indexOf("}", flat().indexOf(marker)),
          ),
        )
      )
        continue;
      const t = tokensFor(marker);
      for (const surface of [t.bg, ...t.mesh]) {
        assert.ok(
          contrast(t.fg, surface) >= 4.5,
          `fg on ${surface} in ${marker}`,
        );
        assert.ok(
          contrast(t.muted, surface) >= 4.5,
          `muted ${t.muted} on ${surface} in ${marker}`,
        );
      }
    }
    assert.ok(
      flat().includes(":root[data-theme=dark]{") ||
        flat().includes(':root[data-theme="dark"]{'),
    );
  });

  test("every Dock link and the theme button carry a tooltip pill that is hidden from assistive tech", () => {
    const dock = navOf("Dock");
    const tips = [
      ...dock.matchAll(/<span class="dock-tip"[^>]*>([^<]*)<\/span>/g),
    ];
    assert.deepEqual(
      tips.map((match) => match[1]),
      ["Top", "Work", "About", "Contact", "Theme"],
    );
    for (const tip of tips) assert.match(tip[0], /aria-hidden="true"/);
    assert.match(dock, /aria-label="Toggle theme"/);
    assert.equal((dock.match(/class="dock-label"/g) ?? []).length, 4);
  });

  test("tooltips appear on hover and focus-visible with opacity and transform only, never blur or pointer events", () => {
    const css = flat();
    const base = ruleBodies(css, ".dock-tip").join(";");
    assert.match(base, /pointer-events:none/);
    assert.match(base, /opacity:0/);
    assert.ok(!/backdrop-filter/.test(base));
    const hoverCapable = mediaBlocks(builtCss(), "(hover: hover)").join("");
    assert.match(
      hoverCapable,
      /:hover\.dock-tip|:hover\s*\.dock-tip|a:hover\.dock-tip/,
    );
    assert.match(flat(), /:focus-visible\.dock-tip/);
    for (const [selector, body] of rulesOf(css)) {
      if (!selector.includes(".dock-tip")) continue;
      const transition = body.match(/transition:[^;]*/)?.[0] ?? "";
      assert.ok(
        /^(transition:)?(opacity|transform|translate|scale|)/.test(
          transition,
        ) && !/width|height|margin|padding|left|top/.test(transition),
        transition,
      );
    }
  });

  test("Hero Chips are quiet: small text, no glass tile, no display-size type", () => {
    const css = flat();
    const body = ruleBodies(css, ".hero-chip").join(";");
    assert.ok(body, "expected a .hero-chip rule");
    assert.ok(!/backdrop-filter|box-shadow/.test(body));
    const size = body.match(/font-size:([^;]*)/)?.[1] ?? "";
    assert.ok(/rem|var\(--text-(xs|sm)\)/.test(size), size);
    assert.ok(!/--text-stat|clamp\(/.test(size), size);
  });

  test("keyboard focus shows the tooltip even on devices without hover", () => {
    const hoverOnly = mediaBlocks(builtCss(), "(hover: hover)").join("");
    assert.ok(
      !/:focus-visible/.test(hoverOnly.split("{")[0] ?? "") &&
        !/focus-visible[^{]*\.dock-tip/.test(hoverOnly),
      "focus-visible tooltip rule is trapped inside (hover: hover)",
    );
    assert.match(flat(), /:focus-visible\.dock-tip/);
  });

  test("phones do not blur behind the Dock, to protect the mobile performance budget", () => {
    const phone = [
      ...mediaBlocks(builtCss(), "(max-width: 859.98px)"),
      ...mediaBlocks(builtCss(), "(width<=859.98px)"),
    ].join("");
    assert.match(phone, /\.dock-list\{[^}]*backdrop-filter:none/);
  });

  test("printing leaves no tile hidden by a reveal", () => {
    const print = mediaBlocks(builtCss(), "print").join("");
    assert.match(print, /\.reveal\{[^}]*animation:none/);
  });

  test("the tooltip stays centred over its item in the built CSS, hidden and shown", () => {
    // The minifier drops a standalone `translate: -50% 0` here, which left the
    // tooltip half its width to the right. Centring must survive in `transform`.
    const css = flat();
    const bodies = rulesOf(css).filter(([selector]) =>
      selector.includes(".dock-tip"),
    );
    const transforms = bodies
      .map(([, body]) => body.match(/(?:^|;)transform:([^;]*)/)?.[1])
      .filter(Boolean);
    assert.ok(transforms.length >= 2, "hidden and shown transforms exist");
    for (const transform of transforms) {
      assert.match(transform, /^translate\(-50%/, transform);
    }
  });

  test("a non-active Dock item is a fixed 44px circle and hover cannot widen it", () => {
    const css = flat();
    const item = ruleBodies(css, ".dock-lista,")
      .concat(ruleBodies(css, ".dock-lista"))
      .join(";");
    assert.match(item, /height:var\(--touch-target\)|height:44px/);
    assert.match(
      item,
      /min-width:var\(--touch-target\)|min-width:44px|width:44px/,
    );
    assert.match(
      item,
      /border-radius:var\(--radius-pill\)|border-radius:999px/,
    );
    assert.match(css, /--touch-target:44px/);
    for (const [selector, body] of rulesOf(css)) {
      if (
        !/:hover/.test(selector) ||
        !/\.dock-list|\.theme-toggle/.test(selector)
      )
        continue;
      assert.ok(
        !/width|padding|margin|gap|border-width/.test(body),
        `${selector} must not change geometry on hover`,
      );
    }
  });

  test("the Dock highlight is not animated by a CSS width transition (the tracker follows real geometry)", () => {
    const css = flat();
    for (const [selector, body] of rulesOf(css)) {
      if (!/\.dock-highlight/.test(selector)) continue;
      assert.ok(
        !/transition:[^;]*width/.test(body),
        `${selector} transitions width`,
      );
    }
  });

  test("tooltips and springs are instant under reduced motion", () => {
    const reduced = mediaBlocks(
      builtCss(),
      "(prefers-reduced-motion: reduce)",
    ).join("");
    assert.match(reduced, /\.dock-tip/);
    assert.match(reduced, /transition:none/);
  });

  test("forced colors keep focus outlines and tooltips visible", () => {
    const forced = mediaBlocks(builtCss(), "(forced-colors: active)").join("");
    assert.match(forced, /\.dock-tip/);
    assert.match(flat(), /:focus-visible\{outline:3pxsolid/);
  });

  test("no reveal or lift remains when the animation is unsupported: tiles have no hidden base state", () => {
    const base = ruleBodies(flat(), ".reveal").filter(
      (body) => !/animation/.test(body),
    );
    for (const body of base)
      assert.ok(!/opacity:0/.test(body), "a .reveal base rule hides content");
  });
});

// Project Block layout, scrollbar and Gallery, read from the built CSS, HTML and script.
describe("built Project Block layout, scrollbar and Gallery", () => {
  before(() => {
    const result = buildOnce();
    assert.equal(
      result.status,
      0,
      `astro build failed\n${result.stdout}\n${result.stderr}`,
    );
  });

  const flat = () => builtCss().replace(/\s+/g, "");
  const rulesOf = (css) =>
    [...css.matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1], m[2]]);
  const wide = () =>
    [
      ...mediaBlocks(builtCss(), "(min-width: 860px)"),
      ...mediaBlocks(builtCss(), "(width>=860px)"),
    ].join("");
  const columnsOf = (css, selectorTest) => {
    const rule = rulesOf(css).find(
      ([selector, body]) =>
        selectorTest(selector) && /grid-template-columns/.test(body),
    );
    const value = rule?.[1].match(/grid-template-columns:([^;]*)/)?.[1] ?? "";
    return [...value.matchAll(/(?:minmax\(0,)?([\d.]+)fr/g)].map((m) =>
      Number(m[1]),
    );
  };
  const isEven = (selector) =>
    /\.project-block:nth-of-type\((even|2n)\)/.test(selector) &&
    !/\.(gallery|project-text)/.test(selector);

  test("odd Project Blocks put the text left and the Gallery in the wider right column (5fr 7fr)", () => {
    const cols = columnsOf(wide(), (sel) => /(^|,)\.project-block$/.test(sel));
    assert.deepEqual(cols, [5, 7]);
  });

  test("even Project Blocks flip to 7fr 5fr and put the Gallery first, so it is still the wider column", () => {
    const css = wide();
    const cols = columnsOf(css, isEven);
    assert.deepEqual(cols, [7, 5]);
    const first = rulesOf(css).find(
      ([sel, body]) =>
        /\.project-block:nth-of-type\((even|2n)\)[^,]*\.gallery/.test(sel) &&
        /order:-1/.test(body),
    );
    assert.ok(first, "expected the Gallery of even blocks to have order:-1");
  });

  test("alternation uses nth-of-type, not nth-child, because the section label shares the parent", () => {
    assert.doesNotMatch(flat(), /\.project-block:nth-child/);
  });

  test("on phones the Gallery comes first and the block is one column", () => {
    const css = flat();
    const phoneEnd =
      css.indexOf("@media(min-width:860px)") > -1
        ? css.indexOf("@media(min-width:860px)")
        : css.indexOf("@media(width>=860px)");
    assert.ok(phoneEnd > -1, "expected the 860px media query");
    const phone = css.slice(0, phoneEnd);
    assert.match(
      phone,
      /\.project-block>\.gallery\{[^}]*order:-1/,
      "Gallery first before 860px",
    );
    const block = rulesOf(phone).find(([sel]) => /^\.project-block$/.test(sel));
    assert.match(block?.[1] ?? "", /grid-template-columns:minmax\(0,1fr\)/);
  });

  test("the page has a thin translucent custom scrollbar with readable thumb colours in light and dark", () => {
    const css = flat();
    const rootRule = rulesOf(css)
      .filter(([sel]) => /(^|,)html$/.test(sel))
      .map(([, body]) => body)
      .join(";");
    assert.match(rootRule, /scrollbar-width:thin/);
    assert.match(rootRule, /scrollbar-color:[^;]*transparent/);
    assert.match(css, /::-webkit-scrollbar\{[^}]*width:10px/);
    const track = rulesOf(css).find(([sel]) =>
      /^::-webkit-scrollbar-track/.test(sel),
    );
    assert.match(track?.[1] ?? "", /background:(transparent|00|#0000)/);
    const thumb = rulesOf(css).find(([sel]) =>
      /^::-webkit-scrollbar-thumb$/.test(sel),
    );
    assert.match(thumb?.[1] ?? "", /border-radius:10px/);
    // Light, system dark and manual dark each define a semi-transparent thumb.
    // The minifier may write the colour as rgba() or as #rrggbbaa.
    const thumbs = [
      ...css.matchAll(/--scroll-thumb:(?:rgba\(([^)]*)\)|#([0-9a-f]{8}))/g),
    ].map((m) =>
      m[1]
        ? Number(m[1].split(",")[3])
        : Number.parseInt(m[2].slice(6), 16) / 255,
    );
    assert.ok(
      thumbs.length >= 3,
      `expected 3 thumb colours, got ${thumbs.length}`,
    );
    for (const alpha of thumbs)
      assert.ok(alpha > 0 && alpha < 1, `alpha ${alpha}`);
  });

  test("the Gallery track hides its own scrollbar and snaps horizontally and mandatorily", () => {
    const css = flat();
    const track = rulesOf(css)
      .filter(([sel]) => /(^|,)\.gallery-track$/.test(sel))
      .map(([, b]) => b)
      .join(";");
    assert.match(track, /scrollbar-width:none/);
    assert.match(
      track,
      /scroll-snap-type:x mandatory|scroll-snap-type:xmandatory/,
    );
    assert.match(track, /overflow-x:auto/);
    assert.match(css, /\.gallery-track::-webkit-scrollbar\{display:none\}/);
  });

  test("each Slide snaps to the track", () => {
    assert.match(flat(), /\.gallery-slide\{[^}]*scroll-snap-align:/);
  });

  test("there is a See more of my work on GitHub link with a 44px touch target", () => {
    const link = (page().match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []).find((a) =>
      textOf(a).startsWith("See more of my work on GitHub"),
    );
    assert.ok(link, "expected the link");
    assert.equal(textOf(link), "See more of my work on GitHub →");
    assert.match(link, /href="https:\/\/github\.com\/khatrihemang07"/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener"/);
    const cls = link.match(/class="([^"]*)"/)?.[1].split(" ")[0];
    assert.ok(cls, "the link has a class");
    const body = rulesOf(flat())
      .filter(([sel]) => sel.includes(`.${cls}`))
      .map(([, b]) => b)
      .join(";");
    assert.match(body, /min-height:var\(--touch-target\)|min-height:44px/);
  });

  test("the Gallery behaviour ships as a bundled module script, with no inline handlers", () => {
    const moduleScripts = [
      ...page().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ]
      .filter(([, attrs]) => /type="module"/.test(attrs))
      .map(([, attrs, body]) => {
        const src = attrs.match(/\ssrc="([^"]+)"/)?.[1];
        return src ? readFileSync(join(root, "dist", src), "utf8") : body;
      });
    const gallery = moduleScripts.find(
      (js) =>
        /aria-current/.test(js) &&
        /ArrowRight/.test(js) &&
        /tablist|role=tab|\[role=.?tab/.test(js),
    );
    assert.ok(
      gallery,
      "expected a module script handling tabs and the Gallery",
    );
    assert.match(
      gallery,
      /prefers-reduced-motion/,
      "reduced motion is respected",
    );
    assert.doesNotMatch(page(), /\son[a-z]+="/i);
  });

  test("smooth scrolling is only enabled when motion is allowed", () => {
    const blocks = mediaBlocks(
      builtCss(),
      "(prefers-reduced-motion: no-preference)",
    );
    assert.match(blocks.join(""), /scroll-behavior:smooth/);
    let outside = flat();
    for (const block of blocks) outside = outside.replace(block, "");
    assert.doesNotMatch(outside, /scroll-behavior:smooth/);
  });
});

// Deployment: the Cloudflare Workers build must install and deploy this repo.
describe("deployment config", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const wranglerPath = join(root, "wrangler.jsonc");

  test("package.json pins the pnpm version the lockfile and workspace file were made with", () => {
    // Cloudflare's build image defaults to pnpm 9, which rejects pnpm-workspace.yaml
    // (it has no `packages` list) and would ignore its overrides.
    assert.match(pkg.packageManager ?? "", /^pnpm@\d+\.\d+\.\d+$/);
    assert.ok(Number(pkg.packageManager.split("@")[1].split(".")[0]) >= 10);
  });

  test("wrangler.jsonc names the Worker, serves dist and answers unknown paths with the 404 page", () => {
    assert.ok(existsSync(wranglerPath), "wrangler.jsonc is missing");
    const text = readFileSync(wranglerPath, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const config = JSON.parse(text);
    assert.equal(config.name, "hemangkhatri");
    assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(config.assets?.directory, "./dist");
    assert.equal(config.assets?.not_found_handling, "404-page");
    assert.equal(config.main, undefined, "static site: no Worker script");
    assert.equal(
      config.workers_dev,
      true,
      "the workers.dev address is the live site",
    );
    assert.equal(
      config.preview_urls,
      false,
      "no public per-version preview addresses",
    );
  });
});
