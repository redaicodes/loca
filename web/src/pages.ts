import { CAST, CONTRACT, GUARDRAILS, type FeedItem, type Loan, type Offer, type Order, type ScoreReport, type Store } from "./data";
import { REASON_TEXT, SCORE_LABELS, STRATEGY, ICON, acct, accountLink, agentService, ago, bps, empty, esc, fmtDate, label, pct, pill, strategyName, strategyNote, txLink, usd } from "./ui";

const enc = encodeURIComponent;
export const agentHref = (id: string) => `#/app/agents/${enc(id)}`;
export const orderHref = (id: number) => `#/app/orders/${id}`;
const n = (v: string | number) => Number(v) / 1e6;

/** Compact dollars for headline figures: $12.4K. */
export const usdK = (raw: string | number) => {
  const v = n(raw);
  return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 10_000 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

export const head = (title: string, sub: string, right = "") =>
  `<header class="page-head"><div><h1>${title}</h1><p class="sub">${sub}</p></div>${right}</header>`;
export const card = (title: string, body: string, opts: { right?: string; foot?: string; cls?: string } = {}) =>
  `<section class="card ${opts.cls ?? ""}"><div class="card-h"><h2>${title}</h2>${opts.right ?? ""}</div><div class="card-b">${body}</div>${opts.foot ? `<div class="card-f">${opts.foot}</div>` : ""}</section>`;
export const kpi = (k: string, v: string, note = "", tip = "") =>
  `<div class="kpi"${tip ? ` data-tip="${esc(tip)}"` : ""}><div class="k">${k}${tip ? ' <span class="q">?</span>' : ""}</div><div class="v">${v}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;

const sorted = <T extends { id: number }>(m: Map<number, T>) => [...m.values()].sort((a, b) => b.id - a.id);
const offersFor = (s: Store, orderId: number) => [...s.offers.values()].filter((o) => o.order_id === orderId).sort((a, b) => Number(a.fee) - Number(b.fee));
const loanFor = (s: Store, o: Order) => (o.loan_id !== null ? s.loans.get(o.loan_id) : undefined);
const pastDeadline = (o: Order) => o.status === "Funded" && BigInt(o.deadline) < BigInt(Date.now()) * 1_000_000n;
const ms = (v: string | null) => (v ? Number(BigInt(v) / 1_000_000n) : 0);

/** How the escrow was split. Lender share counts only what came out of escrow; bond recoveries are separate. */
function split(o: Order, loan?: Loan) {
  const amount = Number(o.amount), refund = Number(o.customer_refund);
  const settled = o.status === "Released" || o.status === "Refunded";
  const fromBond = loan ? Number(loan.recovered_from_bond) : 0;
  const lender = loan && loan.status !== "Active" ? Number(loan.repaid) - fromBond : 0;
  return { amount, refund, lender, fromBond, agent: settled ? amount - refund - lender : 0, settled };
}

/** Market metrics a DeFi reader expects, all derived from the contract's running totals. */
export function metrics(s: Store) {
  const t = s.market.totals;
  const tvl = n(t.escrow_held) + n(t.offers_open) + n(t.bonds_held) + n(t.claimable);
  const closed = t.loans_repaid + t.loans_defaulted;
  const repaidPrincipal = n(t.repaid_to_lenders) - n(t.fees_paid);
  return {
    tvl,
    originated: n(t.originated),
    outstanding: n(t.outstanding),
    escrowVolume: n(t.escrow_volume),
    fees: n(t.fees_paid),
    repayRate: closed ? t.loans_repaid / closed : 1,
    lossRate: n(t.originated) ? n(t.default_loss) / n(t.originated) : 0,
    avgFee: t.loans_repaid && repaidPrincipal > 0 ? n(t.fees_paid) / repaidPrincipal : 0,
    bondCoverage: n(t.outstanding) ? n(t.bonds_held) / n(t.outstanding) : 0,
    advanceRate: n(t.escrow_volume) ? n(t.originated) / n(t.escrow_volume) : 0,
    closed,
  };
}

// ---------------------------------------------------------------- charts

function scoreBars(score: ScoreReport) {
  return `<div class="hbars">${score.components
    .map((c) => {
      const max = c.weight_bps / 10;
      const pts = Math.round((c.weight_bps * c.value_bps) / 1e5);
      return `<div class="hbar" data-tip="${esc(`${SCORE_LABELS[c.name] ?? c.name}: ${pts} of ${max} points (${c.value_bps / 100}% of a ${c.weight_bps / 100}% weight)`)}">
        <span class="hl">${SCORE_LABELS[c.name] ?? c.name}<span class="w">${c.weight_bps / 100}%</span></span>
        <span class="track"><span class="fill" style="width:${c.value_bps / 100}%"></span></span>
        <span class="hv mono">${pts}<span class="muted">/${max}</span></span>
      </div>`;
    })
    .join("")}</div>`;
}

function bidBars(offers: Offer[], winnerId?: number) {
  const max = Math.max(...offers.map((o) => Number(o.fee)));
  return `<div class="hbars">${offers
    .map((o) => {
      const win = o.id === winnerId;
      return `<div class="hbar" data-tip="${esc(`${label(o.lender_id)} (${strategyName(o.strategy)}) bid ${usd(o.fee)} on ${usd(o.principal)}: ${(bps(o.fee, o.principal) / 100).toFixed(2)}%`)}">
        <span class="hl">${esc(label(o.lender_id))}${win ? '<span class="won">won</span>' : ""}</span>
        <span class="track"><span class="fill ${win ? "" : "muted"}" style="width:${(Number(o.fee) / max) * 100}%"></span></span>
        <span class="hv mono">${usd(o.fee)}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function waterfall(o: Order, loan?: Loan) {
  const s = split(o, loan);
  if (!s.settled) return empty("Not settled yet", "The split appears when the customer approves or the dispute window closes.");
  const seg = (v: number, cls: string, name: string) =>
    v > 0 ? `<span class="seg ${cls}" style="flex:${v}" data-tip="${esc(`${name}: ${usd(v)} (${pct((v / s.amount) * 100)})`)}"><span>${usd(v)}</span></span>` : "";
  return `<div class="stack" role="img" aria-label="${esc(`Escrow ${usd(s.amount)}: lender ${usd(s.lender)}, agent ${usd(s.agent)}, refund ${usd(s.refund)}`)}">
      ${seg(s.refund, "c-refund", "Refunded to customer")}${seg(s.lender, "c-lender", "Lender: principal + fee")}${seg(s.agent, "c-agent", "Agent keeps")}</div>
    <div class="legend">
      ${s.refund ? `<span><i class="c-refund"></i>Customer refund <b class="mono">${usd(s.refund)}</b></span>` : ""}
      ${loan ? `<span><i class="c-lender"></i>Lender <b class="mono">${usd(s.lender)}</b></span>` : ""}
      <span><i class="c-agent"></i>Agent <b class="mono">${usd(s.agent)}</b></span>
      ${s.fromBond ? `<span>From bond <b class="mono">${usd(s.fromBond)}</b></span>` : ""}
    </div>`;
}

/** Value locked, stacked by where the tokens sit. Order matches the validated palette adjacency. */
function tvlBar(s: Store) {
  const t = s.market.totals;
  const parts = [
    { k: "Customer escrow", v: n(t.escrow_held), c: "c-escrow", tip: "Payments held for orders not yet settled." },
    { k: "Agent bonds", v: n(t.bonds_held), c: "c-bond", tip: "First-loss capital posted by operators. Drawn before lenders lose." },
    { k: "Lender bids", v: n(t.offers_open), c: "c-offer", tip: "Fully funded offers waiting for an agent to accept." },
    { k: "Claimable", v: n(t.claimable), c: "c-claim", tip: "Settled balances not yet withdrawn." },
  ];
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return `<div class="stack tall">${parts.map((p) => (p.v > 0 ? `<span class="seg ${p.c}" style="flex:${p.v}" data-tip="${esc(`${p.k}: $${p.v.toFixed(2)} (${pct((p.v / total) * 100)}). ${p.tip}`)}"></span>` : "")).join("")}</div>
    <div class="legend">${parts.map((p) => `<span><i class="${p.c}"></i>${p.k} <b class="mono">$${p.v.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b></span>`).join("")}</div>`;
}

/** Single-series column chart over time buckets. */
function columns(series: { t: number; v: number }[], fmt: (v: number) => string, title: string) {
  const stepMs = series.length > 1 ? series[1].t - series[0].t : 600_000;
  if (!series.some((p) => p.v)) return empty("No data yet", "");
  const W = 520, H = 150, L = 6, B = 22, T = 18;
  const max = Math.max(...series.map((p) => p.v), 1);
  const bw = (W - L * 2) / series.length;
  const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const bars = series
    .map((p, i) => {
      const h = ((H - B - T) * p.v) / max;
      const x = L + i * bw;
      const body = h > 0 ? `<path d="M${x + 2},${H - B} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${Math.max(bw - 12, 1)} q4,0 4,4 v${Math.max(h - 4, 0)} z" class="col"/>` : "";
      return `<g data-tip="${esc(`${hhmm(p.t)}–${hhmm(p.t + stepMs)}: ${fmt(p.v)}`)}"><rect x="${x}" y="${T}" width="${bw}" height="${H - B - T}" class="hit"/>${body}</g>`;
    })
    .join("");
  const every = Math.ceil(series.length / 6);
  const ticks = series.map((p, i) => (i % every === 0 ? `<text x="${L + i * bw + 2}" y="${H - 6}" class="ax">${hhmm(p.t)}</text>` : "")).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" class="gl"/>
    <text x="${L}" y="11" class="ax">peak ${fmt(max)}</text>${bars}${ticks}</svg>`;
}

/** Time buckets sized to the market's age: 24 columns covering at least 30 minutes, at most a day. */
function buckets<T>(items: T[], at: (x: T) => number, val: (x: T) => number, count = 24) {
  const first = Math.min(...items.map(at).filter(Boolean), Date.now());
  const minutes = [1, 2, 5, 10, 15, 30, 60].find((m) => m * count * 60_000 >= Date.now() - first) ?? 60;
  const step = minutes * 60_000;
  const end = Math.ceil(Date.now() / step) * step;
  const out = Array.from({ length: count }, (_, i) => ({ t: end - (count - i) * step, v: 0 }));
  for (const x of items) {
    const i = Math.floor((at(x) - out[0].t) / step);
    if (i >= 0 && i < count) out[i].v += val(x);
  }
  return out;
}

// ---------------------------------------------------------------- tables

function ordersTable(s: Store, orders: Order[], showAgent = true) {
  if (!orders.length) return empty("No orders", "Orders appear when a customer escrows payment for an agent.");
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Order</th>${showAgent ? "<th>Agent</th>" : ""}<th>Customer</th><th class="num">Escrow</th><th>Status</th><th class="num">Advance</th><th class="num">Fee</th><th class="num">Age</th></tr></thead>
    <tbody>${orders
      .map((o) => {
        const loan = loanFor(s, o);
        return `<tr data-href="${orderHref(o.id)}">
          <td><a class="mono strong" href="${orderHref(o.id)}">#${o.id}</a></td>
          ${showAgent ? `<td>${esc(label(o.agent_id))}</td>` : ""}
          <td>${esc(label(o.customer_id))}</td>
          <td class="num mono">${usd(o.amount)}</td>
          <td>${pill(o.status)}${pastDeadline(o) ? ' <span class="muted small">past deadline</span>' : ""}</td>
          <td class="num mono">${loan ? usd(loan.principal) : o.credit_request ? `<span class="muted">asked ${usd(o.credit_request.amount)}</span>` : '<span class="muted">–</span>'}</td>
          <td class="num mono">${loan ? `${usd(loan.fee)} <span class="muted">${(bps(loan.fee, loan.principal) / 100).toFixed(1)}%</span>` : '<span class="muted">–</span>'}</td>
          <td class="num muted">${ago(o.created_at)}</td>
        </tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function loansTable(loans: Loan[]) {
  if (!loans.length) return empty("No loans", "Loans appear when an agent accepts a lender's bid.");
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Loan</th><th>Order</th><th>Lender</th><th>Paid to vendor</th><th class="num">Principal</th><th class="num">Fee</th><th class="num">Repaid</th><th>Status</th></tr></thead>
    <tbody>${loans
      .map((l) => `<tr data-href="${orderHref(l.order_id)}">
        <td class="mono">L-${l.id}</td><td><a class="mono" href="${orderHref(l.order_id)}">#${l.order_id}</a></td>
        <td>${esc(label(l.lender_id))}</td><td>${esc(label(l.vendor_id))}</td>
        <td class="num mono">${usd(l.principal)}</td><td class="num mono">${usd(l.fee)}</td><td class="num mono">${usd(l.repaid)}</td><td>${pill(l.status)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

export function agentRows(s: Store) {
  const loans = [...s.loans.values()];
  return [...s.agents.values()]
    .map((r) => {
      const mine = loans.filter((l) => l.agent_id === r.agent.agent_id && l.status === "Repaid");
      const avgFee = mine.length ? mine.reduce((a, l) => a + bps(l.fee, l.principal), 0) / mine.length : NaN;
      return { ...r, avgFee };
    })
    .sort((a, b) => b.score.score - a.score.score);
}

const FEED_ICON: Record<string, string> = { order: "◆", request: "↗", bid: "◇", loan: "●", delivered: "✓", settled: "■", refunded: "↺", disputed: "!", default: "✕" };
export const feedList = (items: FeedItem[], fresh = new Set<string>()) =>
  `<ol class="feed live">${items
    .map((f) => `<li class="k-${f.kind}${fresh.has(f.key) ? " fresh" : ""}"><span class="fi">${FEED_ICON[f.kind]}</span><a class="tx-t" href="${orderHref(f.orderId)}">${esc(f.text)}</a><span class="muted small mono">${new Date(f.at).toLocaleTimeString("en-GB")}</span></li>`)
    .join("")}</ol>`;

function lenderTable(s: Store) {
  const loans = [...s.loans.values()];
  const offers = [...s.offers.values()];
  const rows = CAST.lenders.map((l) => {
    const bids = offers.filter((o) => o.lender_id === l.id);
    const won = loans.filter((x) => x.lender_id === l.id);
    const fees = won.filter((x) => x.status === "Repaid").reduce((a, x) => a + n(x.fee), 0);
    const deployed = won.reduce((a, x) => a + n(x.principal), 0);
    const loss = won.filter((x) => x.status === "Defaulted").reduce((a, x) => a + n(x.principal) + n(x.fee) - n(x.repaid), 0);
    const active = won.filter((x) => x.status === "Active").reduce((a, x) => a + n(x.principal), 0);
    // Win rate over the same window as the bids, so it can never exceed 100%.
    return { l, bids: bids.length, won: bids.filter((o) => o.status === "Accepted").length, fees, deployed, loss, active, net: fees - loss };
  });
  return card("Lenders", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lender</th><th>Strategy</th><th class="num">Bids</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Lent</th><th class="num">Active</th><th class="num">Fees</th><th class="num">Losses</th><th class="num">Net</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${acct(r.l.id)}</td><td>${strategyName(r.l.strategy)}</td><td class="num mono">${r.bids}</td><td class="num mono">${r.won}</td><td class="num mono">${r.bids ? pct((r.won / r.bids) * 100, 0) : "–"}</td>
      <td class="num mono">$${r.deployed.toFixed(0)}</td><td class="num mono">$${r.active.toFixed(0)}</td><td class="num mono">$${r.fees.toFixed(2)}</td><td class="num mono">$${r.loss.toFixed(2)}</td><td class="num mono strong${r.net < 0 ? " bad-t" : ""}">${r.net < 0 ? "−" : ""}$${Math.abs(r.net).toFixed(2)}</td></tr>`)
    .join("")}</tbody></table></div>`, { foot: "Over the loans loaded in this view. Losses are principal + fee not recovered from escrow or bond." });
}

// ---------------------------------------------------------------- pages

export function dashboard(s: Store, feed: FeedItem[]) {
  const m = metrics(s);
  const t = s.market.totals;
  const orders = [...s.orders.values()];
  const loans = [...s.loans.values()];
  const agents = agentRows(s);
  const feeMax = Math.max(...agents.map((a) => a.avgFee).filter((x) => !isNaN(x)), 1);

  return `${head("Market", `Live credit market for AI agents on NEAR testnet. Every figure is read from <code>${esc(CONTRACT)}</code>.`, `<span class="live-tag"><i></i>Live</span>`)}
  <div class="kpis">
    ${kpi("Value locked", `$${m.tvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, "escrow + bids + bonds + claimable", "Tokens held by the contract right now. Always equals its token balance.")}
    ${kpi("Credit originated", usdK(t.originated), `${t.loans} loans`, "Total principal advanced to vendors on behalf of agents.")}
    ${kpi("Outstanding", usdK(t.outstanding), `${pct(m.advanceRate * 100, 0)} of escrow volume borrowed`, "Principal on loans not yet settled.")}
    ${kpi("Repayment rate", m.closed ? pct(m.repayRate * 100, 1) : "–", `${t.loans_repaid} repaid · ${t.loans_defaulted} defaulted`, "Share of closed loans repaid in full, including from bonds.")}
    ${kpi("Avg cost of credit", m.avgFee ? pct(m.avgFee * 100, 2) : "–", "fee per loan, of principal", "Fees paid divided by principal repaid. Each loan lasts minutes on testnet, so this is a per-loan fee, not an APR.")}
  </div>
  <div class="kpis">
    ${kpi("Lender fees earned", `$${m.fees.toFixed(2)}`, "paid at settlement")}
    ${kpi("Loss rate", pct(m.lossRate * 100, 2), `$${n(t.default_loss).toFixed(2)} unrecovered`, "Default losses after bonds, divided by principal originated.")}
    ${kpi("Bond coverage", m.outstanding ? `${m.bondCoverage.toFixed(2)}×` : "–", "bonds ÷ outstanding", "First-loss capital available per dollar of open credit.")}
    ${kpi("Escrow volume", usdK(t.escrow_volume), `${t.orders} orders · ${t.orders_settled} settled`)}
    ${kpi("Agents", String(s.market.agents), `${t.orders_disputed} disputes · ${t.deposits_rejected} deposits refused`)}
  </div>
  ${card("Value locked", tvlBar(s), { foot: "Where every token in the contract sits. Hover a segment for detail." })}
  <div class="grid g-12">
    ${card("Escrow funded over time", columns(buckets(orders, (o) => ms(o.created_at), (o) => n(o.amount)), (v) => `$${v.toFixed(0)}`, "Escrow funded over time"), { cls: "span-6" })}
    ${card("Credit advanced over time", columns(buckets(loans, (l) => ms(l.created_at), (l) => n(l.principal)), (v) => `$${v.toFixed(0)}`, "Credit advanced over time"), { cls: "span-6" })}
  </div>
  <div class="grid g-12">
    ${card("Agent leaderboard", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th class="num">Score</th><th class="num">Revenue</th><th class="num">Orders</th><th class="num">Repaid</th><th class="num">Defaults</th><th>Avg fee paid</th><th class="num">Bond</th></tr></thead><tbody>${agents
      .map((a) => `<tr data-href="${agentHref(a.agent.agent_id)}">
        <td><a href="${agentHref(a.agent.agent_id)}">${esc(label(a.agent.agent_id))}</a><div class="muted small">${esc(agentService(a.agent.agent_id) ?? "")}</div></td>
        <td class="num"><span class="score-sm">${a.score.score}</span>${a.score.rated ? "" : '<div class="muted small">unrated</div>'}</td>
        <td class="num mono">${usd(a.agent.stats.revenue, 0)}</td><td class="num mono">${a.agent.stats.orders_completed}</td>
        <td class="num mono">${a.agent.stats.loans_repaid + a.agent.stats.loans_repaid_with_bond}</td>
        <td class="num mono${a.agent.stats.loans_defaulted ? " bad-t" : ""}">${a.agent.stats.loans_defaulted}</td>
        <td>${isNaN(a.avgFee) ? '<span class="muted">–</span>' : `<span class="inline-bar"><i style="width:${(a.avgFee / feeMax) * 100}%"></i></span><span class="mono small">${(a.avgFee / 100).toFixed(2)}%</span>`}</td>
        <td class="num mono">${usd(a.agent.bond, 0)}</td></tr>`)
      .join("")}</tbody></table></div>`, { cls: "span-8", foot: "Avg fee paid: mean fee on repaid loans, as a share of principal." })}
    ${card("Live activity", feedList(feed.slice(0, 12)), { cls: "span-4", right: `<a class="small" href="#/app/activity">All →</a>` })}
  </div>
  ${lenderTable(s)}`;
}

export function agents(s: Store) {
  return `${head("Agents", "AI service businesses with a LOCA ID. Identity, spend policy and track record are contract state.")}
  <div class="agent-grid">${agentRows(s)
    .map((r) => {
      const st = r.agent.stats;
      return `<a class="agent-card" href="${agentHref(r.agent.agent_id)}">
        <div class="ac-top"><div class="avatar sm">${esc(label(r.agent.agent_id).slice(0, 1))}</div><div><div class="ac-name">${esc(label(r.agent.agent_id))}</div><div class="muted small">${esc(agentService(r.agent.agent_id) ?? "")} · ${esc(label(r.agent.operator_id))}</div></div>
          <div class="ac-score">${r.score.score}</div></div>
        <div class="ac-stats"><div><span class="k">Revenue</span><b class="mono">${usd(st.revenue, 0)}</b></div><div><span class="k">Orders</span><b class="mono">${st.orders_completed}</b></div><div><span class="k">Repaid</span><b class="mono">${st.loans_repaid + st.loans_repaid_with_bond}</b></div><div><span class="k">Defaults</span><b class="mono">${st.loans_defaulted}</b></div></div>
        <div class="codes">${r.score.reason_codes.slice(0, 2).map((c) => `<span class="code">${esc(c)}</span>`).join("") || '<span class="code ok">No adverse codes</span>'}</div>
      </a>`;
    })
    .join("")}</div>`;
}

function feeDots(pts: { v: number; id: number; ok: boolean }[]) {
  const W = 760, H = 170, L = 40, R = 12, T = 14, B = 14;
  const max = Math.max(8, ...pts.map((p) => p.v));
  const x = (i: number) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + ((max - v) * (H - T - B)) / max;
  const grid = [0, max / 2, max].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="gl"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" class="ax">${g.toFixed(1)}%</text>`).join("");
  const dots = pts.map((p, i) => `<g data-tip="${esc(`Loan L-${p.id}: fee ${p.v.toFixed(2)}% of principal${p.ok ? "" : " (defaulted)"}`)}"><circle cx="${x(i)}" cy="${y(p.v)}" r="10" class="hit"/><circle cx="${x(i)}" cy="${y(p.v)}" r="4.5" class="${p.ok ? "dot" : "dot hollow"}"/></g>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fee per loan, oldest to newest">${grid}${dots}</svg>`;
}

export function agentDetail(s: Store, id: string) {
  const rec = s.agents.get(id);
  if (!rec) return `${head("Agent not found", esc(id))}${card("No LOCA ID", empty("This account is not registered", `<code>${esc(id)}</code> has not called <code>register_agent</code> on ${esc(CONTRACT)}.`))}`;
  const { agent, score } = rec;
  const orders = sorted(s.orders).filter((o) => o.agent_id === id);
  const loans = sorted(s.loans).filter((l) => l.agent_id === id);
  const feePts = loans.slice().reverse().filter((l) => l.status !== "Active").map((l) => ({ v: bps(l.fee, l.principal) / 100, id: l.id, ok: l.status === "Repaid" }));
  const st = agent.stats;

  return `<div class="crumbs"><a href="#/app/agents">Agents</a> / ${esc(label(id))}</div>
  <header class="entity">
    <div class="avatar">${esc(label(id).slice(0, 1))}</div>
    <div class="who">
      <h1>${esc(label(id))}</h1>
      <div class="sub">${esc(agentService(id) ?? "AI agent")} · operated by ${esc(label(agent.operator_id))} · registered ${fmtDate(agent.registered_at)}</div>
      <div class="ids"><span class="mono">${esc(id)}</span><button class="icon-btn" data-copy="${esc(id)}" title="Copy account id">${ICON.copy}</button>${accountLink(id, "Explorer")}</div>
    </div>
    <div class="score-box" data-tip="${esc("Deterministic: computed by the contract view get_score from onchain history only.")}">
      <div class="k">LOCA Score ${esc(score.version)}</div>
      <div class="big">${score.score}<span>/1000</span></div>
      <div>${score.rated ? '<span class="pill s-done">Rated</span>' : '<span class="pill s-neutral">Unrated</span>'}</div>
    </div>
  </header>
  <div class="kpis">
    ${kpi("Revenue", usd(st.revenue), `${st.orders_completed} completed orders`)}
    ${kpi("Customers", String(st.unique_customers), `${st.orders_refunded} refunded · ${st.disputes_lost} disputes lost`)}
    ${kpi("Loans", `${st.loans_repaid + st.loans_repaid_with_bond} / ${st.loans_taken}`, `repaid · ${agent.active_loans} active · ${st.loans_defaulted} defaulted`)}
    ${kpi("Principal repaid", usd(st.principal_repaid), `default loss ${usd(st.default_loss)}`)}
    ${kpi("First-loss bond", usd(agent.bond), "covers lenders before any loss", "Posted by the operator. Drawn to repay a lender if the escrow falls short. Locked while a loan is active.")}
  </div>
  <div class="grid g-12">
    ${card("Score breakdown", `${scoreBars(score)}<div class="codes">${score.reason_codes.length ? score.reason_codes.map((c) => `<span class="code" data-tip="${esc(REASON_TEXT[c] ?? c)}">${esc(c)}</span>`).join("") : `<span class="code ok">${ICON.check} No adverse reason codes</span>`}</div>`, {
      cls: "span-7", foot: "Weights are prototype rules, not a validated credit model.",
    })}
    ${card("Controls", `<dl class="kv">
      <dt>Operator</dt><dd>${acct(agent.operator_id)}</dd>
      <dt>Spend policy</dt><dd>v${agent.policy_version} · max <b class="mono">${usd(agent.policy.max_principal)}</b> per loan</dd>
      <dt>Allowed vendors</dt><dd>${agent.policy.allowed_vendors.map((v) => acct(v)).join("") || '<span class="muted">–</span>'}</dd>
      <dt>Loan proceeds</dt><dd>Paid to the vendor, never to the agent</dd>
      <dt>Keys</dt><dd id="agent-keys" data-agent="${esc(id)}"><span class="muted small">Reading NEAR access keys…</span></dd>
      <dt>Profile hash</dt><dd class="mono hash">${esc(agent.profile_hash)}</dd>
    </dl>`, { cls: "span-5" })}
  </div>
  ${card("Fee paid per closed loan", feePts.length ? feeDots(feePts) : empty("No closed loans yet", "Each dot will be one loan's fee as a share of principal."), { foot: "Oldest to newest. Hollow dots defaulted." })}
  ${card(`Orders <span class="count">${orders.length}</span>`, ordersTable(s, orders.slice(0, 25), false))}
  ${card(`Loans <span class="count">${loans.length}</span>`, loansTable(loans.slice(0, 25)))}`;
}

const STATUS_ORDER = ["All", "Funded", "Delivered", "Disputed", "Released", "Refunded"];
export function orders(s: Store, filter = "All") {
  const all = sorted(s.orders);
  const counts = Object.fromEntries(STATUS_ORDER.map((st) => [st, st === "All" ? all.length : all.filter((o) => o.status === st).length]));
  const tabs = STATUS_ORDER.filter((st) => st === "All" || counts[st])
    .map((st) => `<a class="tab ${st === filter ? "on" : ""}" href="#/app/orders${st === "All" ? "" : `?status=${st}`}">${st === "Released" ? "Settled" : st}<span>${counts[st]}</span></a>`)
    .join("");
  const list = (filter === "All" ? all : all.filter((o) => o.status === filter)).slice(0, 100);
  return `${head("Orders", `Customer payments held in escrow. ${s.market.totals.orders} orders so far; the most recent are listed.`)}
  <div class="tabs">${tabs}</div>
  ${card("", ordersTable(s, list), { cls: "flush" })}`;
}

export function orderDetail(s: Store, id: number) {
  const o = s.orders.get(id);
  if (!o) return `${head(`Order #${id}`, "Not loaded")}${card("", empty("Order not in view", "It may be older than the window this page loads."))}`;
  const loan = loanFor(s, o);
  const offers = offersFor(s, id);
  const sp = split(o, loan);

  const tl = [
    { t: "Escrow funded", d: `${label(o.customer_id)} deposited ${usd(o.amount)}`, at: o.created_at, done: true },
    o.credit_request && { t: "Advance requested", d: `${usd(o.credit_request.amount)} for ${label(o.credit_request.vendor_id)}, max fee ${usd(o.credit_request.max_fee)}`, done: true },
    o.credit_request && { t: offers.length ? `${offers.length} bid${offers.length > 1 ? "s" : ""} received` : "No bids", d: offers.length ? `${usd(offers[0].fee)} to ${usd(offers[offers.length - 1].fee)}` : "No lender's policy would fund this request", at: offers[0]?.created_at, done: !!offers.length },
    loan && { t: "Loan funded", d: `${usd(loan.principal)} paid to ${label(loan.vendor_id)}, fee ${usd(loan.fee)}`, at: loan.created_at, done: true },
    { t: "Delivered", d: o.deliverable_hash ? `hash ${o.deliverable_hash.slice(0, 16)}…` : pastDeadline(o) || o.status === "Refunded" ? "missed the deadline" : "waiting for the agent", at: o.delivered_at, done: !!o.delivered_at },
    { t: o.status === "Refunded" ? "Refunded" : o.status === "Disputed" ? "In dispute" : "Settled", d: sp.settled ? (loan ? `${usd(sp.lender)} to lender · ${usd(sp.agent)} to agent` : `${usd(sp.agent)} to agent`) : `auto-release ${Number(s.config.dispute_window_ns) / 1e9}s after delivery`, at: loan?.closed_at, done: sp.settled },
  ].filter(Boolean) as { t: string; d: string; at?: string | null; done: boolean }[];

  return `<div class="crumbs"><a href="#/app/orders">Orders</a> / #${id}</div>
  ${head(`Order #${id} ${pill(o.status)}`, `<a href="${agentHref(o.agent_id)}">${esc(label(o.agent_id))}</a> for ${esc(label(o.customer_id))} · created ${fmtDate(o.created_at)}`)}
  <div class="kpis">
    ${kpi("Escrow", usd(o.amount))}
    ${kpi("Advance", loan ? usd(loan.principal) : "–", loan ? `${pct((Number(loan.principal) / Number(o.amount)) * 100, 0)} of escrow · cap ${s.config.max_advance_bps / 100}%` : "no loan")}
    ${kpi("Fee", loan ? usd(loan.fee) : "–", loan ? `${(bps(loan.fee, loan.principal) / 100).toFixed(2)}% of principal` : "")}
    ${kpi("To lender", sp.settled && loan ? usd(sp.lender) : "–", "paid first")}
    ${kpi("To agent", sp.settled ? usd(sp.agent) : "–", "the remainder")}
  </div>
  <div class="grid g-12">
    ${card("Lifecycle", `<ol class="timeline">${tl
      .map((e) => `<li class="${e.done ? "done" : ""}"><span class="mk"></span><div><div class="tt">${esc(e.t)}</div><div class="muted">${esc(e.d)}</div></div><div class="when">${e.at ? `<span class="muted small">${fmtDate(e.at)}</span>` : ""}</div></li>`)
      .join("")}</ol>`, { cls: "span-5", foot: `State from ${accountLink(CONTRACT, "the market contract")}` })}
    <div class="span-7 col">
      ${card("Settlement", waterfall(o, loan), { foot: "Waterfall: customer refund, then lender principal + fee, then the bond covers any shortfall, then the agent keeps the rest." })}
      ${card("Bids", offers.length ? bidBars(offers, loan?.offer_id) : empty("No bids", o.credit_request ? "No lender's policy would fund this request." : "This order did not request an advance."))}
    </div>
  </div>
  ${offers.length ? card("Offers", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Offer</th><th>Lender</th><th>Strategy</th><th class="num">Fee</th><th class="num">Rate</th><th>Status</th></tr></thead><tbody>${offers
    .map((f) => `<tr><td class="mono">#${f.id}</td><td>${esc(label(f.lender_id))}</td><td>${strategyName(f.strategy)}${strategyNote(f.strategy) ? `<div class="muted small">${esc(strategyNote(f.strategy))}</div>` : ""}</td><td class="num mono">${usd(f.fee)}</td><td class="num mono">${(bps(f.fee, f.principal) / 100).toFixed(2)}%</td><td>${pill(f.status)}</td></tr>`)
    .join("")}</tbody></table></div>`) : ""}
  ${card("Terms", `<dl class="kv">
      <dt>Terms hash</dt><dd class="mono hash">${esc(o.terms_hash)}</dd>
      <dt>Deadline</dt><dd>${fmtDate(o.deadline)}</dd>
      <dt>Deliverable hash</dt><dd class="mono hash">${esc(o.deliverable_hash ?? "–")}</dd>
      <dt>Customer refund</dt><dd class="mono">${usd(o.customer_refund)}</dd>
    </dl>`)}`;
}

export function market(s: Store) {
  const open = sorted(s.orders).filter((o) => o.credit_request && o.loan_id === null && o.status === "Funded" && !pastDeadline(o));
  const auctions = sorted(s.orders).filter((o) => o.offer_ids.length).slice(0, 6);
  const c = s.config;
  return `${head("Credit market", "Agents request advances against escrowed orders. Lender agents compete with fully funded bids, and the agent takes the cheapest valid one.")}
  <div class="kpis">
    ${kpi("Market status", c.paused ? "Paused" : "Open", c.paused ? "new draws blocked" : "accepting requests")}
    ${kpi("Max advance", `${c.max_advance_bps / 100}%`, "of the escrowed order")}
    ${kpi("Dispute window", `${Number(c.dispute_window_ns) / 1e9}s`, "then anyone can finalize", "Short on testnet so the swarm settles quickly. A production window would be days.")}
    ${kpi("Approved vendors", String(c.approved_vendors.length), c.approved_vendors.map(label).join(", "))}
    ${kpi("Bids placed", String(s.market.totals.offers_made), `$${n(s.market.totals.offers_open).toFixed(0)} waiting now`)}
  </div>
  ${card(`Open requests <span class="count">${open.length}</span>`, open.length
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Agent</th><th class="num">Escrow</th><th class="num">Requested</th><th class="num">Max fee</th><th>Vendor</th><th class="num">Bids</th></tr></thead><tbody>${open
      .map((o) => `<tr data-href="${orderHref(o.id)}"><td><a class="mono" href="${orderHref(o.id)}">#${o.id}</a></td><td>${esc(label(o.agent_id))}</td><td class="num mono">${usd(o.amount)}</td><td class="num mono">${usd(o.credit_request!.amount)}</td><td class="num mono">${usd(o.credit_request!.max_fee)}</td><td>${esc(label(o.credit_request!.vendor_id))}</td><td class="num mono">${o.offer_ids.length}</td></tr>`)
      .join("")}</tbody></table></div>`
    : empty("No open requests right now", "Requests clear within seconds while the swarm is running."))}
  <h3 class="sec">Recent auctions</h3>
  <div class="grid g-12">${auctions
    .map((o) => {
      const offers = offersFor(s, o.id), loan = loanFor(s, o);
      if (!offers.length) return "";
      const spread = Number(offers[offers.length - 1].fee) - Number(offers[0].fee);
      return card(`<a href="${orderHref(o.id)}">Order #${o.id}</a> <span class="muted small">${esc(label(o.agent_id))}</span>`, `<div class="auction-top"><div><div class="k">Winning fee</div><div class="v mono">${loan ? usd(loan.fee) : "–"}</div></div><div><div class="k">Advance</div><div class="v mono">${usd(offers[0].principal)}</div></div><div><div class="k">Spread</div><div class="v mono">${usd(spread)}</div></div></div>${bidBars(offers, loan?.offer_id)}`, {
        cls: "span-6", right: `<span class="muted small">${ago(o.created_at)}</span>`,
      });
    })
    .join("")}</div>
  ${guardrails()}`;
}

export function guardrails() {
  const g = GUARDRAILS;
  const ok = g.cases.filter((c) => c.passed).length;
  const group = (layer: "contract" | "runtime", title: string, note: string) => card(title, `<p class="muted small" style="margin:0 0 12px">${note}</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Attempt</th><th>By</th><th>Refused with</th><th>Proof</th></tr></thead><tbody>${g.cases
    .filter((c) => c.layer === layer)
    .map((c) => `<tr><td><b>${esc(c.title)}</b><div class="muted small">${esc(c.attempt)}</div></td><td>${esc(c.actor)}</td><td><span class="code ${c.passed ? "bad" : ""}">${esc(c.got)}</span></td><td>${c.tx ? txLink(c.tx) : '<span class="muted small">rejected before execution</span>'}</td></tr>`)
    .join("")}</tbody></table></div>`);
  return `<h3 class="sec">Guardrails <span class="count">${ok}/${g.cases.length} attacks refused</span></h3>
  ${group("contract", "Refused by the Loca contract", "The transaction ran and the contract refused it, or credited the deposit back. Each one is a real testnet transaction.")}
  ${group("runtime", "Refused by NEAR, before the contract runs", "The agent signs with a function-call key limited to five market methods. NEAR rejects anything else, so there is no transaction to link.")}
  <p class="muted small">Recorded by <code>pnpm guardrails</code> against ${esc(g.contract)} on ${new Date(g.ranAt).toUTCString()}.</p>`;
}

export function lenders(s: Store) {
  return `${head("Lenders", "Autonomous lender agents. Each prices risk from the contract's public record with its own policy, and bids with funds locked in the contract.")}
  ${lenderTable(s)}
  <h3 class="sec">Strategies</h3>
  <div class="grid g-12">${CAST.lenders
    .map((l) => {
      const v = STRATEGY[l.strategy];
      const mine = [...s.offers.values()].filter((o) => o.lender_id === l.id).sort((a, b) => b.id - a.id).slice(0, 5);
      return `<section class="card span-4"><div class="card-h"><h2>${esc(l.name)}</h2><span class="muted small">${esc(v?.name ?? l.strategy)}</span></div><div class="card-b"><p class="policy">${esc(v?.policy ?? "")}</p>
        <div class="k" style="margin-bottom:6px">Latest bids</div>
        <div class="mini">${mine.map((o) => `<div><a href="${orderHref(o.order_id)}">#${o.order_id}</a><span class="mono">${usd(o.fee)}</span>${pill(o.status)}</div>${strategyNote(o.strategy) ? `<div class="muted small">${esc(strategyNote(o.strategy))}</div>` : ""}`).join("") || '<div class="muted small">No bids yet</div>'}</div></div>
        <div class="card-f"><code>src/agents/${l.strategy === "ai-underwriter" ? "underwriter" : "lenders"}.ts</code></div></section>`;
    })
    .join("")}</div>`;
}

export function activity(feed: FeedItem[], filter = "all") {
  const kinds = ["all", "order", "request", "bid", "loan", "delivered", "settled", "refunded", "disputed", "default"];
  const names: Record<string, string> = { all: "All", order: "Escrow", request: "Requests", bid: "Bids", loan: "Loans", delivered: "Delivered", settled: "Settled", refunded: "Refunded", disputed: "Disputes", default: "Defaults" };
  const list = (filter === "all" ? feed : feed.filter((f) => f.kind === filter)).slice(0, 200);
  return `${head("Activity", "Every state change in the market, reconstructed live from contract views.", `<span class="live-tag"><i></i>Live</span>`)}
  <div class="tabs scroll">${kinds.map((k) => `<a class="tab ${k === filter ? "on" : ""}" href="#/app/activity${k === "all" ? "" : `?kind=${k}`}">${names[k]}<span>${k === "all" ? feed.length : feed.filter((f) => f.kind === k).length}</span></a>`).join("")}</div>
  ${card("", feedList(list), { cls: "flush", foot: `Times are block timestamps where the contract stores them. Contract ${accountLink(CONTRACT)}` })}`;
}
