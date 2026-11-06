#!/usr/bin/env node
/**
 * Claude Code `apiKeyHelper`: prints only the current Loki access token.
 * Uses the cached token or silent Windows SSO; never opens a sign-in window.
 */

import { getValidToken } from "./wam.mjs";

try {
	const { accessToken } = await getValidToken();
	process.stdout.write(accessToken);
} catch (error) {
	process.stderr.write(`Loki sign-in required: run /loki-login. (${error instanceof Error ? error.message : String(error)})\n`);
	process.exitCode = 1;
}
