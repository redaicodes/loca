import "./style.css";
import run from "../../docs/testnet-run.json";
import intents from "../../docs/intents-quotes.json";
import { letterSphere } from "./sphere";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Step = { act: string; title: string; tx?: string; error?: string; detail?: any; events?: any[] };
const steps = run.steps as Step[];
const EXPLORER = run.explorer as string;
const LOCA = run.contracts.loca;
const RPC = "https://rpc.testnet.near.org";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (raw: string | number) => `$${(Number(raw) / 1e6).toFixed(2)}`;
const tx = (h?: string) => (h ? `<a href="${EXPLORER}${h}" target="_blank" rel="noopener">${h.slice(0, 8)}…↗</a>` : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (a: string) => a.replace(/^l[a-z0-9]+-/, "").replace(/\.loca-[a-z0-9]+\.testnet$/, "");

const byAct = (act: string) => steps.filter((s) => s.act === act);
const find = (act: string, prefix: string) => byAct(act).find((s) => s.title.startsWith(prefix));

const LABELS: Record<string, string> = {
  revenue_continuity: "Revenue continuity",
  repayment_history: "Repayment history",
  fulfillment: "Fulfillment",
  treasury_bond: "Treasury / bond",
  operator_controls: "Operator controls",
  customer_diversity: "Customer diversity",
};
const STRATEGY: Record<string, string> = {
  "escrow-coverage": "Escrow coverage",
  "repayment-history": "Repayment history",
  "concentration-aware": "Concentration-aware",
};

function scoreBars(score: any) {
  return `<div class="bars">${score.components
    .map((c: any) => {
      const pts = Math.round((c.weight_bps * c.value_bps) / 1e5);
      const max = c.weight_bps / 100;
      return `<div class="bar-row">
        <span>${LABELS[c.name] ?? c.name} <span class="label">${c.weight_bps / 100}%</span></span>
        <div class="track" data-tip="${esc(`${LABELS[c.name]}: ${(c.value_bps / 100).toFixed(0)}% of ${max} points → ${pts} pts`)}">
          <div class="fill" style="width:${c.value_bps / 100}%"></div><div class="hit"></div>
        </div>
        <span class="v">${pts}/${max * 10}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function auction(act: string, title: string) {
  const accept = find(act, "Agent accepts")!;
  const offers = (accept.detail.offers as any[]).slice().sort((a, b) => a.strategy.localeCompare(b.strategy));
  const max = Math.max(...offers.map((o) => Number(o.fee)));
  const winner = accept.detail.offers[0];
  const rationale = (s: string) => byAct(act).find((x) => x.title.toLowerCase().includes(s.split("-")[0]) && x.detail?.rationale)?.detail.rationale ?? [];
  return `<div class="card"><div class="body">
    <div class="label">${title}</div>
    <h3>Winning fee ${usd(winner.fee)} <span class="label">on a ${usd(winner.principal)} advance</span></h3>
    <div class="bars">${offers
      .map((o) => {
        const win = o.id === winner.id;
        return `<div class="bar-row">
          <span>${STRATEGY[o.strategy] ?? o.strategy}${win ? ' <span class="chip blue">accepted</span>' : ""}</span>
          <div class="track" data-tip="${esc(`${STRATEGY[o.strategy]}: ${usd(o.fee)} fee (${((Number(o.fee) / Number(o.principal)) * 100).toFixed(2)}%). ${rationale(o.strategy).join(" · ")}`)}">
            <div class="fill ${win ? "" : "muted"}" style="width:${(Number(o.fee) / max) * 100}%"></div><div class="hit"></div>
          </div>
          <span class="v">${usd(o.fee)}</span>
        </div>`;
      })
      .join("")}</div>
  </div><div class="foot"><span>Bids are funded when placed. The cheapest valid one wins.</span>${tx(accept.tx)}</div></div>`;
}

function waterfall(act: string, title: string) {
  const s = find(act, "Score")!;
  const ev = (s.detail.settlement as any[]).find((e) => e.event === "order_settled").data;
  const lender = Number(ev.to_lender), agent = Number(ev.to_agent), total = lender + agent + Number(ev.customer_refund);
  const seg = (v: number, color: string, name: string) =>
    `<div class="seg" style="flex:${v};background:${color}" data-tip="${esc(`${name}: ${usd(v)} (${((v / total) * 100).toFixed(1)}%)`)}">${usd(v)}</div>`;
  return `<div class="card"><div class="body">
    <div class="label">${title}</div>
    <h3>${usd(total)} escrow released</h3>
    <div class="stack" role="img" aria-label="${esc(`Lender ${usd(lender)}, agent ${usd(agent)}`)}">${seg(lender, "var(--cobalt)", "Lender (principal + fee)")}${seg(agent, "var(--agent)", "Agent keeps")}</div>
    <div class="legend"><span><i style="background:var(--cobalt)"></i>Lender ${usd(lender)}</span><span><i style="background:var(--agent)"></i>Agent ${usd(agent)}</span><span>Shortfall ${usd(ev.lender_shortfall)}</span></div>
  </div><div class="foot"><span>Waterfall: customer refund → lender → bond → agent</span>${tx(find(act, "Customer approves")?.tx)}</div></div>`;
}

function intentsTable() {
  const rows = (intents.results as any[])
    .map((r) => {
      const o = r.outcome;
      if (o.ok) {
        const q = o.response.quote;
        return `<tr><td>${esc(r.label)}</td><td class="num">${esc(Number(q.amountInFormatted).toPrecision(6))}</td><td class="num">$${Number(q.amountInUsd).toFixed(2)}</td><td class="num">${q.amountOutFormatted} USDC</td><td class="num">${q.timeEstimate}s</td><td class="ok">quoted</td></tr>`;
      }
      return `<tr><td>${esc(r.label)}</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="bad">${esc(o.reason)}</td></tr>`;
    })
    .join("");
  return `<div class="card"><div class="body">
    <table><thead><tr><th>Customer pays with</th><th class="num">Amount in</th><th class="num">≈ USD</th><th class="num">Lands in escrow</th><th class="num">ETA</th><th>Route</th></tr></thead><tbody>${rows}</tbody></table>
  </div><div class="foot"><span>Live 1Click dry quotes from ${new Date(intents.generatedAt).toUTCString()}. ${
    intents.recipientIsStandIn ? `Recipient is a stand-in (<code>${esc(intents.recipient)}</code>); LOCA is not yet on mainnet.` : ""
  }</span></div></div>`;
}

function render() {
  const final = run.finalState as any;
  const agent = final.agent;
  const s0 = find("02", "Track record")!.detail.score;
  const reg = find("01", "Agent registers")!;
  const report = find("03", "Agent delivers")!.detail.report;
  const blocked = byAct("05");
  const fees = find("04", "Repeat borrower")!;

  document.querySelector("#app")!.innerHTML = `<div class="wrap">
  <header class="hero">
    <div>
      <span class="tag">[ NEAR HACKATHON · NOV 2026 ]</span>
      <h1>LOCA</h1>
      <p class="sub-h">Line of credit for agents</p>
      <p class="lede">AI businesses borrow against escrowed customer orders. Lender agents compete to fund them.</p>
      <a class="cta" href="https://testnet.nearblocks.io/address/${LOCA}" target="_blank" rel="noopener">CONTRACT ON TESTNET <span>↗</span></a>
    </div>
    <div class="panel"><i class="c1"></i><i class="c2"></i><canvas id="sphere" aria-hidden="true"></canvas><div class="caption">C R E D I T</div></div>
  </header>

  <section>
    <div class="sec-head"><h2>The <span class="blue">agent</span></h2>
      <span class="live" id="live"><i></i>snapshot from run log</span></div>
    <div class="grid g2">
      <div class="card"><div class="body">
        <div class="label">[ 01 ] LOCA ID</div>
        <h3>${esc(reg.detail.profile.name)}</h3>
        <dl class="kv">
          <dt>Account</dt><dd>${esc(agent.agent_id)}</dd>
          <dt>Operator</dt><dd>${esc(agent.operator_id)}</dd>
          <dt>Spend policy</dt><dd>v${agent.policy_version} · max ${usd(agent.policy.max_principal)} · vendors: ${agent.policy.allowed_vendors.map(short).map(esc).join(", ")}</dd>
          <dt>First-loss bond</dt><dd id="bond">${usd(agent.bond)}</dd>
          <dt>Orders</dt><dd id="orders">${agent.stats.orders_completed} completed · ${agent.stats.unique_customers} customers · ${usd(agent.stats.revenue)} revenue</dd>
          <dt>Loans</dt><dd id="loans">${agent.stats.loans_repaid} repaid · ${agent.stats.loans_defaulted} defaulted</dd>
        </dl>
      </div><div class="foot"><span>Identity and history are contract state, not a database.</span>${tx(reg.tx)}</div></div>

      <div class="card"><div class="body">
        <div class="label">[ 02 ] LOCA SCORE ${esc(final.score.version)}</div>
        <div class="score-hero"><span class="n" id="score">${final.score.score}</span><span class="of">/ 1000</span>
          <span class="delta">from ${s0.score} before credit history</span></div>
        <div id="codes">${final.score.reason_codes.map((c: string) => `<span class="chip">${esc(c)}</span>`).join("") || '<span class="chip blue">NO ADVERSE CODES</span>'}</div>
        <div id="bars">${scoreBars(final.score)}</div>
      </div><div class="foot"><span>Computed by the contract view <code>get_score</code>, so anyone can recompute it.</span></div></div>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>Credit <span class="blue">auction</span></h2>
      <span class="sec-note">Three lender agents price the same $30 request with different policies. After one repaid loan the cheapest bid drops from ${usd(fees.detail.first.find((d: any) => d.strategy === "repayment-history").fee)} to ${usd(fees.detail.second.find((d: any) => d.strategy === "repayment-history").fee)}.</span></div>
    <div class="grid g2">${auction("03", "[ 03 ] FIRST LOAN · ORDER #3")}${auction("04", "[ 04 ] REPEAT LOAN · ORDER #4")}</div>
  </section>

  <section>
    <div class="sec-head"><h2>Contract-enforced <span class="blue">repayment</span></h2>
      <span class="sec-note">The $30 loan pays the data vendor directly. The agent delivers, the customer approves, and the escrow repays the lender before the agent sees anything.</span></div>
    <div class="grid g2">${waterfall("03", "[ 03 ] SETTLEMENT · ORDER #3")}${waterfall("04", "[ 04 ] SETTLEMENT · ORDER #4")}</div>
    <div class="card" style="margin-top:20px"><div class="body"><div class="label">DELIVERED ARTIFACT · ORDER #3 · sha256 committed onchain</div><pre class="report">${esc(report)}</pre></div></div>
  </section>

  <section>
    <div class="sec-head"><h2>Any token <span class="blue">in</span></h2>
      <span class="sec-note">NEAR Intents 1Click turns ETH, SOL, BTC or USDC on another chain into exactly $100 USDC delivered to the LOCA contract with <code>ft_transfer_call</code>, so the payment opens the order.</span></div>
    ${intentsTable()}
  </section>

  <section>
    <div class="sec-head"><h2><span class="blue">Guard</span>rails</h2>
      <span class="sec-note">Attempts the contract refuses. Rejected deposits are credited back to the sender, never stranded.</span></div>
    <div class="grid g3">${blocked
      .map((b) => `<div class="card"><div class="body"><div class="label">BLOCKED</div><h3>${esc(cap(b.title.replace("Blocked: ", "").replace(/ \(.*\)$/, "")))}</h3><span class="chip">${esc(b.error)}</span></div><div class="foot"><span>testnet tx</span>${tx(b.tx)}</div></div>`)
      .join("")}</div>
  </section>

  <section>
    <div class="sec-head"><h2>The <span class="blue">ledger</span></h2><span class="sec-note">Every step of the testnet run, ${new Date(run.generatedAt).toUTCString()}.</span></div>
    <ol class="steps">${steps
      .map((s) => `<li><span class="act">[ ${s.act} ]</span><span>${esc(s.title)}${s.error ? ` <span class="err">${esc(s.error)}</span>` : ""}</span>${tx(s.tx)}</li>`)
      .join("")}</ol>
  </section>

  <footer><span>LOCA · testnet prototype · not audited · score weights are prototype rules</span><span>Contract <a href="https://testnet.nearblocks.io/address/${LOCA}" target="_blank" rel="noopener">${esc(LOCA)}</a></span></footer>
</div>`;

  letterSphere(document.querySelector("#sphere") as HTMLCanvasElement);
}

function tooltips() {
  const tip = document.querySelector("#tip") as HTMLElement;
  document.addEventListener("mousemove", (e) => {
    const t = (e.target as HTMLElement).closest("[data-tip]") as HTMLElement | null;
    if (!t) return void (tip.hidden = true);
    tip.textContent = t.dataset.tip!;
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 320)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
}

async function view(method: string, args: object) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "loca", method: "query",
      params: { request_type: "call_function", finality: "final", account_id: LOCA, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

/** Refresh the agent card from the live contract, so the page is not just a recording. */
async function goLive() {
  const live = document.querySelector("#live")!;
  try {
    const agentId = (run.finalState as any).agent.agent_id;
    const [agent, score] = await Promise.all([view("get_agent", { agent_id: agentId }), view("get_score", { agent_id: agentId })]);
    document.querySelector("#score")!.textContent = String(score.score);
    document.querySelector("#bars")!.innerHTML = scoreBars(score);
    document.querySelector("#bond")!.textContent = usd(agent.bond);
    document.querySelector("#orders")!.textContent = `${agent.stats.orders_completed} completed · ${agent.stats.unique_customers} customers · ${usd(agent.stats.revenue)} revenue`;
    document.querySelector("#loans")!.textContent = `${agent.stats.loans_repaid} repaid · ${agent.stats.loans_defaulted} defaulted`;
    live.classList.add("on");
    live.innerHTML = "<i></i>live from testnet contract";
  } catch {
    live.innerHTML = "<i></i>testnet unreachable · showing run log";
  }
}

render();
tooltips();
goLive();
