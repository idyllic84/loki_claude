/**
 * Native stdio MCP adapter for Loki WebGrounding. The host owns this process.
 * Credentials are acquired per operation, never stored in MCP configuration.
 * stdout is reserved exclusively for the MCP transport.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadState } from "./config.mjs";
import { getValidToken } from "./wam.mjs";
import { requestWebGroundingMcp } from "./web-grounding.mjs";

const ALLOWED_TOOLS = new Set(["web", "browse"]);

export function createWebGroundingServer({ getToken = getValidToken, loadConfig = loadState, request = requestWebGroundingMcp } = {}) {
	const server = new Server({ name: "loki-web", version: "1.0.1" }, { capabilities: { tools: {} } });
	async function upstream(method, params, signal) {
		const { endpoint } = loadConfig();
		const token = await getToken(signal);
		return request(token.accessToken, endpoint, method, params, signal);
	}
	server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
		const result = await upstream("tools/list", {}, extra.signal);
		if (!Array.isArray(result.tools)) throw new Error("Invalid Loki WebGrounding tool catalog.");
		// No extra upstream tools become exposed without a deliberate adapter change.
		return { tools: result.tools.filter((tool) => ALLOWED_TOOLS.has(tool?.name)) };
	});
	server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
		if (!ALLOWED_TOOLS.has(params.name)) throw new McpError(ErrorCode.MethodNotFound, "Unknown Loki WebGrounding tool.");
		const args = { ...(params.arguments ?? {}) };
		if (params.name === "web") {
			if (typeof args.query !== "string" || !args.query.trim()) throw new McpError(ErrorCode.InvalidParams, "query must not be empty.");
			args.language ??= "en";
			args.region ??= "US";
		}
		if (params.name === "browse") {
			let url;
			try { url = new URL(args.url); } catch { throw new McpError(ErrorCode.InvalidParams, "Invalid webpage URL."); }
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
				throw new McpError(ErrorCode.InvalidParams, "Use an HTTP(S) webpage URL without credentials.");
			}
		}
		return upstream("tools/call", { name: params.name, arguments: args }, extra.signal);
	});
	return server;
}

export async function runWebGroundingServer() {
	const server = createWebGroundingServer();
	process.once("SIGTERM", () => { server.close().finally(() => process.exit(0)); });
	process.stdin.once("end", () => { server.close().finally(() => process.exit(0)); });
	await server.connect(new StdioServerTransport());
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	runWebGroundingServer().catch(() => {
		// Do not log request content or credentials. The host reports startup failure.
		process.stderr.write("Loki WebGrounding MCP server failed to start.\n");
		process.exitCode = 1;
	});
}
