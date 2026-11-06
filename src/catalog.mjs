/**
 * Live Claude model discovery from Loki `GET /models`, mapped onto Claude Code's
 * native `/model` picker (`modelPicker`) and alias resolution (`modelOverrides`).
 */

import { DEFAULT_UPSTREAM, LOKI_HEADERS } from "./config.mjs";

/** Claude Code spells versions with hyphens (`claude-opus-5-5`); Loki uses dots (`claude-opus-5.5`). */
export function toAnthropicId(lokiId) {
	return String(lokiId).replace(/\./g, "-");
}

export async function fetchLokiModels(token, baseUrl = DEFAULT_UPSTREAM, signal) {
	if (!token) throw new Error("Loki is not authenticated. Run /loki-login first.");
	const normalized = (baseUrl || DEFAULT_UPSTREAM).replace(/\/+$/, "");
	const timeout = AbortSignal.timeout(20_000);
	const response = await fetch(`${normalized}/models`, {
		redirect: "error",
		headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...LOKI_HEADERS },
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Loki GET /models failed: HTTP ${response.status}.`);
	}
	const body = await response.json();
	if (!body || !Array.isArray(body.data)) throw new Error("Invalid Loki /models response format.");
	// Claude Code speaks only the Anthropic Messages API and serves only Claude models.
	return body.data
		.filter((entry) => entry && typeof entry.id === "string" && /claude/i.test(entry.id))
		.filter((entry) => Array.isArray(entry.supported_endpoints) && entry.supported_endpoints.includes("/v1/messages"))
		.map((entry) => ({
			id: entry.id,
			name: entry.display_name || entry.name || entry.id,
			contextWindow: entry.capabilities?.limits?.max_context_window_tokens,
			efforts: Array.isArray(entry.capabilities?.supports?.reasoning_effort) ? entry.capabilities.supports.reasoning_effort : [],
		}));
}

function formatWindow(tokens) {
	if (!Number.isSafeInteger(tokens) || tokens <= 0) return undefined;
	return tokens >= 1_000_000 && tokens % 1_000_000 === 0 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1000)}K`;
}

/**
 * Build the Claude Code settings that expose the live Loki catalog:
 * - `modelPicker` rows send the exact Loki ID; `behavesAs` lends Claude Code the
 *   known model's capabilities (effort levels, thinking, context window).
 * - `modelOverrides` resolve built-in aliases (`opus`, `sonnet`, `haiku`, Default)
 *   to the Loki IDs.
 */
export function buildModelSettings(models) {
	const modelOverrides = {};
	const options = [];
	for (const model of models) {
		const anthropicId = toAnthropicId(model.id);
		if (anthropicId !== model.id) modelOverrides[anthropicId] = model.id;
		const window = formatWindow(model.contextWindow);
		const row = { model: model.id, label: model.name, description: window ? `Loki · ${window} context` : "Loki" };
		if (anthropicId !== model.id) row.behavesAs = anthropicId;
		options.push(row);
	}
	return { modelOverrides, modelPicker: { options, replaceBuiltInOptions: true } };
}

export function formatModelList(models) {
	return models.map((model) => `  - ${model.name} (${model.id})`).join("\n");
}
