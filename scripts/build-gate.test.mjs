import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "src", "content", "projects");
const invalidFile = join(contentDir, "zz-gate-invalid.yaml");

const markuliYaml = `name: markuli
pitch: Scribble on your screen, then make it vanish.
body: A hotkey turns your whole screen into a whiteboard with Excalidraw-identical ink. Press it again and it's gone.
facts:
  - text: "1.5 MB download"
    source: "README claim; GitHub release asset Markuli-0.6.0-macos-universal.dmg is 1,618,813 bytes (about 1.5 MiB). Not yet re-verified."
  - text: "11 MB idle RAM, 0% idle CPU"
    source: "README claim. UNVERIFIED: must be measured in ticket #4."
stack: Rust · native macOS · no webview
repo: https://github.com/khatrihemang07/markuli
download: https://github.com/khatrihemang07/markuli/releases/latest
image: ../../assets/projects/markuli.svg
alt: "Placeholder: markuli's red ink circling a bar in a chart drawn over an app window."
order: 1
`;

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
image: ../../assets/projects/markuli.svg
alt: "Gate alt text."
order: 99
`,
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
image: ../../assets/projects/markuli.svg
alt: "Gate alt text."
order: 99
`,
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
image: ../../assets/projects/markuli.svg
alt: ""
order: 99
`,
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
image: ../../assets/projects/markuli.svg
alt: "Gate alt text."
order: 99
`,
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
image: ../../assets/projects/markuli.svg
alt: "Gate alt text."
order: 99
`,
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
image: ../../assets/projects/markuli.svg
alt: "Gate alt text."
order: 99
`,
  ],
];

function runBuild() {
  return spawnSync("pnpm", ["exec", "astro", "build"], {
    cwd: root,
    encoding: "utf8",
    timeout: 240_000,
  });
}

test("the real markuli entry is the only Project", () => {
  assert.deepEqual(readdirSync(contentDir), ["markuli.yaml"]);
  assert.equal(
    readFileSync(join(contentDir, "markuli.yaml"), "utf8"),
    markuliYaml,
  );
});

for (const [label, yaml] of invalidCases) {
  test(`build fails when a Project has ${label}`, () => {
    try {
      writeFileSync(invalidFile, yaml);
      const result = runBuild();
      assert.notEqual(
        result.status,
        0,
        `expected astro build to fail\n${result.stdout}\n${result.stderr}`,
      );
    } finally {
      rmSync(invalidFile, { force: true });
    }
  });
}

test("build succeeds with only the real markuli entry and renders its Card", () => {
  const result = runBuild();
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
