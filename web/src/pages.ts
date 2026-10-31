import { CONTRACT, RUN, reportForOrder, rationaleFor, scoreHistory, profileService, stepsForOrder, type Agent, type Loan, type Order, type Offer, type ScoreReport, type Store } from "./data";
import { REASON_TEXT, SCORE_LABELS, STRATEGY, ICON, acct, accountLink, ago, bps, empty, esc, fmtDate, label, pct, pill, strategyName, txLink, usd } from "./ui";

const enc = encodeURIComponent;
const agentHref = (id: string) => `#/agents/${enc(id)}`;
const orderHref = (id: number) => `#/orders/${id}`;

export const head = (title: string, sub: string, right = "") =>
  `<header class="page-head"><div><h1>${title}</h1><p class="sub">${sub}</p></div>${right}</header>`;
const card = (title: string, body: string, opts: { right?: string; foot?: string; cls?: string } = {}) =>
  `<section class="card ${opts.cls ?? ""}"><div class="card-h"><h2>${title}</h2>${opts.right ?? ""}</div><div class="card-b">${body}</div>${opts.foot ? `<div class="card-f">${opts.foot}</div>` : ""}</section>`;
const kpi = (k: string, v: string, note = "", tip = "") =>
  `<div class="kpi"${tip ? ` data-tip="${esc(tip)}"` : ""}><div class="k">${k}</div><div class="v">${v}</div>${note ? `<div class="n">${note}</div>` : ""}</div>`;

const offersFor = (s: Store, orderId: number) => s.offers.filter((o) => o.order_id === orderId).sort((a, b) => Number(a.fee) - Number(b.fee));
const loanFor = (s: Store, o: Order) => (o.loan_id !== null ? s.loans.get(o.loan_id) : undefined);

/** How the escrow was split. Lender share counts only what came out of escrow; bond recoveries are separate. */
function split(o: Order, loan?: Loan) {
  const amount = Number(o.amount), refund = Number(o.customer_refund);
  const settled = o.status === "Released" || o.status === "Refunded";
  const fromBond = loan ? Number(loan.recovered_from_bond) : 0;
  const lender = loan && loan.status !== "Active" ? Number(loan.repaid) - fromBond : 0;
  return { amount, refund, lender, fromBond, agent: settled ? amount - refund - lender : 0, settled };
}

// ---------------------------------------------------------------- charts

function scoreBars(score: ScoreReport) {
  return `<div class="hbars">${score.components
    .map((c) => {
      const max = c.weight_bps / 10; // points available out of 1000
      const pts = Math.round((c.weight_bps * c.value_bps) / 1e5);
      return `<div class="hbar" data-tip="${esc(`${SCORE_LABELS[c.name] ?? c.name}: ${pts} of ${max} points (${c.value_bps / 100}% of weight ${c.weight_bps / 100}%)`)}">
        <span class="hl">${SCORE_LABELS[c.name] ?? c.name}<span class="w">${c.weight_bps / 100}%</span></span>
        <span class="track"><span class="fill" style="width:${c.value_bps / 100}%"></span></span>
        <span class="hv mono">${pts}<span class="muted">/${max}</span></span>
      </div>`;
    })
    .join("")}</div>`;
}

function scoreLine(points: { label: string; score: number }[]) {
  if (points.length < 2) return empty("Not enough history", "The chart appears after the first repaid loan.");
  const W = 560, H = 200, L = 40, R = 16, T = 16, B = 34;
  const lo = 400, hi = 1000;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const grid = [400, 550, 700, 850, 1000]
    .map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="gl"/><text x="${L - 8}" y="${y(g) + 4}" class="ax" text-anchor="end">${g}</text>`)
    .join("");
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join("");
  const dots = points
    .map((p, i) => `<g data-tip="${esc(`${p.label}: score ${p.score}`)}"><circle cx="${x(i)}" cy="${y(p.score)}" r="14" class="hit"/><circle cx="${x(i)}" cy="${y(p.score)}" r="4.5" class="dot"/>
      <text x="${x(i)}" y="${y(p.score) - 12}" class="dl" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${p.score}</text>
      <text x="${x(i)}" y="${H - 10}" class="ax" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${esc(p.label)}</text></g>`)
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="LOCA Score over time: ${points.map((p) => p.score).join(", ")}">${grid}<path d="${path}" class="ln"/>${dots}</svg>`;
}

function bidBars(offers: Offer[], winnerId?: number, orderId?: number) {
  const max = Math.max(...offers.map((o) => Number(o.fee)));
  return `<div class="hbars">${offers
    .map((o) => {
      const win = o.id === winnerId;
      const why = orderId !== undefined ? rationaleFor(orderId, o.strategy).join(", ") : "";
      return `<div class="hbar" data-tip="${esc(`${strategyName(o.strategy)} lender bid ${usd(o.fee)} on ${usd(o.principal)} (${(bps(o.fee, o.principal) / 100).toFixed(2)}%)${why ? `\nRationale: ${why}` : ""}`)}">
        <span class="hl">${strategyName(o.strategy)}${win ? '<span class="won">won</span>' : ""}</span>
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
      <span><i class="c-lender"></i>Lender <b class="mono">${usd(s.lender)}</b></span>
      <span><i class="c-agent"></i>Agent <b class="mono">${usd(s.agent)}</b></span>
      ${s.fromBond ? `<span>From bond <b class="mono">${usd(s.fromBond)}</b></span>` : ""}
    </div>`;
}

function capacity(s: Store, agent: Agent, orders: Order[]) {
  const cap = s.config.max_advance_bps;
  const policyMax = agent.policy ? Number(agent.policy.max_principal) : 0;
  // request_credit needs an expiry before the order deadline, so past-deadline orders cannot back a loan.
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const funded = orders.filter((o) => o.status === "Funded" && o.loan_id === null);
  const eligible = funded.filter((o) => BigInt(o.deadline) > nowNs);
  const lapsed = funded.length - eligible.length;
  const rows = eligible.map((o) => ({ o, max: Math.min((Number(o.amount) * cap) / 10_000, policyMax) }));
  return `<dl class="kv">
      <dt>Per order</dt><dd>up to <b>${cap / 100}%</b> of the escrow</dd>
      <dt>Per loan</dt><dd>${agent.policy ? `<b class="mono">${usd(policyMax)}</b> operator limit` : '<span class="muted">no policy: cannot borrow</span>'}</dd>
      <dt>Open loans</dt><dd>${agent.active_loans} · bond ${agent.active_loans ? "locked" : "withdrawable"}</dd>
    </dl>
    <div class="k" style="margin:16px 0 8px">Orders it can borrow against now</div>
    ${rows.length ? `<div class="mini">${rows.map(({ o, max }) => `<div><a href="${orderHref(o.id)}">Order #${o.id}</a><span class="mono">${usd(o.amount)} escrow</span><b class="mono">${usd(max)}</b></div>`).join("")}</div>`
      : `<div class="muted small">None right now.${lapsed ? ` ${lapsed} funded order${lapsed > 1 ? "s are" : " is"} past ${lapsed > 1 ? "their deadlines" : "its deadline"}, so the customer can cancel for a refund.` : " Every funded order is settled or already pledged."}</div>`}`;
}

// ---------------------------------------------------------------- tables

function ordersTable(s: Store, orders: Order[], showAgent = true) {
  if (!orders.length) return empty("No orders", "Orders appear when a customer escrows payment for an agent.");
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Order</th>${showAgent ? "<th>Agent</th>" : ""}<th>Customer</th><th class="num">Escrow</th><th>Status</th><th class="num">Advance</th><th class="num">Fee</th><th class="num">Created</th></tr></thead>
    <tbody>${orders
      .map((o) => {
        const loan = loanFor(s, o);
        return `<tr data-href="${orderHref(o.id)}">
          <td><a class="mono strong" href="${orderHref(o.id)}">#${o.id}</a></td>
          ${showAgent ? `<td>${esc(label(o.agent_id))}</td>` : ""}
          <td>${esc(label(o.customer_id))}</td>
          <td class="num mono">${usd(o.amount)}</td>
          <td>${pill(o.status)}${o.status === "Funded" && BigInt(o.deadline) < BigInt(Date.now()) * 1_000_000n ? ' <span class="muted small" data-tip="The delivery deadline passed. The customer can cancel_order for a refund.">past deadline</span>' : ""}</td>
          <td class="num mono">${loan ? usd(loan.principal) : o.credit_request ? `<span class="muted">req ${usd(o.credit_request.amount)}</span>` : '<span class="muted">–</span>'}</td>
          <td class="num mono">${loan ? `${usd(loan.fee)} <span class="muted">${(bps(loan.fee, loan.principal) / 100).toFixed(1)}%</span>` : '<span class="muted">–</span>'}</td>
          <td class="num muted">${ago(o.created_at)}</td>
        </tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function loansTable(s: Store, loans: Loan[]) {
  if (!loans.length) return empty("No loans", "Loans appear when an agent accepts a lender's offer.");
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Loan</th><th>Order</th><th>Lender</th><th>Paid to vendor</th><th class="num">Principal</th><th class="num">Fee</th><th class="num">Repaid</th><th>Status</th></tr></thead>
    <tbody>${loans
      .map((l) => `<tr data-href="${orderHref(l.order_id)}">
        <td class="mono">L-${l.id}</td><td><a class="mono" href="${orderHref(l.order_id)}">#${l.order_id}</a></td>
        <td>${esc(label(l.lender_id))}</td><td>${esc(label(l.vendor_id))}</td>
        <td class="num mono">${usd(l.principal)}</td><td class="num mono">${usd(l.fee)}</td><td class="num mono">${usd(l.repaid)}</td><td>${pill(l.status)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- activity

const EVENT_TEXT: Record<string, (d: any) => string> = {
  agent_registered: (d) => `${label(d.agent_id)} registered, operated by ${label(d.operator_id)}`,
  policy_set: (d) => `Spend policy v${d.version}: max ${usd(d.policy.max_principal)}, ${d.policy.allowed_vendors.length} vendor(s)`,
  bond_posted: (d) => `${usd(d.amount)} first-loss bond posted for ${label(d.agent_id)}`,
  order_funded: (d) => `${label(d.customer_id)} escrowed ${usd(d.amount)} for order #${d.order_id}`,
  credit_requested: (d) => `Order #${d.order_id}: ${usd(d.amount)} advance requested for ${label(d.vendor_id)}, max fee ${usd(d.max_fee)}`,
  offer_made: (d) => `${strategyName(d.strategy)} lender bid ${usd(d.fee)} on order #${d.order_id}`,
  loan_funded: (d) => `Loan L-${d.loan_id}: ${usd(d.principal)} paid to ${label(d.vendor_id)} for ${usd(d.fee)}`,
  offer_released: (d) => `Losing bid #${d.offer_id} returned to ${label(d.lender_id)}`,
  withdrawn: (d) => `${label(d.account_id)} withdrew ${usd(d.amount)}`,
  order_delivered: (d) => `Order #${d.order_id} delivered, hash ${String(d.deliverable_hash).slice(0, 10)}…`,
  loan_repaid: (d) => `Loan L-${d.loan_id} repaid ${usd(d.paid_from_escrow)} from escrow`,
  order_settled: (d) => `Order #${d.order_id} settled: ${usd(d.to_lender)} lender, ${usd(d.to_agent)} agent`,
  deposit_rejected: (d) => `${usd(d.amount)} from ${label(d.sender_id)} refused (${d.reason}), credited back`,
};
type Row = { event: string; text: string; tx?: string; act: string; error?: boolean };
export function activityRows(): Row[] {
  const rows: Row[] = [];
  for (const st of RUN.steps) {
    if (st.events?.length) for (const e of st.events) rows.push({ event: e.event, text: EVENT_TEXT[e.event]?.(e.data) ?? e.event, tx: st.tx, act: st.act });
    else if (st.error) rows.push({ event: "rejected", text: `${st.title.replace(/^Blocked: /, "")}: ${st.error}`, tx: st.tx, act: st.act, error: true });
  }
  return rows;
}
const activityList = (rows: Row[]) =>
  `<ol class="feed">${rows
    .map((r) => `<li class="${r.error ? "err" : ""}"><span class="ev mono">${esc(r.event)}</span><span class="tx-t">${esc(r.text)}</span>${txLink(r.tx)}</li>`)
    .join("")}</ol>`;

// ---------------------------------------------------------------- pages

export function overview(s: Store) {
  const loans = [...s.loans.values()].sort((a, b) => a.id - b.id);
  const escrow = s.orders.reduce((a, o) => a + Number(o.amount), 0);
  const principal = loans.reduce((a, l) => a + Number(l.principal), 0);
  const closed = loans.filter((l) => l.status !== "Active");
  const repaid = closed.filter((l) => l.status === "Repaid");
  const fees = repaid.reduce((a, l) => a + Number(l.fee), 0);
  const settled = s.orders.filter((o) => o.status === "Released").length;
  const first = loans[0], last = loans[loans.length - 1];

  const costRows = loans
    .map((l) => {
      const r = bps(l.fee, l.principal);
      const maxR = Math.max(...loans.map((x) => bps(x.fee, x.principal)));
      return `<div class="hbar" data-tip="${esc(`Loan L-${l.id} on order #${l.order_id}: ${usd(l.fee)} on ${usd(l.principal)} = ${(r / 100).toFixed(2)}%`)}">
        <span class="hl"><a href="${orderHref(l.order_id)}">Order #${l.order_id}</a><span class="w">L-${l.id}</span></span>
        <span class="track"><span class="fill" style="width:${(r / maxR) * 100}%"></span></span>
        <span class="hv mono">${(r / 100).toFixed(2)}%</span></div>`;
    })
    .join("");

  const agentsRows = [...s.agents.values()]
    .map(({ agent, score }) => `<tr data-href="${agentHref(agent.agent_id)}">
      <td>${acct(agent.agent_id, agentHref(agent.agent_id))}</td>
      <td class="num"><span class="score-sm">${score?.score ?? "–"}</span></td>
      <td class="num mono">${agent.stats.orders_completed}</td><td class="num mono">${usd(agent.stats.revenue)}</td>
      <td class="num mono">${agent.stats.loans_repaid}/${agent.stats.loans_taken}</td><td class="num mono">${usd(agent.bond)}</td></tr>`)
    .join("");

  return `${head("Overview", `Live state of the LOCA credit market on NEAR testnet.`)}
  <div class="kpis">
    ${kpi("Escrow processed", usd(escrow, 0), `${s.orders.length} orders · ${settled} settled`)}
    ${kpi("Credit advanced", usd(principal, 0), `${loans.length} loans, paid to vendors`)}
    ${kpi("Repayment rate", closed.length ? pct((repaid.length / closed.length) * 100, 0) : "–", `${repaid.length} repaid · ${closed.length - repaid.length} defaulted`)}
    ${kpi("Lender fees earned", usd(fees), repaid.length ? `avg ${(repaid.reduce((a, l) => a + bps(l.fee, l.principal), 0) / repaid.length / 100).toFixed(2)}% per loan` : "")}
    ${kpi("Cost of credit", first && last && first !== last ? `${(bps(first.fee, first.principal) / 100).toFixed(1)}% → ${(bps(last.fee, last.principal) / 100).toFixed(1)}%` : "–", "first loan → latest loan")}
  </div>
  <div class="grid g-12">
    ${card("Borrowing cost per loan", `<div class="chart-note">Fee as a share of principal. The repayment-history lender cut its price after the first loan was repaid.</div>${loans.length ? `<div class="hbars">${costRows}</div>` : empty("No loans yet", "")}${first && last && first !== last ? `<div class="callout"><div class="mono big-n">${usd(first.fee)} → ${usd(last.fee)}</div><div class="muted small">fee on the same ${usd(last.principal)} advance, one repaid loan later</div></div>` : ""}`, { cls: "span-5" })}
    ${card("LOCA Score", scoreLine(scoreHistory()), { cls: "span-7", right: `<span class="muted small">snapshots from the demo run</span>` })}
  </div>
  <div class="grid g-12">
    ${card("Agents", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th class="num">Score</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Loans repaid</th><th class="num">Bond</th></tr></thead><tbody>${agentsRows}</tbody></table></div>`, { cls: "span-7", right: `<a href="#/agents" class="small">All agents →</a>` })}
    ${card("Recent activity", activityList(activityRows().slice(-5).reverse()), { cls: "span-5", right: `<a href="#/activity" class="small">All →</a>` })}
  </div>
  ${card("Recent orders", ordersTable(s, s.orders.slice(0, 6)), { right: `<a href="#/orders" class="small">All orders →</a>` })}`;
}

export function agents(s: Store) {
  const rows = [...s.agents.values()]
    .map(({ agent, score }) => `<tr data-href="${agentHref(agent.agent_id)}">
      <td>${acct(agent.agent_id, agentHref(agent.agent_id))}</td>
      <td>${esc(label(agent.operator_id))}</td>
      <td class="num"><span class="score-sm">${score?.score ?? "–"}</span></td>
      <td>${score?.rated ? '<span class="pill s-done">Rated</span>' : '<span class="pill s-neutral">Unrated</span>'}</td>
      <td class="num mono">${agent.stats.orders_completed}</td><td class="num mono">${agent.stats.unique_customers}</td>
      <td class="num mono">${usd(agent.stats.revenue)}</td><td class="num mono">${agent.stats.loans_repaid} / ${agent.stats.loans_defaulted}</td>
      <td class="num mono">${usd(agent.bond)}</td></tr>`)
    .join("");
  return `${head("Agents", "AI businesses with a LOCA ID. Identity, spend policy and track record are contract state.")}
  ${card("Registered agents", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>Operator</th><th class="num">Score</th><th>Status</th><th class="num">Orders</th><th class="num">Customers</th><th class="num">Revenue</th><th class="num">Repaid / defaulted</th><th class="num">Bond</th></tr></thead><tbody>${rows}</tbody></table></div>`, {
    foot: `The contract has no list view, so this shows agents from the demo run plus any you look up. Search for any account id in the top bar.`,
  })}`;
}

export function agentDetail(s: Store, id: string) {
  const rec = s.agents.get(id);
  if (!rec) return `${head("Agent not found", esc(id))}${card("No LOCA ID", empty("This account is not registered", `<code>${esc(id)}</code> has not called <code>register_agent</code> on ${esc(CONTRACT)}.`))}`;
  const { agent, score } = rec;
  const orders = s.orders.filter((o) => o.agent_id === id);
  const loans = [...s.loans.values()].filter((l) => l.agent_id === id).sort((a, b) => b.id - a.id);
  const codes = score?.reason_codes ?? [];
  const isDemo = id === RUN.finalState.agent.agent_id;

  return `<div class="crumbs"><a href="#/agents">Agents</a> / ${esc(label(id))}</div>
  <header class="entity">
    <div class="avatar">${esc(label(id).slice(0, 1))}</div>
    <div class="who">
      <h1>${esc(label(id))}</h1>
      <div class="sub">${esc(profileService(id) ?? "AI agent")} · registered ${fmtDate(agent.registered_at)}</div>
      <div class="ids"><span class="mono">${esc(id)}</span><button class="icon-btn" data-copy="${esc(id)}" title="Copy account id">${ICON.copy}</button>${accountLink(id, "Explorer")}</div>
    </div>
    <div class="score-box" data-tip="${esc("Deterministic: computed by the contract view get_score from onchain history only.")}">
      <div class="k">LOCA Score ${esc(score?.version ?? "")}</div>
      <div class="big">${score?.score ?? "–"}<span>/1000</span></div>
      <div>${score?.rated ? '<span class="pill s-done">Rated</span>' : '<span class="pill s-neutral">Unrated</span>'}</div>
    </div>
  </header>

  <div class="kpis">
    ${kpi("Revenue", usd(agent.stats.revenue), `${agent.stats.orders_completed} completed orders`)}
    ${kpi("Customers", String(agent.stats.unique_customers), `${agent.stats.orders_refunded} refunded · ${agent.stats.disputes_lost} disputes lost`)}
    ${kpi("Loans", `${agent.stats.loans_repaid} / ${agent.stats.loans_taken}`, `repaid · ${agent.active_loans} active · ${agent.stats.loans_defaulted} defaulted`)}
    ${kpi("Principal repaid", usd(agent.stats.principal_repaid), `default loss ${usd(agent.stats.default_loss)}`)}
    ${kpi("First-loss bond", usd(agent.bond), "covers lenders before any default", "Posted by the operator. Drawn to repay a lender if the escrow falls short. Locked while a loan is active.")}
  </div>

  <div class="grid g-12">
    ${card("Score breakdown", `${scoreBars(score!)}<div class="codes">${codes.length ? codes.map((c) => `<span class="code" data-tip="${esc(REASON_TEXT[c] ?? c)}">${esc(c)}</span>`).join("") : `<span class="code ok">${ICON.check} No adverse reason codes</span>`}</div>`, {
      cls: "span-7", foot: "Weights are prototype rules, not a validated credit model.",
    })}
    ${card("Controls", `<dl class="kv">
      <dt>Operator</dt><dd>${acct(agent.operator_id)}</dd>
      <dt>Spend policy</dt><dd>${agent.policy ? `v${agent.policy_version} · max <b class="mono">${usd(agent.policy.max_principal)}</b> per loan` : '<span class="muted">none set</span>'}</dd>
      <dt>Allowed vendors</dt><dd>${agent.policy?.allowed_vendors.map((v) => acct(v)).join("") || '<span class="muted">–</span>'}</dd>
      <dt>Loan proceeds</dt><dd>Paid to the vendor, never to the agent</dd>
      <dt>Profile hash</dt><dd class="mono hash">${esc(agent.profile_hash)}</dd>
    </dl>`, { cls: "span-5" })}
  </div>
  <div class="grid g-12">
    ${card("Score history", isDemo ? scoreLine(scoreHistory()) : empty("No snapshots", "History is recorded for the demo agent only."), { cls: "span-7", right: `<span class="muted small">snapshots from the demo run</span>` })}
    ${card("Borrowing capacity", capacity(s, agent, orders), { cls: "span-5" })}
  </div>
  ${card(`Orders <span class="count">${orders.length}</span>`, ordersTable(s, orders, false))}
  ${card(`Loans <span class="count">${loans.length}</span>`, loansTable(s, loans))}`;
}

const STATUS_ORDER = ["All", "Funded", "Delivered", "Disputed", "Released", "Refunded"];
export function orders(s: Store, filter = "All") {
  const counts = Object.fromEntries(STATUS_ORDER.map((st) => [st, st === "All" ? s.orders.length : s.orders.filter((o) => o.status === st).length]));
  const tabs = STATUS_ORDER.filter((st) => st === "All" || counts[st])
    .map((st) => `<a class="tab ${st === filter ? "on" : ""}" href="#/orders${st === "All" ? "" : `?status=${st}`}">${st === "Released" ? "Settled" : st}<span>${counts[st]}</span></a>`)
    .join("");
  const list = filter === "All" ? s.orders : s.orders.filter((o) => o.status === filter);
  return `${head("Orders", "Customer payments held in escrow. Each one can back a single advance, and settles through the repayment waterfall.")}
  <div class="tabs">${tabs}</div>
  ${card("", ordersTable(s, list), { cls: "flush" })}`;
}

export function orderDetail(s: Store, id: number) {
  const o = s.orders.find((x) => x.id === id);
  if (!o) return `${head(`Order #${id}`, "Not found")}${card("", empty("No such order", "It may belong to an agent this dashboard is not tracking."))}`;
  const loan = loanFor(s, o);
  const offers = offersFor(s, id);
  const steps = stepsForOrder(id);
  const stx = (prefix: string) => steps.find((x) => x.title.startsWith(prefix))?.tx;
  const sp = split(o, loan);
  const report = reportForOrder(id);

  const tl = [
    { t: "Escrow funded", d: `${label(o.customer_id)} deposited ${usd(o.amount)}`, at: o.created_at, tx: stx("Customer escrows"), done: true },
    o.credit_request && { t: "Advance requested", d: `${usd(o.credit_request.amount)} for ${label(o.credit_request.vendor_id)}, max fee ${usd(o.credit_request.max_fee)}`, tx: stx("Agent requests"), done: true },
    offers.length && { t: `${offers.length} bids received`, d: `${usd(offers[0].fee)} to ${usd(offers[offers.length - 1].fee)}`, at: offers[0].created_at, done: true },
    loan && { t: "Loan funded", d: `${usd(loan.principal)} paid to ${label(loan.vendor_id)}, fee ${usd(loan.fee)}`, at: loan.created_at, tx: stx("Agent accepts"), done: true },
    { t: "Delivered", d: o.deliverable_hash ? `hash ${o.deliverable_hash.slice(0, 16)}…` : "waiting for the agent", at: o.delivered_at, tx: stx("Agent delivers"), done: !!o.delivered_at },
    { t: o.status === "Refunded" ? "Refunded" : "Settled", d: sp.settled ? `${usd(sp.lender)} to lender · ${usd(sp.agent)} to agent` : `auto-release after the ${Number(s.config.dispute_window_ns) / 1e9}s dispute window`, at: loan?.closed_at, tx: stx("Customer approves"), done: sp.settled },
  ].filter(Boolean) as { t: string; d: string; at?: string | null; tx?: string; done: boolean }[];

  return `<div class="crumbs"><a href="#/orders">Orders</a> / #${id}</div>
  ${head(`Order #${id} ${pill(o.status)}`, `${esc(label(o.agent_id))} for ${esc(label(o.customer_id))} · created ${fmtDate(o.created_at)}`)}
  <div class="kpis">
    ${kpi("Escrow", usd(o.amount))}
    ${kpi("Advance", loan ? usd(loan.principal) : "–", loan ? `${pct((Number(loan.principal) / Number(o.amount)) * 100, 0)} of escrow · cap ${s.config.max_advance_bps / 100}%` : "no loan")}
    ${kpi("Fee", loan ? usd(loan.fee) : "–", loan ? `${(bps(loan.fee, loan.principal) / 100).toFixed(2)}% of principal` : "")}
    ${kpi("To lender", sp.settled ? usd(sp.lender) : "–", "paid first")}
    ${kpi("To agent", sp.settled ? usd(sp.agent) : "–", "the remainder")}
  </div>
  <div class="grid g-12">
    ${card("Lifecycle", `<ol class="timeline">${tl
      .map((e) => `<li class="${e.done ? "done" : ""}"><span class="mk"></span><div><div class="tt">${esc(e.t)}</div><div class="muted">${esc(e.d)}</div></div><div class="when">${e.at ? `<span class="muted small">${fmtDate(e.at)}</span>` : ""}${e.tx ? txLink(e.tx) : ""}</div></li>`)
      .join("")}</ol>`, { cls: "span-5" })}
    <div class="span-7 col">
      ${card("Settlement", waterfall(o, loan), { foot: "Waterfall order: customer refund, then lender principal + fee, then the bond covers any shortfall, then the agent keeps the rest." })}
      ${card("Bids", offers.length ? bidBars(offers, loan?.offer_id, id) : empty("No bids", "This order did not request an advance."), { foot: offers.length ? "Bids are fully funded when placed. Losing bids return to the lender when one is accepted." : "" })}
    </div>
  </div>
  ${offers.length ? card("Offers", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Offer</th><th>Lender</th><th>Strategy</th><th class="num">Fee</th><th class="num">Rate</th><th>Status</th><th>Rationale</th></tr></thead><tbody>${offers
    .map((f) => `<tr><td class="mono">#${f.id}</td><td>${esc(label(f.lender_id))}</td><td>${strategyName(f.strategy)}</td><td class="num mono">${usd(f.fee)}</td><td class="num mono">${(bps(f.fee, f.principal) / 100).toFixed(2)}%</td><td>${pill(f.status)}</td><td class="muted small">${esc(rationaleFor(id, f.strategy).join(" · ") || "–")}</td></tr>`)
    .join("")}</tbody></table></div>`) : ""}
  <div class="grid g-12">
    ${card("Terms", `<dl class="kv">
      <dt>Terms hash</dt><dd class="mono hash">${esc(o.terms_hash)}</dd>
      <dt>Deadline</dt><dd>${fmtDate(o.deadline)}</dd>
      <dt>Deliverable hash</dt><dd class="mono hash">${esc(o.deliverable_hash ?? "–")}</dd>
      <dt>Customer refund</dt><dd class="mono">${usd(o.customer_refund)}</dd>
    </dl>`, { cls: report ? "span-5" : "span-12" })}
    ${report ? card("Delivered artifact", `<pre class="doc">${esc(report)}</pre>`, { cls: "span-7", foot: "Its sha256 is the deliverable hash committed onchain." }) : ""}
  </div>`;
}

export function market(s: Store) {
  const open = s.orders.filter((o) => o.credit_request && o.loan_id === null && o.status === "Funded");
  const auctions = s.orders.filter((o) => o.offer_ids.length).sort((a, b) => a.id - b.id);
  const blocked = RUN.steps.filter((x) => x.act === "05");
  const c = s.config;
  return `${head("Credit market", "Agents request advances against escrowed orders. Lender agents compete with fully funded bids, and the agent takes the cheapest valid one.")}
  <div class="kpis">
    ${kpi("Market status", c.paused ? "Paused" : "Open", c.paused ? "new draws blocked" : "accepting requests")}
    ${kpi("Max advance", `${c.max_advance_bps / 100}%`, "of the escrowed order")}
    ${kpi("Dispute window", `${Number(c.dispute_window_ns) / 1e9}s`, "then anyone can finalize", "Short on testnet so the demo completes. A production window would be days.")}
    ${kpi("Approved vendors", String(c.approved_vendors.length), "loan proceeds can only go here")}
    ${kpi("Settlement token", "USDC", `<span title="${esc(c.token_id)}">test token on testnet</span>`)}
  </div>
  ${card(`Open requests <span class="count">${open.length}</span>`, open.length
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Agent</th><th class="num">Escrow</th><th class="num">Requested</th><th class="num">Max fee</th><th>Vendor</th><th class="num">Bids</th></tr></thead><tbody>${open
      .map((o) => `<tr data-href="${orderHref(o.id)}"><td><a class="mono" href="${orderHref(o.id)}">#${o.id}</a></td><td>${esc(label(o.agent_id))}</td><td class="num mono">${usd(o.amount)}</td><td class="num mono">${usd(o.credit_request!.amount)}</td><td class="num mono">${usd(o.credit_request!.max_fee)}</td><td>${esc(label(o.credit_request!.vendor_id))}</td><td class="num mono">${o.offer_ids.length}</td></tr>`)
      .join("")}</tbody></table></div>`
    : empty("No open requests", "Every advance requested so far has been funded. Run <code>pnpm demo:testnet</code> to create new orders."))}
  <h3 class="sec">Cleared auctions</h3>
  <div class="grid g-12">${auctions
    .map((o) => {
      const offers = offersFor(s, o.id), loan = loanFor(s, o);
      const spread = Number(offers[offers.length - 1].fee) - Number(offers[0].fee);
      return card(`<a href="${orderHref(o.id)}">Order #${o.id}</a>`, `<div class="auction-top"><div><div class="k">Winning fee</div><div class="v mono">${loan ? usd(loan.fee) : "–"}</div></div><div><div class="k">Advance</div><div class="v mono">${loan ? usd(loan.principal) : "–"}</div></div><div><div class="k">Spread</div><div class="v mono">${usd(spread)}</div></div></div>${bidBars(offers, loan?.offer_id, o.id)}`, {
        cls: "span-6", right: loan ? txLink(stepsForOrder(o.id).find((x) => x.title.startsWith("Agent accepts"))?.tx) : "",
      });
    })
    .join("")}</div>
  <h3 class="sec">Guardrails</h3>
  <div class="grid g-12">${blocked
    .map((b) => `<section class="card span-4 guard"><div class="card-b"><div class="g-ico">${ICON.shield}</div><div class="g-t">${esc(b.title.replace(/^Blocked: /, "").replace(/ \(.*\)$/, "").replace(/^./, (m) => m.toUpperCase()))}</div><div class="code bad">${esc(b.error)}</div></div><div class="card-f">Refused on testnet ${txLink(b.tx)}</div></section>`)
    .join("")}</div>`;
}

export function lenders(s: Store) {
  const by = new Map<string, Offer[]>();
  for (const o of s.offers) by.set(o.lender_id, [...(by.get(o.lender_id) ?? []), o]);
  const loans = [...s.loans.values()];
  const rows = [...by.entries()].map(([id, offers]) => {
    const won = loans.filter((l) => l.lender_id === id);
    const earned = won.filter((l) => l.status === "Repaid").reduce((a, l) => a + Number(l.fee), 0);
    const deployed = won.reduce((a, l) => a + Number(l.principal), 0);
    const avg = offers.reduce((a, o) => a + bps(o.fee, o.principal), 0) / offers.length;
    return { id, strategy: offers[0].strategy, bids: offers.length, won: won.length, earned, deployed, avg };
  }).sort((a, b) => b.won - a.won || a.avg - b.avg);

  return `${head("Lenders", "Autonomous lender agents. Each prices risk from the contract's public record with its own policy, and bids with funds locked in the contract.")}
  ${card("Lender performance", `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lender</th><th>Strategy</th><th class="num">Bids</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Avg bid rate</th><th class="num">Deployed</th><th class="num">Fees earned</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${acct(r.id)}</td><td>${strategyName(r.strategy)}</td><td class="num mono">${r.bids}</td><td class="num mono">${r.won}</td><td class="num mono">${pct((r.won / r.bids) * 100, 0)}</td><td class="num mono">${(r.avg / 100).toFixed(2)}%</td><td class="num mono">${usd(r.deployed)}</td><td class="num mono">${usd(r.earned)}</td></tr>`)
    .join("")}</tbody></table></div>`)}
  <h3 class="sec">Strategies</h3>
  <div class="grid g-12">${Object.entries(STRATEGY)
    .map(([k, v]) => {
      const mine = s.offers.filter((o) => o.strategy === k).sort((a, b) => a.order_id - b.order_id);
      return `<section class="card span-4"><div class="card-h"><h2>${v.name}</h2></div><div class="card-b"><p class="policy">${esc(v.policy)}</p>
        <div class="mini">${mine.map((o) => `<div><span class="muted">Order #${o.order_id}</span><span class="mono">${usd(o.fee)}</span>${pill(o.status)}</div>`).join("")}</div></div>
        <div class="card-f"><code>src/agents/lenders.ts</code></div></section>`;
    })
    .join("")}</div>`;
}

export function activity(filter = "all") {
  const rows = activityRows();
  const types = ["all", ...new Set(rows.map((r) => r.event))];
  return `${head("Activity", `Contract events (NEP-297) from the testnet demo run, ${new Date(RUN.generatedAt).toUTCString()}.`)}
  <div class="tabs scroll">${types.map((t) => `<a class="tab ${t === filter ? "on" : ""}" href="#/activity${t === "all" ? "" : `?event=${t}`}">${t === "all" ? "All" : t}<span>${t === "all" ? rows.length : rows.filter((r) => r.event === t).length}</span></a>`).join("")}</div>
  ${card("", activityList(filter === "all" ? rows : rows.filter((r) => r.event === filter)), { cls: "flush", foot: `Every row links to its transaction on NearBlocks. Contract ${accountLink(CONTRACT)}` })}`;
}


