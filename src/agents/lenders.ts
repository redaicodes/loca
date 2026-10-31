// Three lender strategies. Each is a pure, deterministic function of public onchain data
// (order, credit request, agent profile, score report) plus the lender's own book.
// They are demo strategies on an open market, not independent competitors.

import type { Agent, CreditRequest, Order, ScoreReport } from "../lib/types.js";

export interface BidContext {
  order: Order;
  request: CreditRequest;
  agent: Agent;
  score: ScoreReport;
  /** Principal this lender already has outstanding to the same agent. */
  exposureToAgent: bigint;
}

export type BidDecision =
  | { bid: true; feeBps: number; fee: bigint; rationale: string[] }
  | { bid: false; rationale: string[] };

export interface LenderStrategy {
  id: string;
  label: string;
  decide(ctx: BidContext): BidDecision;
}

const component = (s: ScoreReport, name: string) =>
  s.components.find((c) => c.name === name)?.value_bps ?? 0;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function finish(ctx: BidContext, feeBps: number, rationale: string[]): BidDecision {
  const principal = BigInt(ctx.request.amount);
  const fee = (principal * BigInt(Math.round(feeBps))) / 10_000n;
  if (fee > BigInt(ctx.request.max_fee)) {
    return { bid: false, rationale: [...rationale, `fee ${feeBps}bps exceeds borrower max`] };
  }
  return { bid: true, feeBps: Math.round(feeBps), fee, rationale };
}

/** Prices mainly against escrow coverage; wants a bond from unrated agents. */
export const escrowCoverage: LenderStrategy = {
  id: "escrow-coverage",
  label: "Conservative / escrow coverage",
  decide(ctx) {
    const principal = Number(ctx.request.amount);
    const coverage = Number(ctx.order.amount) / principal;
    const bondRatio = Number(ctx.agent.bond) / principal;
    const r = [`escrow coverage ${coverage.toFixed(2)}x`, `bond ${(bondRatio * 100).toFixed(0)}% of principal`];
    if (coverage < 2) return { bid: false, rationale: [...r, "coverage below 2x"] };
    if (!ctx.score.rated && bondRatio < 0.2) return { bid: false, rationale: [...r, "unrated and bond < 20%"] };
    const fee = 600 - 100 * clamp(coverage - 2, 0, 2) - Math.max(0, ctx.score.score - 600) / 2;
    return finish(ctx, fee, r);
  },
};

/** Rewards clean repayment history most; refuses agents with a default on record. */
export const repaymentHistory: LenderStrategy = {
  id: "repayment-history",
  label: "History-weighted / repayment first",
  decide(ctx) {
    const s = ctx.agent.stats;
    const r = [`repaid ${s.loans_repaid}, defaulted ${s.loans_defaulted}`];
    if (s.loans_defaulted > 0) return { bid: false, rationale: [...r, "default on record"] };
    if (s.orders_completed < 3) return { bid: false, rationale: [...r, "fewer than 3 completed orders"] };
    const fee = 700 - (component(ctx.score, "repayment_history") * 400) / 10_000
      - (component(ctx.score, "fulfillment") * 100) / 10_000;
    return finish(ctx, fee, r);
  },
};

/** Caps exposure per agent and charges more for concentrated customer bases. */
export const concentrationAware: LenderStrategy = {
  id: "concentration-aware",
  label: "Concentration-aware / exposure capped",
  decide(ctx) {
    const cap = 60_000_000n; // $60 per agent
    const principal = BigInt(ctx.request.amount);
    const r = [`exposure to agent ${ctx.exposureToAgent} + ${principal} vs cap ${cap}`];
    if (ctx.exposureToAgent + principal > cap) return { bid: false, rationale: [...r, "exposure cap reached"] };
    let fee = 900 - ctx.score.score * 0.6;
    if (ctx.score.reason_codes.includes("CUSTOMER_CONCENTRATION")) {
      fee += 200;
      r.push("customer concentration +200bps");
    }
    return finish(ctx, fee, r);
  },
};

export const STRATEGIES: LenderStrategy[] = [escrowCoverage, repaymentHistory, concentrationAware];
