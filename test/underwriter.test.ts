import { describe, expect, it } from "vitest";
import type { BidContext } from "../src/agents/lenders.js";
import { parseDecision, underwrite, underwritingFacts } from "../src/agents/underwriter.js";
import type { Agent, Order, ScoreReport } from "../src/lib/types.js";

const request = { amount: "30000000", vendor_id: "vendor", max_fee: "3000000", expires_at: "0" };
const ctx: BidContext = {
  order: { id: 1, amount: "100000000", credit_request: request } as unknown as Order,
  request,
  agent: {
    bond: "10000000", active_loans: 0,
    stats: {
      orders_received: 40, orders_completed: 38, orders_refunded: 1, disputes_lost: 1, unique_customers: 9,
      revenue: "0", loans_taken: 30, loans_repaid: 28, loans_repaid_with_bond: 1, loans_defaulted: 1,
      principal_repaid: "0", default_loss: "0",
    },
  } as unknown as Agent,
  score: { agent_id: "a", version: "v0", score: 742, rated: true, reason_codes: [], components: [{ name: "repayment_history", weight_bps: 2500, value_bps: 9300 }] } as ScoreReport,
  exposureToAgent: 0n,
};

describe("AI underwriter", () => {
  it("shows the model only public facts, in dollars", () => {
    const f = underwritingFacts(ctx);
    expect(f.requested_principal_usd).toBe(30);
    expect(f.escrow_coverage_x).toBe(3.33);
    expect(f.default_rate_pct).toBe(3.45);
    expect(f.score_components.repayment_history).toBe(93);
  });

  it("turns a well-formed reply into a bid", () => {
    const d = parseDecision(ctx, 'Sure: {"bid": true, "fee_bps": 420, "reason": "3.3x coverage, 1 default in 29"}');
    expect(d.bid).toBe(true);
    if (d.bid) expect(d.fee).toBe(1_260_000n);
  });

  it("refuses anything malformed, out of range or above the borrower's cap", () => {
    for (const reply of [
      "I think we should lend.",
      '{"bid": true, "fee_bps": 0, "reason": "free money"}',
      '{"bid": true, "fee_bps": 99999, "reason": "x"}',
      '{"bid": true, "fee_bps": 12.5, "reason": "x"}',
      '{"bid": true, "fee_bps": 1500, "reason": "15% is above the $3 cap on $30"}',
      '{"bid": "yes", "fee_bps": 300}',
    ]) expect(parseDecision(ctx, reply).bid).toBe(false);
  });

  it("calls NEAR AI Cloud's OpenAI-compatible endpoint", async () => {
    let sent: { url: string; body: { model: string; messages: { content: string }[] } } | undefined;
    const fake = (async (url: string, init: { body: string }) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"bid":false,"fee_bps":0,"reason":"bond too thin"}' } }] }));
    }) as unknown as typeof fetch;
    const d = await underwrite(ctx, { apiKey: "k", fetch: fake });
    expect(sent!.url).toBe("https://cloud-api.near.ai/v1/chat/completions");
    expect(JSON.parse(sent!.body.messages[1].content).loca_score).toBe(742);
    expect(d.bid).toBe(false);
    expect(d.rationale[0]).toContain("bond too thin");
  });
});
