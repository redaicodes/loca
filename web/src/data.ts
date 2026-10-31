// Live state from the LOCA market contract on testnet. Everything shown in the app comes from
// contract views; docs/swarm.json only supplies display names for the swarm's accounts.

import cast from "../../docs/swarm.json";
import demoRun from "../../docs/testnet-run.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type OrderStatus = "Funded" | "Delivered" | "Disputed" | "Released" | "Refunded";
export interface CreditRequest { amount: string; vendor_id: string; max_fee: string; expires_at: string }
export interface Order {
  id: number; agent_id: string; customer_id: string; amount: string; terms_hash: string; deadline: string;
  status: OrderStatus; created_at: string; delivered_at: string | null; deliverable_hash: string | null;
  credit_request: CreditRequest | null; offer_ids: number[]; loan_id: number | null; customer_refund: string;
}
export interface Offer {
  id: number; order_id: number; lender_id: string; principal: string; fee: string; expires_at: string;
  strategy: string; status: "Open" | "Accepted" | "Withdrawn"; created_at: string;
}
export interface Loan {
  id: number; order_id: number; offer_id: number; lender_id: string; agent_id: string; vendor_id: string;
  principal: string; fee: string; status: "Active" | "Repaid" | "Defaulted"; repaid: string;
  recovered_from_bond: string; created_at: string; closed_at: string | null;
}
export interface Stats {
  orders_received: number; orders_completed: number; orders_refunded: number; disputes_lost: number;
  unique_customers: number; revenue: string; loans_taken: number; loans_repaid: number;
  loans_repaid_with_bond: number; loans_defaulted: number; principal_repaid: string; default_loss: string;
}
export interface Agent {
  agent_id: string; operator_id: string; profile_hash: string; registered_at: string;
  policy: { allowed_vendors: string[]; max_principal: string }; policy_version: number;
  bond: string; active_loans: number; stats: Stats;
}
export interface ScoreReport {
  agent_id: string; version: string; score: number; rated: boolean;
  components: { name: string; weight_bps: number; value_bps: number }[]; reason_codes: string[];
}
export interface Config {
  owner_id: string; arbiter_id: string; token_id: string; paused: boolean;
  dispute_window_ns: string; max_advance_bps: number; approved_vendors: string[];
}
export interface Totals {
  orders: number; orders_settled: number; orders_refunded: number; orders_disputed: number;
  escrow_volume: string; escrow_held: string; offers_made: number; offers_open: string;
  loans: number; loans_repaid: number; loans_defaulted: number; originated: string; outstanding: string;
  repaid_to_lenders: string; fees_paid: string; default_loss: string; bonds_held: string; bond_drawn: string;
  agent_revenue: string; customer_refunds: string; claimable: string; deposits_rejected: number;
}
export interface Market { totals: Totals; agents: number; next_order_id: number; next_offer_id: number; next_loan_id: number; block_timestamp: string }
export interface AgentRecord { agent: Agent; score: ScoreReport }

export const CAST = cast;
export const CONTRACT = cast.contract;
export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";
export const EXPLORER_ACCOUNT = "https://testnet.nearblocks.io/address/";
/** The first demo run (contract v1) recorded the guardrail rejections as real testnet transactions. */
export const DEMO_RUN = demoRun as unknown as { steps: { act: string; title: string; tx?: string; error?: string }[]; contracts: { loca: string } };

// ---------------------------------------------------------------- RPC

// Free public endpoints rate-limit, so reads rotate across several.
const RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com", "https://archival-rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
let rr = 0;

// Free endpoints throttle bursts, so at most three requests are in flight at once.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rpc(method: string, params: object) {
  return slot(() => rpcOnce(method, params));
}

async function rpcOnce(method: string, params: object) {
  let last: unknown;
  for (let i = 0; i < RPCS.length * 2; i++) {
    if (i >= RPCS.length) await pause(400 * (i - RPCS.length + 1));
    const url = RPCS[rr++ % RPCS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "loca", method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      if (json.result?.error) return Promise.reject(new ContractView(json.result.error));
      return json.result;
    } catch (e) {
      if (e instanceof ContractView) throw e;
      last = e;
    }
  }
  throw last;
}
class ContractView extends Error {}

export async function view<T>(method: string, args: object = {}, contract = CONTRACT): Promise<T> {
  const r = await rpc("query", {
    request_type: "call_function", finality: "optimistic", account_id: contract,
    method_name: method, args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}

export async function latestBlock(): Promise<{ height: number; timestampNs: string }> {
  const r = await rpc("block", { finality: "final" });
  return { height: r.header.height, timestampNs: r.header.timestamp_nanosec };
}

// ---------------------------------------------------------------- store

export interface Store {
  market: Market;
  config: Config;
  agents: Map<string, AgentRecord>;
  orders: Map<number, Order>;
  offers: Map<number, Offer>;
  loans: Map<number, Loan>;
  loadedAt: Date;
}

async function range<T>(method: string, from: number, to: number): Promise<T[]> {
  const pages: Promise<T[]>[] = [];
  for (let i = from; i < to; i += 100) pages.push(view<T[]>(method, { from_id: i, limit: Math.min(100, to - i) }));
  return (await Promise.all(pages)).flat();
}

/** First load pulls a deeper history for charts; refreshes only re-read the recent tail. */
export async function loadStore(prev?: Store): Promise<Store> {
  const [market, config, agentList] = await Promise.all([
    view<Market>("get_market"),
    prev ? Promise.resolve(prev.config) : view<Config>("get_config"),
    view<{ agent: Agent; score: ScoreReport }[]>("get_agents", { from_index: 0, limit: 100 }),
  ]);
  const depth = prev ? 60 : 200;
  const [orders, offers, loans] = await Promise.all([
    range<Order>("get_orders", Math.max(0, market.next_order_id - depth), market.next_order_id),
    range<Offer>("get_offer_list", Math.max(0, market.next_offer_id - depth * 2), market.next_offer_id),
    range<Loan>("get_loans", Math.max(0, market.next_loan_id - depth), market.next_loan_id),
  ]);
  const s: Store = {
    market, config,
    agents: new Map(agentList.map((a) => [a.agent.agent_id, a])),
    orders: new Map(prev?.orders), offers: new Map(prev?.offers), loans: new Map(prev?.loans),
    loadedAt: new Date(),
  };
  for (const o of orders) s.orders.set(o.id, o);
  for (const o of offers) s.offers.set(o.id, o);
  for (const l of loans) s.loans.set(l.id, l);
  return s;
}

// ---------------------------------------------------------------- live feed

export type FeedKind = "order" | "request" | "bid" | "loan" | "delivered" | "settled" | "refunded" | "disputed" | "default";
export interface FeedItem { key: string; kind: FeedKind; at: number; text: string; orderId: number; from?: string; to?: string; via?: string; amount?: number }

const ns = (v: string | null | undefined) => (v ? Number(BigInt(v) / 1_000_000n) : 0);

/** Market events reconstructed from contract state, newest first. Timestamps are block times where the
 *  contract stores one; settlements of unlevered orders are stamped when first observed. */
export function deriveFeed(s: Store, seen: Map<string, number>, label: (id: string) => string): FeedItem[] {
  const items: FeedItem[] = [];
  const push = (it: Omit<FeedItem, "at"> & { at?: number }) => {
    const at = it.at || seen.get(it.key) || Date.now();
    if (!seen.has(it.key)) seen.set(it.key, at);
    items.push({ ...it, at });
  };
  for (const o of s.orders.values()) {
    const amt = Number(o.amount) / 1e6;
    push({ key: `o${o.id}`, kind: "order", at: ns(o.created_at), orderId: o.id, from: o.customer_id, to: o.agent_id, amount: amt,
      text: `${label(o.customer_id)} escrowed $${amt.toFixed(2)} for ${label(o.agent_id)}` });
    if (o.credit_request) {
      push({ key: `r${o.id}`, kind: "request", orderId: o.id, from: o.agent_id, amount: Number(o.credit_request.amount) / 1e6,
        at: seen.get(`r${o.id}`) ?? (ns(o.created_at) + 2000),
        text: `${label(o.agent_id)} asked for $${(Number(o.credit_request.amount) / 1e6).toFixed(2)} against #${o.id}` });
    }
    if (o.delivered_at) push({ key: `d${o.id}`, kind: "delivered", at: ns(o.delivered_at), orderId: o.id, from: o.agent_id, to: o.customer_id, text: `${label(o.agent_id)} delivered #${o.id}` });
    if (o.status === "Disputed") push({ key: `x${o.id}`, kind: "disputed", orderId: o.id, from: o.customer_id, text: `${label(o.customer_id)} disputed #${o.id}` });
    if (o.status === "Released" || o.status === "Refunded") {
      const loan = o.loan_id !== null ? s.loans.get(o.loan_id) : undefined;
      const at = loan?.closed_at ? ns(loan.closed_at) : seen.get(`s${o.id}`) ?? (o.delivered_at ? ns(o.delivered_at) + 5000 : ns(o.deadline));
      const refund = Number(o.customer_refund) / 1e6;
      if (loan?.status === "Defaulted") {
        push({ key: `s${o.id}`, kind: "default", at, orderId: o.id, from: o.agent_id, to: loan.lender_id,
          text: `Loan on #${o.id} defaulted; bond covered $${(Number(loan.recovered_from_bond) / 1e6).toFixed(2)}` });
      } else if (o.status === "Refunded") {
        push({ key: `s${o.id}`, kind: "refunded", at, orderId: o.id, from: o.agent_id, to: o.customer_id, amount: refund, text: `#${o.id} refunded to ${label(o.customer_id)}` });
      } else {
        const toLender = loan ? Number(loan.repaid) / 1e6 : 0;
        push({ key: `s${o.id}`, kind: "settled", at, orderId: o.id, from: o.agent_id, to: loan?.lender_id, amount: toLender,
          text: loan ? `#${o.id} settled: $${toLender.toFixed(2)} back to ${label(loan.lender_id)}` : `#${o.id} settled: $${(amt - refund).toFixed(2)} to ${label(o.agent_id)}` });
      }
    }
  }
  for (const f of s.offers.values()) {
    push({ key: `b${f.id}`, kind: "bid", at: ns(f.created_at), orderId: f.order_id, from: f.lender_id, amount: Number(f.fee) / 1e6,
      text: `${label(f.lender_id)} bid $${(Number(f.fee) / 1e6).toFixed(2)} on #${f.order_id}` });
  }
  for (const l of s.loans.values()) {
    push({ key: `l${l.id}`, kind: "loan", at: ns(l.created_at), orderId: l.order_id, from: l.lender_id, to: l.vendor_id, via: l.agent_id, amount: Number(l.principal) / 1e6,
      text: `${label(l.lender_id)} funded $${(Number(l.principal) / 1e6).toFixed(2)} to ${label(l.vendor_id)} for ${label(l.agent_id)}` });
  }
  return items.sort((a, b) => b.at - a.at);
}
