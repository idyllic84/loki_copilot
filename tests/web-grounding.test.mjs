import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMcpConfig } from "../src/mcp-config.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWebGroundingServer } from "../src/web-mcp-server.mjs";
import { createWebGroundingConfig, refreshWebGrounding } from "../src/web-grounding.mjs";
import { requestWebGroundingMcp } from "../src/search.mjs";
import { DF_UPSTREAM, PROD_UPSTREAM } from "../src/config.mjs";

const tools = [
	{ name: "web", description: "Web search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
	{ name: "browse", description: "Read a page", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
	{ name: "not-exposed", inputSchema: { type: "object" } },
];

test("native MCP adapter exposes only web/browse and reacquires auth/config per operation", async () => {
	let endpoint = PROD_UPSTREAM;
	let tokens = 0;
	const calls = [];
	const server = createWebGroundingServer({
		getToken: async () => ({ accessToken: `FAKE_${++tokens}` }),
		loadConfig: () => ({ endpoint }),
		request: async (token, baseUrl, method, params) => {
			calls.push({ token, baseUrl, method, params });
			return method === "tools/list" ? { tools } : { content: [{ type: "text", text: "Unmodified page\nbody" }], isError: false };
		},
	});
	const client = new Client({ name: "test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["web", "browse"]);
		await client.callTool({ name: "web", arguments: { query: "public query" } });
		assert.deepEqual(calls[1].params, { name: "web", arguments: { query: "public query", language: "en", region: "US" } });
		endpoint = DF_UPSTREAM;
		const page = await client.callTool({ name: "browse", arguments: { url: "https://example.com", maxLength: 900 } });
		assert.equal(page.content[0].text, "Unmodified page\nbody");
		assert.equal(calls[2].baseUrl, DF_UPSTREAM);
		assert.equal(calls[2].token, "FAKE_3");
		await assert.rejects(client.callTool({ name: "not-exposed", arguments: {} }), /Unknown Loki/);
		await assert.rejects(client.callTool({ name: "browse", arguments: { url: "file:///private.txt" } }), /HTTP/);
		assert.equal(tokens, 3, "Rejected tools/URLs must not acquire credentials.");
	} finally {
		await client.close();
		await server.close();
	}
});

test("MCP configuration contains no token; refresh obeys native disabled state", async () => {
	const config = createWebGroundingConfig();
	assert.equal(config.type, "stdio");
	assert.deepEqual(config.tools, ["web", "browse"]);
	assert.equal(config.headers, undefined);
	assert.equal(config.env, undefined);
	assert.ok(config.args[0].endsWith("web-mcp-server.mjs"));
	let enabled = false;
	const operations = [];
	const session = { rpc: { mcp: {
		listConfigured: async () => ({ servers: [{ name: "loki-web", enabled }] }),
		restartServer: async (input) => operations.push(["restart", input]),
		startServer: async (input) => operations.push(["start", input]),
	} } };
	assert.equal(await refreshWebGrounding(session), false);
	assert.deepEqual(operations, []);
	enabled = true;
	await refreshWebGrounding(session, { restart: false });
	await refreshWebGrounding(session);
	assert.deepEqual(operations, [["start", { serverName: "loki-web" }], ["restart", { serverName: "loki-web" }]]);
});

test("installer registers a token-free native server and preserves unrelated MCP configuration", () => {
	const home = mkdtempSync(join(tmpdir(), "loki-mcp-install-"));
	const path = join(home, "mcp-config.json");
	try {
		const other = { type: "http", url: "https://example.com/mcp", headers: { "X-Test": "FAKE_OTHER_VALUE" } };
		writeFileSync(path, JSON.stringify({ customSetting: true, mcpServers: { other } }));
		installMcpConfig(home, join(home, "app"));
		const document = JSON.parse(readFileSync(path, "utf8"));
		assert.deepEqual(document.mcpServers.other, other);
		assert.equal(document.customSetting, true);
		assert.equal(document.mcpServers["loki-web"].type, "stdio");
		assert.equal(document.mcpServers["loki-web"].headers, undefined);
		assert.equal(document.mcpServers["loki-web"].env, undefined);
		const first = readFileSync(path, "utf8");
		installMcpConfig(home, join(home, "app"));
		assert.equal(readFileSync(path, "utf8"), first);
		writeFileSync(path, "malformed JSON");
		assert.throws(() => installMcpConfig(home, join(home, "app")), /not valid JSON/);
		assert.equal(readFileSync(path, "utf8"), "malformed JSON");
		const conflict = JSON.stringify({ mcpServers: { "loki-web": other } });
		writeFileSync(path, conflict);
		assert.throws(() => installMcpConfig(home, join(home, "app")), /already exists/);
		assert.equal(readFileSync(path, "utf8"), conflict);
	} finally { rmSync(home, { recursive: true, force: true }); }
});

test("upstream MCP accepts SSE results, forbids unsafe bases and does not echo HTTP error bodies", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n', { headers: { "content-type": "text/event-stream" } }));
	assert.deepEqual(await requestWebGroundingMcp("FAKE_TOKEN", PROD_UPSTREAM, "tools/list"), { tools: [] });
	await assert.rejects(requestWebGroundingMcp("FAKE_TOKEN", "http://remote.example", "tools/list"), /HTTPS/);
	t.mock.method(globalThis, "fetch", async () => new Response("secret-echo-do-not-forward", { status: 401 }));
	await assert.rejects(requestWebGroundingMcp("FAKE_TOKEN", PROD_UPSTREAM, "tools/list"), (error) => error.message.includes("HTTP 401") && !error.message.includes("secret-echo"));
});
