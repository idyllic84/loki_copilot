import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fetchLokiCatalog, buildCopilotProvidersAndModels } from "../src/catalog.mjs";
import { DEFAULT_UPSTREAM, PROD_UPSTREAM } from "../src/config.mjs";

test("future models and per-model thinking levels are discovered dynamically on every refresh", async (t) => {
	const entry = {
		id: "future-model-not-hardcoded", supported_endpoints: ["/responses"],
		capabilities: {
			limits: { max_context_window_tokens: 1_048_576, max_prompt_tokens: 983_040, max_output_tokens: 65_536 },
			supports: { vision: true, reasoning_effort: ["none", "low", "high"] },
		},
	};
	let call = 0;
	t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: call++ === 0 ? [entry] : [] })));
	const discovered = await fetchLokiCatalog("TEST_TOKEN");
	const { models } = buildCopilotProvidersAndModels(discovered, PROD_UPSTREAM);
	assert.equal(models[0].wireModel, entry.id);
	assert.deepEqual(models[0].capabilities.supports.reasoning_effort, ["none", "low", "high"]);
	assert.equal(models[0].capabilities.supports.vision, true);
	assert.equal(models[0].maxPromptTokens, 983_040);
	assert.equal(models[0].maxOutputTokens, 65_536);
	assert.equal(models[0].maxContextWindowTokens, 1_048_576);
	assert.equal(models[0].name, `${entry.id} [Loki]`);
	assert.deepEqual(await fetchLokiCatalog("TEST_TOKEN"), [], "Removed models must not survive as cached/static entries.");
	assert.equal(call, 2);
});

test("non-reasoning models do not advertise fabricated thinking levels", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: [{
		id: "plain-model", supported_endpoints: ["/responses"],
		capabilities: { limits: { max_context_window_tokens: 200_000, max_output_tokens: 20_000 }, supports: {} },
	}] })));
	const catalog = await fetchLokiCatalog("TEST_TOKEN");
	const model = buildCopilotProvidersAndModels(catalog, PROD_UPSTREAM).models[0];
	assert.deepEqual(model.capabilities.supports.reasoning_effort, []);
	assert.equal(model.capabilities.supports.adaptive_thinking, undefined);
});

test("display names are not decorated with guessed window sizes", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: [{
		id: "no-window-model", supported_endpoints: ["/responses"], capabilities: { supports: {} },
	}] })));
	const catalog = await fetchLokiCatalog("TEST_TOKEN");
	const { models } = buildCopilotProvidersAndModels(catalog, PROD_UPSTREAM);
	assert.equal(models[0].name, "no-window-model [Loki]");
});

test("unknown pricing is not displayed as free and advertised zero pricing remains valid", async (t) => {
	const billing = [
		null,
		{ price_unit: "UnknownUnit", cost_per_input_token: 1, cost_per_output_token: 2 },
		{ price_unit: "CopilotCredit", cost_per_input_token: 0 },
		{ price_unit: "CopilotCredit", cost_per_input_token: 0, cost_per_output_token: 0 },
	];
	t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: billing.map((price, i) => ({
		id: `pricing-${i}`, supported_endpoints: ["/responses"], billing: price,
		capabilities: { limits: { max_context_window_tokens: 200_000, max_output_tokens: 20_000 }, supports: {} },
	})) })));
	const catalog = await fetchLokiCatalog("TEST_TOKEN");
	for (const item of catalog.slice(0, 3)) assert.equal(item.priceLabel, "price=unknown");
	assert.equal(catalog[3].priceLabel, "~$0.00/$0.00/1M");
	for (const model of buildCopilotProvidersAndModels(catalog, PROD_UPSTREAM).models) {
		assert.equal(model.name, `${model.id} [Loki]`, "Do not imitate native columns by changing the model name.");
	}
});

test("prod is the default, with no static model list or competing model-selection command", () => {
	assert.equal(DEFAULT_UPSTREAM, PROD_UPSTREAM);
	const source = readFileSync(new URL("../extension.mjs", import.meta.url), "utf8");
	assert.ok(!/name:\s*"loki-models?"/.test(source));
	assert.ok(!/name:\s*"loki_switch_model"/.test(source));
	assert.ok(!source.includes("registerBearerTokenProviders"), "Do not depend on SDK-internal callback registration methods.");
});
