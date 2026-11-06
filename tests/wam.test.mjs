import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("the WAM broker loads without keytar, which plugin installs cannot compile", () => {
	const pkg = import.meta.resolve("@azure/msal-node-extensions/package.json");
	const broker = readFileSync(fileURLToPath(new URL("dist/broker/NativeBrokerPlugin.mjs", pkg)), "utf8");
	assert.match(broker, /export \{[^}]*NativeBrokerPlugin/);
	assert.doesNotMatch(broker, /keytar/);
	const helper = readFileSync(new URL("../src/wam-helper.mjs", import.meta.url), "utf8");
	assert.match(helper, /dist\/broker\/NativeBrokerPlugin\.mjs/);
});
