/**
 * Loki WebGrounding client (`POST <baseUrl>/tools/web/mcp`) for the Loki Copilot CLI Extension.
 */

import { DEFAULT_UPSTREAM, LOKI_HEADERS } from "./config.mjs";

export function buildMcpUrl(baseUrl) {
	const url = new URL(baseUrl || DEFAULT_UPSTREAM);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Loki WebGrounding requires an HTTPS base URL (or HTTP loopback) without credentials, query or fragment.",
		);
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/tools/web/mcp`;
	return url.href;
}

async function callWebGroundingMcp(token, baseUrl, toolName, args, signal = AbortSignal.timeout(30_000)) {
	if (!token) {
		throw new Error("Loki is not authenticated. Run /loki-login before using web search/browse.");
	}
	const mcpUrl = buildMcpUrl(baseUrl);
	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...LOKI_HEADERS,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args,
			},
		}),
		signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
	});

	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(`Loki WebGrounding (${toolName}) failed: HTTP ${response.status} ${errText.slice(0, 200)}`);
	}

	const payload = await response.json();
	if (payload.error) {
		throw new Error(
			`Loki WebGrounding (${toolName}) RPC error: ${payload.error.message || JSON.stringify(payload.error)}`,
		);
	}
	const text = (payload.result?.content ?? [])
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");

	if (payload.result?.isError) {
		throw new Error(`Loki WebGrounding (${toolName}) tool error: ${text}`);
	}
	return text;
}

export async function lokiWebSearch(token, query, opts = {}) {
	const trimmed = String(query || "").trim();
	if (!trimmed) throw new Error("Search query must not be empty.");

	const maxResults = Math.min(6, Math.max(1, opts.maxResults ?? 6));
	const language = opts.language?.trim() || "en";
	const region = opts.region?.trim() || "US";

	const rawText = await callWebGroundingMcp(
		token,
		opts.baseUrl || DEFAULT_UPSTREAM,
		"web",
		{
			query: trimmed,
			maxResults,
			language,
			region,
		},
		opts.signal,
	);

	if (!rawText.trim()) return [];
	try {
		const parsed = JSON.parse(rawText);
		if (Array.isArray(parsed)) {
			return parsed.filter((item) => Boolean(item && typeof item.url === "string"));
		}
	} catch {}
	return [{ url: "", title: rawText.trim() }];
}

export async function lokiWebBrowse(token, pageUrl, opts = {}) {
	const trimmed = String(pageUrl || "").trim();
	if (!trimmed) throw new Error("URL to browse must not be empty.");
	const maxLength = Math.min(20_000, Math.max(1, opts.maxLength ?? 20_000));

	return callWebGroundingMcp(
		token,
		opts.baseUrl || DEFAULT_UPSTREAM,
		"browse",
		{
			url: trimmed,
			maxLength,
		},
		opts.signal,
	);
}
