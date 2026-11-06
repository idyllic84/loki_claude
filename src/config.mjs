/**
 * Constants, endpoints and persistent plugin state for the Loki Claude Code plugin.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROD_UPSTREAM = "https://loki.delve.office.com/api/v1/llmapi";
export const MSIT_UPSTREAM = "https://msit.loki.delve.office.com/api/v1/llmapi";
export const DF_UPSTREAM = "https://df.loki.delve.office.com/api/v1/llmapi";
export const DEFAULT_UPSTREAM = PROD_UPSTREAM;

/** M365 Copilot desktop client ID (registered for WAM broker auth). */
export const CLIENT_ID = "0ec893e0-5785-4de6-99da-4ed124e5296c";
export const LOKI_RESOURCE = "42c8f7bd-c7a8-4ba9-bc1c-91edfb716247";
export const AUTHORITY = "https://login.microsoftonline.com/common";

export const LOKI_API_VERSION = "2026-10-21";
export const LOKI_QUOTA_API_VERSION = "2026-09-28";
export const CREDIT_TO_USD = 0.01;

/** Headers Loki requires on every request. */
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
	const alias = ENDPOINT_ALIASES[trimmed.toLowerCase()];
	if (alias) return alias;
	let url;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`Invalid endpoint "${input}". Use prod, msit, df, or an https:// URL.`);
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
		throw new Error(`Invalid endpoint "${input}". Use prod, msit, df, or an https:// URL.`);
	}
	return url.href.replace(/\/+$/, "");
}

export function formatEndpointLabel(url) {
	const clean = String(url || "").replace(/\/+$/, "");
	if (clean === PROD_UPSTREAM) return `prod (${PROD_UPSTREAM})`;
	if (clean === MSIT_UPSTREAM) return `msit (${MSIT_UPSTREAM})`;
	if (clean === DF_UPSTREAM) return `df (${DF_UPSTREAM})`;
	return clean;
}

/** Claude Code configuration directory, honoring `CLAUDE_CONFIG_DIR`. */
export function getClaudeDir() {
	return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function getStatePath() {
	return process.env.LOKI_CLAUDE_STATE || join(getClaudeDir(), "loki-state", "config.json");
}

function readJson(path) {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	} catch {
		return {};
	}
}

/** Plugin state: endpoint, token cache, fallback conversation id, activation and the settings backup. */
export function loadState() {
	const raw = readJson(getStatePath());
	const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
	return {
		endpoint: text(raw.endpoint)?.replace(/\/+$/, "") ?? DEFAULT_UPSTREAM,
		account: text(raw.account),
		accessToken: text(raw.accessToken),
		expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
		conversationId: text(raw.conversationId),
		active: raw.active === true,
		settingsBackup: raw.settingsBackup && typeof raw.settingsBackup === "object" && !Array.isArray(raw.settingsBackup) ? raw.settingsBackup : undefined,
	};
}

export function saveState(patch) {
	const next = { ...loadState(), ...patch };
	for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
	const path = getStatePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return next;
}

/** A stable fallback conversation id; the plugin replaces it per session at runtime. */
export function ensureConversationId() {
	const state = loadState();
	if (state.conversationId) return state.conversationId;
	const conversationId = randomUUID();
	saveState({ conversationId });
	return conversationId;
}

/** `ANTHROPIC_CUSTOM_HEADERS` value: one `Name: Value` pair per line. */
export function buildCustomHeaders(conversationId) {
	return [...Object.entries(LOKI_HEADERS).map(([name, value]) => `${name}: ${value}`), `X-ConversationId: ${conversationId}`].join("\n");
}
