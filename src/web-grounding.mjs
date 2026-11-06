/**
 * Loki WebGrounding client (`POST <baseUrl>/tools/web/mcp`).
 */

import { DEFAULT_UPSTREAM, LOKI_HEADERS } from "./config.mjs";

export function buildMcpUrl(baseUrl) {
	const url = new URL(baseUrl || DEFAULT_UPSTREAM);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Loki WebGrounding requires an HTTPS base URL (or HTTP loopback) without credentials, query or fragment.",
		);
	}
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/tools/web/mcp`;
	return url.href;
}

/** Execute one stateless upstream MCP operation, preserving its result envelope. */
export async function requestWebGroundingMcp(token, baseUrl, method, params = {}, signal) {
	if (!token) throw new Error("Loki is not authenticated. Run /loki-login first.");
	if (method !== "tools/list" && method !== "tools/call") throw new Error("Unsupported WebGrounding operation.");
	const response = await fetch(buildMcpUrl(baseUrl), {
		method: "POST",
		redirect: "error",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...LOKI_HEADERS,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		// Never forward arbitrary HTTP error bodies that may echo credentials.
		await response.body?.cancel();
		throw new Error(`Loki WebGrounding ${method} failed: HTTP ${response.status}.`);
	}
	let payload;
	if (response.headers.get("content-type")?.includes("text/event-stream")) {
		const body = await response.text();
		for (const frame of body.replace(/\r\n/g, "\n").split("\n\n")) {
			const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
			if (!data || data === "[DONE]") continue;
			const message = JSON.parse(data);
			if (message.id === 1) { payload = message; break; }
		}
	} else {
		payload = await response.json();
	}
	if (payload?.error) throw new Error(`Loki WebGrounding ${method} RPC error (${payload.error.code ?? "unknown"}).`);
	if (!payload?.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
		throw new Error("Invalid Loki WebGrounding response.");
	}
	return payload.result;
}
