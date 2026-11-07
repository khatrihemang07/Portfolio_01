import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
      5,
      "expected 3 Source and 2 Download links",
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
