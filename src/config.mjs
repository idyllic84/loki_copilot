/**
 * Constants, endpoints, and persistent configuration for the Loki Copilot CLI Extension.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LOKI_PROVIDER_ID = "loki";
export const LOKI_ANTHROPIC_PROVIDER = "loki-anthropic";
export const LOKI_OPENAI_PROVIDER = "loki-openai";

export const PROD_UPSTREAM = "https://loki.delve.office.com/api/v1/llmapi";
export const MSIT_UPSTREAM = "https://msit.loki.delve.office.com/api/v1/llmapi";
export const DF_UPSTREAM = "https://df.loki.delve.office.com/api/v1/llmapi";
export const DEFAULT_UPSTREAM = (process.env.LOKI_UPSTREAM || PROD_UPSTREAM).replace(/\/+$/, "");

/** M365 Copilot desktop client ID (registered for WAM broker auth). */
export const CLIENT_ID = "0ec893e0-5785-4de6-99da-4ed124e5296c";
export const LOKI_RESOURCE = "42c8f7bd-c7a8-4ba9-bc1c-91edfb716247";
export const LOKI_SCOPES = [`${LOKI_RESOURCE}/.default`];
export const AUTHORITY = "https://login.microsoftonline.com/common";

export const LOKI_API_VERSION = "2026-10-21";
export const LOKI_QUOTA_API_VERSION = "2026-09-28";
export const CREDIT_TO_USD = 0.01;

export const LOKI_HEADERS = {
	"X-ClientType": "Copilot",
	"X-ClientFeature": "LlmApiProxy",
	"X-ClientScenario": "Code",
	"X-HostPlatform": "Windows",
	"X-Llm-Api-Version": LOKI_API_VERSION,
};

export const ENDPOINT_ALIASES = {
	prod: PROD_UPSTREAM,
	production: PROD_UPSTREAM,
	default: PROD_UPSTREAM,
	msit: MSIT_UPSTREAM,
	df: DF_UPSTREAM,
	dogfood: DF_UPSTREAM,
	sdf: DF_UPSTREAM,
};

export function resolveEndpointAlias(input) {
	const trimmed = String(input || "").trim();
	const low = trimmed.toLowerCase();
	if (ENDPOINT_ALIASES[low]) {
		return ENDPOINT_ALIASES[low];
	}
	if (trimmed.startsWith("https://") || trimmed.startsWith("http://127.0.0.1") || trimmed.startsWith("http://localhost")) {
		return trimmed.replace(/\/+$/, "");
	}
	throw new Error(`Invalid endpoint "${input}". Use prod, msit, df, or an https:// URL.`);
}

export function formatEndpointLabel(url) {
	const clean = String(url || "").replace(/\/+$/, "");
	if (clean === PROD_UPSTREAM) return `prod (${PROD_UPSTREAM})`;
	if (clean === MSIT_UPSTREAM) return `msit (${MSIT_UPSTREAM})`;
	if (clean === DF_UPSTREAM) return `df (${DF_UPSTREAM})`;
	return clean;
}

export function getStateDir() {
	return process.env.LOKI_COPILOT_HOME || join(homedir(), ".copilot", "loki-state");
}

export function getConfigPath() {
	return join(getStateDir(), "config.json");
}

export function getWamCachePath() {
	return join(getStateDir(), "msal-cache.json");
}

export function loadExtensionConfig() {
	const path = getConfigPath();
	const defaults = { endpoint: DEFAULT_UPSTREAM };
	if (!existsSync(path)) return defaults;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
		return {
			endpoint:
				typeof raw.endpoint === "string" && raw.endpoint.trim()
					? raw.endpoint.trim().replace(/\/+$/, "")
					: DEFAULT_UPSTREAM,
			account: typeof raw.account === "string" && raw.account.trim() ? raw.account.trim() : undefined,
			accessToken: typeof raw.accessToken === "string" && raw.accessToken.trim() ? raw.accessToken.trim() : undefined,
			expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
		};
	} catch {
		return defaults;
	}
}

export function saveExtensionConfig(patch) {
	const current = loadExtensionConfig();
	const next = { ...current, ...patch };
	const path = getConfigPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return next;
}
