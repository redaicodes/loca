// Public landing page. The hero replays real loans from the market contract; every number is live.

import { CONTRACT, type Loan, type Offer, type Order, type Store } from "./data";
import { agentRows, metrics } from "./pages";
import { EXPLORER_ACCOUNT } from "./data";
import { LOGO, esc, label } from "./ui";

const SOURCES = {
  quickbooks: "https://stacker.com/stories/small-business/small-businesses-are-owed-17500-average-how-fastest-paid-are-closing-gap",
  trm: "https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain",
};

const money = (raw: string | number, dp = 2) => `$${(Number(raw) / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export function landing() {
  return `<div class="lx">
  <nav class="lx-nav">
    <a class="lx-logo" href="#/">${LOGO(30)}<span>LOCA</span></a>
    <div class="lx-nav-r">
      <a href="#/app">Market</a>
      <a href="#/app/swarm">Live swarm</a>
      <a class="lx-btn sm" href="#/app">Open app</a>
    </div>
  </nav>

  <header class="lx-hero">
    <div class="lx-hero-copy">
      <h1>Credit for the<br/>agent economy</h1>
      <p>AI agents borrow against orders their customers have already paid for. Lenders compete on price. The escrow repays them first.</p>
      <div class="lx-actions">
        <a class="lx-btn" href="#/app">Open the market</a>
        <a class="lx-link" href="#/app/swarm">Watch agents trade live</a>
      </div>
    </div>
    <div class="lx-ticket" id="lx-ticket" aria-live="polite">
      <div class="lx-ticket-skel">Loading a live loan from NEAR testnet</div>
    </div>
  </header>

  <section class="lx-numbers" id="lx-numbers">
    <div><b data-n="escrow">–</b><span>escrowed by customers</span></div>
    <div><b data-n="credit">–</b><span>lent to agents</span></div>
    <div><b data-n="repaid">–</b><span>of loans repaid</span></div>
    <div><b data-n="fee">–</b><span>average fee per loan</span></div>
  </section>

  <section class="lx-dark">
    <div class="lx-dark-in">
      <h2>The order is the collateral.</h2>
      <div class="lx-flow" id="lx-flow">
        <div class="lx-node"><b>Customer</b><span>pays into escrow</span></div>
        <div class="lx-edge"><i></i></div>
        <div class="lx-node"><b>Lenders</b><span>bid for the advance</span></div>
        <div class="lx-edge"><i></i></div>
        <div class="lx-node"><b>Vendor</b><span>is paid the loan</span></div>
        <div class="lx-edge"><i></i></div>
        <div class="lx-node"><b>Escrow</b><span>repays the lender, then the agent</span></div>
      </div>
      <div class="lx-rules">
        <p><b>The agent never holds borrowed money.</b> Loans go straight to a vendor its operator approved.</p>
        <p><b>Lenders are paid before the agent.</b> Settlement runs in a fixed order the contract enforces.</p>
        <p><b>Operators put money at risk first.</b> A bond covers lender losses before anyone else.</p>
      </div>
    </div>
  </section>

  <section class="lx-product">
    <div class="lx-product-copy">
      <h2>Every agent builds a credit record.</h2>
      <p>Each repaid loan raises an agent's LOCA Score, computed by the contract from its own history. Better scores get cheaper credit.</p>
      <a class="lx-link" href="#/app/agents">See all agents</a>
    </div>
    <div class="lx-window">
      <div class="lx-window-bar"><i></i><i></i><i></i><span>LOCA market · agents by score</span></div>
      <table class="lx-board" id="lx-board"><tbody><tr><td>Loading</td></tr></tbody></table>
    </div>
  </section>

  <section class="lx-why">
    <h2>Why it matters</h2>
    <div class="lx-why-grid">
      <div><b>56%</b><p>of small businesses surveyed were waiting on unpaid invoices, owed $17,500 on average. Agents selling services face the same gap, with no bank to bridge it.</p><a href="${SOURCES.quickbooks}" target="_blank" rel="noopener">QuickBooks, 2025</a></div>
      <div><b>$5–11K</b><p>a month of genuinely agent-driven payments onchain today. The market is early. Credit is one of the pieces it is missing.</p><a href="${SOURCES.trm}" target="_blank" rel="noopener">TRM Labs, Sept 2026</a></div>
      <div><b data-n="assets">210</b><p>assets a customer can pay with. NEAR Intents converts them to the exact USDC owed and opens the order in one step.</p><a href="#/app/pay">Try a quote</a></div>
    </div>
  </section>

  <section class="lx-cta">
    <h2>Agents are trading on testnet now.</h2>
    <div class="lx-actions"><a class="lx-btn light" href="#/app/swarm">Watch the swarm</a><a class="lx-link light" href="#/app">Open the market</a></div>
  </section>

  <footer class="lx-foot">
    <span>LOCA, line of credit for agents. Built for NEAR Hackathon 2026.</span>
    <span>Testnet prototype, not audited. <a href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">Market contract</a></span>
  </footer>
</div>`;
}

// ---------------------------------------------------------------- live numbers

const shown = new Map<string, number>();
let counted = false;

function countTo(el: HTMLElement, to: number, fmt: (v: number) => string) {
  const from = shown.get(el.dataset.n!) ?? 0;
  shown.set(el.dataset.n!, to);
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

export function updateLanding(s: Store, _feed: unknown, assets: number | null) {
  if (!document.querySelector(".lx")) return;
  const m = metrics(s);
  const t = s.market.totals;
  const nums = document.getElementById("lx-numbers")!;
  const run = () => {
    const set = (k: string, v: number, fmt: (v: number) => string) => {
      const el = document.querySelector<HTMLElement>(`[data-n="${k}"]`);
      if (el) countTo(el, v, fmt);
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
      .filter((o) => o.status === "Released" && o.loan_id !== null && o.offer_ids.length >= 2)
      .sort((a, b) => b.id - a.id)
      .slice(0, 12)
      .map((order) => ({
        order,
        loan: s.loans.get(order.loan_id!)!,
        offers: [...s.offers.values()].filter((f) => f.order_id === order.id).sort((a, b) => Number(a.fee) - Number(b.fee)),
      }))
      .filter((st) => st.loan && st.loan.status === "Repaid");
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
