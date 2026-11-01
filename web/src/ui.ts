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
  ...CAST.vendors.map((v) => [v.id, (v as { name?: string }).name ?? cap(v.id.split(".")[0])] as [string, string]),
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
    policy: "Prices off how many times the escrow covers the advance, plus the agent's default rate. Declines below 2× coverage, above 15% defaults, or an unrated agent with a bond under 20% of principal.",
  },
  "repayment-history": {
    name: "Repayment history",
    policy: "Lends only to agents with 3+ completed orders and defaults under 5% of closed loans. Fee falls as repayment and fulfillment records grow.",
  },
  "concentration-aware": {
    name: "Concentration-aware",
    policy: "Caps exposure at $60 per agent. Prices off the LOCA Score and the default rate, and adds 2% when one customer dominates revenue.",
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

/** Candidate marks, drawn on a 32-unit grid. `i` is the ink colour, `a` the blue accent. */
export const LOGOS: Record<string, { name: string; idea: string; svg: (i: string, a: string) => string }> = {
  "1": { name: "Split coin", idea: "The order, with half of it advanced",
    svg: (i, a) => `<path d="M16 28A12 12 0 0 1 16 4" fill="none" stroke="${i}" stroke-width="3"/><path d="M16 2.5a13.5 13.5 0 0 1 0 27z" fill="${a}"/>` },
  "2": { name: "Stepped bars", idea: "The fee falling with every repaid loan",
    svg: (i, a) => `<rect x="4" y="5" width="24" height="5.5" rx="1.5" fill="${i}"/><rect x="4" y="13.25" width="17" height="5.5" rx="1.5" fill="${i}"/><rect x="4" y="21.5" width="10" height="5.5" rx="1.5" fill="${a}"/>` },
  "3": { name: "Bracket and dot", idea: "Money held in escrow",
    svg: (i, a) => `<path d="M10 4H5v24h5M22 4h5v24h-5" fill="none" stroke="${i}" stroke-width="3.2"/><circle cx="16" cy="16" r="5" fill="${a}"/>` },
  "4": { name: "Line through a ring", idea: "A credit line running through the order",
    svg: (i, a) => `<circle cx="14" cy="16" r="9.5" fill="none" stroke="${i}" stroke-width="3.2"/><path d="M1 16h24" stroke="${a}" stroke-width="3.2"/><path d="M24 10.5l7 5.5-7 5.5z" fill="${a}"/>` },
  "5": { name: "Overlapping squares", idea: "Where lender and agent meet",
    svg: (i, a) => `<rect x="12" y="12" width="9.5" height="9.5" fill="${a}"/><rect x="4" y="4" width="17.5" height="17.5" fill="none" stroke="${i}" stroke-width="3"/><rect x="12" y="12" width="17.5" height="17.5" fill="none" stroke="${i}" stroke-width="3"/>` },
  "6": { name: "Rising record", idea: "A credit history that grows",
    svg: (i, a) => `<path d="M3 29h26" stroke="${i}" stroke-width="2.2"/><path d="M4 23l7-7 5 4 8-9" fill="none" stroke="${i}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="25.5" cy="9" r="3.6" fill="${a}"/>` },
};
export const logoChoice = () => (typeof localStorage !== "undefined" && LOGOS[localStorage.getItem("loca.logo") ?? ""] ? localStorage.getItem("loca.logo")! : "1");
export const markSvg = (key: string, size: number, ink = "#1e1e1e", accent = "#2A4C9C") =>
  `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${LOGOS[key].svg(ink, accent)}</svg>`;
/** The current mark, as chosen on #/logos (defaults to the split coin). */
export const LOGO = (size = 28, ink = "#1e1e1e", accent = "#2A4C9C") => markSvg(logoChoice(), size, ink, accent);

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
