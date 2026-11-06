/**
 * WAM broker helper, run as a short-lived child process by `wam.mjs`.
 *
 * The MSAL native runtime keeps the Node event loop alive after any broker
 * call, so it runs in this helper process with `windowsHide: true`, prints a
 * single JSON line on stdout and exits explicitly.
 *
 * argv: <mode> [loginHint]
 *   mode = silent | interactive | interactive_only | accounts
 * env:  LOKI_CLIENT_ID, LOKI_AUTHORITY, LOKI_RESOURCE
 */

function finish(payload, code = 0) {
	process.stdout.write(`${JSON.stringify(payload)}\n`, () => process.exit(code));
}

/**
 * Load only the WAM broker plugin. The package entry point also loads the
 * keychain persistence module, which needs `keytar` compiled by an install
 * script; Claude Code installs plugin dependencies without install scripts.
 */
async function loadNativeBrokerPlugin() {
	try {
		const pkg = import.meta.resolve("@azure/msal-node-extensions/package.json");
		return (await import(new URL("dist/broker/NativeBrokerPlugin.mjs", pkg).href)).NativeBrokerPlugin;
	} catch {
		return (await import("@azure/msal-node-extensions")).NativeBrokerPlugin;
	}
}

async function main() {
	const [mode, rawHint] = process.argv.slice(2);
	const loginHint = rawHint || undefined;
	const scopes = [`${process.env.LOKI_RESOURCE}/.default`];

	let msal;
	let NativeBrokerPlugin;
	try {
		msal = await import("@azure/msal-node");
		NativeBrokerPlugin = await loadNativeBrokerPlugin();
	} catch (error) {
		return finish(
			{
				error: `MSAL modules not found. Reinstall the loki plugin. (${error?.message ?? error})`,
			},
			1,
		);
	}

	const broker = new NativeBrokerPlugin();
	if (!broker.isBrokerAvailable) return finish({ error: "Windows WAM broker is unavailable on this machine." }, 1);

	const pca = new msal.PublicClientApplication({
		auth: { clientId: process.env.LOKI_CLIENT_ID, authority: process.env.LOKI_AUTHORITY },
		broker: { nativeBrokerPlugin: broker },
	});

	const accounts = await pca.getAllAccounts();
	if (mode === "accounts") return finish({ accounts: accounts.map((a) => a.username).filter(Boolean) });

	const hint = loginHint?.toLowerCase();
	const account = (hint && accounts.find((a) => a.username?.toLowerCase() === hint)) || accounts[0];

	let result = null;
	let silentError;
	if (mode !== "interactive_only" && account) {
		try {
			result = await pca.acquireTokenSilent({ account, scopes });
		} catch (error) {
			silentError = error;
		}
	}

	if (!result?.accessToken && (mode === "interactive" || mode === "interactive_only")) {
		result = await pca.acquireTokenInteractive({
			scopes,
			loginHint,
			account: mode === "interactive" ? account : undefined,
			prompt: mode === "interactive_only" ? "select_account" : undefined,
			openBrowser: async () => {
				throw new Error("Browser sign-in is not supported; the WAM broker handles interaction.");
			},
		});
	}

	if (!result?.accessToken) {
		const message =
			silentError?.errorMessage ||
			silentError?.message ||
			"No Entra account available for silent SSO; run /loki-login.";
		return finish({ error: message }, 1);
	}

	return finish({
		access_token: result.accessToken,
		exp: result.expiresOn ? Math.floor(result.expiresOn.getTime() / 1000) : Math.floor(Date.now() / 1000) + 3600,
		account: result.account?.username || loginHint || "m365-user",
	});
}

main().catch((error) => finish({ error: error?.errorMessage || error?.message || String(error) }, 1));
