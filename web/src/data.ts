// Live state from the LOCA contract on testnet, plus the demo run log for history the contract
// does not index (events, tx hashes, delivered reports, score snapshots).

import run from "../../docs/testnet-run.json";

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
  policy: { allowed_vendors: string[]; max_principal: string } | null; policy_version: number;
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
export interface Step { act: string; title: string; tx?: string; error?: string; detail?: any; events?: { event: string; data: any }[] }

export const RUN = run as unknown as {
  network: string; explorer: string; generatedAt: string;
  contracts: { loca: string; token: string };
  finalState: { agent: Agent; score: ScoreReport };
  steps: Step[];
};
export const CONTRACT = RUN.contracts.loca;
export const EXPLORER_TX = RUN.explorer;
export const EXPLORER_ACCOUNT = "https://testnet.nearblocks.io/address/";
// FastNEAR answers in under a second; the official endpoint takes ~3s, so it is only the fallback.
const RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];

async function rpcAt(url: string, method: string, params: object) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "loca", method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error));
  return json.result;
}

async function rpc(method: string, params: object) {
  try {
    return await rpcAt(RPCS[0], method, params);
  } catch {
    return rpcAt(RPCS[1], method, params);
  }
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const r = await rpc("query", {
    request_type: "call_function", finality: "final", account_id: CONTRACT,
    method_name: method, args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}

export async function latestBlock(): Promise<{ height: number; timestampNs: string }> {
  const r = await rpc("block", { finality: "final" });
  return { height: r.header.height, timestampNs: r.header.timestamp_nanosec };
}

export interface AgentRecord { agent: Agent; score: ScoreReport | null }
export interface Store {
  config: Config;
  agents: Map<string, AgentRecord>;
  orders: Order[];
  offers: Offer[];
  loans: Map<number, Loan>;
  loadedAt: Date;
}

const EXTRA_KEY = "loca.watchedAgents";
export const watchedAgents = (): string[] => {
  try { return JSON.parse(localStorage.getItem(EXTRA_KEY) ?? "[]"); } catch { return []; }
};
export function watchAgent(id: string) {
  const list = new Set(watchedAgents());
  list.add(id);
  localStorage.setItem(EXTRA_KEY, JSON.stringify([...list]));
}

/** Agents the UI knows about: the contract has no list view, so start from the run and add searched ones. */
const knownAgentIds = () => [...new Set([RUN.finalState.agent.agent_id, ...watchedAgents()])];

export async function loadStore(): Promise<Store> {
  const config = await view<Config>("get_config");
  const agents = new Map<string, AgentRecord>();
  const orders: Order[] = [];
  await Promise.all(
    knownAgentIds().map(async (id) => {
      const agent = await view<Agent | null>("get_agent", { agent_id: id });
      if (!agent) return;
      const [score, list] = await Promise.all([
        view<ScoreReport | null>("get_score", { agent_id: id }),
        view<Order[]>("get_agent_orders", { agent_id: id, from_index: 0, limit: 200 }),
      ]);
      agents.set(id, { agent, score });
      orders.push(...list);
    }),
  );
  orders.sort((a, b) => b.id - a.id);
  const offerLists = await Promise.all(orders.filter((o) => o.offer_ids.length).map((o) => view<Offer[]>("get_offers", { order_id: o.id })));
  const loanList = await Promise.all(orders.filter((o) => o.loan_id !== null).map((o) => view<Loan | null>("get_loan", { loan_id: o.loan_id })));
  const loans = new Map<number, Loan>();
  for (const l of loanList) if (l) loans.set(l.id, l);
  return { config, agents, orders, offers: offerLists.flat(), loans, loadedAt: new Date() };
}

/** Run-log steps for one order. The demo numbers its acts so that act 03 is order #3 and act 04 is order #4. */
export const stepsForOrder = (id: number) => RUN.steps.filter((s) => Number(s.act) === id && Number(s.act) >= 3 && Number(s.act) <= 4);

export const reportForOrder = (id: number): string | undefined =>
  stepsForOrder(id).find((s) => s.title.startsWith("Agent delivers"))?.detail?.report;

export const rationaleFor = (orderId: number, strategy: string): string[] =>
  stepsForOrder(orderId).find((s) => s.detail?.rationale && s.events?.some((e) => e.event === "offer_made" && e.data.strategy === strategy))
    ?.detail.rationale.map((r: string) => r.replace(/\b\d{7,}\b/g, (n) => `$${(Number(n) / 1e6).toFixed(2)}`)) ?? [];

/** Score snapshots recorded during the run: after warm-up, then after each loan. */
export function scoreHistory(): { label: string; score: number; tx?: string }[] {
  const out: { label: string; score: number; tx?: string }[] = [];
  const warm = RUN.steps.find((s) => s.act === "02");
  if (warm) out.push({ label: "3 paid orders", score: warm.detail.score.score });
  for (const s of RUN.steps.filter((x) => x.title.startsWith("Score "))) {
    out.push({ label: `Loan on order #${Number(s.act)} repaid`, score: s.detail.after.score, tx: RUN.steps.find((x) => x.act === s.act && x.title.startsWith("Customer approves"))?.tx });
  }
  return out;
}

export const profileName = (agentId: string): string | undefined =>
  RUN.steps.find((s) => s.detail?.agent === agentId && s.detail?.profile)?.detail.profile.name;
export const profileService = (agentId: string): string | undefined =>
  RUN.steps.find((s) => s.detail?.agent === agentId && s.detail?.profile)?.detail.profile.service;
