// Extract the current version's section from CHANGELOG.md into a temp file
// that electron-builder uploads as the GitHub release body. Runs before
// `electron-builder --publish always` from the `release` npm script.
//
// Expects CHANGELOG.md sections to start with a line like:
//   ## [0.1.1] — 2026-04-21
// or
//   ## 0.1.1
// The version number must match package.json's `version` field. If no
// matching section is found, we write a minimal placeholder so the publish
// doesn't fail outright.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");

const pkg = JSON.parse(
  await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
);
const version = pkg.version;

const changelog = await fs
  .readFile(path.join(appRoot, "CHANGELOG.md"), "utf8")
  .catch(() => "");

function extract(md, target) {
  // Split on h2 headings, find the section whose heading mentions `target`
  // (matching `## [0.1.1]` or `## 0.1.1`), return the body below the heading.
  const escaped = target.replace(/\./g, "\\.");
  const headingRe = new RegExp(`^##\\s+\\[?${escaped}\\]?`);
  const sections = md.split(/\n(?=##\s)/);
  for (const section of sections) {
    if (!headingRe.test(section)) continue;
    const nl = section.indexOf("\n");
    return nl === -1 ? "" : section.slice(nl + 1).trim();
  }
  return null;
}

const body =
  extract(changelog, version) ??
  `Release ${version}.\n\nSee the CHANGELOG.md in the repository for details.`;

const outPath = path.join(appRoot, ".release-notes.md");
await fs.writeFile(outPath, body + "\n", "utf8");
console.log(`release notes for ${version} → ${path.relative(appRoot, outPath)}`);
