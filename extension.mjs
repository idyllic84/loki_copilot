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
 *      - `/loki-models [prod | msit | df]`
 *   4. Registers agent tools (`skipPermission: true` read-only):
 *      - `loki_web_search`
 *      - `loki_web_browse`
 *      - `loki_quota`
 *      - `loki_models`
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
import { lokiWebBrowse, lokiWebSearch } from "./src/search.mjs";
import { acquireWamToken, getValidToken } from "./src/wam.mjs";

const CONVERSATION_ID = process.env.SESSION_ID || randomUUID();

const bearerTokenProvider = async () => {
	const tok = await getValidToken();
	return tok.accessToken;
};

let initialProviders = [];
let initialModels = [];
let startupWarning = null;

try {
	const cfg = loadExtensionConfig();
	const tok = await getValidToken(AbortSignal.timeout(25_000));
	const catalog = await fetchLokiCatalog(tok.accessToken, cfg.endpoint);
	const built = buildCopilotProvidersAndModels(catalog, cfg.endpoint, {
		bearerTokenProvider,
		bearerToken: tok.accessToken,
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
	if (session?.registerBearerTokenProviders) {
		session.registerBearerTokenProviders(
			new Map([
				[LOKI_ANTHROPIC_PROVIDER, bearerTokenProvider],
				[LOKI_OPENAI_PROVIDER, bearerTokenProvider],
			]),
		);
	}
	const { providers, models } = buildCopilotProvidersAndModels(catalog, endpoint, {
		bearerTokenProvider,
		bearerToken: tok.accessToken,
		conversationId: CONVERSATION_ID,
		forRpcSync: true,
	});
	if (session?.rpc?.provider?.sync) {
		await session.rpc.provider.sync({ providers, models });
	} else if (session?.rpc?.provider?.add) {
		await session.rpc.provider.add({ providers, models });
	}
	try {
		const cur = await session?.rpc?.model?.getCurrent?.();
		const activeModelId = cur?.modelId || cur?.selectedModelId || cur?.committedModelId;
		if (
			typeof activeModelId === "string" &&
			(activeModelId.startsWith(`${LOKI_ANTHROPIC_PROVIDER}/`) ||
				activeModelId.startsWith(`${LOKI_OPENAI_PROVIDER}/`))
		) {
			await session.rpc.model.switchTo({ modelId: activeModelId });
		}
	} catch {}
	return catalog;
}

session = await joinSession({
	...(initialProviders.length > 0 ? { providers: initialProviders, models: initialModels } : {}),
	hooks: {
		onSessionStart: async () => {
			const cfg = loadExtensionConfig();
			if (startupWarning) {
				await session.log(`[loki] Startup catalog warning: ${startupWarning}`, {
					level: "warning",
					ephemeral: true,
				});
			} else if (initialModels.length > 0) {
				await session.log(
					`[loki] Connected to ${formatEndpointLabel(cfg.endpoint)} (${initialModels.length} live models registered)`,
					{ ephemeral: true },
				);
			}
		},
	},
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
				if (process.platform === "win32") {
					try {
						const { execFile } = await import("node:child_process");
						execFile(
							"powershell.exe",
							[
								"-NoProfile",
								"-Command",
								`[Environment]::SetEnvironmentVariable("COPILOT_LOKI_BASE_URL", $env:NEXT_LOKI_URL, "User")`,
							],
							{ env: { ...process.env, NEXT_LOKI_URL: nextUrl }, windowsHide: true },
							() => {},
						);
					} catch {}
				}
				try {
					const catalog = await syncProvidersAndModels(nextUrl);
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
		{
			name: "loki-models",
			description: "List live models from Loki GET /models [prod | msit | df]",
			handler: async (ctx) => {
				try {
					const cfg = loadExtensionConfig();
					const arg = (ctx.args || "").trim();
					const endpoint = arg ? resolveEndpointAlias(arg) : cfg.endpoint;
					const tok = await getValidToken();
					const catalog = await fetchLokiCatalog(tok.accessToken, endpoint);
					await session.log(formatModelsTable(catalog, endpoint));
				} catch (err) {
					await session.log(`[loki] Models query failed: ${err instanceof Error ? err.message : String(err)}`, {
						level: "error",
					});
				}
			},
		},
		{
			name: "loki-model",
			description: "Select or switch a Loki model interactively or by ID (e.g. /loki-model or /loki-model df/claude-opus-5.5)",
			handler: async (ctx) => {
				try {
					let raw = (ctx.args || "").trim();
					let cfg = loadExtensionConfig();
					if (!raw) {
						const tok = await getValidToken();
						const catalog = await fetchLokiCatalog(tok.accessToken, cfg.endpoint);
						if (session.capabilities?.ui?.elicitation && catalog.length > 0) {
							const cur = await session.rpc.model.getCurrent().catch(() => null);
							const curId = String(cur?.modelId || "").replace(/^loki-(anthropic|openai)\//, "");
							const ids = catalog.map((m) => m.id);
							const names = catalog.map(
								(m) => `${m.name} (${m.id}) — ctx ${Math.round(m.contextWindow / 1000)}K, $${m.cost.input}/$${m.cost.output}`,
							);
							const resp = await session.ui.elicitation({
								message: `Select a Loki model from ${formatEndpointLabel(cfg.endpoint)}:`,
								requestedSchema: {
									type: "object",
									properties: {
										model: {
											type: "string",
											title: "Model",
											enum: ids,
											enumNames: names,
											default: ids.includes(curId) ? curId : ids[0],
										},
									},
									required: ["model"],
								},
							});
							if (resp?.action === "accept" && resp.content?.model) {
								raw = String(resp.content.model);
							} else {
								return;
							}
						} else {
							const cur = await session.rpc.model.getCurrent();
							await session.log(`[loki] Current session model: ${JSON.stringify(cur)}`);
							return;
						}
					}
					let targetModel = raw;
					const slashIdx = raw.indexOf("/");
					if (slashIdx > 0) {
						const prefix = raw.slice(0, slashIdx).trim();
						const rest = raw.slice(slashIdx + 1).trim();
						if (prefix !== "loki-anthropic" && prefix !== "loki-openai") {
							const ep = resolveEndpointAlias(prefix);
							cfg = saveExtensionConfig({ endpoint: ep });
							await syncProvidersAndModels(ep);
							targetModel = rest;
						}
					}
					const selectionId = targetModel.includes("/")
						? targetModel
						: targetModel.toLowerCase().startsWith("claude")
							? `loki-anthropic/${targetModel}`
							: `loki-openai/${targetModel}`;
					const switched = await session.rpc.model.switchTo({ modelId: selectionId });
					await session.log(
						`[loki] Switched session model to ${switched?.modelId || selectionId} (endpoint: ${formatEndpointLabel(cfg.endpoint)})`,
					);
				} catch (err) {
					await session.log(`[loki] Model switch failed: ${err instanceof Error ? err.message : String(err)}`, {
						level: "error",
					});
				}
			},
		},
	],
	tools: [
		{
			name: "loki_web_search",
			description:
				"Search the web via Microsoft Loki WebGrounding (/tools/web/mcp) and return ranked titles, URLs, and dates.",
			skipPermission: true,
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The web search query.",
					},
					maxResults: {
						type: "integer",
						description: "Maximum number of results to return (1-6, default 6).",
					},
					language: {
						type: "string",
						description: "Two-letter language code (e.g. 'en' or 'zh', default 'en').",
					},
					region: {
						type: "string",
						description: "Two-letter region code (e.g. 'US' or 'CN', default 'US').",
					},
				},
				required: ["query"],
			},
			handler: async (args) => {
				try {
					const cfg = loadExtensionConfig();
					const tok = await getValidToken();
					const results = await lokiWebSearch(tok.accessToken, args.query, {
						baseUrl: cfg.endpoint,
						maxResults: args.maxResults,
						language: args.language,
						region: args.region,
					});
					return JSON.stringify(results, null, 2);
				} catch (err) {
					process.stderr.write(`[loki-ext] loki_web_search error: ${err?.stack || err}\n`);
					throw err;
				}
			},
		},
		{
			name: "loki_web_browse",
			description: "Fetch a single web page's full text content via Microsoft Loki WebGrounding (/tools/web/mcp).",
			skipPermission: true,
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The HTTPS URL of the webpage to fetch.",
					},
					maxLength: {
						type: "integer",
						description: "Maximum characters of page content to return (1-20000, default 20000).",
					},
				},
				required: ["url"],
			},
			handler: async (args) => {
				try {
					const cfg = loadExtensionConfig();
					const tok = await getValidToken();
					return await lokiWebBrowse(tok.accessToken, args.url, {
						baseUrl: cfg.endpoint,
						maxLength: args.maxLength,
					});
				} catch (err) {
					process.stderr.write(`[loki-ext] loki_web_browse error: ${err?.stack || err}\n`);
					throw err;
				}
			},
		},
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
			name: "loki_switch_model",
			description:
				"Switch the active Copilot session model to a Loki model (e.g. 'claude-opus-5.5', 'claude-opus-5', 'gpt-61-sol', or 'df/claude-opus-5.5').",
			skipPermission: true,
			parameters: {
				type: "object",
				properties: {
					model: {
						type: "string",
						description:
							"Model ID (e.g. 'claude-opus-5.5', 'gpt-61-sol') or '<endpoint>/<model>' (e.g. 'df/claude-opus-5.5').",
					},
					reasoningEffort: {
						type: "string",
						description: "Optional reasoning effort: low, medium, high, xhigh, max.",
					},
				},
				required: ["model"],
			},
			handler: async (args) => {
				const raw = String(args.model || "").trim();
				let cfg = loadExtensionConfig();
				let targetModel = raw;
				const slashIdx = raw.indexOf("/");
				if (slashIdx > 0) {
					const prefix = raw.slice(0, slashIdx).trim();
					const rest = raw.slice(slashIdx + 1).trim();
					if (prefix !== "loki-anthropic" && prefix !== "loki-openai") {
						const ep = resolveEndpointAlias(prefix);
						cfg = saveExtensionConfig({ endpoint: ep });
						await syncProvidersAndModels(ep);
						targetModel = rest;
					}
				}
				const selectionId = targetModel.includes("/")
					? targetModel
					: targetModel.toLowerCase().startsWith("claude")
						? `loki-anthropic/${targetModel}`
						: `loki-openai/${targetModel}`;
				const switched = await session.rpc.model.switchTo({
					modelId: selectionId,
					...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
				});
				return `Switched session model to ${switched?.modelId || selectionId} (endpoint: ${cfg.endpoint})`;
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
