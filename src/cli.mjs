#!/usr/bin/env node
/**
 * Command backend for the plugin's slash commands. The hooks module runs it with
 * `node src/cli.mjs <command> [args]` and prints its stdout in the transcript.
 *
 *   login [account | picker]   Sign in and point Claude Code at Loki
 *   endpoint [prod|msit|df|url] Show or switch the Loki endpoint
 *   usage                       Show cloud quota and usage
 *   sync                        Refresh the live model lineup (session start)
 *   logout                      Restore the previous settings and forget the token
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildModelSettings, fetchLokiModels, formatModelList } from "./catalog.mjs";
import { buildCustomHeaders, ensureConversationId, formatEndpointLabel, loadState, resolveEndpointAlias, saveState } from "./config.mjs";
import { fetchLokiQuota, formatLokiQuota } from "./quota.mjs";
import { applyLokiSettings, readSettings, removeLokiSettings, sameJson, writeSettings } from "./settings.mjs";
import { acquireWamToken, clearToken, getValidToken } from "./wam.mjs";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The `apiKeyHelper` command. Claude Code runs it through `cmd` on Windows. */
export function helperCommand(srcDir = SRC_DIR) {
	return `node "${join(srcDir, "token.mjs")}"`;
}

/** Point Claude Code at Loki, with the live model lineup when a token is available. */
export async function configureClaude({ token, fetchModels = fetchLokiModels, srcDir = SRC_DIR } = {}) {
	const state = loadState();
	const models = token ? await fetchModels(token.accessToken, state.endpoint) : undefined;
	const current = readSettings();
	const { settings, backup, removed } = applyLokiSettings(
		current,
		{
			endpoint: state.endpoint,
			helperCommand: helperCommand(srcDir),
			headers: buildCustomHeaders(ensureConversationId()),
			modelSettings: models ? buildModelSettings(models) : undefined,
		},
		state.settingsBackup,
	);
	const changed = !sameJson(settings, current);
	if (changed) writeSettings(settings);
	saveState({ active: true, settingsBackup: backup });
	return { models, removed, changed };
}

function describeRemoved(removed) {
	if (removed.length === 0) return [];
	return [`Set aside (restored by /loki-logout): ${removed.join(", ")}`];
}

async function login(args) {
	const choice = args[0]?.trim();
	const picker = choice?.toLowerCase() === "picker";
	const token = await acquireWamToken(picker ? "interactive_only" : "interactive", picker ? undefined : choice || undefined);
	const { models, removed } = await configureClaude({ token });
	const endpoint = loadState().endpoint;
	return [
		`Signed in to Loki as ${token.account}.`,
		`Endpoint: ${formatEndpointLabel(endpoint)}`,
		`Models (${models.length}):`,
		formatModelList(models),
		...describeRemoved(removed),
		"Claude Code now uses Loki. Open /model to choose a model and effort level.",
	].join("\n");
}

async function endpoint(args) {
	const state = loadState();
	if (!args[0]) {
		return [`Current Loki endpoint: ${formatEndpointLabel(state.endpoint)}`, "Switch with: /loki-endpoint prod | msit | df | <https://...>"].join("\n");
	}
	const next = resolveEndpointAlias(args[0]);
	saveState({ endpoint: next });
	if (!state.active) return `Loki endpoint set to ${formatEndpointLabel(next)}. Run /loki-login to start using it.`;
	let token;
	try {
		token = await getValidToken();
	} catch {
		await configureClaude();
		return `Loki endpoint switched to ${formatEndpointLabel(next)}. Run /loki-login to refresh the model list.`;
	}
	const { models } = await configureClaude({ token });
	return [`Loki endpoint switched to ${formatEndpointLabel(next)}.`, `Models (${models.length}):`, formatModelList(models)].join("\n");
}

async function usage() {
	const state = loadState();
	const token = await getValidToken();
	return formatLokiQuota(await fetchLokiQuota(token.accessToken, state.endpoint), state.endpoint);
}

/** Session start: refresh silently, only after the user has signed in. */
async function sync() {
	if (!loadState().active) return "";
	const token = await getValidToken();
	await configureClaude({ token });
	return "";
}

function logout() {
	const state = loadState();
	if (state.settingsBackup) writeSettings(removeLokiSettings(readSettings(), state.settingsBackup));
	clearToken();
	saveState({ active: false, settingsBackup: undefined });
	return "Signed out of Loki and restored your previous Claude Code settings.";
}

const COMMANDS = { login, endpoint, usage, sync, logout };

export async function runCli(argv) {
	const [name, ...args] = argv;
	const command = COMMANDS[name];
	if (!command) throw new Error(`Unknown command "${name ?? ""}". Use login, endpoint, usage, sync or logout.`);
	return command(args.filter((arg) => arg.trim()));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	runCli(process.argv.slice(2)).then(
		(text) => { if (text) process.stdout.write(`${text}\n`); },
		(error) => {
			process.stdout.write(`[loki] ${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		},
	);
}
