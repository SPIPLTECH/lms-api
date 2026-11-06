#!/usr/bin/env node
/**
 * One-time setup of the API's AI process: creates ai/.venv on CPython 3.13, installs the exact
 * locked packages (ai/requirements.lock.txt) and downloads the pinned models, each checked against
 * its SHA-256. Safe to run again. After this the API starts the AI process itself.
 *
 *   npm run ai:setup
 *   npm run ai:setup -- --models-from=<folder>   take the models from a folder instead of downloading
 *                                                (still checked), and skip the Python environment
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ai");
const isWindows = process.platform === "win32";
const venvPython = path.join(aiDir, ".venv", ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"]));
const modelsFrom = process.argv.find((arg) => arg.startsWith("--models-from="))?.split("=")[1];

function run(command, args) {
  console.log(`[ai:setup] ${path.basename(command)} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: aiDir, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`[ai:setup] failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}. CPython 3.13 is required.`);
    process.exit(1);
  }
}

if (modelsFrom) {
  const manifest = JSON.parse(fs.readFileSync(path.join(aiDir, "models", "models.json"), "utf8"));
  for (const [name, spec] of Object.entries(manifest)) {
    const bytes = fs.readFileSync(path.join(modelsFrom, spec.file));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== spec.sha256) {
      console.error(`[ai:setup] ${name}: CHECKSUM MISMATCH; not copied.`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(aiDir, "models", spec.file), bytes);
    console.log(`[ai:setup] ${name}: copied, checksum OK`);
  }
  process.exit(0);
}

if (!fs.existsSync(venvPython)) {
  if (isWindows) run("py", ["-3.13", "-m", "venv", ".venv"]);
  else run("python3.13", ["-m", "venv", ".venv"]);
}
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.lock.txt"]);
run(venvPython, ["scripts/download_models.py"]);
console.log("[ai:setup] done. The API starts the AI process itself.");
