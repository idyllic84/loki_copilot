/** Session-scoped MCP registration using the official Copilot SDK. */
import { fileURLToPath } from "node:url";

export const WEB_GROUNDING_SERVER = "loki-web";

export function createWebGroundingConfig() {
	// Bundled Copilot executables can host Node without being node.exe themselves.
	const node = /(?:^|[\\/])node(?:\.exe)?$/i.test(process.execPath)
		? process.execPath
		: process.platform === "win32" ? "node.exe" : "node";
	return {
		type: "stdio",
		command: node,
		args: [fileURLToPath(new URL("./web-mcp-server.mjs", import.meta.url))],
		tools: ["web", "browse"],
		timeout: 60_000,
	};
}

/** Restart only this server after explicit login/account/endpoint changes. */
export async function refreshWebGrounding(session, { restart = true } = {}) {
	const { servers } = await session.rpc.mcp.listConfigured();
	const server = servers.find((item) => item.name === WEB_GROUNDING_SERVER);
	if (!server) throw new Error("loki-web is not configured. Run npm run install:user, then reload /mcp.");
	if (!server.enabled) return false;
	if (restart) await session.rpc.mcp.restartServer({ serverName: WEB_GROUNDING_SERVER });
	else await session.rpc.mcp.startServer({ serverName: WEB_GROUNDING_SERVER });
	return true;
}
