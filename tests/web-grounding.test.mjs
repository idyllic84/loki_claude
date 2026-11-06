import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWebGroundingServer } from "../src/web-mcp-server.mjs";
import { requestWebGroundingMcp } from "../src/web-grounding.mjs";
import { DF_UPSTREAM, PROD_UPSTREAM } from "../src/config.mjs";

const tools = [
	{ name: "web", description: "Web search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
	{ name: "browse", description: "Read a page", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
	{ name: "not-exposed", inputSchema: { type: "object" } },
];

test("loki-web MCP exposes only web/browse and reacquires auth and endpoint per operation", async () => {
	let endpoint = PROD_UPSTREAM;
	let tokens = 0;
	const calls = [];
	const server = createWebGroundingServer({
		getToken: async () => ({ accessToken: `FAKE_${++tokens}` }),
		loadConfig: () => ({ endpoint }),
		request: async (token, baseUrl, method, params) => {
			calls.push({ token, baseUrl, method, params });
			return method === "tools/list" ? { tools } : { content: [{ type: "text", text: "Unmodified page\nbody" }], isError: false };
		},
	});
	const client = new Client({ name: "test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["web", "browse"]);
		await client.callTool({ name: "web", arguments: { query: "public query" } });
		assert.deepEqual(calls[1].params, { name: "web", arguments: { query: "public query", language: "en", region: "US" } });
		endpoint = DF_UPSTREAM;
		const page = await client.callTool({ name: "browse", arguments: { url: "https://example.com", maxLength: 900 } });
		assert.equal(page.content[0].text, "Unmodified page\nbody");
		assert.equal(calls[2].baseUrl, DF_UPSTREAM);
		assert.equal(calls[2].token, "FAKE_3");
		await assert.rejects(client.callTool({ name: "not-exposed", arguments: {} }), /Unknown Loki/);
		await assert.rejects(client.callTool({ name: "browse", arguments: { url: "file:///private.txt" } }), /HTTP/);
		assert.equal(tokens, 3, "Rejected tools/URLs must not acquire credentials.");
	} finally {
		await client.close();
		await server.close();
	}
});

test("upstream MCP accepts SSE results, forbids unsafe bases and does not echo HTTP error bodies", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n', { headers: { "content-type": "text/event-stream" } }));
	assert.deepEqual(await requestWebGroundingMcp("FAKE_TOKEN", PROD_UPSTREAM, "tools/list"), { tools: [] });
	await assert.rejects(requestWebGroundingMcp("FAKE_TOKEN", "http://remote.example", "tools/list"), /HTTPS/);
	t.mock.method(globalThis, "fetch", async () => new Response("secret-echo-do-not-forward", { status: 401 }));
	await assert.rejects(requestWebGroundingMcp("FAKE_TOKEN", PROD_UPSTREAM, "tools/list"), (error) => error.message.includes("HTTP 401") && !error.message.includes("secret-echo"));
});

test("plugin MCP configuration starts the bundled server and stores no credentials", () => {
	const config = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"));
	const server = config.mcpServers["loki-web"];
	assert.equal(server.command, "node");
	assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/src/web-mcp-server.mjs"]);
	assert.equal(server.env, undefined);
	assert.equal(server.headers, undefined);
});
