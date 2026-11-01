// Live view of the agent swarm: who is trading with whom, right now, from contract state.

import { CAST, type FeedItem, type Order, type Store } from "./data";
import { agentHref, agentRows, feedList, head, metrics } from "./pages";
import { ago, esc, label, usd } from "./ui";

const W = 940, H = 600;
type Node = { id: string; x: number; y: number; kind: "customer" | "agent" | "lender" | "vendor" };

function layout(): Map<string, Node> {
  const col = (ids: string[], x: number, top: number, bottom: number, kind: Node["kind"]) =>
    ids.map((id, i) => ({ id, kind, x, y: ids.length === 1 ? (top + bottom) / 2 : top + (i * (bottom - top)) / (ids.length - 1) }));
  const nodes = [
    ...col(CAST.customers, 110, 60, H - 60, "customer"),
    ...col(CAST.agents.map((a) => a.id), 470, 40, H - 40, "agent"),
    ...col(CAST.lenders.map((l) => l.id), 780, 50, 270, "lender"),
    ...col(CAST.vendors.map((v) => v.id), 780, 350, H - 50, "vendor"),
  ];
  return new Map(nodes.map((nd) => [nd.id, nd]));
}
const NODES = layout();

const edgePath = (a: Node, b: Node) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
};

/** Pairs that traded in the window, weighted by count. */
function edges(s: Store, windowMs = 30 * 60_000) {
  const since = Date.now() - windowMs;
  const out = new Map<string, { a: string; b: string; kind: string; count: number }>();
  const add = (a: string, b: string, kind: string) => {
    if (!NODES.has(a) || !NODES.has(b)) return;
    const k = `${kind}:${a}>${b}`;
    const e = out.get(k) ?? { a, b, kind, count: 0 };
    e.count++;
    out.set(k, e);
  };
  for (const o of s.orders.values()) if (Number(BigInt(o.created_at) / 1_000_000n) > since) add(o.customer_id, o.agent_id, "escrow");
  for (const l of s.loans.values()) {
    if (Number(BigInt(l.created_at) / 1_000_000n) <= since) continue;
    add(l.lender_id, l.agent_id, "credit");
    add(l.agent_id, l.vendor_id, "spend");
  }
  return [...out.values()];
}

function agentStatus(s: Store, agentId: string): { text: string; busy: boolean; order?: Order } {
  const mine = [...s.orders.values()].filter((o) => o.agent_id === agentId).sort((a, b) => b.id - a.id);
  const open = mine.find((o) => o.status === "Funded" || o.status === "Delivered" || o.status === "Disputed");
  if (!open) return { text: mine[0] ? `Idle · last order ${ago(mine[0].created_at)}` : "Idle", busy: false };
  const loan = open.loan_id !== null ? s.loans.get(open.loan_id) : undefined;
  if (open.status === "Delivered") return { text: `Delivered #${open.id}, awaiting approval`, busy: true, order: open };
  if (open.status === "Disputed") return { text: `#${open.id} in dispute`, busy: true, order: open };
  if (loan) return { text: `Working on #${open.id} · ${usd(loan.principal)} from ${label(loan.lender_id)}`, busy: true, order: open };
  if (open.credit_request) return { text: `Raising ${usd(open.credit_request.amount)} for #${open.id}`, busy: true, order: open };
  return { text: `Working on #${open.id} (${usd(open.amount)})`, busy: true, order: open };
}

function counters(s: Store, feed: FeedItem[]) {
  const t = s.market.totals;
  const m = metrics(s);
  const tenMin = Date.now() - 10 * 60_000;
  const recentOrders = [...s.orders.values()].filter((o) => Number(BigInt(o.created_at) / 1_000_000n) > tenMin).length;
  const events = feed.filter((f) => f.at > tenMin).length;
  const c = (k: string, v: number, fmt: string, note: string) =>
    `<div class="kpi"><div class="k">${k}</div><div class="v" data-count="${v}" data-fmt="${fmt}">${fmtCount(v, fmt)}</div><div class="n">${note}</div></div>`;
  return c("Orders", t.orders, "int", `${(recentOrders / 10).toFixed(1)} per minute`)
    + c("Loans", t.loans, "int", `${t.loans_repaid} repaid · ${t.loans_defaulted} defaulted`)
    + c("Escrow volume", Number(t.escrow_volume) / 1e6, "usd", "all orders")
    + c("Credit originated", Number(t.originated) / 1e6, "usd", `${(m.avgFee * 100).toFixed(2)}% avg fee`)
    + c("Events, last 10 min", events, "int", "escrows, bids, loans, settlements");
}

function fmtCount(v: number, fmt: string) {
  if (fmt === "usd") return v >= 10_000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v).toLocaleString("en-US")}`;
  return Math.round(v).toLocaleString("en-US");
}

function network(s: Store) {
  const es = edges(s);
  const max = Math.max(1, ...es.map((e) => e.count));
  const lines = es
    .map((e) => `<path d="${edgePath(NODES.get(e.a)!, NODES.get(e.b)!)}" class="edge e-${e.kind}" style="stroke-width:${1 + (3 * e.count) / max}"/>`)
    .join("");
  const busy = new Set(CAST.agents.filter((a) => agentStatus(s, a.id).busy).map((a) => a.id));
  const nodes = [...NODES.values()]
    .map((nd) => {
      const name = label(nd.id);
      const anchor = nd.kind === "customer" ? "end" : "start";
      const dx = nd.kind === "customer" ? -14 : 14;
      const rec = s.agents.get(nd.id);
      const sub = rec ? `${rec.score.score}` : "";
      return `<g class="node n-${nd.kind}${busy.has(nd.id) ? " busy" : ""}" data-tip="${esc(name)}">
        ${nd.kind === "agent" ? `<circle cx="${nd.x}" cy="${nd.y}" r="15" class="halo"/>` : ""}
        <circle cx="${nd.x}" cy="${nd.y}" r="${nd.kind === "agent" ? 9 : 7}" class="dotn"/>
        <text x="${nd.x + dx}" y="${nd.y + 4}" text-anchor="${anchor}" class="nl">${esc(name)}${sub ? ` <tspan class="ns">${sub}</tspan>` : ""}</text></g>`;
    })
    .join("");
  const heads = `<text x="110" y="18" text-anchor="middle" class="colh">CUSTOMERS</text><text x="470" y="18" text-anchor="middle" class="colh">AGENTS · SCORE</text><text x="780" y="30" class="colh" text-anchor="middle">LENDERS</text><text x="780" y="326" class="colh" text-anchor="middle">VENDORS</text>`;
  return `<svg id="sw-svg" class="net" viewBox="0 0 ${W} ${H}" role="img" aria-label="Network of customers, agents, lenders and vendors trading in the last 30 minutes">${heads}<g id="sw-edges">${lines}</g><g id="sw-pulses"></g>${nodes}</svg>`;
}

function agentTiles(s: Store) {
  return agentRows(s)
    .map((r) => {
      const st = agentStatus(s, r.agent.agent_id);
      return `<a class="tile${st.busy ? " busy" : ""}" href="${agentHref(r.agent.agent_id)}">
        <div class="tile-h"><span class="pulse"></span><b>${esc(label(r.agent.agent_id))}</b><span class="tile-score">${r.score.score}</span></div>
        <div class="tile-s">${esc(st.text)}</div>
        <div class="tile-f mono"><span>${usd(r.agent.stats.revenue, 0)} rev</span><span>${r.agent.stats.loans_repaid + r.agent.stats.loans_repaid_with_bond} repaid</span><span class="${r.agent.stats.loans_defaulted ? "bad-t" : ""}">${r.agent.stats.loans_defaulted} def</span></div>
      </a>`;
    })
    .join("");
}

export function swarmPage(s: Store, feed: FeedItem[]) {
  return `${head("Agent swarm", `${CAST.agents.length} AI service agents, ${CAST.customers.length} customers, ${CAST.lenders.length} lender agents and ${CAST.vendors.length} vendors trading on one Loca market on NEAR testnet. Every number below is read from the contract as it changes.`, `<span class="live-tag"><i></i>Live · <span id="sw-age">now</span></span>`)}
  <div class="kpis" id="sw-counters">${counters(s, feed)}</div>
  <div class="grid g-12">
    <section class="card span-8"><div class="card-h"><h2>Who is trading with whom</h2><span class="legend small"><span><i class="c-escrow"></i>escrow</span><span><i class="c-offer"></i>credit</span><span><i class="c-bond"></i>spend</span></span></div>
      <div class="card-b" id="sw-net">${network(s)}</div>
      <div class="card-f">Lines: pairs that traded in the last 30 minutes, thicker for more trades. A pulse runs along a line for each new event. Ringed agents have an open order.</div></section>
    <section class="card span-4"><div class="card-h"><h2>Event stream</h2><a class="small" href="#/app/activity">All →</a></div><div class="card-b feed-scroll" id="sw-feed">${feedList(feed.slice(0, 24))}</div></section>
  </div>
  <h3 class="sec">Agents right now</h3>
  <div class="tiles" id="sw-agents">${agentTiles(s)}</div>
  <p class="muted small">The swarm is <code>scripts/swarm.ts</code>: each agent takes orders, borrows against them when it needs inputs, delivers or misses, and customers approve, go silent, dispute or cancel. Lender agents price every request with their own strategy. Funds are a test USDC token; gas is testnet NEAR.</p>`;
}

/** Update the live parts in place so animations and hover state survive a refresh. */
export function updateSwarm(s: Store, feed: FeedItem[], fresh: Set<string>) {
  const root = document.querySelector("#sw-counters");
  if (!root) return;
  const prev = new Map([...root.querySelectorAll<HTMLElement>("[data-count]")].map((el, i) => [i, Number(el.dataset.count)]));
  root.innerHTML = counters(s, feed);
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el, i) => tween(el, prev.get(i) ?? 0, Number(el.dataset.count), el.dataset.fmt!));
  document.querySelector("#sw-edges")!.outerHTML = `<g id="sw-edges">${network(s).match(/<g id="sw-edges">([\s\S]*?)<\/g><g id="sw-pulses">/)![1]}</g>`;
  // Agent node rings follow open orders.
  const busy = new Set(CAST.agents.filter((a) => agentStatus(s, a.id).busy).map((a) => label(a.id)));
  document.querySelectorAll<SVGGElement>("#sw-svg .n-agent").forEach((g) => g.classList.toggle("busy", busy.has(g.dataset.tip!)));
  document.querySelector("#sw-feed")!.innerHTML = feedList(feed.slice(0, 24), fresh);
  document.querySelector("#sw-agents")!.innerHTML = agentTiles(s);
  document.querySelector("#sw-age")!.textContent = "just now";
  for (const f of feed.filter((x) => fresh.has(x.key)).slice(0, 12)) pulse(f);
}

function tween(el: HTMLElement, from: number, to: number, fmt: string) {
  if (from === to) return;
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = fmtCount(from + (to - from) * (1 - Math.pow(1 - k, 3)), fmt);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 900);
}

/** A dot travelling along the edge an event used. */
function pulse(f: FeedItem) {
  const g = document.querySelector("#sw-pulses");
  if (!g) return;
  const path = (a?: string, b?: string) => (a && b && NODES.has(a) && NODES.has(b) ? edgePath(NODES.get(a)!, NODES.get(b)!) : null);
  const routes: { d: string; cls: string }[] = [];
  if (f.kind === "order") { const d = path(f.from, f.to); if (d) routes.push({ d, cls: "p-escrow" }); }
  if (f.kind === "loan") {
    const d1 = path(f.from, f.via), d2 = path(f.via, f.to);
    if (d1) routes.push({ d: d1, cls: "p-credit" });
    if (d2) routes.push({ d: d2, cls: "p-spend" });
  }
  // Repayment runs agent → lender; deliveries and refunds run back toward the customer.
  if (f.kind === "settled" && f.to) { const d = path(f.from, f.to); if (d) routes.push({ d, cls: "p-credit" }); }
  if (f.kind === "delivered" || f.kind === "refunded") { const d = path(f.from, f.to); if (d) routes.push({ d, cls: "p-escrow" }); }
  routes.forEach((r, i) => {
    const ns = "http://www.w3.org/2000/svg";
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("r", "5");
    c.setAttribute("class", `pulse-dot ${r.cls}`);
    const anim = document.createElementNS(ns, "animateMotion");
    anim.setAttribute("dur", "1.4s");
    anim.setAttribute("begin", `${i * 0.5 + Math.random() * 0.6}s`);
    anim.setAttribute("fill", "freeze");
    anim.setAttribute("path", r.d);
    c.appendChild(anim);
    g.appendChild(c);
    (anim as unknown as { beginElement?: () => void }).beginElement?.();
    setTimeout(() => c.remove(), 3500);
  });
}

