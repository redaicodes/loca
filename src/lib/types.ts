// Mirrors contracts/loca/src/types.rs and score.rs (JSON shapes). U128/U64 arrive as strings.

export type U128 = string;
export type U64 = string;

export interface SpendPolicy {
  allowed_vendors: string[];
  max_principal: U128;
}

export interface Stats {
  orders_received: number;
  orders_completed: number;
  orders_refunded: number;
  disputes_lost: number;
  unique_customers: number;
  revenue: U128;
  loans_taken: number;
  loans_repaid: number;
  loans_repaid_with_bond: number;
  loans_defaulted: number;
  principal_repaid: U128;
  default_loss: U128;
}

export interface Agent {
  agent_id: string;
  operator_id: string;
  profile_hash: string;
  registered_at: U64;
  policy: SpendPolicy;
  policy_version: number;
  bond: U128;
  active_loans: number;
  stats: Stats;
}

export type OrderStatus = "Funded" | "Delivered" | "Disputed" | "Released" | "Refunded";

export interface CreditRequest {
  amount: U128;
  vendor_id: string;
  max_fee: U128;
  expires_at: U64;
}

export interface Order {
  id: number;
  agent_id: string;
  customer_id: string;
  amount: U128;
  terms_hash: string;
  deadline: U64;
  status: OrderStatus;
  created_at: U64;
  delivered_at: U64 | null;
  deliverable_hash: string | null;
  credit_request: CreditRequest | null;
  offer_ids: number[];
  loan_id: number | null;
  customer_refund: U128;
}

export interface Offer {
  id: number;
  order_id: number;
  lender_id: string;
  principal: U128;
  fee: U128;
  expires_at: U64;
  strategy: string;
  status: "Open" | "Accepted" | "Withdrawn";
  created_at: U64;
}

export interface Loan {
  id: number;
  order_id: number;
  offer_id: number;
  lender_id: string;
  agent_id: string;
  vendor_id: string;
  principal: U128;
  fee: U128;
  status: "Active" | "Repaid" | "Defaulted";
  repaid: U128;
  recovered_from_bond: U128;
  created_at: U64;
  closed_at: U64 | null;
}

export interface ScoreComponent {
  name: string;
  weight_bps: number;
  value_bps: number;
}

export interface ScoreReport {
  agent_id: string;
  version: string;
  score: number;
  rated: boolean;
  components: ScoreComponent[];
  reason_codes: string[];
}

export interface Config {
  owner_id: string;
  arbiter_id: string;
  token_id: string;
  paused: boolean;
  dispute_window_ns: U64;
  max_advance_bps: number;
  approved_vendors: string[];
}

export interface LocaEvent {
  event: string;
  data: Record<string, unknown>;
}

/** USDC-style 6-decimal amounts. */
export const DECIMALS = 6;
export const usd = (x: number): bigint => BigInt(Math.round(x * 10 ** DECIMALS));
export const fmtUsd = (raw: string | bigint): string => {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  return `$${(Number(v) / 10 ** DECIMALS).toFixed(2)}`;
};
