// Customer checkout through NEAR Intents 1Click. Quotes are always `dry: true`: no deposit address,
// no funds move. LOCA is not on mainnet yet, so the recipient is a stand-in account.

import recorded from "../../docs/intents-quotes.json";
import { NEAR_USDC, buildFundingQuote, fundOrderMsg, listTokens, requestQuote, type IntentsToken, type QuoteOutcome } from "../../src/intents/oneclick";
import { head } from "./pages";
import { ICON, esc } from "./ui";

const STAND_IN = "intents.near";
const EVM = ["eth", "arb", "base", "op", "pol", "bsc", "avax", "gnosis", "scroll", "bera", "monad", "xlayer", "plasma", "hood", "abs"];
// Public example addresses, only to pass quote validation in a dry run.
const SAMPLE_REFUND: Record<string, string> = {
  evm: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
  sol: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK",
  btc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
};
const refundFor = (chain: string) => SAMPLE_REFUND[EVM.includes(chain) ? "evm" : chain] ?? "";
const CHAIN: Record<string, string> = {
  eth: "Ethereum", arb: "Arbitrum", base: "Base", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche",
  sol: "Solana", btc: "Bitcoin", near: "NEAR", gnosis: "Gnosis", ton: "TON", tron: "Tron", sui: "Sui", aptos: "Aptos",
  stellar: "Stellar", zec: "Zcash", bera: "Berachain", scroll: "Scroll", starknet: "Starknet", monad: "Monad",
};
const chainName = (c: string) => CHAIN[c] ?? c.toUpperCase();
const PREFERRED = ["ETH@arb", "USDC@base", "SOL@sol", "BTC@btc", "ETH@eth", "USDT@eth", "USDC@sol", "ETH@base"];

let tokens: IntentsToken[] | null = null;

export function pay(agents: { id: string; name: string }[]) {
  const rows = (recorded.results as any[])
    .map((r) => {
      const o = r.outcome;
      if (!o.ok) return `<tr><td>${esc(r.label)}</td><td class="num muted">–</td><td class="num muted">–</td><td class="num muted">–</td><td><span class="pill s-bad">${esc(o.reason)}</span></td></tr>`;
      const q = o.response.quote;
      return `<tr><td>${esc(r.label)}</td><td class="num mono">${Number(q.amountInFormatted).toPrecision(6)}</td><td class="num mono">$${Number(q.amountInUsd).toFixed(2)}</td><td class="num mono">${q.timeEstimate}s</td><td><span class="pill s-done">Quoted</span></td></tr>`;
    })
    .join("");

  return `${head("Pay with any token", "A customer funds an order from another chain. NEAR Intents swaps to the exact USDC owed and delivers it to the LOCA contract with <code>ft_transfer_call</code>, which opens the order in the same step.")}
  <div class="notice">${ICON.shield}<div><b>Dry quotes only.</b> LOCA is not deployed on mainnet yet, and 1Click only quotes to existing mainnet accounts, so quotes go to the stand-in <code>${STAND_IN}</code>. Route, price and fees do not depend on the recipient. No deposit address is issued and no funds move.</div></div>
  <div class="grid g-12">
    <section class="card span-5"><div class="card-h"><h2>Checkout</h2></div><div class="card-b">
      <form id="pay-form" class="form">
        <label><span>Agent</span><select name="agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></label>
        <label><span>Order amount</span><div class="inp-suffix"><input name="amount" type="number" min="1" step="0.01" value="100" required /><span>USDC</span></div></label>
        <label><span>Pay with</span><select name="asset" id="asset"><option>Loading 1Click assets…</option></select></label>
        <label><span>Refund address <span class="muted">(on the origin chain, if the swap fails)</span></span><input name="refund" id="refund" class="mono" required /></label>
        <label><span>Your NEAR account <span class="muted">(customer of record)</span></span><input name="customer" class="mono" value="customer.near" required /></label>
        <button class="btn" type="submit" id="quote-btn">Get quote</button>
      </form>
    </div></section>
    <section class="card span-7"><div class="card-h"><h2>Quote</h2><span class="muted small" id="quote-time"></span></div><div class="card-b" id="quote-out">
      <div class="empty"><div class="empty-t">No quote yet</div><div class="muted">Pick a token and request a quote. It is fetched live from the 1Click API.</div></div>
    </div></section>
  </div>
  <section class="card"><div class="card-h"><h2>Recorded routes</h2><span class="muted small">${new Date(recorded.generatedAt).toUTCString()}</span></div><div class="card-b"><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Customer pays with</th><th class="num">Amount in</th><th class="num">≈ USD</th><th class="num">ETA</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="card-f">For an exact $100.00 USDC delivered to escrow. The two failures are deliberate: an unlisted token and an invalid refund address.</div></section>`;
}

export async function mountPay() {
  const form = document.querySelector("#pay-form") as HTMLFormElement | null;
  if (!form) return;
  const sel = form.querySelector("#asset") as HTMLSelectElement;
  const refund = form.querySelector("#refund") as HTMLInputElement;
  try {
    tokens ??= await listTokens();
  } catch {
    sel.innerHTML = "<option>1Click API unreachable</option>";
    return;
  }
  const usable = tokens.filter((t) => t.assetId !== NEAR_USDC);
  const key = (t: IntentsToken) => `${t.symbol}@${t.blockchain}`;
  const top = PREFERRED.map((k) => usable.find((t) => key(t) === k)).filter(Boolean) as IntentsToken[];
  const byChain = new Map<string, IntentsToken[]>();
  for (const t of usable) byChain.set(t.blockchain, [...(byChain.get(t.blockchain) ?? []), t]);
  const opt = (t: IntentsToken) => `<option value="${esc(t.assetId)}" data-chain="${esc(t.blockchain)}" data-symbol="${esc(t.symbol)}" data-dec="${t.decimals}">${esc(t.symbol)} on ${esc(chainName(t.blockchain))}</option>`;
  sel.innerHTML = `<optgroup label="Popular">${top.map(opt).join("")}</optgroup>${[...byChain.entries()]
    .sort((a, b) => chainName(a[0]).localeCompare(chainName(b[0])))
    .map(([c, ts]) => `<optgroup label="${esc(chainName(c))}">${ts.map(opt).join("")}</optgroup>`)
    .join("")}`;
  const syncRefund = () => {
    const chain = sel.selectedOptions[0]?.dataset.chain ?? "";
    refund.value = refundFor(chain);
    refund.placeholder = refund.value ? "" : `a ${chainName(chain)} address`;
  };
  sel.addEventListener("change", syncRefund);
  syncRefund();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const out = document.querySelector("#quote-out")!;
    const btn = form.querySelector("#quote-btn") as HTMLButtonElement;
    const option = sel.selectedOptions[0];
    const usdcOut = BigInt(Math.round(Number(f.get("amount")) * 1e6));
    const msg = fundOrderMsg({
      agentId: String(f.get("agent")), customerId: String(f.get("customer")),
      termsHash: "checkout", deadlineNs: BigInt(Date.now() + 86_400_000) * 1_000_000n,
    });
    const req = buildFundingQuote({ originAsset: String(f.get("asset")), usdcOut, refundTo: String(f.get("refund")), locaContract: STAND_IN, msg, dry: true });
    btn.disabled = true;
    btn.textContent = "Quoting…";
    out.innerHTML = `<div class="loading">Asking 1Click solvers for a route…</div>`;
    let res: QuoteOutcome;
    try {
      res = await requestQuote(req, tokens!);
    } catch (err) {
      res = { ok: false, reason: "QUOTE_REJECTED", message: String(err) };
    }
    btn.disabled = false;
    btn.textContent = "Get quote";
    document.querySelector("#quote-time")!.textContent = new Date().toLocaleTimeString();
    out.innerHTML = renderQuote(res, option?.dataset.symbol ?? "", option ? chainName(option.dataset.chain!) : "", msg);
  });
}

function renderQuote(r: QuoteOutcome, symbol: string, chain: string, msg: string) {
  if (!r.ok) {
    return `<div class="q-fail"><span class="pill s-bad">${esc(r.reason)}</span><p>${esc(r.message)}</p>
      <p class="muted small">${r.reason === "QUOTE_REJECTED" ? "1Click refused the request. Check the refund address matches the origin chain." : r.reason === "ROUTE_UNAVAILABLE" ? "No solver route for this asset." : "The quote failed LOCA's checks and would not be used."}</p></div>`;
  }
  const q = r.response.quote;
  return `<div class="q-main">
      <div><div class="k">Customer pays</div><div class="q-big mono">${Number(q.amountInFormatted).toPrecision(6)} <span>${esc(symbol)}</span></div><div class="muted">on ${esc(chain)} · ≈ $${Number(q.amountInUsd).toFixed(2)}</div></div>
      <div class="q-arrow">→</div>
      <div><div class="k">Escrow receives</div><div class="q-big mono">${esc(q.amountOutFormatted)} <span>USDC</span></div><div class="muted">exact output · ~${q.timeEstimate}s</div></div>
    </div>
    <ul class="checks">${r.checks.slice(0, 3).map((c) => `<li>${ICON.check}<span>${esc(c)}</span></li>`).join("")}
      <li>${ICON.check}<span>escrow message unchanged by the quoter</span></li></ul>
    <div class="k">Message passed to <code>ft_on_transfer</code></div>
    <pre class="code-block">${esc(JSON.stringify(JSON.parse(msg), null, 2))}</pre>`;
}
