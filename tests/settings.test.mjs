import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModelSettings, fetchLokiModels, toAnthropicId } from "../src/catalog.mjs";
import { applyLokiSettings, isServable, removeLokiSettings } from "../src/settings.mjs";
import { buildCustomHeaders, DF_UPSTREAM, PROD_UPSTREAM, resolveEndpointAlias } from "../src/config.mjs";

const lokiModels = [
	{ id: "claude-opus-5.5", name: "Claude Opus 5.5", contextWindow: 1_000_000, efforts: ["low", "max"] },
	{ id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1_000_000, efforts: ["low", "max"] },
	{ id: "claude-haiku-5.5", name: "Claude Haiku 5.5", contextWindow: 200_000, efforts: [] },
];
const config = {
	endpoint: PROD_UPSTREAM,
	helperCommand: 'node "C:\\plugin\\src\\token.mjs"',
	headers: buildCustomHeaders("00000000-0000-4000-8000-000000000000"),
	modelSettings: buildModelSettings(lokiModels),
};

test("Loki IDs map onto Claude Code's native model IDs, picker rows and aliases", () => {
	assert.equal(toAnthropicId("claude-opus-5.5"), "claude-opus-5-5");
	assert.equal(toAnthropicId("claude-opus-5"), "claude-opus-5");
	const { modelOverrides, modelPicker } = config.modelSettings;
	assert.deepEqual(modelOverrides, { "claude-opus-5-5": "claude-opus-5.5", "claude-haiku-5-5": "claude-haiku-5.5" });
	assert.equal(modelPicker.replaceBuiltInOptions, true);
	assert.deepEqual(modelPicker.options[0], { model: "claude-opus-5.5", label: "Claude Opus 5.5", description: "Loki · 1M context", behavesAs: "claude-opus-5-5" });
	assert.deepEqual(modelPicker.options[1], { model: "claude-opus-5", label: "Claude Opus 5", description: "Loki · 1M context" });
	assert.equal(modelPicker.options[2].description, "Loki · 200K context");
});

test("only Claude models served over /v1/messages are offered", async (t) => {
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, `${DF_UPSTREAM}/models`);
		assert.equal(init.headers.Authorization, "Bearer FAKE");
		assert.equal(init.headers["X-ClientType"], "Copilot");
		return new Response(JSON.stringify({ data: [
			{ id: "claude-future-6", display_name: "Claude Future 6", supported_endpoints: ["/v1/messages"], capabilities: { limits: { max_context_window_tokens: 1_000_000 }, supports: { reasoning_effort: ["low"] } } },
			{ id: "gpt-61-sol", supported_endpoints: ["/responses"] },
			{ id: "claude-embeddings", supported_endpoints: ["/embeddings"] },
		] }));
	});
	const models = await fetchLokiModels("FAKE", DF_UPSTREAM);
	assert.deepEqual(models.map((model) => model.id), ["claude-future-6"]);
	await assert.rejects(fetchLokiModels(undefined, DF_UPSTREAM), /loki-login/);
});

test("applying Loki settings sets the gateway, sets aside bypassing credentials and is idempotent", () => {
	const original = {
		theme: "dark",
		model: "opus[1m]",
		modelOverrides: { "claude-sonnet-4-6": "my-own-sonnet" },
		env: { ANTHROPIC_AUTH_TOKEN: "user-secret", ANTHROPIC_BASE_URL: "http://localhost:41414", ANTHROPIC_MODEL: "claude-opus-4.7[1m]", KEEP: "1" },
	};
	const first = applyLokiSettings(original, config, {});
	assert.equal(first.settings.apiKeyHelper, config.helperCommand);
	assert.equal(first.settings.env.ANTHROPIC_BASE_URL, PROD_UPSTREAM);
	assert.match(first.settings.env.ANTHROPIC_CUSTOM_HEADERS, /^X-ClientType: Copilot\n.*\nX-ConversationId: 0{8}-/s);
	assert.equal(first.settings.env.ANTHROPIC_AUTH_TOKEN, undefined);
	assert.equal(first.settings.env.ANTHROPIC_MODEL, undefined, "a model Loki does not serve would fail every request");
	assert.equal(first.settings.model, "opus[1m]", "aliases resolve through modelOverrides");
	assert.equal(first.settings.env.KEEP, "1");
	assert.equal(first.settings.theme, "dark");
	assert.deepEqual(first.settings.modelOverrides, { "claude-sonnet-4-6": "my-own-sonnet", ...config.modelSettings.modelOverrides });
	assert.deepEqual(first.removed.sort(), ["env.ANTHROPIC_AUTH_TOKEN", "env.ANTHROPIC_MODEL"]);
	assert.equal(original.env.ANTHROPIC_AUTH_TOKEN, "user-secret", "input must not be mutated");

	const second = applyLokiSettings(first.settings, config, first.backup);
	assert.deepEqual(second.settings, first.settings);
	assert.deepEqual(second.backup, first.backup, "the first backup is never overwritten by Loki values");
	assert.deepEqual(removeLokiSettings(second.settings, second.backup), original);
});

test("a sync without a model list keeps the existing lineup", () => {
	const first = applyLokiSettings({}, config, {});
	const { settings } = applyLokiSettings(first.settings, { ...config, endpoint: DF_UPSTREAM, modelSettings: undefined }, first.backup);
	assert.equal(settings.env.ANTHROPIC_BASE_URL, DF_UPSTREAM);
	assert.deepEqual(settings.modelPicker, config.modelSettings.modelPicker);
	assert.deepEqual(removeLokiSettings(settings, first.backup), {});
});

test("logout without a backup leaves user settings untouched", () => {
	const mine = { apiKeyHelper: "my-helper", env: { ANTHROPIC_BASE_URL: "https://mine.example" } };
	assert.deepEqual(removeLokiSettings(mine, {}), mine);
});

test("servable model selections", () => {
	assert.ok(isServable("sonnet", config.modelSettings));
	assert.ok(isServable("claude-opus-5-5[1m]", config.modelSettings));
	assert.ok(isServable("claude-opus-5.5", config.modelSettings));
	assert.ok(!isServable("claude-fable-5", config.modelSettings));
});

test("endpoint aliases and unsafe custom endpoints", () => {
	assert.equal(resolveEndpointAlias("df"), DF_UPSTREAM);
	assert.equal(resolveEndpointAlias("https://custom.example/llmapi/"), "https://custom.example/llmapi");
	assert.throws(() => resolveEndpointAlias("http://remote.example"), /Invalid endpoint/);
	assert.throws(() => resolveEndpointAlias("https://user:pw@custom.example"), /Invalid endpoint/);
});

test("configureClaude writes user settings and logout restores them", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "loki-claude-test-"));
	const previous = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = dir;
	t.after(() => {
		if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	const original = { env: { ANTHROPIC_API_KEY: "sk-user" }, spinnerTipsEnabled: false };
	writeFileSync(join(dir, "settings.json"), JSON.stringify(original));
	const { configureClaude, runCli } = await import("../src/cli.mjs");
	const result = await configureClaude({ token: { accessToken: "FAKE" }, fetchModels: async () => lokiModels, srcDir: "C:\\plugin\\src" });
	assert.deepEqual(result.removed, ["env.ANTHROPIC_API_KEY"]);
	const written = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
	assert.equal(written.apiKeyHelper, 'node "C:\\plugin\\src\\token.mjs"');
	assert.equal(written.modelPicker.options.length, 3);
	const state = JSON.parse(readFileSync(join(dir, "loki-state", "config.json"), "utf8"));
	assert.equal(state.active, true);
	assert.doesNotMatch(JSON.stringify(written), /FAKE/, "the access token is never written to settings");

	assert.match(await runCli(["logout"]), /restored/);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), original);
	assert.equal(await runCli(["sync"]), "", "signed-out sessions never touch settings");
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), original);
});
