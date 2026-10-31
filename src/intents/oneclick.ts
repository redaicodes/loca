// NEAR Intents 1Click adapter: fund a LOCA order (or lender offer) from any routable token.
//
// The quote asks for EXACT_OUTPUT of USDC on NEAR, delivered to the LOCA contract with
// `customRecipientMsg`, so 1Click withdraws via `ft_transfer_call` and the deposit lands
// directly in escrow as an order owned by `customer_id`. LOCA credits funds only when tokens
// actually arrive in `ft_on_transfer`, so a duplicate status callback can never credit twice.
// There is no Intents testnet: real execution is mainnet-only; `dry: true` quotes are free.

// `process` is absent in the browser; the dashboard imports this module too.
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
export const ONECLICK_URL = ENV.ONECLICK_URL ?? "https://1click.chaindefuser.com";
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export interface IntentsToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  customRecipientMsg?: string;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeEstimate: number;
  withdrawFee?: string;
  refundFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING"
  | "SUCCESS" | "REFUNDED" | "FAILED";

export interface StatusResponse {
  status: SwapStatus;
  updatedAt: string;
  quoteResponse: QuoteResponse;
  swapDetails: {
    amountOut?: string;
    refundedAmount?: string;
    refundReason?: string;
    nearTxHashes: string[];
    originChainTxHashes: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes: { hash: string; explorerUrl: string }[];
  };
}

export type QuoteOutcome =
  | { ok: true; response: QuoteResponse; checks: string[] }
  | { ok: false; reason: "ROUTE_UNAVAILABLE" | "QUOTE_REJECTED" | "POLICY_VIOLATION"; message: string };

export interface FundingPolicy {
  /** Largest slippage tolerance we will request, in bps. */
  maxSlippageBps: number;
  /** Minimum time a live quote must stay valid, in seconds. */
  minValiditySec: number;
}

export const DEFAULT_POLICY: FundingPolicy = { maxSlippageBps: 100, minValiditySec: 300 };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ENV.ONECLICK_JWT) headers.Authorization = `Bearer ${ENV.ONECLICK_JWT}`;
  const res = await fetch(`${ONECLICK_URL}${path}`, { ...init, headers });
  const body = await res.text();
  if (!res.ok) throw new OneClickError(res.status, body);
  return JSON.parse(body) as T;
}

export class OneClickError extends Error {
  constructor(readonly status: number, readonly body: string) {
    let msg = body;
    try {
      msg = JSON.parse(body).message ?? body;
    } catch {}
    super(`1Click ${status}: ${msg}`);
  }
}

export const listTokens = () => api<IntentsToken[]>("/v0/tokens");

export function findAsset(tokens: IntentsToken[], symbol: string, blockchain: string): IntentsToken | undefined {
  return tokens.find((t) => t.symbol === symbol && t.blockchain === blockchain);
}

/** The LOCA message 1Click passes to `ft_transfer_call` on the LOCA contract. */
export function fundOrderMsg(p: { agentId: string; customerId: string; termsHash: string; deadlineNs: bigint }): string {
  return JSON.stringify({
    FundOrder: { agent_id: p.agentId, terms_hash: p.termsHash, deadline: p.deadlineNs.toString(), customer_id: p.customerId },
  });
}

export function buildFundingQuote(p: {
  originAsset: string;
  /** Exact USDC (6 decimals) that must arrive in escrow. */
  usdcOut: bigint;
  refundTo: string;
  locaContract: string;
  msg: string;
  dry: boolean;
  slippageBps?: number;
  validitySec?: number;
}): QuoteRequest {
  return {
    dry: p.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: p.slippageBps ?? 100,
    originAsset: p.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: p.usdcOut.toString(),
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.locaContract,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + (p.validitySec ?? 1800) * 1000).toISOString(),
    customRecipientMsg: p.msg,
  };
}

/** Validate a quote against what the escrow needs before showing or executing it. */
export function checkQuote(req: QuoteRequest, res: QuoteResponse, policy = DEFAULT_POLICY): string[] {
  const problems: string[] = [];
  if (req.slippageTolerance > policy.maxSlippageBps) problems.push(`slippage ${req.slippageTolerance}bps > max ${policy.maxSlippageBps}bps`);
  if (BigInt(res.quote.minAmountOut) < BigInt(req.amount)) {
    problems.push(`minAmountOut ${res.quote.minAmountOut} below required ${req.amount}`);
  }
  if (res.quoteRequest.recipient !== req.recipient) problems.push("recipient changed by quoter");
  if (res.quoteRequest.customRecipientMsg !== req.customRecipientMsg) problems.push("escrow message changed by quoter");
  if (!req.dry) {
    if (!res.quote.depositAddress) problems.push("live quote without deposit address");
    const deadline = res.quote.deadline ? Date.parse(res.quote.deadline) : 0;
    if (deadline - Date.now() < policy.minValiditySec * 1000) problems.push("quote expires too soon");
  }
  return problems;
}

export async function requestQuote(req: QuoteRequest, tokens?: IntentsToken[], policy = DEFAULT_POLICY): Promise<QuoteOutcome> {
  if (tokens && !tokens.some((t) => t.assetId === req.originAsset)) {
    return { ok: false, reason: "ROUTE_UNAVAILABLE", message: `${req.originAsset} is not in the 1Click asset registry` };
  }
  let response: QuoteResponse;
  try {
    response = await api<QuoteResponse>("/v0/quote", { method: "POST", body: JSON.stringify(req) });
  } catch (e) {
    if (e instanceof OneClickError) return { ok: false, reason: "QUOTE_REJECTED", message: e.message };
    throw e;
  }
  const problems = checkQuote(req, response, policy);
  if (problems.length) return { ok: false, reason: "POLICY_VIOLATION", message: problems.join("; ") };
  return {
    ok: true,
    response,
    checks: [
      `delivers exactly ${response.quote.amountOutFormatted} USDC to ${req.recipient}`,
      `pay ${response.quote.amountInFormatted} (~$${Number(response.quote.amountInUsd).toFixed(2)}), at least ${response.quote.minAmountIn} base units`,
      `withdraw fee ${response.quote.withdrawFee ?? "0"} (already included)`,
      `escrow message: ${req.customRecipientMsg}`,
    ],
  };
}

export const getStatus = (depositAddress: string, depositMemo?: string) =>
  api<StatusResponse>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}${depositMemo ? `&depositMemo=${encodeURIComponent(depositMemo)}` : ""}`);

export type FundingState =
  | { kind: "waiting"; status: SwapStatus }
  | { kind: "delivered"; amountOut: string; nearTxHashes: string[] }
  | { kind: "refunded"; amount: string; reason: string }
  | { kind: "failed"; reason: string };

/** Map a 1Click status to what LOCA should do. Only SUCCESS means escrow was funded. */
export function interpretStatus(s: StatusResponse): FundingState {
  switch (s.status) {
    case "SUCCESS":
      return { kind: "delivered", amountOut: s.swapDetails.amountOut ?? "0", nearTxHashes: s.swapDetails.nearTxHashes };
    case "REFUNDED":
      return { kind: "refunded", amount: s.swapDetails.refundedAmount ?? "0", reason: s.swapDetails.refundReason ?? "unknown" };
    case "FAILED":
      return { kind: "failed", reason: s.swapDetails.refundReason ?? "swap failed" };
    default:
      return { kind: "waiting", status: s.status };
  }
}

export async function waitForFunding(depositAddress: string, opts: { timeoutMs?: number; intervalMs?: number; onUpdate?: (s: FundingState) => void } = {}): Promise<FundingState> {
  const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  let last = "";
  while (Date.now() < until) {
    const state = interpretStatus(await getStatus(depositAddress));
    const key = JSON.stringify(state);
    if (key !== last) opts.onUpdate?.(state);
    last = key;
    if (state.kind !== "waiting") return state;
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 5_000));
  }
  return { kind: "failed", reason: "timed out waiting for 1Click status" };
}
