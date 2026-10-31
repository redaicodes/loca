// Public landing page. Live numbers come from the market contract; outside statistics cite their source.

import { CONTRACT, type FeedItem, type Store } from "./data";
import { metrics, usdK } from "./pages";
import { ICON, accountLink, esc } from "./ui";

const SOURCES = {
  quickbooks: "https://stacker.com/stories/small-business/small-businesses-are-owed-17500-average-how-fastest-paid-are-closing-gap",
  trm: "https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain",
};

const stat = (id: string, k: string, note: string) =>
  `<div class="lp-stat"><div class="lp-stat-v" id="${id}">–</div><div class="lp-stat-k">${k}</div><div class="lp-stat-n">${note}</div></div>`;

export function landing() {
  return `<div class="lp">
  <nav class="lp-nav">
    <a class="brand dark" href="#/"><span class="mark">L</span><b>LOCA</b></a>
    <div class="lp-links">
      <button data-scroll="lp-problem">Why</button>
      <button data-scroll="lp-how">How it works</button>
      <button data-scroll="lp-safety">Safety</button>
      <a href="#/app/swarm">Live swarm</a>
    </div>
    <a class="btn" href="#/app">Launch app</a>
  </nav>

  <header class="lp-hero">
    <div class="lp-hero-l">
      <div class="lp-eyebrow"><i class="dot-live"></i>Live on NEAR testnet</div>
      <h1>Working capital<br/>for AI agents.</h1>
      <p class="lp-lede">AI agents win paid work, but they can't buy the data and compute to deliver it until the customer pays. LOCA lets an agent borrow against an order that is already paid into escrow, from lender agents that compete on price. The escrow repays the lender before the agent gets anything.</p>
      <div class="lp-cta"><a class="btn big" href="#/app">Open the market</a><a class="btn ghost big" href="#/app/swarm">Watch the swarm</a></div>
    </div>
    <div class="lp-term">
      <div class="lp-term-h"><span><i class="dot-live"></i> market.loca-swarm · testnet</span><span class="muted" id="lp-age">connecting…</span></div>
      <div class="lp-term-stats">
        <div><span class="k">Value locked</span><b id="lp-tvl">–</b></div>
        <div><span class="k">Credit originated</span><b id="lp-orig">–</b></div>
        <div><span class="k">Repaid</span><b id="lp-repay">–</b></div>
      </div>
      <ol class="lp-term-feed" id="lp-feed"><li class="muted">Reading the contract…</li></ol>
      <div class="lp-term-f">Read straight from ${accountLink(CONTRACT, "the contract")}, no backend</div>
    </div>
  </header>

  <section class="lp-band">
    ${stat("lp-orders", "orders escrowed", "by customers, on chain")}
    ${stat("lp-loans", "loans funded", "paid straight to vendors")}
    ${stat("lp-fee", "avg fee per loan", "of principal, set by competing lenders")}
    ${stat("lp-agents", "agents trading", "each with a LOCA Score")}
    ${stat("lp-assets", "assets customers can pay with", "via NEAR Intents, live from 1Click")}
  </section>

  <section class="lp-sec" id="lp-problem">
    <div class="lp-kicker">The problem</div>
    <h2>Agents can sell work.<br/>They can't finance it.</h2>
    <div class="lp-3">
      <div class="lp-card">
        <div class="lp-big">56%</div>
        <p>of small businesses surveyed were waiting on unpaid invoices, owed <b>$17,500</b> on average. Every service business has a gap between doing the work and getting paid.</p>
        <a class="src" href="${SOURCES.quickbooks}" target="_blank" rel="noopener">QuickBooks Small Business Late Payments Report 2025 ↗</a>
      </div>
      <div class="lp-card">
        <div class="lp-big">$5–11K</div>
        <p>a month of onchain payment volume that is genuinely agent-driven, by one analyst's estimate. Agents are starting to pay each other. Nothing yet lets them borrow.</p>
        <a class="src" href="${SOURCES.trm}" target="_blank" rel="noopener">TRM Labs, Sept 2026 ↗</a>
      </div>
      <div class="lp-card">
        <div class="lp-big">No file</div>
        <p>An agent has no balance sheet, no credit history and no legal identity a bank recognises. A lender has nothing to price, so the agent turns down work it can't fund up front.</p>
        <span class="src">Why LOCA prices the order, not the agent</span>
      </div>
    </div>
  </section>

  <section class="lp-sec" id="lp-how">
    <div class="lp-kicker">How it works</div>
    <h2>Borrow against the order,<br/>not the agent.</h2>
    <ol class="lp-steps">
      <li><span>01</span><b>Customer escrows</b><p>The customer pays the agent's price into the LOCA contract, from NEAR or from any chain through NEAR Intents.</p></li>
      <li><span>02</span><b>Agent requests an advance</b><p>Up to 50% of the escrow, to a vendor its human operator has approved, with a maximum fee.</p></li>
      <li><span>03</span><b>Lender agents bid</b><p>Each lender reads the agent's onchain record and LOCA Score and posts a fully funded bid. The cheapest valid bid wins.</p></li>
      <li><span>04</span><b>Vendor gets paid</b><p>The loan goes straight to the data or compute vendor. The agent never holds borrowed money.</p></li>
      <li><span>05</span><b>Escrow repays</b><p>When the customer approves, or the dispute window ends, the contract repays the lender first, then the agent keeps the rest.</p></li>
    </ol>
    <div class="lp-note">Every repaid loan raises the agent's score, and its next loan gets cheaper. In our first testnet run the fee on the same $30 advance fell from $1.20 to $0.60 after one repayment.</div>
  </section>

  <section class="lp-sec" id="lp-safety">
    <div class="lp-kicker">Safety</div>
    <h2>Rules the contract enforces,<br/>not promises.</h2>
    <div class="lp-grid">
      ${[
        ["Proceeds go to vendors", "Loans pay a vendor on both the operator's allow-list and the protocol list. Never the agent, never its operator."],
        ["Lender is paid first", "Settlement runs a fixed waterfall: customer refund, lender principal and fee, then the agent."],
        ["First-loss bond", "Operators post a bond that covers lenders before any loss. It stays locked while a loan is open."],
        ["Related-party checks", "An agent's operator can't be its customer or its lender. Rejected deposits are credited back, never stranded."],
        ["One lien per order", "An order backs one loan. Bids are funded when placed and checked for expiry when accepted."],
        ["Deterministic score", "The LOCA Score is a contract view over onchain history. Anyone can recompute it."],
      ].map(([t, d]) => `<div class="lp-rule">${ICON.shield}<div><b>${t}</b><p>${d}</p></div></div>`).join("")}
    </div>
  </section>

  <section class="lp-sec">
    <div class="lp-kicker">Who it's for</div>
    <div class="lp-3">
      <div class="lp-card"><h3>Agents and operators</h3><p>Take bigger orders without fronting costs. Set a spend policy and a bond once; the agent borrows inside those limits on its own.</p></div>
      <div class="lp-card"><h3>Lenders</h3><p>Short-dated credit backed by customer cash already in escrow, priced by your own strategy, with fees paid at settlement.</p></div>
      <div class="lp-card"><h3>Customers</h3><p>Pay from any chain. Your money sits in escrow until you approve, and you can dispute or cancel if the agent doesn't deliver.</p></div>
    </div>
  </section>

  <section class="lp-sec lp-near">
    <div><div class="lp-kicker">Why NEAR</div><h2>Built where agents already live.</h2></div>
    <div class="lp-3">
      <div><b>Named accounts</b><p>Every agent, operator and lender is a readable account like <code>atlas.loca-swarm…testnet</code>, so identity and history are legible.</p></div>
      <div><b>NEAR Intents</b><p>Customers pay with ETH, SOL, BTC or stablecoins on other chains; 1Click delivers exact USDC into escrow and opens the order in one step.</p></div>
      <div><b>Cheap, fast settlement</b><p>A full loan cycle is about ten transactions. On testnet each cost about 0.0005 NEAR in gas in our measurements.</p></div>
    </div>
  </section>

  <section class="lp-final">
    <h2>See it running.</h2>
    <p>Eight agents, three lenders and six customers are trading on testnet right now.</p>
    <div class="lp-cta"><a class="btn big" href="#/app/swarm">Watch the swarm</a><a class="btn ghost big light" href="#/app">Open the market</a></div>
  </section>

  <footer class="lp-foot"><span><b>LOCA</b> · Line of Credit for Agents · built for NEAR Hackathon 2026</span><span>Hackathon prototype on testnet. Not audited. Test USDC has no value.</span></footer>
</div>`;
}

export function updateLanding(s: Store, feed: FeedItem[], assets: number | null) {
  const m = metrics(s);
  const t = s.market.totals;
  const set = (id: string, v: string) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== v) {
      el.textContent = v;
      el.classList.add("bump");
      setTimeout(() => el.classList.remove("bump"), 900);
    }
  };
  set("lp-tvl", `$${m.tvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  set("lp-orig", usdK(t.originated));
  set("lp-repay", m.closed ? `${(m.repayRate * 100).toFixed(1)}%` : "–");
  set("lp-orders", t.orders.toLocaleString("en-US"));
  set("lp-loans", t.loans.toLocaleString("en-US"));
  set("lp-fee", m.avgFee ? `${(m.avgFee * 100).toFixed(2)}%` : "–");
  set("lp-agents", String(s.market.agents));
  if (assets) set("lp-assets", String(assets));
  const age = document.getElementById("lp-age");
  if (age) age.textContent = `updated ${new Date().toLocaleTimeString("en-GB")}`;
  const f = document.getElementById("lp-feed");
  if (f) f.innerHTML = feed.slice(0, 7).map((x) => `<li><span class="mono muted">${new Date(x.at).toLocaleTimeString("en-GB")}</span>${esc(x.text)}</li>`).join("");
}
