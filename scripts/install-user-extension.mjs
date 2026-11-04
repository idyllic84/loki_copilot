#!/usr/bin/env node
/**
 * Install an isolated copy of the Loki Copilot CLI extension into
 * `~/.copilot/extensions/loki` so the active user-level extension is separated
 * from the development repository.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installMcpConfig } from "../src/mcp-config.mjs";

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

const mcpConfigPath = installMcpConfig(copilotHome, targetDir);
console.log(`Installed Copilot CLI extension to: ${targetDir}`);
console.log(`Registered loki-web MCP in: ${mcpConfigPath} (no credentials stored).`);
