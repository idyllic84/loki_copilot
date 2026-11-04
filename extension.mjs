/**
 * Microsoft Entra (Loki LLM API) Extension for GitHub Copilot CLI.
 *
 * Joins the foreground Copilot CLI session via `@github/copilot-sdk/extension` and:
 *   1. Acquires & refreshes M365 Entra tokens via Windows WAM (`bearerTokenProvider`).
 *   2. Fetches live models from `<endpoint>/models` and registers additive BYOK
 *      providers (`loki-anthropic`, `loki-openai`) and models so `/model` can
 *      select any Loki model (`loki-anthropic/claude-opus-5.5`, `loki-openai/gpt-61-sol`, etc.).
 *   3. Registers slash commands:
 *      - `/loki-login [account | picker]`
 *      - `/loki-endpoint [prod | msit | df | <https://...>]`
 *      - `/loki-usage [prod | msit | df]`
 *   4. Registers `loki-web` as a native MCP server (web + browse).
 *   5. Registers read-only quota and model-catalog agent tools.
 */

import { randomUUID } from "node:crypto";
import { joinSession } from "@github/copilot-sdk/extension";
import { buildCopilotProvidersAndModels, fetchLokiCatalog, formatModelsTable } from "./src/catalog.mjs";
import {
	DF_UPSTREAM,
	LOKI_ANTHROPIC_PROVIDER,
	LOKI_OPENAI_PROVIDER,
	MSIT_UPSTREAM,
	PROD_UPSTREAM,
	formatEndpointLabel,
	loadExtensionConfig,
	resolveEndpointAlias,
	saveExtensionConfig,
} from "./src/config.mjs";
import { fetchLokiQuota, formatLokiQuota } from "./src/quota.mjs";
import { refreshWebGrounding } from "./src/web-grounding.mjs";
import { acquireWamToken, getValidToken } from "./src/wam.mjs";

const CONVERSATION_ID = process.env.SESSION_ID || randomUUID();

const bearerTokenProvider = async () => {
	const tok = await getValidToken();
	return tok.accessToken;
};

// Register both auth callbacks even if initial discovery fails. Later refreshes
// use the same SDK-owned callbacks; no SDK-internal registration APIs are needed.
let initialProviders = buildCopilotProvidersAndModels([], loadExtensionConfig().endpoint, {
	bearerTokenProvider,
	conversationId: CONVERSATION_ID,
}).providers;
let initialModels = [];
let startupWarning = null;

try {
	const cfg = loadExtensionConfig();
	const tok = await getValidToken(AbortSignal.timeout(25_000));
	const catalog = await fetchLokiCatalog(tok.accessToken, cfg.endpoint);
	const built = buildCopilotProvidersAndModels(catalog, cfg.endpoint, {
		bearerTokenProvider,
		conversationId: CONVERSATION_ID,
		forRpcSync: false,
	});
	initialProviders = built.providers;
	initialModels = built.models;
} catch (err) {
	startupWarning = err instanceof Error ? err.message : String(err);
}

let session;

async function syncProvidersAndModels(endpoint) {
	const tok = await getValidToken();
	const catalog = await fetchLokiCatalog(tok.accessToken, endpoint);
	const { providers, models } = buildCopilotProvidersAndModels(catalog, endpoint, {
		bearerTokenProvider,
		conversationId: CONVERSATION_ID,
		forRpcSync: true,
	});
	if (!session?.rpc?.provider?.sync) {
		throw new Error("This Copilot CLI version does not support live provider synchronization. Update Copilot CLI.");
	}
	await session.rpc.provider.sync({ providers, models });
	// Use the public session catalog API so the host sees the refreshed model metadata.
	await session.rpc.model.list({ skipCache: true });
	try {
		const cur = await session?.rpc?.model?.getCurrent?.();
		const activeModelId = cur?.modelId || cur?.selectedModelId || cur?.committedModelId;
		if (
			typeof activeModelId === "string" &&
			(activeModelId.startsWith(`${LOKI_ANTHROPIC_PROVIDER}/`) ||
				activeModelId.startsWith(`${LOKI_OPENAI_PROVIDER}/`))
		) {
			await session.rpc.model.switchTo({
				modelId: activeModelId,
				...(cur.reasoningEffort ? { reasoningEffort: cur.reasoningEffort } : {}),
			});
		}
	} catch {}
	return catalog;
}

async function syncWebGrounding(options) {
	try {
		await refreshWebGrounding(session, options);
	} catch {
		await session.log("[loki] WebGrounding MCP could not connect. After /loki-login, use /mcp to reload loki-web.", { level: "warning" });
	}
}

session = await joinSession({
	...(initialProviders.length > 0 ? { providers: initialProviders, models: initialModels } : {}),
	commands: [
		{
			name: "loki-login",
			description: "Sign in to Microsoft Entra (Loki) via Windows WAM [account | picker]",
			handler: async (ctx) => {
				const arg = (ctx.args || "").trim();
				const usePicker = arg.toLowerCase() === "picker" || arg.toLowerCase() === "--picker";
				const hint = usePicker ? undefined : arg || undefined;
				try {
					await session.log("[loki] Acquiring Microsoft Entra token via Windows WAM...", { ephemeral: true });
					const tok = await acquireWamToken(usePicker ? "interactive_only" : "interactive", hint);
					const cfg = loadExtensionConfig();
					const catalog = await syncProvidersAndModels(cfg.endpoint);
					await syncWebGrounding();
					await session.log(
						`[loki] Logged in as ${tok.account}. Synced ${catalog.length} models from ${formatEndpointLabel(cfg.endpoint)}.`,
					);
				} catch (err) {
					await session.log(`[loki] Login failed: ${err instanceof Error ? err.message : String(err)}`, {
						level: "error",
					});
				}
			},
		},
		{
			name: "loki-endpoint",
			description: "View or switch Loki endpoint (prod | msit | df | <https://...>)",
			handler: async (ctx) => {
				const rawArg = (ctx.args || "").trim();
				const cfg = loadExtensionConfig();

				let nextUrl = "";
				if (rawArg) {
					try {
						nextUrl = resolveEndpointAlias(rawArg);
					} catch (err) {
						await session.log(`[loki] ${err instanceof Error ? err.message : String(err)}`, {
							level: "error",
						});
						return;
					}
				} else if (session.capabilities?.ui?.elicitation) {
					try {
						const resp = await session.ui.elicitation({
							message: `Current Loki endpoint: ${formatEndpointLabel(cfg.endpoint)}. Select target endpoint:`,
							requestedSchema: {
								type: "object",
								properties: {
									endpoint: {
										type: "string",
										title: "Loki Endpoint",
										enum: ["prod", "msit", "df"],
										enumNames: [
											`Production (${PROD_UPSTREAM})`,
											`MSIT (${MSIT_UPSTREAM})`,
											`Dogfood (${DF_UPSTREAM})`,
										],
										default:
											cfg.endpoint === DF_UPSTREAM
												? "df"
												: cfg.endpoint === MSIT_UPSTREAM
													? "msit"
													: "prod",
									},
								},
								required: ["endpoint"],
							},
						});
						if (resp?.action === "accept" && resp.content?.endpoint) {
							nextUrl = resolveEndpointAlias(String(resp.content.endpoint));
						} else {
							return;
						}
					} catch {
						await session.log(
							`[loki] Current endpoint: ${formatEndpointLabel(cfg.endpoint)}. Usage: /loki-endpoint <prod|msit|df|https://...>`,
						);
						return;
					}
				} else {
					await session.log(
						`[loki] Current endpoint: ${formatEndpointLabel(cfg.endpoint)}. Usage: /loki-endpoint <prod|msit|df|https://...>`,
					);
					return;
				}

				saveExtensionConfig({ endpoint: nextUrl });
				try {
					const catalog = await syncProvidersAndModels(nextUrl);
					await syncWebGrounding();
					await session.log(
						`[loki] Switched endpoint to ${formatEndpointLabel(nextUrl)} (${catalog.length} models synced).`,
					);
				} catch (err) {
					await session.log(
						`[loki] Endpoint saved as ${formatEndpointLabel(nextUrl)}, but GET /models failed: ${err instanceof Error ? err.message : String(err)}`,
						{ level: "warning" },
					);
				}
			},
		},
		{
			name: "loki-usage",
			description: "Query live cloud quota and AI credit usage from Loki GET /quota [prod | msit | df]",
			handler: async (ctx) => {
				try {
					const cfg = loadExtensionConfig();
					const arg = (ctx.args || "").trim();
					const endpoint = arg ? resolveEndpointAlias(arg) : cfg.endpoint;
					const tok = await getValidToken();
					const snapshots = await fetchLokiQuota(tok.accessToken, endpoint);
					await session.log(formatLokiQuota(snapshots, endpoint));
				} catch (err) {
					await session.log(`[loki] Quota query failed: ${err instanceof Error ? err.message : String(err)}`, {
						level: "error",
					});
				}
			},
		},
	],
	tools: [
		{
			name: "loki_quota",
			description: "Query live Microsoft Loki cloud AI credit quota and usage from GET /quota.",
			skipPermission: true,
			parameters: {
				type: "object",
				properties: {
					endpoint: {
						type: "string",
						description: "Optional endpoint alias (prod, msit, df) or full HTTPS URL.",
					},
				},
			},
			handler: async (args) => {
				try {
					const cfg = loadExtensionConfig();
					const endpoint = args?.endpoint ? resolveEndpointAlias(args.endpoint) : cfg.endpoint;
					const tok = await getValidToken();
					const snapshots = await fetchLokiQuota(tok.accessToken, endpoint);
					return formatLokiQuota(snapshots, endpoint);
				} catch (err) {
					process.stderr.write(`[loki-ext] loki_quota error: ${err?.stack || err}\n`);
					throw err;
				}
			},
		},
		{
			name: "loki_models",
			description: "Fetch the live model catalog from Microsoft Loki GET /models.",
			skipPermission: true,
			parameters: {
				type: "object",
				properties: {
					endpoint: {
						type: "string",
						description: "Optional endpoint alias (prod, msit, df) or full HTTPS URL.",
					},
				},
			},
			handler: async (args) => {
				try {
					const cfg = loadExtensionConfig();
					const endpoint = args?.endpoint ? resolveEndpointAlias(args.endpoint) : cfg.endpoint;
					const tok = await getValidToken();
					const catalog = await fetchLokiCatalog(tok.accessToken, endpoint);
					return formatModelsTable(catalog, endpoint);
				} catch (err) {
					process.stderr.write(`[loki-ext] loki_models error: ${err?.stack || err}\n`);
					throw err;
				}
			},
		},
	],
});

await syncWebGrounding({ restart: false });

// Only log after joinSession resolves. No hook or prompt-triggered initialization.
if (startupWarning) {
	await session.log(`[loki] No live catalog: ${startupWarning}. Run /loki-login to retry.`, { level: "warning" });
} else {
	try {
		await session.rpc.model.list();
		await session.log(
			`[loki] ${initialModels.length} live models loaded from ${formatEndpointLabel(loadExtensionConfig().endpoint)}. Use /model, search Loki; use ←/→ for reasoning effort.`,
			{ ephemeral: true },
		);
	} catch (error) {
		await session.log(`[loki] Provider registered, but host catalog refresh failed: ${error.message}`, { level: "warning" });
	}
}
