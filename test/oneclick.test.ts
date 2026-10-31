import { describe, expect, it } from "vitest";
import { buildFundingQuote, checkQuote, fundOrderMsg, interpretStatus, NEAR_USDC, type QuoteResponse, type StatusResponse } from "../src/intents/oneclick.js";

const msg = fundOrderMsg({ agentId: "agent.near", customerId: "cust.near", termsHash: "h", deadlineNs: 5n });
const req = buildFundingQuote({ originAsset: "nep141:arb.omft.near", usdcOut: 100_000_000n, refundTo: "0xabc", locaContract: "loca.near", msg, dry: false });

function res(o: Partial<QuoteResponse["quote"]> = {}, r: Partial<typeof req> = {}): QuoteResponse {
  return {
    correlationId: "c", timestamp: "t", signature: "s", quoteRequest: { ...req, ...r },
    quote: {
      depositAddress: "0xdeposit", amountIn: "1", amountInFormatted: "1", amountInUsd: "101", minAmountIn: "1",
      amountOut: "100000000", amountOutFormatted: "100", amountOutUsd: "100", minAmountOut: "100000000",
      deadline: new Date(Date.now() + 3_600_000).toISOString(), timeEstimate: 20, ...o,
    },
  };
}

describe("1Click adapter", () => {
  it("builds an exact-output USDC quote into LOCA with the escrow message", () => {
    expect(req.swapType).toBe("EXACT_OUTPUT");
    expect(req.destinationAsset).toBe(NEAR_USDC);
    expect(req.recipient).toBe("loca.near");
    expect(JSON.parse(req.customRecipientMsg!).FundOrder.customer_id).toBe("cust.near");
  });

  it("accepts a quote that delivers the full amount", () => {
    expect(checkQuote(req, res())).toEqual([]);
  });

  it("rejects short delivery, tampered message, missing deposit address and near expiry", () => {
    expect(checkQuote(req, res({ minAmountOut: "99000000" }))[0]).toMatch(/minAmountOut/);
    expect(checkQuote(req, res({}, { customRecipientMsg: "{}" }))).toContain("escrow message changed by quoter");
    expect(checkQuote(req, res({ depositAddress: undefined }))).toContain("live quote without deposit address");
    expect(checkQuote(req, res({ deadline: new Date(Date.now() + 60_000).toISOString() }))).toContain("quote expires too soon");
  });

  it("only SUCCESS counts as funded", () => {
    const s = (status: StatusResponse["status"], d: Partial<StatusResponse["swapDetails"]> = {}): StatusResponse => ({
      status, updatedAt: "", quoteResponse: res(),
      swapDetails: { nearTxHashes: ["h"], originChainTxHashes: [], destinationChainTxHashes: [], ...d },
    });
    expect(interpretStatus(s("PROCESSING")).kind).toBe("waiting");
    expect(interpretStatus(s("INCOMPLETE_DEPOSIT")).kind).toBe("waiting");
    expect(interpretStatus(s("SUCCESS", { amountOut: "100000000" }))).toEqual({ kind: "delivered", amountOut: "100000000", nearTxHashes: ["h"] });
    expect(interpretStatus(s("REFUNDED", { refundedAmount: "5", refundReason: "PARTIAL_DEPOSIT" }))).toEqual({ kind: "refunded", amount: "5", reason: "PARTIAL_DEPOSIT" });
    expect(interpretStatus(s("FAILED")).kind).toBe("failed");
  });
});
