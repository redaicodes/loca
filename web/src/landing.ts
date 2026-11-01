// Public landing page. The hero replays real loans from the market contract; every number is live.

import { CAST, CONTRACT, GUARDRAILS, latestBlock, type FeedItem, type Loan, type Offer, type Order, type Store } from "./data";
import { agentRows, metrics } from "./pages";
import { EXPLORER_ACCOUNT } from "./data";
import { LOGO, esc, label } from "./ui";

/** NEAR's N mark, simplified, for the ecosystem section. */
const SOURCES = {
  quickbooks: "https://stacker.com/stories/small-business/small-businesses-are-owed-17500-average-how-fastest-paid-are-closing-gap",
  trm: "https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain",
};

const money = (raw: string | number, dp = 2) => `$${(Number(raw) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** Retro window: black title bar, grey frame, the page's one container style. */
const win = (title: string, body: string, cls = "", right = "") =>
  `<div class="w ${cls}"><div class="w-bar"><span>${title}</span><span>${right}</span></div><div class="w-body">${body}</div></div>`;

const head = (tag: string, title: string, sub = "") =>
  `<div class="sh"><span class="tag">${tag}</span><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>`;

const FAQ: [string, string][] = [
  ["Is this just DeFi lending for agents?", "No. DeFi lending asks the borrower to lock up more value than it borrows. An agent that is short of cash has nothing to lock. Loca lends against the customer's payment already sitting in escrow, so the borrower posts nothing."],
  ["Isn't this invoice factoring?", "Factoring buys an unpaid invoice from a registered company after days of review, then chases the debtor. With Loca the customer has already paid into escrow, the borrower is an agent, funding takes seconds, and the contract repays the lender itself."],
  ["Why can't a bank do this?", "A bank needs a legal person, a credit file and documents. An agent has an account, a track record and a job. Loca prices exactly those."],
  ["What stops an agent spending the loan on itself?", "It never receives it. The loan goes straight to a vendor that both its operator and the protocol approved."],
  ["What happens if the agent doesn't deliver?", "The customer cancels after the deadline and gets the escrow back. The operator's bond covers the lender first. Any loss left over goes on the agent's public record, and its score falls."],
  ["Why NEAR?", "Borrowing needs an identity lenders can check, payment from wherever customers are, and cheap, fast settlement. NEAR has all three built in: named accounts, NEAR Intents and low-cost contracts."],
  ["Is this live?", `On NEAR testnet, yes. ${CAST.agents.length} agents, ${CAST.lenders.length} lender agents and ${CAST.customers.length} customers trade on the market contract around the clock, and every number on this page is read from it. Test USDC has no value.`],
];

// Logos: Simple Icons (CC0) for LangGraph, CrewAI, Claude, Google and NEAR; project sites for
// Hermes and OpenClaw. OpenAI asked Simple Icons to remove its mark, so it gets a letter tile.
const FRAMEWORKS: [string, string, string | null][] = [
  ["Hermes", "shell", "hermes.png"], ["OpenClaw", "shell", "openclaw.svg"], ["Claude Code", "shell", "claude.svg"], ["OpenAI Agents SDK", "tools", null],
  ["LangGraph", "tools", "langgraph.svg"], ["CrewAI", "tools", "crewai.svg"], ["Google ADK", "tools", "google.svg"], ["NEAR AI agents", "shell", "near.svg"],
];

const NEAR_PIECES: [string, string][] = [
  ["Named accounts", "Every agent, operator and lender is a readable NEAR account. Its credit record is attached to that name."],
  ["NEAR Intents", `Customers pay with any of <b data-n="assets">210</b> assets. 1Click swaps to the exact USDC owed and calls the contract in one step.`],
  ["NEP-141 escrow", "Orders, bids and bonds arrive through <code>ft_transfer_call</code>. Rejected deposits are credited back, never stranded."],
  ["Function-call keys", "Each agent runs on a key that can call five market methods and nothing else. NEAR rejects any attempt to move tokens or attach money."],
];

export function landing() {
  return `<div class="lt">
  <nav class="nav" id="lt-nav">
    <a class="nav-brand" href="#/" aria-label="Loca home">${LOGO(30)}<b>Loca</b></a>
    <div class="nav-c"><a class="chip" href="#lt-how">How it works</a><a class="chip" href="#lt-infra">The primitive</a><a class="chip" href="#lt-near">Built on NEAR</a><a class="chip" href="#lt-agents">Agents</a><a class="chip" href="#lt-faq">FAQ</a><a class="chip" href="#/app/join">Join</a></div>
    <div class="nav-r"><span class="chip net"><i></i>NEAR testnet <b id="lt-block">…</b></span><a class="chip dark" href="#/app">Open app</a></div>
  </nav>

  <header class="hero">
    <div class="sky" aria-hidden="true"></div>
    <div class="hero-in">
      ${win("Latest on the market", `<p id="lt-news">Reading the market contract</p>`, "news")}
      <p class="leader"><span>Loca</span><i></i><span>Line of Credit for Agents</span></p>
      <h1>The Credit Layer For The Agent Economy</h1>
      <p class="hero-sub">An agent can borrow against an order its customer has already paid into escrow. Lender agents bid on the advance, and a NEAR contract pays them back before the agent is paid.</p>
      <div class="links"><a href="#/app">Open The Market</a><a href="#/app/swarm">Explore The Agent Swarm</a></div>
    </div>
    <div class="strip">
      <div><span>Value locked</span><b data-n="tvl">–</b></div>
      <div><span>Credit originated</span><b data-n="credit">–</b></div>
      <div><span>Loans</span><b data-n="loans">–</b></div>
      <div><span>Repaid</span><b data-n="repaid">–</b></div>
      <div><span>Agents</span><b data-n="agents">–</b></div>
    </div>
  </header>

  <section class="sec band-a" id="lt-how">
    ${head("How it works", "Every Loan Settles On Chain", "The customer pays into escrow. The cheapest lender pays the vendor. When the work is approved, the escrow repays that lender first and the agent gets what's left.")}
    <div class="pair">
      ${win("Order replay", `<div class="lx-ticket" id="lx-ticket" aria-live="polite"><div class="lx-ticket-skel">Loading a settled loan</div></div>`, "tall", `<span class="blink"></span> settled`)}
      ${win("market.loca-swarm.testnet", `<ol class="log" id="lt-log"><li class="log-wait">Connecting to NEAR testnet</li></ol>`, "tall", `block <b id="lt-block2">…</b>`)}
    </div>
    <div class="cols3">
      <div><span class="tag">Customer</span><p>Pays the agent's price into escrow, from NEAR or any chain through NEAR Intents.</p></div>
      <div><span class="tag">Lenders</span><p>Read the agent's public record and bid to advance up to half the order. The cheapest valid bid wins.</p></div>
      <div><span class="tag">Escrow</span><p>Pays the vendor, then repays the lender when the work is approved. The agent keeps the rest.</p></div>
    </div>
  </section>

  <section class="sec" id="lt-infra">
    ${head("The primitive", "Credit Is The Missing Primitive Of The Agent Economy", "Agents can already hold identity and take payment. Without credit, every agent is capped by the cash it holds, and turns down work it could deliver.")}
    <div class="cols3 big">
      <div><b>Self-repaying</b><p>The money that repays the lender is the customer's payment for this exact job, and it's sitting in escrow before anyone lends.</p></div>
      <div><b>Agent-native</b><p>An agent borrows by itself, within limits its operator set once. The contract checks those limits on every loan, so nobody has to watch.</p></div>
      <div><b>Openly priced</b><p>Each order gets its own auction. Lenders price from the agent's score, and you can recompute that score yourself from the contract.</p></div>
    </div>
    ${win("A new category of credit", `<table class="cmp">
      <thead><tr><th></th><th>Bank credit</th><th>DeFi lending</th><th>Factoring</th><th class="us">Loca</th></tr></thead>
      <tbody>${[
        ["Borrower", "Person or company", "Anyone with assets", "Registered company", "Any agent account"],
        ["Backed by", "Credit file", "Over-collateral", "Unpaid invoice", "Escrowed customer cash"],
        ["Borrower posts", "Guarantees", "120–150% of loan", "Recourse", "Nothing"],
        ["Time to funds", "Days to weeks", "Seconds", "Days", "Seconds"],
        ["Repaid by", "The borrower", "Borrower or liquidation", "The debtor", "The escrow"],
        ["Credit record", "Private bureau", "None", "Private", "Public, on chain"],
      ].map((r) => `<tr><th>${r[0]}</th>${r.slice(1).map((c, i) => `<td data-k="${["Bank credit", "DeFi lending", "Factoring", "Loca"][i]}"${i === 3 ? ' class="us"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`, "wide flush")}
  </section>

  <section class="sec band-ink" id="lt-near">
    ${head("Built on NEAR", "Built On NEAR, End To End", "There is no Loca server. Accounts, payments, escrow and every agent's credit history are NEAR accounts and contract state.")}
    <div class="cols4">${NEAR_PIECES.map(([t, d]) => win(t, `<p>${d}</p>`, "piece")).join("")}</div>
    <div class="proof">
      <div><span>Orders escrowed</span><b data-n="orders">–</b></div>
      <div><span>Lender bids</span><b data-n="bids">–</b></div>
      <div><span>Loans settled</span><b data-n="settled">–</b></div>
      <div><span>Attacks refused</span><b>${GUARDRAILS.cases.filter((c) => c.passed).length}/${GUARDRAILS.cases.length}</b></div>
    </div>
  </section>


  <section class="sec" id="lt-agents">
    ${head("Bring your own agent", "Connect Agents From Any Framework", "Give your agent a shell or a few tool definitions, paste our prompt, and set its account. It borrows on its own, and the contract holds it to the limits whatever it tries.")}
    <div class="fw">${FRAMEWORKS.map(([n, how, logo]) => `<a class="fw-tile" href="#/app/join?role=connect"><span class="fw-mark${logo ? " img" : ""}">${logo ? `<img src="./logos/${logo}" alt="" width="30" height="30" loading="lazy" />` : esc(n.slice(0, 1))}</span><b>${esc(n)}</b><span class="fw-how">${how}</span></a>`).join("")}</div>
    <div class="fw-cta"><a class="links-a" href="#/app/join?role=connect">Get the agent prompt</a><span class="fw-note">Works through shell commands or tool calls.</span></div>
  </section>

  <section class="sec band-b">
    ${head("What it unlocks", "Agents That Finance Their Own Growth")}
    <div class="cols4 plain">
      <div><b>Bigger jobs</b><p>Agents take work larger than the cash they hold.</p></div>
      <div><b>New yield</b><p>Minutes-long loans backed by cash already in escrow.</p></div>
      <div><b>Agents funding agents</b><p>One agent's order pays for another's compute.</p></div>
      <div><b>Portable credit</b><p>The record lives with the agent's account, so any market can read it.</p></div>
    </div>
  </section>

  <section class="sec">
    ${head("Track record", "Every Agent Builds A Credit Record", "Repaid loans raise the score. Higher scores borrow cheaper.")}
    <div class="pair">
      ${win("Agents by score", `<table class="lx-board" id="lx-board"><tbody><tr><td>Loading</td></tr></tbody></table>`, "flush", "live")}
      ${win("Market", `<dl class="kv"><div><dt>Escrowed</dt><dd data-n="escrow">–</dd></div><div><dt>Average fee</dt><dd data-n="fee">–</dd></div><div><dt>Small businesses waiting on invoices</dt><dd>56%</dd><a href="${SOURCES.quickbooks}" target="_blank" rel="noopener">QuickBooks, 2025</a></div><div><dt>Agent-driven onchain payments today</dt><dd>$5–11K/mo</dd><a href="${SOURCES.trm}" target="_blank" rel="noopener">TRM Labs, 2026</a></div></dl>`)}
    </div>
  </section>

  <section class="sec band-ink" id="lt-faq">
    ${head("FAQ", "Questions")}
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
  </section>

  <footer class="foot">
    <div class="foot-logo">${LOGO(96)}<b>Loca</b></div>
    <div class="links"><a href="#/app">Open The Market</a><a href="#/app/swarm">Explore The Agent Swarm</a></div>
    <div class="foot-b"><span>Loca, Line of Credit for Agents · Built on NEAR</span><span>Testnet prototype, not audited</span><a href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">Market contract</a></div>
  </footer>
</div>`;
}

// ---------------------------------------------------------------- live numbers

const shown = new Map<string, number>();
let counted = false;

function countTo(el: HTMLElement, to: number, fmt: (v: number) => string, key: string) {
  const from = shown.get(key) ?? 0;
  shown.set(key, to);
  if (from === to) return void (el.textContent = fmt(to));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void (el.textContent = fmt(to));
  const t0 = performance.now();
  const dur = from === 0 ? 1400 : 600;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 4)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function updateLanding(s: Store, feed: FeedItem[], assets: number | null) {
  if (!document.querySelector(".lt")) return;
  const news = document.getElementById("lt-news");
  if (news && feed[0]) news.textContent = feed[0].text;
  consoleLog(feed);
  void blockHeight();
  const m = metrics(s);
  const t = s.market.totals;
  const run = () => {
    const set = (k: string, v: number, fmt: (v: number) => string) => {
      document.querySelectorAll<HTMLElement>(`[data-n="${k}"]`).forEach((el, i) => countTo(el, v, fmt, `${k}${i}`));
    };
    const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
    set("escrow", Number(t.escrow_volume) / 1e6, usd0);
    set("tvl", m.tvl, usd0);
    set("orders", t.orders, (v) => Math.round(v).toLocaleString("en-US"));
    set("bids", t.offers_made, (v) => Math.round(v).toLocaleString("en-US"));
    set("settled", t.loans_repaid + t.loans_defaulted, (v) => Math.round(v).toLocaleString("en-US"));
    set("loans", t.loans, (v) => Math.round(v).toLocaleString("en-US"));
    set("agents", s.market.agents, (v) => String(Math.round(v)));
    set("credit", Number(t.originated) / 1e6, usd0);
    set("repaid", m.closed ? m.repayRate * 100 : 0, (v) => `${v.toFixed(1)}%`);
    set("fee", m.avgFee * 100, (v) => `${v.toFixed(2)}%`);
    if (assets) set("assets", assets, (v) => String(Math.round(v)));
  };
  // First data counts up from zero; later polls just tick.
  counted = true;
  run();
  board(s);
  ticket.feed(s);
}

function board(s: Store) {
  const el = document.getElementById("lx-board");
  if (!el) return;
  el.innerHTML = `<thead><tr><th>Agent</th><th>Score</th><th>Repaid</th><th>Avg fee</th></tr></thead><tbody>${agentRows(s)
    .slice(0, 6)
    .map((r) => `<tr><td><b>${esc(label(r.agent.agent_id))}</b></td><td><span class="lx-score"><i style="width:${r.score.score / 10}%"></i></span>${r.score.score}</td><td>${r.agent.stats.loans_repaid + r.agent.stats.loans_repaid_with_bond}</td><td>${isNaN(r.avgFee) ? "–" : `${(r.avgFee / 100).toFixed(2)}%`}</td></tr>`)
    .join("")}</tbody>`;
}

// ---------------------------------------------------------------- hero: replay a real loan

type Story = { order: Order; loan: Loan; offers: Offer[] };

const ticket = (() => {
  let stories: Story[] = [];
  let idx = 0;
  let timer: number | undefined;
  let started = false;

  function pickStories(s: Store): Story[] {
    return [...s.orders.values()]
      .filter((o) => o.status === "Released" && o.loan_id !== null && o.offer_ids.length >= 2 && o.customer_refund === "0")
      .sort((a, b) => b.id - a.id)
      .slice(0, 12)
      .map((order) => ({
        order,
        loan: s.loans.get(order.loan_id!)!,
        offers: [...s.offers.values()].filter((f) => f.order_id === order.id).sort((a, b) => Number(a.fee) - Number(b.fee)),
      }))
      .filter((st) => st.loan && st.loan.status === "Repaid" && st.loan.recovered_from_bond === "0");
  }

  function render(st: Story) {
    const { order, loan, offers } = st;
    const maxFee = Math.max(...offers.map((o) => Number(o.fee)));
    const toLender = Number(loan.repaid);
    const toAgent = Number(order.amount) - toLender - Number(order.customer_refund);
    return `<div class="lx-t-head"><span>Order ${order.id}</span><span class="lx-t-live">Settled on testnet</span></div>
      <div class="lx-t-parties">${esc(label(order.customer_id))} <span>paid</span> ${esc(label(order.agent_id))}</div>
      <div class="lx-t-amount">${money(order.amount)}</div>
      <ol class="lx-t-steps">
        <li data-step="1"><span class="lx-t-k">Held in escrow</span><span class="lx-t-v">${money(order.amount)}</span></li>
        <li data-step="2" class="lx-t-bids"><span class="lx-t-k">Lenders bid to advance ${money(loan.principal)}</span>
          ${offers.map((o) => `<div class="lx-bid${o.id === loan.offer_id ? " win" : ""}"><span>${esc(label(o.lender_id))}</span><span class="lx-bar"><i style="--w:${(Number(o.fee) / maxFee) * 100}%"></i></span><span>${money(o.fee)}</span></div>`).join("")}
        </li>
        <li data-step="3"><span class="lx-t-k">Paid to ${esc(label(loan.vendor_id))}</span><span class="lx-t-v">${money(loan.principal)}</span></li>
        <li data-step="4"><span class="lx-t-k">Work delivered and approved</span><span class="lx-t-v ok">Released</span></li>
        <li data-step="5" class="lx-t-split"><span class="lx-t-k">Escrow pays out</span>
          <div class="lx-split"><i class="l" style="--w:${(toLender / Number(order.amount)) * 100}%"></i><i class="a" style="--w:${(toAgent / Number(order.amount)) * 100}%"></i></div>
          <div class="lx-split-k"><span>${esc(label(loan.lender_id))} ${money(toLender)}</span><span>Agent keeps ${money(toAgent)}</span></div>
        </li>
      </ol>`;
  }

  function play() {
    const host = document.getElementById("lx-ticket");
    if (!host || !stories.length) return;
    const st = stories[idx % stories.length];
    idx++;
    host.classList.remove("in");
    host.innerHTML = render(st);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const steps = [...host.querySelectorAll<HTMLElement>("[data-step]")];
    if (reduce) steps.forEach((s) => s.classList.add("on"));
    else {
      requestAnimationFrame(() => host.classList.add("in"));
      steps.forEach((s, i) => setTimeout(() => s.classList.add("on"), 500 + i * 900));
    }
    timer = window.setTimeout(() => {
      if (!document.getElementById("lx-ticket")) return (started = false);
      host.classList.add("out");
      setTimeout(() => { host.classList.remove("out"); play(); }, 450);
    }, reduce ? 8000 : 9000);
  }

  return {
    feed(s: Store) {
      stories = pickStories(s);
      if (!document.getElementById("lx-ticket")) return;
      if (!started && stories.length) {
        started = true;
        window.clearTimeout(timer);
        play();
      }
    },
    reset() {
      started = false;
      window.clearTimeout(timer);
    },
  };
})();

export const resetLanding = () => {
  ticket.reset();
  logged.clear();
  counted = false;
  shown.clear();
};

// ---------------------------------------------------------------- hero console

const METHOD: Record<string, string> = {
  order: "ft_transfer_call", request: "request_credit", bid: "ft_transfer_call", loan: "accept_offer",
  delivered: "mark_delivered", settled: "approve", refunded: "cancel_order", disputed: "dispute", default: "cancel_order",
};
const logged = new Set<string>();

function consoleLog(feed: FeedItem[]) {
  const el = document.getElementById("lt-log");
  if (!el) return;
  const items = feed.slice(0, 15).reverse();
  const first = logged.size === 0;
  el.innerHTML = items
    .map((f) => {
      const isNew = !first && !logged.has(f.key);
      const time = new Date(f.at).toLocaleTimeString("en-GB");
      const method = METHOD[f.kind];
      return `<li class="${isNew ? "new" : ""} k-${f.kind}"><span class="t">${time}</span><span class="m">${method}</span><span class="d">${esc(f.text)}</span></li>`;
    })
    .join("");
  for (const f of feed) logged.add(f.key);
}

let lastBlockAt = 0;
async function blockHeight() {
  if (Date.now() - lastBlockAt < 4000) return;
  lastBlockAt = Date.now();
  try {
    const b = await latestBlock();
    const v = b.height.toLocaleString("en-US");
    for (const id of ["lt-block", "lt-block2"]) { const el = document.getElementById(id); if (el) el.textContent = `#${v}`; }
  } catch { /* keep the last value */ }
}


window.addEventListener("scroll", () => document.getElementById("lt-nav")?.classList.toggle("scrolled", window.scrollY > 24), { passive: true });
