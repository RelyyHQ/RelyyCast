import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const args = { mode: undefined };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }

    if (token.startsWith("--mode=")) {
      args.mode = token.slice("--mode=".length);
      continue;
    }

    if (token === "--mode") {
      args.mode = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/release/bump-version.mjs --mode <decimal|full>\n\nModes:\n  decimal  Increment patch: x.y.z -> x.y.(z+1)\n  full     Increment major: x.y.z -> (x+1).0.0`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}. Expected x.y.z`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(current, mode) {
  const { major, minor, patch } = parseSemver(current);

  if (mode === "decimal") {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (mode === "full") {
    return `${major + 1}.0.0`;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

function runNpmVersion(targetVersion) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["version", targetVersion, "--no-git-tag-version", "--allow-same-version"],
    {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(`npm version failed. ${stderr || stdout || "No output"}`);
  }
}

function replaceAllOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Pattern not found for ${label}`);
  }

  return content.replace(pattern, replacement);
}

function updateTextFile(filePath, updater) {
  const original = fs.readFileSync(filePath, "utf8");
  const updated = updater(original);

  if (updated === original) {
    throw new Error(`No changes made in ${filePath}`);
  }

  fs.writeFileSync(filePath, updated, "utf8");
}

function updateNeutralinoVersion(version) {
  const configPath = path.join(REPO_ROOT, "neutralino.config.json");
  const json = readJson(configPath);
  json.version = version;
  writeJson(configPath, json);
}

function updateMacBuildScript(version) {
  const filePath = path.join(REPO_ROOT, "scripts", "installers", "mac", "build-pkg.sh");

  updateTextFile(filePath, (content) =>
    replaceAllOrThrow(content, /APP_VERSION="\d+\.\d+\.\d+"/g, `APP_VERSION="${version}"`, "APP_VERSION in build-pkg.sh"),
  );
}

function updateWindowsInstallerScript(version) {
  const filePath = path.join(REPO_ROOT, "scripts", "installers", "windows", "relyycast.nsi");
  const windowsFileVersion = `${version}.0`;

  updateTextFile(filePath, (content) => {
    let next = content;
    next = replaceAllOrThrow(next, /!define APP_VERSION\s+"\d+\.\d+\.\d+"/g, `!define APP_VERSION   "${version}"`, "APP_VERSION in relyycast.nsi");
    next = replaceAllOrThrow(next, /VIProductVersion "\d+\.\d+\.\d+\.\d+"/g, `VIProductVersion "${windowsFileVersion}"`, "VIProductVersion in relyycast.nsi");
    return next;
  });
}

function updateMacInfoPlist(version) {
  const filePath = path.join(REPO_ROOT, "scripts", "installers", "mac", "Info.plist");

  updateTextFile(filePath, (content) => {
    let next = content;
    next = replaceAllOrThrow(next, /(<key>CFBundleVersion<\/key>\s*<string>)\d+\.\d+\.\d+(<\/string>)/g, `$1${version}$2`, "CFBundleVersion in Info.plist");
    next = replaceAllOrThrow(next, /(<key>CFBundleShortVersionString<\/key>\s*<string>)\d+\.\d+\.\d+(<\/string>)/g, `$1${version}$2`, "CFBundleShortVersionString in Info.plist");
    return next;
  });
}

function updateMacDistribution(version) {
  const filePath = path.join(REPO_ROOT, "scripts", "installers", "mac", "distribution.xml");

  updateTextFile(filePath, (content) =>
    replaceAllOrThrow(content, /(pkg-ref id="com\.relyycast\.app\.(?:core|uninstall)"\s+version=")\d+\.\d+\.\d+("\s+onConclusion="none">)/g, `$1${version}$2`, "pkg-ref versions in distribution.xml"),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || (args.mode !== "decimal" && args.mode !== "full")) {
    throw new Error("--mode must be one of: decimal, full");
  }

  const packageJsonPath = path.join(REPO_ROOT, "package.json");
  const packageJson = readJson(packageJsonPath);
  const currentVersion = packageJson.version;
  const targetVersion = nextVersion(currentVersion, args.mode);

  runNpmVersion(targetVersion);
  updateNeutralinoVersion(targetVersion);
  updateMacBuildScript(targetVersion);
  updateWindowsInstallerScript(targetVersion);
  updateMacInfoPlist(targetVersion);
  updateMacDistribution(targetVersion);

  console.log(`[version:bump] Mode: ${args.mode}`);
  console.log(`[version:bump] ${currentVersion} -> ${targetVersion}`);
}

try {
  main();
} catch (error) {
  console.error("[version:bump] ERROR:", error.message);
  process.exit(1);
}
