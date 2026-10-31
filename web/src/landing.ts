// Public landing page. The hero replays real loans from the market contract; every number is live.

import { CONTRACT, type FeedItem, type Loan, type Offer, type Order, type Store } from "./data";
import { agentRows, metrics } from "./pages";
import { EXPLORER_ACCOUNT } from "./data";
import { LOGO, esc, label } from "./ui";

const SOURCES = {
  quickbooks: "https://stacker.com/stories/small-business/small-businesses-are-owed-17500-average-how-fastest-paid-are-closing-gap",
  trm: "https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain",
};

const money = (raw: string | number, dp = 2) => `$${(Number(raw) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const win = (title: string, body: string, cls = "", right = "") =>
  `<div class="lt-win ${cls}"><div class="lt-win-bar"><span>${title}</span><span>${right}</span></div><div class="lt-win-body">${body}</div></div>`;

const FAQ: [string, string][] = [
  ["Is this just DeFi lending for agents?", "No. DeFi lending asks the borrower to lock up more value than it borrows. An agent that is short of cash has nothing to lock. LOCA lends against the customer's payment already sitting in escrow, so the borrower posts nothing."],
  ["Isn't this invoice factoring?", "Factoring buys an unpaid invoice from a registered company, after days of review, and chases the debtor for payment. With LOCA the customer has already paid into escrow, the borrower is software, funding takes seconds, and the contract repays the lender itself."],
  ["Why can't a bank do this?", "A bank needs a legal person, a credit file and documents. An agent has an account, a track record and a job. LOCA prices exactly those."],
  ["What stops an agent spending the loan on itself?", "It never receives it. The loan goes straight to a vendor that both its operator and the protocol approved."],
  ["What happens if the agent doesn't deliver?", "The customer cancels after the deadline and gets the escrow back. The operator's bond covers the lender first. Any loss left over goes on the agent's public record, and its score falls."],
  ["Is this live?", "On NEAR testnet, yes. Eight agents, three lender agents and six customers trade on the market contract, and every number on this page is read from it. Test USDC has no value."],
];

export function landing() {
  return `<div class="lt">
  <nav class="lt-nav">
    <a class="lt-brand" href="#/">${LOGO(34)}<span><b>loca</b><small>Line of Credit for Agents</small></span></a>
    <div class="lt-nav-c"><a href="#lt-how">How it works</a><a href="#lt-category">Why it's new</a><a href="#lt-faq">FAQ</a><a href="#/app/swarm">Agent swarm</a></div>
    <a class="lt-chip dark" href="#/app">Open app</a>
  </nav>

  <header class="lt-hero">
    <div class="lt-sky" aria-hidden="true"></div>
    <div class="lt-hero-grid">
      <div>
        <p class="lt-acro"><b>L</b>ine <b>o</b>f <b>C</b>redit for <b>A</b>gents</p>
        <h1>The First Credit Line Built For AI Agents</h1>
        <p class="lt-lede">Agents borrow against orders their customers have already paid into escrow. Lenders compete on price. The escrow repays them first.</p>
        <div class="lt-links left"><a href="#/app">Open The Market</a><a href="#/app/swarm">Explore The Agent Swarm</a></div>
      </div>
      ${win(`Latest on the market`, `<p id="lt-news">Reading the market contract</p><span class="lt-news-k">NEAR testnet · updates every few seconds</span>`, "lt-news")}
    </div>
  </header>

  <section class="lt-pink" id="lt-how">
    <div class="lt-stage">
      ${win("Order replay", `<div class="lx-ticket" id="lx-ticket" aria-live="polite"><div class="lx-ticket-skel">Loading a settled loan</div></div>`, "lt-ticket-win", `<span class="lt-blink"></span> settled on testnet`)}
      <div class="lt-stage-side">
        ${win("Market", `<dl class="lt-kv"><div><dt>Escrowed</dt><dd data-n="escrow">–</dd></div><div><dt>Lent</dt><dd data-n="credit">–</dd></div><div><dt>Repaid</dt><dd data-n="repaid">–</dd></div><div><dt>Avg fee</dt><dd data-n="fee">–</dd></div></dl>`, "", "live")}
        ${win("Rules", `<ul class="lt-rules"><li>Loans pay vendors, never the agent</li><li>Escrow repays lenders first</li><li>Operator bond takes first loss</li><li>One loan per order</li></ul>`)}
      </div>
    </div>
    <h2>We Lend Against The Order, Not The Borrower</h2>
    <div class="lt-cols">
      <div><span class="lt-tag">The customer</span><p>Pays the agent's price into escrow, from NEAR or any chain through NEAR Intents.</p></div>
      <div><span class="lt-tag">The lenders</span><p>Read the agent's public record and bid to advance up to half the order. Cheapest valid bid wins.</p></div>
      <div><span class="lt-tag">The escrow</span><p>Pays the vendor, then repays the lender when the work is approved. The agent keeps the rest.</p></div>
    </div>
  </section>

  <section class="lt-white" id="lt-category">
    <h2>A New Category Of Credit</h2>
    <p class="lt-sub">Every credit product today assumes the borrower is a person or a company. An agent is neither.</p>
    ${win("Compare", `<div class="lt-table" role="table">
      <div class="lt-tr lt-th" role="row"><span></span><span>Bank credit</span><span>DeFi lending</span><span>Factoring</span><span class="us">LOCA</span></div>
      ${[
        ["Borrower", "Person or company", "Anyone with assets", "Registered company", "Any agent account"],
        ["Backed by", "Credit file, guarantees", "Crypto over the loan value", "Unpaid invoice", "Customer cash in escrow"],
        ["Borrower posts", "Often personal", "120–150% of loan", "Recourse", "Nothing"],
        ["Time to funds", "Days to weeks", "Seconds", "Days", "Seconds"],
        ["Repaid by", "Borrower", "Borrower or liquidation", "The debtor", "The escrow, automatically"],
        ["Record", "Private bureau", "None", "Private", "Public, recomputable"],
      ].map((r) => `<div class="lt-tr" role="row">${r.map((c, i) => `<span class="${i === 4 ? "us" : ""}">${c}</span>`).join("")}</div>`).join("")}
    </div>`, "lt-wide")}
    <div class="lt-big"><b data-n="repaid">–</b> Repaid.<br/><b data-n="fee">–</b> Per Loan.</div>
    <p class="lt-note">Live from the testnet market. Fees fall as an agent's record improves.</p>
  </section>

  <section class="lt-white lt-new">
    <h2>What's Actually New</h2>
    <div class="lt-grid4">
      <article><span class="lt-tag">Collateral</span><h3>Self-repaying</h3><p>The money that repays the lender is locked before the loan exists. It is the customer's payment for the work being funded.</p></article>
      <article><span class="lt-tag">Borrower</span><h3>Software</h3><p>No signatures or paperwork. An agent borrows inside limits its operator set once, enforced on every loan.</p></article>
      <article><span class="lt-tag">Credit file</span><h3>Public code</h3><p>The LOCA Score is a contract view. Any lender can recompute it from onchain history. No bureau.</p></article>
      <article><span class="lt-tag">Lenders</span><h3>Agents too</h3><p>Autonomous lenders with their own strategies compete per order, in seconds.</p></article>
    </div>
  </section>

  <section class="lt-green">
    <h2>What It Unlocks</h2>
    <div class="lt-grid4">
      <article><h3>Bigger jobs</h3><p>Agents accept work larger than the cash they hold.</p></article>
      <article><h3>New yield</h3><p>Minutes-long loans backed by cash already in escrow.</p></article>
      <article><h3>Agents funding agents</h3><p>One agent's order pays for another's compute.</p></article>
      <article><h3>Portable credit</h3><p>The record lives with the account, usable on any market.</p></article>
    </div>
  </section>

  <section class="lt-white">
    <div class="lt-split">
      <div><h2 class="left">Every Agent Builds A Record</h2><p class="lt-sub left">Repaid loans raise the score. Higher scores borrow cheaper.</p><div class="lt-links left"><a href="#/app/agents">See All Agents</a></div></div>
      ${win("Agents by score", `<table class="lx-board" id="lx-board"><tbody><tr><td>Loading</td></tr></tbody></table>`, "", "live")}
    </div>
    <div class="lt-why">
      <div><b>56%</b><p>of small businesses surveyed were waiting on unpaid invoices, owed $17,500 on average. <a href="${SOURCES.quickbooks}" target="_blank" rel="noopener">QuickBooks, 2025</a></p></div>
      <div><b>$5–11K</b><p>a month of genuinely agent-driven payments onchain. Early, and missing credit. <a href="${SOURCES.trm}" target="_blank" rel="noopener">TRM Labs, 2026</a></p></div>
      <div><b data-n="assets">210</b><p>assets a customer can pay with through NEAR Intents. <a href="#/app/pay">Try a quote</a></p></div>
    </div>
  </section>

  <section class="lt-black" id="lt-faq">
    <h2>Questions</h2>
    <div class="lt-faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
  </section>

  <footer class="lt-foot">
    <div class="lt-foot-logo">${LOGO(96)}<span>loca</span></div>
    <p class="lt-foot-acro">Line of Credit for Agents</p>
    <div class="lt-links"><a href="#/app">Open The Market</a><a href="#/app/swarm">Explore The Agent Swarm</a></div>
    <div class="lt-foot-b"><span>LOCA, Line of Credit for Agents · NEAR Hackathon 2026</span><span>Testnet prototype, not audited</span><a href="#/logos">Logo options</a><a href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">Market contract</a></div>
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
  const m = metrics(s);
  const t = s.market.totals;
  const nums = document.querySelector(".lt-kv")!;
  const run = () => {
    const set = (k: string, v: number, fmt: (v: number) => string) => {
      document.querySelectorAll<HTMLElement>(`[data-n="${k}"]`).forEach((el, i) => countTo(el, v, fmt, `${k}${i}`));
    };
    const usd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
    set("escrow", Number(t.escrow_volume) / 1e6, usd0);
    set("credit", Number(t.originated) / 1e6, usd0);
    set("repaid", m.closed ? m.repayRate * 100 : 0, (v) => `${v.toFixed(1)}%`);
    set("fee", m.avgFee * 100, (v) => `${v.toFixed(2)}%`);
    if (assets) set("assets", assets, (v) => String(Math.round(v)));
  };
  // Count up once, when the numbers first scroll into view; later polls just tick.
  if (counted) run();
  else {
    new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) {
        counted = true;
        run();
        obs.disconnect();
      }
    }, { threshold: 0.4 }).observe(nums);
  }
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
  counted = false;
  shown.clear();
};
