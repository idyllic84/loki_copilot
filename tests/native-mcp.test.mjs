import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";

const enabled = process.env.LOKI_COPILOT_MCP_TEST === "1" && process.env.COPILOT_TEST_CLI && process.env.COPILOT_TEST_SDK;
test("native MCP connects, survives reload and offers only web/browse", { skip: !enabled, timeout: 90_000 }, async () => {
	const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(process.env.COPILOT_TEST_SDK).href);
	const client = new CopilotClient({ connection: RuntimeConnection.forStdio({ path: process.env.COPILOT_TEST_CLI }), logLevel: "error" });
	let session;
	try {
		session = await client.createSession({
			enableExperimentalMode: true, requestExtensions: true, enableConfigDiscovery: true,
			workingDirectory: process.cwd(), onPermissionRequest: () => ({ kind: "approve-once" }),
			disabledMcpServers: ["github-mcp-server", "githubiq"],
		});
		for (let i = 0; i < 150; i++) {
			const { extensions } = await session.rpc.extensions.list();
			if (extensions.some((e) => e.name === "loki" && e.status === "failed")) assert.fail("Loki extension failed to load.");
			if (extensions.some((e) => e.name === "loki" && e.status === "running")) break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		for (let pass = 0; pass < 2; pass++) {
			const { servers } = await session.rpc.mcp.list();
			assert.equal(servers.find((s) => s.name === "loki-web")?.status, "connected");
			assert.deepEqual((await session.rpc.mcp.listTools({ serverName: "loki-web" })).tools.map((t) => t.name).sort(), ["browse", "web"]);
			if (pass === 0) await session.rpc.mcp.reload();
		}
		await session.rpc.tools.initializeAndValidate();
		const names = (await session.rpc.tools.getCurrentMetadata()).tools.map((t) => t.name);
		assert.ok(names.includes("loki-web-web"));
		assert.ok(names.includes("loki-web-browse"));
		assert.ok(!names.includes("loki_web_search"));
		assert.ok(!names.includes("loki_web_browse"));
		if (process.env.LOKI_COPILOT_MCP_LIVE_TEST === "1") {
			const result = await session.rpc.tools.execute({ name: "loki-web-web", arguments: { query: "TypeScript release notes", maxResults: 2, language: "en", region: "US" } });
			assert.equal(result.resultType, "success");
			assert.match(result.textResultForLlm, /https:\/\//);
			const page = await session.rpc.tools.execute({ name: "loki-web-browse", arguments: { url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html", maxLength: 1000 } });
			assert.equal(page.resultType, "success");
			assert.match(page.textResultForLlm, /TypeScript/);
		}
	} finally {
		await session?.disconnect().catch(() => {});
		await client.stop();
	}
});
