import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const level = process.argv[2];
if (!level || !["patch", "minor", "major"].includes(level)) {
  console.error("Usage: node --experimental-strip-types ./scripts/release.ts <patch|minor|major>");
  process.exit(1);
}

ensureCleanWorkingTree();
ensureOnMainBranch();
run("npm", ["run", "check"]);

const currentVersion = readPackageVersion();
run("npm", ["version", level, "--no-git-tag-version"]);
const nextVersion = readPackageVersion();

if (currentVersion === nextVersion) {
  throw new Error(`Version did not change (still ${currentVersion})`);
}

updateChangelog(nextVersion);
run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
run("git", ["commit", "-m", `chore(release): v${nextVersion}`]);
run("git", ["tag", `v${nextVersion}`]);

console.log(`\nReleased v${nextVersion} locally.`);
console.log("Next step:");
console.log("  git push origin main --follow-tags");

function ensureCleanWorkingTree(): void {
  const status = exec("git", ["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error("Working tree must be clean before running a release.");
  }
}

function ensureOnMainBranch(): void {
  const branch = exec("git", ["branch", "--show-current"]).trim();
  if (branch !== "main") {
    throw new Error(`Releases must be cut from main. Current branch: ${branch}`);
  }
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  return pkg.version;
}

function updateChangelog(version: string): void {
  const changelogPath = "CHANGELOG.md";
  const normalized = readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
  const marker = "## [Unreleased]";
  const start = normalized.indexOf(marker);
  if (start < 0) {
    throw new Error("CHANGELOG.md must contain a ## [Unreleased] section.");
  }

  const afterMarker = normalized.slice(start + marker.length);
  const nextSectionOffset = afterMarker.search(/\n## \[[^\]]+\]/);
  const unreleasedBody = nextSectionOffset >= 0 ? afterMarker.slice(0, nextSectionOffset) : afterMarker;
  const suffix = nextSectionOffset >= 0 ? afterMarker.slice(nextSectionOffset + 1) : "";
  const releaseBody = hasMeaningfulNotes(unreleasedBody)
    ? unreleasedBody.trim()
    : "### Changed\n- Internal maintenance release.";

  const refreshed = [
    normalized.slice(0, start),
    `${marker}\n\n### Added\n- \n\n### Changed\n- \n\n### Fixed\n- \n`,
    `\n## [${version}] - ${today()}\n\n${releaseBody}\n`,
    suffix ? `\n${suffix.trimStart()}` : "",
  ].join("");

  writeFileSync(changelogPath, `${refreshed.trimEnd()}\n`);
}

function hasMeaningfulNotes(section: string): boolean {
  const meaningful = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("### ") && line !== "-" && line !== "- ");
  return meaningful.length > 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function exec(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" });
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "inherit" });
}
