// A transaction, read straight from NEAR testnet through FastNEAR's transaction API. The public testnet
// explorers lag or stall, so every "tx" link in the app opens here and shows what the chain recorded:
// who signed, what was called with which arguments, each receipt's result, and the Loca events it emitted.

import { card, head } from "./pages";
import { EXPLORER_TX } from "./data";
import { esc, label } from "./ui";

const TX_API = "https://tx.test.fastnear.com/v0/transactions";

interface Outcome { executor_id: string; status: Record<string, unknown>; logs: string[]; gas_burnt: number }
interface FastTx {
  transaction: { hash: string; signer_id: string; receiver_id: string; public_key: string; actions: (Record<string, { method_name?: string; args?: string; deposit?: string }> | string)[] };
  execution_outcome: { block_timestamp: number; block_height: number; outcome: Outcome };
  receipts: { execution_outcome: { outcome: Outcome } }[];
}

export const txPage = (hash: string) =>
  `${head("Transaction", `<span class="mono">${esc(hash)}</span>`)}<div id="tx-view"><div class="loading">Reading the transaction from NEAR testnet…</div></div>`;

const decode = (b64?: string) => {
  if (!b64) return "";
  try {
    const raw = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    try {
      const j = JSON.parse(raw);
      if (typeof j.msg === "string") try { j.msg = JSON.parse(j.msg); } catch { /* plain string */ }
      return JSON.stringify(j, null, 2);
    } catch {
      return raw;
    }
  } catch {
    return b64;
  }
};

/** The ERR_* code or runtime error behind a failed receipt. */
const failure = (o: Outcome) => {
  const f = o.status.Failure;
  if (!f) return null;
  const s = JSON.stringify(f);
  return s.match(/ERR_[A-Z_]+/)?.[0] ?? s.match(/"(\w+Error|\w+DoesNotExist|\w+Mismatch)"/)?.[1] ?? s.slice(0, 120);
};

const events = (logs: string[]) =>
  logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => {
    try { return JSON.parse(l.slice(11)) as { standard: string; event: string; data: unknown[] }; } catch { return null; }
  }).filter(Boolean) as { standard: string; event: string; data: unknown[] }[];

export async function mountTx(hash: string) {
  const el = document.querySelector<HTMLElement>("#tx-view");
  if (!el) return;
  let tx: FastTx | undefined;
  try {
    const r = await fetch(TX_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_hashes: [hash] }) });
    tx = ((await r.json()) as { transactions: FastTx[] }).transactions[0];
  } catch {
    /* shown below */
  }
  if (!document.body.contains(el)) return;
  if (!tx) {
    el.innerHTML = `<div class="empty big"><div class="empty-t">Not found yet</div><div class="muted">FastNEAR has not indexed this transaction, or it does not exist. Try <a class="ext" href="${EXPLORER_TX}${esc(hash)}" target="_blank" rel="noopener">nearblocks</a>.</div></div>`;
    return;
  }
  const t = tx.transaction;
  const outcomes = [tx.execution_outcome.outcome, ...tx.receipts.map((r) => r.execution_outcome.outcome)];
  const failed = outcomes.map(failure).find(Boolean);
  const loca = outcomes.flatMap((o) => events(o.logs)).filter((e) => e.standard === "loca");
  const rejected = loca.find((e) => e.event === "deposit_rejected")?.data[0] as { reason?: string } | undefined;
  const gas = outcomes.reduce((g, o) => g + o.gas_burnt, 0);
  const who = (id: string) => (label(id) !== id ? `${esc(label(id))} <span class="muted small" style="word-break:break-all">${esc(id)}</span>` : `<span style="word-break:break-all">${esc(id)}</span>`);
  const verdict = failed
    ? `<span class="pill s-bad" style="white-space:normal">Refused: ${esc(failed)}</span>`
    : rejected ? `<span class="pill s-bad" style="white-space:normal">Deposit credited back: ${esc(rejected.reason ?? "")}</span>`
    : `<span class="pill s-done">Succeeded</span>`;
  const actions = t.actions.map((a) => {
    if (typeof a === "string") return `<div><b>${esc(a)}</b></div>`;
    const [kind, body] = Object.entries(a)[0];
    if (kind !== "FunctionCall") return `<div><b>${esc(kind)}</b></div>`;
    return `<div><b class="mono">${esc(body.method_name ?? "")}</b>${body.deposit && body.deposit !== "0" ? ` <span class="muted small">deposit ${esc(body.deposit)} yocto</span>` : ""}<pre class="code-block">${esc(decode(body.args))}</pre></div>`;
  }).join("");
  el.innerHTML = `<div class="grid g-12">
    ${card("Summary", `<dl class="kv">
      <dt>Result</dt><dd>${verdict}</dd>
      <dt>Signer</dt><dd class="mono">${who(t.signer_id)}</dd>
      <dt>Key</dt><dd class="mono small" style="word-break:break-all">${esc(t.public_key)}</dd>
      <dt>Receiver</dt><dd class="mono">${who(t.receiver_id)}</dd>
      <dt>Block</dt><dd>${tx.execution_outcome.block_height} · ${new Date(tx.execution_outcome.block_timestamp / 1e6).toUTCString()}</dd>
      <dt>Gas burnt</dt><dd>${(gas / 1e12).toFixed(2)} TGas</dd>
    </dl>`, { cls: "span-5", foot: `Read from NEAR testnet via FastNEAR · <a class="ext" href="${TX_API.replace("/v0/transactions", "")}" target="_blank" rel="noopener">API</a> · <a class="ext" href="${EXPLORER_TX}${esc(hash)}" target="_blank" rel="noopener">nearblocks</a>` })}
    <div class="span-7 col">
      ${card("Actions", actions)}
      ${card("Loca events", loca.length ? loca.map((e) => `<div><b class="mono">${esc(e.event)}</b><pre class="code-block">${esc(JSON.stringify(e.data[0], null, 2))}</pre></div>`).join("") : '<span class="muted small">This transaction emitted no Loca events.</span>')}
    </div>
  </div>
  ${card("Receipts", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Executed by</th><th>Status</th><th class="num">Gas</th></tr></thead><tbody>${outcomes
    .map((o) => `<tr><td class="mono">${esc(label(o.executor_id))}</td><td>${failure(o) ? `<span class="code bad">${esc(failure(o)!)}</span>` : '<span class="muted small">ok</span>'}</td><td class="num mono">${(o.gas_burnt / 1e12).toFixed(2)}</td></tr>`)
    .join("")}</tbody></table></div>`)}`;
}
