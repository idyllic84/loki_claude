/**
 * Live quota / usage query from Loki `GET /quota` for the Loki Claude Code plugin.
 */

import { CREDIT_TO_USD, DEFAULT_UPSTREAM, LOKI_HEADERS, LOKI_QUOTA_API_VERSION } from "./config.mjs";

export async function fetchLokiQuota(token, baseUrl = DEFAULT_UPSTREAM, signal = AbortSignal.timeout(20_000)) {
	if (!token) {
		throw new Error("Loki is not authenticated. Run /loki-login before querying /quota.");
	}
	const normalized = (baseUrl || DEFAULT_UPSTREAM).replace(/\/+$/, "");
	const response = await fetch(`${normalized}/quota`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			...LOKI_HEADERS,
			"X-Llm-Api-Version": LOKI_QUOTA_API_VERSION,
		},
		signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
	});
	if (!response.ok) {
		let detail = "";
		try {
			const errBody = await response.json();
			const msg = typeof errBody?.error?.message === "string" ? errBody.error.message.trim() : "";
			const code = typeof errBody?.error?.code === "string" ? errBody.error.code.trim() : "";
			if (msg || code) detail = ` (${[code, msg].filter(Boolean).join(": ")})`;
		} catch {}
		throw new Error(`Loki GET /quota failed: HTTP ${response.status}${detail}.`);
	}

	const body = await response.json();
	if (!body || !body.quotaSnapshots || typeof body.quotaSnapshots !== "object" || Array.isArray(body.quotaSnapshots)) {
		throw new Error("Invalid Loki /quota response format");
	}

	const result = {};
	for (const [key, value] of Object.entries(body.quotaSnapshots)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			result[key] = value;
		}
	}
	return result;
}

function formatDate(iso) {
	if (!iso) return "n/a";
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return iso;
	return parsed.toISOString().replace(/\.\d+Z$/, "Z");
}

function formatNumber(n) {
	return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatLokiQuota(snapshots, baseUrl) {
	const entries = Object.entries(snapshots);
	if (entries.length === 0) {
		return `Loki /quota (${baseUrl}): no quota snapshots returned.`;
	}

	const lines = [`Loki Cloud Quota (${baseUrl}/quota):`];
	for (const [bucket, snap] of entries) {
		const consumed = typeof snap.consumedQuantity === "number" ? snap.consumedQuantity : 0;
		const unit = snap.usageUnit || "ai_credits";
		const usd = unit === "ai_credits" ? ` (~$${formatNumber(consumed * CREDIT_TO_USD)})` : "";
		const entitled =
			typeof snap.entitledQuantity === "number" && snap.entitledQuantity >= 0
				? formatNumber(snap.entitledQuantity)
				: "Unlimited";
		const available =
			typeof snap.availableQuantity === "number" && snap.availableQuantity >= 0
				? formatNumber(snap.availableQuantity)
				: "Unlimited";

		lines.push(
			`  [${bucket}] service=${snap.service || "n/a"} | scope=${snap.usageScope || "n/a"} | access=${snap.accessState || "n/a"} | capacity=${snap.capacityState || "n/a"}`,
			`  Consumed : ${formatNumber(consumed)} ${unit}${usd}`,
			`  Limit    : ${entitled} (available: ${available})`,
			`  Cycle    : ${formatDate(snap.usageCycleStart)} -> ${formatDate(snap.usageResetOn)}`,
			`  Queried  : ${formatDate(snap.usageQueriedAt)}`,
		);
	}
	return lines.join("\n");
}
