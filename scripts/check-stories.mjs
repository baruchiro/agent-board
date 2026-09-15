#!/usr/bin/env node
/**
 * Story-coverage gate.
 *
 * Parses STORIES.md for story IDs (headings of the form `## CORE-1 ...`),
 * scans test files for `// @story: CORE-1, CORE-2` annotations, and fails if
 * any story has zero covering tests OR a test references an ID that no longer
 * exists in STORIES.md.
 *
 * Exemption: a story whose section in STORIES.md contains an
 * `<!-- @unimplemented -->` marker is exempt from the coverage requirement.
 * This lets a story be recorded ahead of its implementation (e.g. a roadmap
 * commitment) without a vacuous placeholder test. Remove the marker in the
 * same change that lands the real tagged tests.
 *
 * Stack-agnostic: it only needs a STORIES.md and text files carrying `@story:`
 * comments — it doesn't care what language or test runner you use.
 *
 * Configuration (env vars, all optional):
 *   STORY_TEST_ROOTS   comma-separated dirs to scan (default: common source
 *                      dirs that exist — src, app, lib, test, tests, e2e,
 *                      spec, packages; falls back to the repo root).
 *   STORY_TEST_GLOB    override the test-filename regex (a JS RegExp source
 *                      string). Default matches .test./.spec./_test. across
 *                      common extensions plus test_*.py.
 *
 * Wire into your pre-push gate and CI. See CLAUDE.md § "Stories workflow".
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const STORIES_FILE = join(REPO_ROOT, "STORIES.md");

const STORY_HEADING_RE = /^##\s+([A-Z][A-Z0-9]*-\d+)\b/gm;
const STORY_TAG_RE = /@story:?\s+([A-Z0-9, \-]+)/g;
const UNIMPLEMENTED_RE = /<!--\s*@unimplemented\s*-->/;
const ID_RE = /^[A-Z][A-Z0-9]*-\d+$/;

const TEST_FILE_RE = new RegExp(
  process.env.STORY_TEST_GLOB ??
    "(\\.(test|spec)\\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java|kt)$)|(_test\\.(go|py|rb)$)|(^test_.*\\.py$)",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
]);

function resolveTestRoots() {
  if (process.env.STORY_TEST_ROOTS) {
    return process.env.STORY_TEST_ROOTS.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => join(REPO_ROOT, d));
  }
  const candidates = [
    "src",
    "app",
    "lib",
    "test",
    "tests",
    "e2e",
    "spec",
    "packages",
  ];
  const existing = candidates
    .map((d) => join(REPO_ROOT, d))
    .filter((full) => existsSync(full));
  // Fall back to scanning the whole repo when no conventional dir exists.
  return existing.length > 0 ? existing : [REPO_ROOT];
}

function findTestFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function extractStoryIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(STORY_HEADING_RE)) ids.add(m[1]);
  return ids;
}

/**
 * Returns the set of story IDs whose section (heading text up to the next
 * `## ` heading) contains an `<!-- @unimplemented -->` marker.
 */
function extractUnimplementedIds(text) {
  const ids = new Set();
  const matches = [...text.matchAll(STORY_HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const section = text.slice(start, end);
    if (UNIMPLEMENTED_RE.test(section)) ids.add(matches[i][1]);
  }
  return ids;
}

function extractTagsFromFile(text) {
  const ids = new Set();
  for (const m of text.matchAll(STORY_TAG_RE)) {
    for (const raw of m[1].split(",")) {
      const id = raw.trim();
      if (ID_RE.test(id)) ids.add(id);
    }
  }
  return ids;
}

if (!existsSync(STORIES_FILE)) {
  console.error("STORIES.md not found at repo root.");
  process.exit(1);
}

const storiesText = readFileSync(STORIES_FILE, "utf8");
const storyIds = extractStoryIds(storiesText);
const unimplementedIds = extractUnimplementedIds(storiesText);

if (storyIds.size === 0) {
  console.error(
    "STORIES.md has no stories (expected `## PREFIX-N ...` headings).",
  );
  process.exit(1);
}

const coverageById = new Map();
for (const id of storyIds) coverageById.set(id, []);

const unknownByFile = new Map();

const testFiles = resolveTestRoots().flatMap((root) => findTestFiles(root));

for (const file of testFiles) {
  const tags = extractTagsFromFile(readFileSync(file, "utf8"));
  for (const id of tags) {
    if (coverageById.has(id)) {
      coverageById.get(id).push(file);
    } else {
      if (!unknownByFile.has(file)) unknownByFile.set(file, new Set());
      unknownByFile.get(file).add(id);
    }
  }
}

const uncoveredAll = [...coverageById.entries()]
  .filter(([, files]) => files.length === 0)
  .map(([id]) => id);

const uncovered = uncoveredAll.filter((id) => !unimplementedIds.has(id));
const exempt = uncoveredAll.filter((id) => unimplementedIds.has(id));

console.log(`Stories defined: ${storyIds.size}`);
console.log(
  `  covered: ${storyIds.size - uncoveredAll.length} / ${storyIds.size}` +
    (exempt.length > 0 ? ` (${exempt.length} unimplemented, exempt)` : ""),
);

let exitCode = 0;

if (exempt.length > 0) {
  console.log(`\nUnimplemented stories (exempt from coverage):`);
  for (const id of exempt) console.log(`  - ${id}`);
}

if (uncovered.length > 0) {
  console.error(`\nUncovered stories (need at least one tagged test):`);
  for (const id of uncovered) console.error(`  - ${id}`);
  exitCode = 1;
}

if (unknownByFile.size > 0) {
  console.error(`\nTest files referencing unknown story IDs:`);
  for (const [file, ids] of unknownByFile) {
    console.error(`  - ${relative(REPO_ROOT, file)}: ${[...ids].join(", ")}`);
  }
  exitCode = 1;
}

if (exitCode === 0) console.log("\nAll stories covered.");
process.exit(exitCode);
