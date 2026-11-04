import assert from "node:assert/strict";
import test from "node:test";
import { buildCopilotProvidersAndModels, fetchLokiCatalog, formatModelsTable } from "../src/catalog.mjs";
import {
	DF_UPSTREAM,
	LOKI_ANTHROPIC_PROVIDER,
	LOKI_OPENAI_PROVIDER,
	MSIT_UPSTREAM,
	PROD_UPSTREAM,
	resolveEndpointAlias,
} from "../src/config.mjs";
import { fetchLokiQuota, formatLokiQuota } from "../src/quota.mjs";
import { lokiWebBrowse, lokiWebSearch } from "../src/search.mjs";

test("resolveEndpointAlias maps prod, msit, df, and custom HTTPS URLs", () => {
	assert.equal(resolveEndpointAlias("prod"), PROD_UPSTREAM);
	assert.equal(resolveEndpointAlias("msit"), MSIT_UPSTREAM);
	assert.equal(resolveEndpointAlias("df"), DF_UPSTREAM);
	assert.equal(resolveEndpointAlias("https://custom.example.com/llmapi/"), "https://custom.example.com/llmapi");
	assert.throws(() => resolveEndpointAlias("http://insecure.example.com"), /Invalid endpoint/);
});

test("fetchLokiCatalog and buildCopilotProvidersAndModels map Claude and GPT models to Copilot SDK BYOK providers", async (t) => {
	t.mock.method(globalThis, "fetch", async () => {
		return new Response(
			JSON.stringify({
				data: [
					{
						id: "claude-opus-5.5",
						display_name: "Claude Opus 5.5",
						supported_endpoints: ["/v1/messages"],
						capabilities: {
							limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 128_000 },
							supports: { reasoning_effort: ["low", "medium", "high", "xhigh", "max"] },
						},
						billing: { price_unit: "CopilotCredit", cost_per_input_token: 0.00044, cost_per_output_token: 0.0022 },
					},
					{
						id: "gpt-61-sol",
						display_name: "GPT-6.1 Sol",
						supported_endpoints: ["/responses"],
						capabilities: {
							limits: { max_context_window_tokens: 1_050_000, max_output_tokens: 128_000 },
							supports: { reasoning_effort: ["low", "medium", "high", "xhigh", "max"] },
						},
						billing: { price_unit: "CopilotCredit", cost_per_input_token: 0.00022, cost_per_output_token: 0.0011 },
					},
				],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	});

	const catalog = await fetchLokiCatalog("TEST_TOKEN", DF_UPSTREAM);
	assert.equal(catalog.length, 2);

	const dummyBearer = async () => "TEST_TOKEN";
	const { providers, models } = buildCopilotProvidersAndModels(catalog, DF_UPSTREAM, {
		bearerTokenProvider: dummyBearer,
		bearerToken: "TEST_TOKEN",
		conversationId: "00000000-0000-0000-0000-000000000001",
	});

	assert.equal(providers.length, 2);
	assert.equal(providers[0].name, LOKI_ANTHROPIC_PROVIDER);
	assert.equal(providers[0].type, "anthropic");
	assert.equal(providers[0].headers["X-ConversationId"], "00000000-0000-0000-0000-000000000001");
	assert.equal(providers[0].headers["anthropic-version"], "2023-06-01");
	assert.equal(providers[1].name, LOKI_OPENAI_PROVIDER);
	assert.equal(providers[1].type, "openai");
	assert.equal(providers[1].wireApi, "responses");
	assert.equal(providers[1].headers["X-ConversationId"], "00000000-0000-0000-0000-000000000001");

	const synced = buildCopilotProvidersAndModels(catalog, PROD_UPSTREAM, {
		bearerTokenProvider: dummyBearer,
		bearerToken: "TEST_TOKEN",
		forRpcSync: true,
	});
	assert.equal(synced.providers[0].hasBearerTokenProvider, true);
	assert.equal(synced.providers[0].bearerToken, "TEST_TOKEN");

	assert.equal(models.length, 2);
	assert.equal(models[0].id, "claude-opus-5.5");
	assert.equal(models[0].provider, LOKI_ANTHROPIC_PROVIDER);
	assert.equal(models[0].name, "Claude Opus 5.5 [Loki]");
	assert.equal(models[1].id, "gpt-61-sol");
	assert.equal(models[1].provider, LOKI_OPENAI_PROVIDER);
	assert.equal(models[1].name, "GPT-6.1 Sol [Loki]");
	assert.deepEqual(models[0].capabilities.supports.reasoning_effort, ["low", "medium", "high", "xhigh", "max"]);
	assert.equal(models[0].capabilities.supports.adaptive_thinking, "adaptive_only");
	assert.equal(models[1].capabilities.supports.adaptive_thinking, undefined);
	assert.equal(models[0].capabilities.limits.max_context_window_tokens, 1_000_000);
	assert.equal(models[0].capabilities.limits.max_prompt_tokens, 872_000);
	assert.equal(models[0].capabilities.limits.max_output_tokens, 128_000);
	assert.notEqual(models[0].capabilities, catalog[0].capabilities);
	assert.equal(catalog[0].capabilities.supports.adaptive_thinking, undefined, "Registration must not mutate the discovery response.");

	const table = formatModelsTable(catalog, DF_UPSTREAM);
	assert.match(table, /loki-anthropic\/claude-opus-5\.5/);
	assert.match(table, /loki-openai\/gpt-61-sol/);
});

test("fetchLokiQuota and WebGrounding tools work with mocked Loki endpoints", async (t) => {
	t.mock.method(globalThis, "fetch", async (url, init) => {
		if (String(url).endsWith("/quota")) {
			return new Response(
				JSON.stringify({
					quotaSnapshots: {
						enterprise: {
							service: "CopilotCode",
							usageScope: "user",
							accessState: "allowed",
							capacityState: "available",
							consumedQuantity: 500,
							usageUnit: "ai_credits",
							entitledQuantity: -1,
							availableQuantity: -1,
						},
					},
				}),
				{ status: 200 },
			);
		}
		const body = JSON.parse(String(init.body));
		if (body.params.name === "web") {
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify([{ url: "https://example.com", title: "Example" }]),
							},
						],
					},
				}),
				{ status: 200 },
			);
		}
		return new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				result: { content: [{ type: "text", text: "Page body" }] },
			}),
			{ status: 200 },
		);
	});

	const quota = await fetchLokiQuota("TEST_TOKEN", PROD_UPSTREAM);
	assert.match(formatLokiQuota(quota, PROD_UPSTREAM), /500\.00 ai_credits \(~\$5\.00\)/);

	const searchRes = await lokiWebSearch("TEST_TOKEN", "hello", { baseUrl: PROD_UPSTREAM });
	assert.equal(searchRes[0].url, "https://example.com");

	const browseRes = await lokiWebBrowse("TEST_TOKEN", "https://example.com", { baseUrl: PROD_UPSTREAM });
	assert.equal(browseRes, "Page body");
});
