/**
 * Read and update the user's Claude Code `settings.json`.
 *
 * Plugins cannot ship provider settings, so the plugin writes the documented keys
 * itself (`env`, `apiKeyHelper`, `modelOverrides`, `modelPicker`). Every value it
 * replaces is backed up once and restored by `/loki-logout`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getClaudeDir } from "./config.mjs";

/** Keys the plugin owns. `env.*` entries refer to keys inside the `env` object. */
const OWNED = ["apiKeyHelper", "modelOverrides", "modelPicker", "env.ANTHROPIC_BASE_URL", "env.ANTHROPIC_CUSTOM_HEADERS", "env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK"];
/** Credentials that take precedence over `apiKeyHelper`; removed while Loki is active. */
const CONFLICTING = ["env.ANTHROPIC_AUTH_TOKEN", "env.ANTHROPIC_API_KEY"];
/** Model selections that may name a model Loki does not serve. */
const MODEL_KEYS = ["model", "env.ANTHROPIC_MODEL"];
const ALIASES = new Set(["default", "opus", "sonnet", "haiku", "opusplan", "best"]);

export function getSettingsPath() {
	return join(getClaudeDir(), "settings.json");
}

export function readSettings(path = getSettingsPath()) {
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8");
	if (!text.trim()) return {};
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Cannot parse ${path}; fix the JSON before running Loki commands.`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} must contain a JSON object.`);
	return parsed;
}

export function writeSettings(settings, path = getSettingsPath()) {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.loki-${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(temp, path);
}

function getKey(settings, key) {
	if (!key.startsWith("env.")) return settings[key];
	return settings.env && typeof settings.env === "object" ? settings.env[key.slice(4)] : undefined;
}

function hasKey(settings, key) {
	if (!key.startsWith("env.")) return Object.hasOwn(settings, key);
	return Boolean(settings.env && typeof settings.env === "object" && Object.hasOwn(settings.env, key.slice(4)));
}

function setKey(settings, key, value) {
	if (!key.startsWith("env.")) {
		if (value === undefined) delete settings[key];
		else settings[key] = value;
		return;
	}
	const name = key.slice(4);
	if (value === undefined) {
		if (settings.env && typeof settings.env === "object") {
			delete settings.env[name];
			if (Object.keys(settings.env).length === 0) delete settings.env;
		}
		return;
	}
	if (!settings.env || typeof settings.env !== "object" || Array.isArray(settings.env)) settings.env = {};
	settings.env[name] = value;
}

function remember(settings, backup, key) {
	if (Object.hasOwn(backup, key)) return;
	backup[key] = hasKey(settings, key) ? { present: true, value: structuredClone(getKey(settings, key)) } : { present: false };
}

/** True when Claude Code can reach a Loki model for this `model` / `ANTHROPIC_MODEL` value. */
export function isServable(value, modelSettings) {
	if (typeof value !== "string" || !value.trim()) return true;
	const id = value.trim().replace(/\[1m\]$/i, "").toLowerCase();
	if (ALIASES.has(id)) return true;
	const known = new Set();
	for (const row of modelSettings.modelPicker.options) known.add(row.model.toLowerCase());
	for (const [anthropicId, lokiId] of Object.entries(modelSettings.modelOverrides)) {
		known.add(anthropicId.toLowerCase());
		known.add(lokiId.toLowerCase());
	}
	return known.has(id);
}

/**
 * Return `{ settings, backup, removed }`: a copy of `current` configured for Loki,
 * the updated backup and the keys removed because they would bypass Loki.
 * `modelSettings` may be omitted to keep the current model lineup.
 */
export function applyLokiSettings(current, { endpoint, helperCommand, headers, modelSettings }, previousBackup = {}) {
	const settings = structuredClone(current);
	const backup = structuredClone(previousBackup);
	const removed = [];

	for (const key of OWNED) remember(current, backup, key);
	setKey(settings, "apiKeyHelper", helperCommand);
	setKey(settings, "env.ANTHROPIC_BASE_URL", endpoint);
	setKey(settings, "env.ANTHROPIC_CUSTOM_HEADERS", headers);
	// Loki rejects the advisor-tool and fallback-credit betas without naming them,
	// so Claude Code cannot retry around them: turn both features off.
	setKey(settings, "env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "1");
	setKey(settings, "env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK", "1");

	if (modelSettings) {
		// Keep the user's own overrides for models Loki does not serve.
		const original = backup.modelOverrides?.present && backup.modelOverrides.value && typeof backup.modelOverrides.value === "object" ? backup.modelOverrides.value : {};
		setKey(settings, "modelOverrides", { ...original, ...modelSettings.modelOverrides });
		setKey(settings, "modelPicker", modelSettings.modelPicker);
		for (const key of MODEL_KEYS) {
			if (hasKey(settings, key) && !isServable(getKey(settings, key), modelSettings)) {
				remember(current, backup, key);
				setKey(settings, key, undefined);
				removed.push(key);
			}
		}
	}

	for (const key of CONFLICTING) {
		if (hasKey(settings, key)) {
			remember(current, backup, key);
			setKey(settings, key, undefined);
			removed.push(key);
		}
	}
	return { settings, backup, removed };
}

/** Restore every value the plugin replaced or removed. */
export function removeLokiSettings(current, backup = {}) {
	const settings = structuredClone(current);
	for (const key of [...OWNED, ...CONFLICTING, ...MODEL_KEYS]) {
		const saved = backup[key];
		if (saved) setKey(settings, key, saved.present ? saved.value : undefined);
	}
	return settings;
}

export function sameJson(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
