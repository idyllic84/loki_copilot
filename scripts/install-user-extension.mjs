#!/usr/bin/env node
/**
 * Install an isolated copy of the Loki Copilot CLI extension into
 * `~/.copilot/extensions/loki` so the active user-level extension is separated
 * from the development repository.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const copilotHome = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const targetDir = process.env.LOKI_COPILOT_EXT_DIR || join(copilotHome, "extensions", "loki");

console.log(`Installing standalone Loki Copilot CLI extension to: ${targetDir}`);

if (existsSync(targetDir)) {
	rmSync(targetDir, { recursive: true, force: true });
}
mkdirSync(targetDir, { recursive: true });

for (const item of ["extension.mjs", "src", "package.json", "README.md", "LICENSE"]) {
	const srcPath = join(repoRoot, item);
	if (existsSync(srcPath)) {
		cpSync(srcPath, join(targetDir, item), { recursive: true });
	}
}

const nmSrc = join(repoRoot, "node_modules");
if (existsSync(nmSrc)) {
	cpSync(nmSrc, join(targetDir, "node_modules"), { recursive: true });
}

const npmCmd = spawnSync(
	process.execPath,
	[
		"-e",
		`
import { execFileSync } from "node:child_process";
const tokenCmd = 'node "' + ${JSON.stringify(join(targetDir, "src", "wam.mjs").replace(/\\/g, "/"))} + '"';
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  '[Environment]::SetEnvironmentVariable("COPILOT_LOKI_TOKEN_COMMAND", $env:TCMD, "User"); if (-not [Environment]::GetEnvironmentVariable("COPILOT_LOKI_BASE_URL", "User")) { [Environment]::SetEnvironmentVariable("COPILOT_LOKI_BASE_URL", "https://loki.delve.office.com/api/v1/llmapi", "User") }'
], { env: { ...process.env, TCMD: tokenCmd }, windowsHide: true });
`,
	],
	{ windowsHide: true, stdio: "inherit" },
);
void npmCmd;

console.log(`Installed Copilot CLI extension to: ${targetDir}`);
console.log(`Configured user env COPILOT_LOKI_TOKEN_COMMAND and COPILOT_LOKI_BASE_URL so native '/model' picker works directly.`);
