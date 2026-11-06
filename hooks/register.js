/**
 * Loki hooks module (a Claude Code mod).
 *
 * - Adds the /loki-login, /loki-endpoint, /loki-usage and /loki-logout commands.
 *   They run without a Claude turn and delegate to `src/cli.mjs`.
 * - Gives each session its own `X-ConversationId` request header.
 * - Refreshes the live Loki model lineup in the background at session start.
 */

const LOGIN_TIMEOUT_MS = 300_000;
const COMMAND_TIMEOUT_MS = 60_000;

async function runCli($, args, timeoutMs) {
	try {
		const result = await $.process.run(['node', $.plugin.root + '/src/cli.mjs', ...args], { timeoutMs });
		const text = (result.stdout || result.stderr || '').trim();
		return { text: text || (result.exitCode === 0 ? 'Done.' : '[loki] Command failed.') };
	} catch (error) {
		return { text: '[loki] ' + (error && error.message ? error.message : String(error)) };
	}
}

function splitArgs(text) {
	return String(text || '').trim().split(/\s+/).filter(Boolean);
}

/** Replace the configured fallback conversation id with this session's id. */
async function useSessionConversationId($) {
	const headers = await $.env.get('ANTHROPIC_CUSTOM_HEADERS');
	if (!headers || !/^X-ClientType:/im.test(headers) || !/^X-ConversationId:/im.test(headers)) return;
	const sessionId = await $.session.id();
	await $.env.set('ANTHROPIC_CUSTOM_HEADERS', headers.replace(/^X-ConversationId:.*$/im, 'X-ConversationId: ' + sessionId));
}

export function register(on) {
	on('session.start', async ($, e, next) => {
		try {
			await useSessionConversationId($);
		} catch {}
		try {
			await $.command.register({ name: 'loki-login', description: 'Sign in to Loki with Microsoft Entra (Windows SSO)', argumentHint: '[account | picker]' });
			await $.command.register({ name: 'loki-endpoint', description: 'Show or switch the Loki endpoint', argumentHint: '[prod | msit | df | https://...]' });
			await $.command.register({ name: 'loki-usage', description: 'Show Loki cloud quota and usage' });
			await $.command.register({ name: 'loki-logout', description: 'Sign out of Loki and restore previous settings' });
		} catch {}
		$.clock.after(0, async () => {
			await runCli($, ['sync'], COMMAND_TIMEOUT_MS);
		});
		return next(e);
	});

	on('command.run', { command: 'loki-login' }, async ($, e) => runCli($, ['login', ...splitArgs(e.args)], LOGIN_TIMEOUT_MS));
	on('command.run', { command: 'loki-endpoint' }, async ($, e) => runCli($, ['endpoint', ...splitArgs(e.args)], COMMAND_TIMEOUT_MS));
	on('command.run', { command: 'loki-usage' }, async ($) => runCli($, ['usage'], COMMAND_TIMEOUT_MS));
	on('command.run', { command: 'loki-logout' }, async ($) => runCli($, ['logout'], COMMAND_TIMEOUT_MS));
}
