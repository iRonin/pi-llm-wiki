import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "extensions/llm-wiki/index.ts",
  "extensions/llm-wiki/resources/skills/llm-wiki/SKILL.md",
  "extensions/llm-wiki/src/config.ts",
  "extensions/llm-wiki/src/capture.ts",
  "extensions/llm-wiki/src/indexer.ts",
  "extensions/llm-wiki/src/lint.ts",
  "scripts/release.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
];

for (const path of requiredFiles) {
  await access(path);
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (!pkg.pi?.extensions?.includes("./extensions/llm-wiki/index.ts")) {
  throw new Error("package.json pi.extensions is missing ./extensions/llm-wiki/index.ts");
}

if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("pi-package")) {
  throw new Error('package.json keywords must include "pi-package"');
}

console.log("pi-llm-wiki sanity check passed");
