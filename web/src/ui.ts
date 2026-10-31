import { CAST, EXPLORER_ACCOUNT, EXPLORER_TX } from "./data";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** USDC has 6 decimals. */
export const usd = (raw: string | number | bigint, dp = 2) =>
  `$${(Number(raw) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const pct = (n: number, dp = 1) => `${n.toFixed(dp)}%`;
export const bps = (fee: string | number, principal: string | number) => (Number(fee) / Number(principal)) * 10_000;

export const nsToDate = (ns: string | number) => new Date(Number(BigInt(ns) / 1_000_000n));
export const fmtDate = (ns: string | number | null | undefined) =>
  ns ? nsToDate(ns).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "–";
export function ago(ns: string | number) {
  const s = Math.max(0, (Date.now() - nsToDate(ns).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const cap = (x: string) => x.replace(/(^|-)([a-z])/g, (_, d, c) => (d ? " " : "") + c.toUpperCase());
const NAMES = new Map<string, string>([
  ...CAST.agents.map((a) => [a.id, a.name] as [string, string]),
  ...CAST.lenders.map((l) => [l.id, l.name] as [string, string]),
  ...CAST.operators.map((o) => [o, cap(o.split(".")[0])] as [string, string]),
  ...CAST.customers.map((c) => [c, cap(c.split(".")[0])] as [string, string]),
  ...CAST.vendors.map((v) => [v.id, ({ datahub: "DataHub", "gpu-pool": "GPU Pool", "api-mart": "API Mart" } as Record<string, string>)[v.id.split(".")[0]] ?? v.id] as [string, string]),
  [CAST.arbiter, "Arbiter"],
  [CAST.contract, "LOCA market"],
  [CAST.root, "Swarm keeper"],
]);
export const label = (id: string) => NAMES.get(id) ?? id;
export const agentService = (id: string) => CAST.agents.find((a) => a.id === id)?.service;
export const lenderStrategy = (id: string) => CAST.lenders.find((l) => l.id === id)?.strategy;

/** Account cell: readable label with the full account id underneath. */
export const acct = (id: string, href?: string) => {
  const name = label(id);
  const main = href ? `<a href="${href}">${esc(name)}</a>` : esc(name);
  return `<span class="acct">${main}${name !== id ? `<span class="id mono" title="${esc(id)}">${esc(id)}</span>` : ""}</span>`;
};

export const txLink = (h?: string, text?: string) =>
  h ? `<a class="mono ext" href="${EXPLORER_TX}${h}" target="_blank" rel="noopener" title="${esc(h)}">${esc(text ?? `${h.slice(0, 6)}…${h.slice(-4)}`)}</a>` : `<span class="muted">–</span>`;
export const accountLink = (id: string, text?: string) =>
  `<a class="mono ext" href="${EXPLORER_ACCOUNT}${id}" target="_blank" rel="noopener">${esc(text ?? id)}</a>`;

const STATUS_CLASS: Record<string, string> = {
  Funded: "s-open", Open: "s-open", Active: "s-open", Delivered: "s-wait", Disputed: "s-warn",
  Released: "s-done", Repaid: "s-done", Accepted: "s-done", Refunded: "s-neutral", Withdrawn: "s-neutral", Defaulted: "s-bad",
};
const STATUS_TEXT: Record<string, string> = { Released: "Settled", Withdrawn: "Released" };
export const pill = (status: string) => `<span class="pill ${STATUS_CLASS[status] ?? "s-neutral"}">${esc(STATUS_TEXT[status] ?? status)}</span>`;

export const STRATEGY: Record<string, { name: string; policy: string }> = {
  "escrow-coverage": {
    name: "Escrow coverage",
    policy: "Prices off how many times the escrow covers the advance. Declines below 2× coverage, or an unrated agent with a bond under 20% of principal.",
  },
  "repayment-history": {
    name: "Repayment history",
    policy: "Lends only to agents with 3+ completed orders and no defaults. Fee falls as repayment and fulfillment records grow.",
  },
  "concentration-aware": {
    name: "Concentration-aware",
    policy: "Caps exposure at $60 per agent. Prices off the LOCA Score and adds 2% when one customer dominates revenue.",
  },
};
export const strategyName = (s: string) => STRATEGY[s]?.name ?? s;

export const SCORE_LABELS: Record<string, string> = {
  revenue_continuity: "Revenue continuity",
  repayment_history: "Repayment history",
  fulfillment: "Fulfillment",
  treasury_bond: "Treasury bond",
  operator_controls: "Operator controls",
  customer_diversity: "Customer diversity",
};
export const REASON_TEXT: Record<string, string> = {
  NO_CREDIT_HISTORY: "No loans repaid yet",
  DEFAULT_ON_RECORD: "Default on record",
  BOND_DRAWN: "Bond was drawn to repay a lender",
  DISPUTES_LOST: "Lost a dispute",
  NO_BOND: "No first-loss bond",
  NO_SPEND_POLICY: "Operator has not set a spend policy",
  CUSTOMER_CONCENTRATION: "Revenue concentrated in few customers",
  UNRATED_INSUFFICIENT_HISTORY: "Needs 3 completed orders from 2+ customers",
};

const P = (d: string) => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" aria-hidden="true">${d}</svg>`;
export const ICON = {
  overview: P('<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>'),
  agents: P('<circle cx="10" cy="7" r="3.2"/><path d="M3.5 17c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5"/>'),
  orders: P('<path d="M4 3h12v14H4z"/><path d="M7 7h6M7 10h6M7 13h4"/>'),
  market: P('<path d="M3 16h14"/><path d="M5 13V9M9 13V5M13 13V8"/><path d="M16 13v-2"/>'),
  lenders: P('<path d="M3 8l7-4 7 4"/><path d="M5 8v7M10 8v7M15 8v7M3 16h14"/>'),
  pay: P('<path d="M3 6h14v9H3z"/><path d="M3 9h14"/><path d="M6 12.5h3"/>'),
  activity: P('<path d="M2 10h4l2-5 4 10 2-5h4"/>'),
  search: P('<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>'),
  ext: P('<path d="M8 4H4v12h12v-4"/><path d="M11 3h6v6M17 3l-8 8"/>'),
  check: P('<path d="M4 10.5l4 4 8-9"/>'),
  x: P('<path d="M5 5l10 10M15 5L5 15"/>'),
  shield: P('<path d="M10 2.5l6 2.5v5c0 3.7-2.6 6.4-6 7.5-3.4-1.1-6-3.8-6-7.5V5z"/>'),
  copy: P('<rect x="7" y="7" width="10" height="10"/><path d="M13 4H4v9"/>'),
};

/** The LOCA mark: the advance (short bar) stacked on the order that backs it (long bar). Read together, an L. */
export const LOGO = (size = 28, fill = "#2A4C9C") =>
  `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="${fill}"/><rect x="8" y="9" width="7" height="6" rx="1.5" fill="#fff" opacity=".72"/><rect x="8" y="17" width="16" height="6" rx="1.5" fill="#fff"/></svg>`;

export const empty = (title: string, body: string) =>
  `<div class="empty"><div class="empty-t">${esc(title)}</div><div class="muted">${body}</div></div>`;

export function tooltips() {
  const tip = document.querySelector("#tip") as HTMLElement;
  document.addEventListener("mousemove", (e) => {
    const t = (e.target as HTMLElement).closest("[data-tip]") as HTMLElement | null;
    if (!t) return void (tip.hidden = true);
    tip.textContent = t.dataset.tip!;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 12)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null;
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy!);
    b.classList.add("copied");
    setTimeout(() => b.classList.remove("copied"), 900);
  });
}
