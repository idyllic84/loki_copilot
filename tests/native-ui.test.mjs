import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Opt-in: opens the real CLI in a headless ConPTY (no visible console window).
// Requires an installed extension and existing WAM authentication. No CLI internals.
const enabled = process.platform === "win32" && process.env.LOKI_COPILOT_TUI_TEST === "1";
test("native /model lists dynamic Loki models and supports Low through Max", { skip: !enabled, timeout: 100_000 }, async () => {
	const { default: pty } = await import("@lydell/node-pty");
	const xterm = await import("@xterm/headless");
	const Terminal = xterm.Terminal || xterm.default.Terminal;
	const screen = new Terminal({ cols: 150, rows: 55, scrollback: 100, allowProposedApi: true });
	const cli = process.env.COPILOT_TEST_CLI || execFileSync("where.exe", ["copilot.exe"], { windowsHide: true, encoding: "utf8" }).trim().split(/\r?\n/)[0];
	const home = process.env.COPILOT_HOME || join(homedir(), ".copilot");
	const providersPath = join(home, "providers.json");
	const fingerprint = () => {
		try { return createHash("sha256").update(readFileSync(providersPath)).digest("hex"); }
		catch (error) { if (error.code === "ENOENT") return null; throw error; }
	};
	const before = fingerprint();
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/^COPILOT_(LOKI_|PROVIDER_)/.test(key)) delete env[key];
	}
	const args = ["--no-auto-update", "--disable-builtin-mcps", "--no-custom-instructions", "--no-mouse", "--no-color"];
	// Use a normal executable or the official JavaScript entry point for version-pinned testing.
	const child = pty.spawn(cli.endsWith(".js") ? process.execPath : cli, cli.endsWith(".js") ? [cli, ...args] : args, {
		cols: 150, rows: 55, cwd: process.cwd(), env, useConptyDll: true,
	});
	let closed = false;
	screen.onData((data) => { if (!closed) child.write(data); });
	child.onData((data) => { if (!closed) screen.write(data); });
	const text = () => {
		const buffer = screen.buffer.active;
		return Array.from({ length: 55 }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) || "").join("\n");
	};
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const waitFor = async (predicate, description, timeout = 20_000) => {
		const until = Date.now() + timeout;
		while (Date.now() < until) {
			if (predicate(text())) return;
			await delay(200);
		}
		assert.fail(`Timed out waiting for ${description}; no private terminal transcript is printed.`);
	};
	try {
		let allowed = false;
		const until = Date.now() + 30_000;
		while (Date.now() < until) {
			const current = text();
			if (current.includes("Would you like to add this key binding")) child.write("\x1b");
			else if (current.includes('Extension "user:loki" wants elevated permissions')) {
				// One launch only; do not persist a global permission grant.
				assert.ok(!allowed, "Unexpected repeated extension permission request.");
				child.write("\r");
				allowed = true;
			} else if (current.includes("Interactive") && !current.includes("still waiting on extensions")) {
				break;
			}
			await delay(800);
		}
		// Allow asynchronous extension activation to settle before opening the native picker.
		await delay(3000);
		child.write("/model"); await delay(300); child.write("\r");
		await waitFor((value) => value.includes("Search models"), "native model picker");
		child.write("loki");
		const target = process.env.LOKI_TEST_MODEL_LABEL || "Claude Opus 5.5 [Loki]";
		await waitFor((value) => value.includes(target), "dynamic Loki entry");
		for (let i = 0; i < 30; i++) {
			const selected = text().split("\n").find((line) => /^\s*❯\s+/.test(line) && line.includes(target));
			if (selected) break;
			child.write("\x1b[B"); await delay(150);
		}
		const selectedLine = () => text().split("\n").find((line) => /^\s*❯\s+/.test(line) && line.includes(target)) || "";
		assert.ok(selectedLine(), "The target must be an actual selectable row, not only a timeline message.");
		for (let i = 0; i < 6; i++) { child.write("\x1b[D"); await delay(120); }
		await waitFor(() => selectedLine().includes("Low"), "Low reasoning");
		for (const level of ["Medium", "High", "Extra High", "Max"]) {
			child.write("\x1b[C");
			await waitFor(() => selectedLine().includes(level), `${level} reasoning`);
		}
		child.write("\x1b[D\x1b[D"); await delay(300); child.write("\r");
		await waitFor((value) => value.includes("(high) for this session") || value.includes(`${target} · High`), "committed High effort");
		// Refresh the live directory through the extension, then check the native
		// picker again. This covers callback auth and effort surviving provider.sync.
		child.write("/loki-endpoint prod"); await delay(300); child.write("\r");
		await waitFor((value) => value.includes("Switched endpoint to prod"), "live catalog resynchronization");
		child.write("/model"); await delay(300); child.write("\r");
		await waitFor((value) => value.includes("Search models"), "reopened native picker");
		child.write("loki");
		await waitFor(() => selectedLine().includes("High"), "High effort preserved after live refresh");
		child.write("\r"); await delay(700);
		if (process.env.LOKI_COPILOT_LIVE_TEST === "1") {
			child.write("Reply exactly: LOKI_NATIVE_HIGH_OK."); await delay(300); child.write("\r");
			await waitFor((value) => /●\s+LOKI_NATIVE_HIGH_OK\.?/.test(value), "real Loki response after native High selection", 35_000);
		}
		assert.equal(fingerprint(), before, "Native integration must not create or change providers.json.");
	} finally {
		closed = true;
		child.kill();
		screen.dispose();
	}
});
