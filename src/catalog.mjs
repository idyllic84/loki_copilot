/**
 * Live model discovery from Loki `GET /models` and conversion into Copilot SDK
 * `NamedProviderConfig` + `ProviderModelConfig` entries.
 */

import { randomUUID } from "node:crypto";
import {
	CREDIT_TO_USD,
	DEFAULT_UPSTREAM,
	LOKI_ANTHROPIC_PROVIDER,
	LOKI_HEADERS,
	LOKI_OPENAI_PROVIDER,
} from "./config.mjs";

function isAlwaysThinking(modelId) {
	return modelId.includes("5.5") || modelId.includes("5-5");
}

function toUsdPerMillion(billing) {
	if (!billing) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const factor = CREDIT_TO_USD * 1_000_000;
	const round = (n) => Math.round(n * 10_000) / 10_000;
	return {
		input: round((billing.cost_per_input_token ?? 0) * factor),
		output: round((billing.cost_per_output_token ?? 0) * factor),
		cacheRead: round((billing.cache_read_cost_per_token ?? 0) * factor),
		cacheWrite: round((billing.cache_write_cost_per_token ?? 0) * factor),
	};
}

function toCatalogItem(entry, baseUrl) {
	const endpoints = entry.supported_endpoints ?? [];
	const limits = entry.capabilities?.limits;
	const efforts = entry.capabilities?.supports?.reasoning_effort ?? [];
	const reasoning = Array.isArray(efforts) && efforts.length > 0;
	const contextWindow = limits?.max_context_window_tokens ?? 200_000;
	const cost = toUsdPerMillion(entry.billing);
	const displayName = entry.display_name || entry.name || entry.id;

	if (endpoints.includes("/v1/messages")) {
		return {
			id: entry.id,
			name: displayName,
			provider: LOKI_ANTHROPIC_PROVIDER,
			type: "anthropic",
			wireApi: undefined,
			baseUrl,
			contextWindow,
			maxTokens: limits?.max_output_tokens ?? (isAlwaysThinking(entry.id) || entry.id === "claude-opus-5" ? 128_000 : 64_000),
			reasoning,
			reasoningEfforts: efforts,
			cost,
			supportedEndpoints: endpoints,
		};
	}

	if (endpoints.includes("/responses") || endpoints.includes("/chat/completions")) {
		const isResponses = endpoints.includes("/responses");
		return {
			id: entry.id,
			name: displayName,
			provider: LOKI_OPENAI_PROVIDER,
			type: "openai",
			wireApi: isResponses ? "responses" : "completions",
			baseUrl,
			contextWindow,
			maxTokens: limits?.max_output_tokens ?? (isResponses ? 128_000 : 64_000),
			reasoning,
			reasoningEfforts: efforts,
			cost,
			supportedEndpoints: endpoints,
		};
	}

	return null;
}

export async function fetchLokiCatalog(token, baseUrl = DEFAULT_UPSTREAM, signal = AbortSignal.timeout(20_000)) {
	if (!token) throw new Error("Loki is not authenticated. Run /loki-login first.");
	const normalized = (baseUrl || DEFAULT_UPSTREAM).replace(/\/+$/, "");

	const response = await fetch(`${normalized}/models`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			...LOKI_HEADERS,
		},
		signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
	});

	if (!response.ok) {
		let detail = "";
		try {
			const errBody = await response.json();
			const msg = typeof errBody?.error?.message === "string" ? errBody.error.message.trim() : "";
			const code = typeof errBody?.error?.code === "string" ? errBody.error.code.trim() : "";
			if (msg || code) detail = ` (${[code, msg].filter(Boolean).join(": ")})`;
		} catch {}
		throw new Error(`Loki GET /models failed: HTTP ${response.status}${detail}.`);
	}

	const body = await response.json();
	if (!body || !Array.isArray(body.data)) {
		throw new Error("Invalid Loki /models response format");
	}

	return body.data
		.filter((entry) => Boolean(entry) && typeof entry.id === "string")
		.map((entry) => toCatalogItem(entry, normalized))
		.filter(Boolean);
}

/**
 * Build Copilot SDK `NamedProviderConfig[]` and `ProviderModelConfig[]` from a live Loki catalog.
 */
export function buildCopilotProvidersAndModels(catalog, baseUrl, options = {}) {
	const cleanUrl = (baseUrl || DEFAULT_UPSTREAM).replace(/\/+$/, "");
	const {
		bearerTokenProvider,
		bearerToken,
		conversationId = process.env.SESSION_ID || randomUUID(),
		forRpcSync = false,
	} = typeof options === "function" ? { bearerTokenProvider: options } : options;

	const headers = {
		...LOKI_HEADERS,
		"X-ConversationId": conversationId,
	};

	const buildAuthFields = () => {
		if (forRpcSync) {
			return {
				...(bearerTokenProvider ? { hasBearerTokenProvider: true } : {}),
				...(bearerToken ? { bearerToken } : {}),
			};
		}
		return {
			...(bearerTokenProvider ? { bearerTokenProvider } : {}),
			...(bearerToken ? { bearerToken } : {}),
		};
	};

	const providers = [
		{
			name: LOKI_ANTHROPIC_PROVIDER,
			type: "anthropic",
			modelProvider: "anthropic",
			baseUrl: cleanUrl,
			headers: {
				...headers,
				"anthropic-version": "2023-06-01",
			},
			...buildAuthFields(),
		},
		{
			name: LOKI_OPENAI_PROVIDER,
			type: "openai",
			wireApi: "responses",
			modelProvider: "openai",
			baseUrl: cleanUrl,
			headers: { ...headers },
			...buildAuthFields(),
		},
	];

	const models = catalog.map((item) => ({
		id: item.id,
		provider: item.provider,
		wireModel: item.id,
		modelId: item.id,
		name: `${item.name} [Loki]`,
		maxContextWindowTokens: item.contextWindow,
		maxPromptTokens: Math.max(32_000, item.contextWindow - item.maxTokens),
		maxOutputTokens: item.maxTokens,
	}));

	return { providers, models };
}

export function formatModelsTable(models, baseUrl) {
	const lines = [`Loki Live Models (${baseUrl}) — ${models.length} models:`];
	for (const m of models) {
		const ctx = `${Math.round(m.contextWindow / 1000)}K`;
		const maxOut = `${Math.round(m.maxTokens / 1000)}K`;
		const cost = `$${m.cost.input.toFixed(2)}/$${m.cost.output.toFixed(2)}`;
		const selectId = `${m.provider}/${m.id}`;
		lines.push(`  - ${selectId.padEnd(34)} ctx=${ctx.padStart(5)} out=${maxOut.padStart(4)} cost=${cost}`);
	}
	return lines.join("\n");
}
