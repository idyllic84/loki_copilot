/** Install a credential-free entry in Copilot's documented user MCP config. */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { createWebGroundingConfig, WEB_GROUNDING_SERVER } from "./web-grounding.mjs";

export function installMcpConfig(copilotHome, installedDirectory) {
	const path = join(copilotHome, "mcp-config.json");
	let before = "";
	try { before = readFileSync(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
	let document;
	try { document = before.trim() ? JSON.parse(before.replace(/^\uFEFF/, "")) : {}; }
	catch { throw new Error("Existing mcp-config.json is not valid JSON; it was not changed. Add loki-web through /mcp instead."); }
	if (!document || typeof document !== "object" || Array.isArray(document) ||
		(document.mcpServers != null && (typeof document.mcpServers !== "object" || Array.isArray(document.mcpServers)))) {
		throw new Error("Existing mcp-config.json has an unexpected shape; it was not changed.");
	}
	const config = createWebGroundingConfig();
	config.args = [join(installedDirectory, "src", "web-mcp-server.mjs")];
	const previous = document.mcpServers?.[WEB_GROUNDING_SERVER];
	if (previous) {
		const ownsEntry = ["stdio", "local"].includes(previous.type) && Array.isArray(previous.args) && previous.args.length === 1 && typeof previous.args[0] === "string" &&
			normalize(previous.args[0]).toLowerCase() === normalize(config.args[0]).toLowerCase();
		if (!ownsEntry) throw new Error("A different loki-web MCP configuration already exists; it was not changed.");
	}
	document.mcpServers = { ...document.mcpServers, [WEB_GROUNDING_SERVER]: { ...previous, ...config } };
	const after = `${JSON.stringify(document, null, 2)}\n`;
	if (after === before) return path;
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, after, { mode: 0o600 });
		let current = "";
		try { current = readFileSync(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
		if (current !== before) throw new Error("MCP configuration changed concurrently; run install:user again.");
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
	}
	return path;
}
