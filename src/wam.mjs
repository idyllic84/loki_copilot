/**
 * Windows WAM (Web Account Manager) token acquisition for the Loki Copilot CLI Extension.
 *
 * All child processes run with `windowsHide: true` so no console window pops up.
 */

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AUTHORITY, CLIENT_ID, LOKI_RESOURCE, loadExtensionConfig, saveExtensionConfig } from "./config.mjs";

const execFileAsync = promisify(execFile);
const HELPER = join(dirname(fileURLToPath(import.meta.url)), "wam-helper.mjs");
const REFRESH_SKEW_SEC = 5 * 60;

function resolveNodeExecutable() {
	if (/\bnode(\.exe)?$/i.test(process.execPath)) {
		return process.execPath;
	}
	return process.platform === "win32" ? "node.exe" : "node";
}

async function runHelper(args, timeoutMs, signal) {
	if (process.platform !== "win32") {
		throw new Error("Microsoft Entra sign-in requires Windows (WAM broker).");
	}

	let stdout;
	let stderr;
	try {
		({ stdout, stderr } = await execFileAsync(resolveNodeExecutable(), [HELPER, ...args], {
			windowsHide: true,
			timeout: timeoutMs,
			signal,
			env: {
				...process.env,
				LOKI_CLIENT_ID: CLIENT_ID,
				LOKI_RESOURCE: LOKI_RESOURCE,
				LOKI_AUTHORITY: AUTHORITY,
			},
		}));
	} catch (error) {
		const out = error?.stdout;
		if (!out?.trim()) throw error;
		stdout = out;
		stderr = error?.stderr ?? "";
	}

	const lastLine = stdout.trim().split(/\r?\n/).pop()?.trim();
	if (!lastLine) throw new Error(`Empty output from the WAM helper. stderr: ${stderr}`);
	return JSON.parse(lastLine);
}

let inMemoryToken = null;

export async function detectWindowsUpn(signal) {
	if (process.platform !== "win32") return undefined;
	try {
		const { stdout } = await execFileAsync("whoami.exe", ["/upn"], {
			windowsHide: true,
			timeout: 5_000,
			signal,
		});
		const upn = stdout.trim();
		return upn.includes("@") ? upn : undefined;
	} catch {
		return undefined;
	}
}

export async function acquireWamToken(mode, loginHint, signal) {
	const nowSec = Math.floor(Date.now() / 1000);
	if (
		mode === "silent" &&
		inMemoryToken &&
		nowSec + REFRESH_SKEW_SEC < inMemoryToken.expiresAt &&
		(!loginHint || inMemoryToken.account.toLowerCase() === loginHint.toLowerCase())
	) {
		return inMemoryToken;
	}

	const cfg = loadExtensionConfig();
	const effectiveHint = loginHint || cfg.account || (await detectWindowsUpn(signal));

	if (
		mode === "silent" &&
		cfg.accessToken &&
		cfg.expiresAt &&
		nowSec + REFRESH_SKEW_SEC < cfg.expiresAt &&
		(!effectiveHint || (cfg.account && cfg.account.toLowerCase() === effectiveHint.toLowerCase()))
	) {
		inMemoryToken = {
			accessToken: cfg.accessToken,
			expiresAt: cfg.expiresAt,
			account: cfg.account || effectiveHint || "m365-user",
		};
		return inMemoryToken;
	}

	const parsed = await runHelper([mode, effectiveHint || ""], mode === "silent" ? 25_000 : 120_000, signal);
	const accessToken = parsed.access_token;
	const expiresAt = parsed.exp;
	if (typeof parsed.error === "string" || typeof accessToken !== "string" || typeof expiresAt !== "number") {
		throw new Error(typeof parsed.error === "string" ? parsed.error : "Invalid response from the WAM helper");
	}

	const account = typeof parsed.account === "string" ? parsed.account : effectiveHint || "m365-user";
	inMemoryToken = { accessToken, expiresAt, account };
	saveExtensionConfig({ account, accessToken, expiresAt });
	return inMemoryToken;
}

export async function getValidToken(signal) {
	if (process.env.LOKI_TOKEN?.trim()) {
		return {
			accessToken: process.env.LOKI_TOKEN.trim(),
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			account: "env:LOKI_TOKEN",
		};
	}
	return acquireWamToken("silent", undefined, signal);
}
