/**
 * Windows WAM (Web Account Manager) token acquisition. The MSAL broker runs in a
 * short-lived helper process with `windowsHide: true`, so no console window appears.
 */

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AUTHORITY, CLIENT_ID, LOKI_RESOURCE, loadState, saveState } from "./config.mjs";

const execFileAsync = promisify(execFile);
const HELPER = join(dirname(fileURLToPath(import.meta.url)), "wam-helper.mjs");
const REFRESH_SKEW_SEC = 5 * 60;

function resolveNodeExecutable() {
	if (/\bnode(\.exe)?$/i.test(process.execPath)) return process.execPath;
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
			env: { ...process.env, LOKI_CLIENT_ID: CLIENT_ID, LOKI_RESOURCE: LOKI_RESOURCE, LOKI_AUTHORITY: AUTHORITY },
		}));
	} catch (error) {
		const out = error?.stdout;
		if (!out?.trim()) throw error;
		stdout = out;
		stderr = error?.stderr ?? "";
	}
	const lastLine = stdout.trim().split(/\r?\n/).pop()?.trim();
	if (!lastLine) throw new Error(`Empty output from the WAM helper. ${stderr}`.trim());
	return JSON.parse(lastLine);
}

export async function detectWindowsUpn(signal) {
	if (process.platform !== "win32") return undefined;
	try {
		const { stdout } = await execFileAsync("whoami.exe", ["/upn"], { windowsHide: true, timeout: 5_000, signal });
		const upn = stdout.trim();
		return upn.includes("@") ? upn : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Acquire a Loki access token.
 * `mode`: `silent` (cache, then silent SSO), `interactive` (silent first, then WAM UI)
 * or `interactive_only` (Windows account picker).
 */
export async function acquireWamToken(mode, loginHint, signal) {
	const nowSec = Math.floor(Date.now() / 1000);
	const state = loadState();
	const hint = loginHint || state.account || (await detectWindowsUpn(signal));
	const sameAccount = !loginHint || (state.account && state.account.toLowerCase() === loginHint.toLowerCase());

	if (mode === "silent" && state.accessToken && state.expiresAt && nowSec + REFRESH_SKEW_SEC < state.expiresAt && sameAccount) {
		return { accessToken: state.accessToken, expiresAt: state.expiresAt, account: state.account || hint || "m365-user" };
	}

	const parsed = await runHelper([mode, mode === "interactive_only" ? "" : hint || ""], mode === "silent" ? 25_000 : 180_000, signal);
	if (typeof parsed.error === "string" || typeof parsed.access_token !== "string" || typeof parsed.exp !== "number") {
		throw new Error(typeof parsed.error === "string" ? parsed.error : "Invalid response from the WAM helper.");
	}
	const token = {
		accessToken: parsed.access_token,
		expiresAt: parsed.exp,
		account: typeof parsed.account === "string" ? parsed.account : hint || "m365-user",
	};
	saveState(token);
	return token;
}

export function getValidToken(signal) {
	return acquireWamToken("silent", undefined, signal);
}

export function clearToken() {
	saveState({ accessToken: undefined, expiresAt: undefined });
}
