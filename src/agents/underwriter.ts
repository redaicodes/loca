// An AI underwriter: a lender agent that asks a model on NEAR AI Cloud whether to fund a credit request
// and at what fee. It sees what any lender sees (the order, the request, the agent's onchain stats and
// score report, its own exposure) and must answer in a fixed JSON shape. The answer is checked before it is
// used: a malformed reply, a fee outside 0.5%-20% or above the borrower's cap means no bid. The contract
// still enforces every rule, so a confused or manipulated model can at worst skip a loan or overprice one.
//
// Runs in Node and in the Cloudflare Worker (fetch only).

import { defaultRate, type BidContext, type BidDecision } from "./lenders.js";

export const UNDERWRITER_STRATEGY = "ai-underwriter";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5-5";
const MIN_BPS = 50;
const MAX_BPS = 2_000;

export interface UnderwriterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const SYSTEM = `You underwrite short loans to AI agents on the Loca credit market. A customer has already paid the agent's order into escrow. The agent asks for an advance against it, paid straight to a vendor. When the customer approves the work, the escrow repays the lender (principal + fee) before the agent gets anything; if the order fails, the operator's first-loss bond covers the shortfall before the lender loses money.
Price the loan as an annualised-agnostic flat fee in basis points of principal, for a loan that lasts minutes. Expected loss should be covered, then a margin. Decline when the risk is not worth it.
Reply with JSON only: {"bid": true|false, "fee_bps": integer, "reason": "one short sentence citing the numbers that drove the decision"}.`;

/** The facts the model sees: public onchain data only, amounts in USD. */
export function underwritingFacts(ctx: BidContext) {
  const usd = (v: string | bigint) => Number(BigInt(v)) / 1e6;
  const s = ctx.agent.stats;
  return {
    order_escrow_usd: usd(ctx.order.amount),
    requested_principal_usd: usd(ctx.request.amount),
    borrower_max_fee_usd: usd(ctx.request.max_fee),
    escrow_coverage_x: +(Number(ctx.order.amount) / Number(ctx.request.amount)).toFixed(2),
    first_loss_bond_usd: usd(ctx.agent.bond),
    open_loans: ctx.agent.active_loans,
    loca_score: ctx.score.score,
    rated: ctx.score.rated,
    score_components: Object.fromEntries(ctx.score.components.map((c) => [c.name, c.value_bps / 100])),
    reason_codes: ctx.score.reason_codes,
    orders_completed: s.orders_completed,
    orders_refunded: s.orders_refunded,
    disputes_lost: s.disputes_lost,
    unique_customers: s.unique_customers,
    loans_repaid: s.loans_repaid,
    loans_repaid_with_bond: s.loans_repaid_with_bond,
    loans_defaulted: s.loans_defaulted,
    default_rate_pct: +(defaultRate(ctx.agent) * 100).toFixed(2),
    my_exposure_to_agent_usd: usd(ctx.exposureToAgent),
  };
}

/** Turn a model reply into a bid, or a refusal if anything about it is off. */
export function parseDecision(ctx: BidContext, reply: string): BidDecision {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  let d: { bid?: unknown; fee_bps?: unknown; reason?: unknown };
  try {
    d = JSON.parse(json ?? "");
  } catch {
    return { bid: false, rationale: ["model reply was not JSON"] };
  }
  const reason = typeof d.reason === "string" ? d.reason.slice(0, 200) : "no reason given";
  if (d.bid !== true) return { bid: false, rationale: [`model declined: ${reason}`] };
  const bps = Number(d.fee_bps);
  if (!Number.isInteger(bps) || bps < MIN_BPS || bps > MAX_BPS) return { bid: false, rationale: [`model fee ${String(d.fee_bps)}bps outside ${MIN_BPS}-${MAX_BPS}`] };
  const fee = (BigInt(ctx.request.amount) * BigInt(bps)) / 10_000n;
  if (fee > BigInt(ctx.request.max_fee)) return { bid: false, rationale: [reason, `fee ${bps}bps exceeds borrower max`] };
  return { bid: true, feeBps: bps, fee, rationale: [reason] };
}

export async function underwrite(ctx: BidContext, opts: UnderwriterOptions): Promise<BidDecision & { model: string }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const res = await (opts.fetch ?? fetch)(`${opts.baseUrl ?? "https://cloud-api.near.ai/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model,
      // The model reasons before it answers; 200 tokens ran out before the JSON.
      max_tokens: 1_500,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(underwritingFacts(ctx)) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { ...parseDecision(ctx, body.choices?.[0]?.message?.content ?? ""), model };
}
