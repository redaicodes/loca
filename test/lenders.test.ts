import { describe, expect, it } from "vitest";
import { concentrationAware, escrowCoverage, repaymentHistory, type BidContext } from "../src/agents/lenders.js";
import { parseEvents } from "../src/lib/near.js";
import type { Agent, Order, ScoreReport } from "../src/lib/types.js";

const stats = (o: Partial<Agent["stats"]> = {}): Agent["stats"] => ({
  orders_received: 3, orders_completed: 3, orders_refunded: 0, disputes_lost: 0, unique_customers: 3,
  revenue: "60000000", loans_taken: 0, loans_repaid: 0, loans_repaid_with_bond: 0, loans_defaulted: 0,
  principal_repaid: "0", default_loss: "0", ...o,
});

function ctx(score: number, o: { rated?: boolean; repayment?: number; codes?: string[]; bond?: string; s?: Partial<Agent["stats"]>; exposure?: bigint } = {}): BidContext {
  const request = { amount: "30000000", vendor_id: "vendor", max_fee: "3000000", expires_at: "0" };
  const order = { id: 1, amount: "100000000", credit_request: request } as unknown as Order;
  const agent = { bond: o.bond ?? "5000000", stats: stats(o.s) } as unknown as Agent;
  const report: ScoreReport = {
    agent_id: "a", version: "v0", score, rated: o.rated ?? true, reason_codes: o.codes ?? [],
    components: [
      { name: "repayment_history", weight_bps: 2500, value_bps: o.repayment ?? 5000 },
      { name: "fulfillment", weight_bps: 2000, value_bps: 10000 },
    ],
  };
  return { order, request, agent, score: report, exposureToAgent: o.exposure ?? 0n };
}

describe("lender strategies", () => {
  it("every strategy prices a better score at a lower or equal fee", () => {
    for (const s of [escrowCoverage, repaymentHistory, concentrationAware]) {
      const a = s.decide(ctx(620));
      const b = s.decide(ctx(747, { repayment: 10000 }));
      expect(a.bid && b.bid).toBe(true);
      if (a.bid && b.bid) expect(b.fee).toBeLessThanOrEqual(a.fee);
    }
  });

  it("repayment-history refuses an agent with a default", () => {
    expect(repaymentHistory.decide(ctx(700, { s: { loans_defaulted: 1 } })).bid).toBe(false);
  });

  it("escrow-coverage refuses unrated agents without a bond", () => {
    expect(escrowCoverage.decide(ctx(500, { rated: false, bond: "0" })).bid).toBe(false);
    expect(escrowCoverage.decide(ctx(500, { rated: false, bond: "10000000" })).bid).toBe(true);
  });

  it("concentration-aware respects its exposure cap and penalises concentration", () => {
    expect(concentrationAware.decide(ctx(700, { exposure: 40_000_000n })).bid).toBe(false);
    const plain = concentrationAware.decide(ctx(700));
    const conc = concentrationAware.decide(ctx(700, { codes: ["CUSTOMER_CONCENTRATION"] }));
    if (plain.bid && conc.bid) expect(conc.fee).toBeGreaterThan(plain.fee);
  });

  it("never bids above the borrower's max fee", () => {
    const d = concentrationAware.decide(ctx(0, { codes: ["CUSTOMER_CONCENTRATION"] }));
    expect(d.bid).toBe(false);
  });
});

describe("event parsing", () => {
  it("keeps only LOCA NEP-297 events", () => {
    const logs = [
      'EVENT_JSON:{"standard":"loca","version":"0.1.0","event":"loan_repaid","data":[{"loan_id":0}]}',
      'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{}]}',
      "plain log",
    ];
    expect(parseEvents(logs)).toEqual([{ event: "loan_repaid", data: { loan_id: 0 } }]);
  });
});
