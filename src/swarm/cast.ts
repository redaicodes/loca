// The swarm's cast, shared by the setup script (scripts/swarm.ts) and the hosted worker (worker/swarm.ts).
// Every slug is a sub-account of the swarm root: `<slug>.<root>`.

import { STRATEGIES, type BidContext, type BidDecision, type LenderStrategy } from "../agents/lenders.js";

export type VendorKind = "data" | "compute" | "api";

export interface AgentSpec {
  slug: string; name: string; service: string; operator: string;
  price: [number, number]; reliability: number; borrowRate: number; vendors: VendorKind[];
  /** Share of orders from the agent's main customer (customer-concentration signal). */
  concentration?: number; bond: number;
}

export const AGENTS: AgentSpec[] = [
  { slug: "atlas", name: "Atlas Research", service: "research briefs", operator: "northwind", price: [60, 160], reliability: 0.97, borrowRate: 0.8, vendors: ["data"], bond: 15 },
  { slug: "quill", name: "Quill Translate", service: "document translation", operator: "northwind", price: [25, 90], reliability: 0.99, borrowRate: 0.5, vendors: ["api"], bond: 10 },
  { slug: "forge", name: "Forge Code Review", service: "code audits", operator: "helix", price: [80, 200], reliability: 0.95, borrowRate: 0.9, vendors: ["compute"], bond: 20 },
  { slug: "echo", name: "Echo Transcribe", service: "audio transcription", operator: "helix", price: [20, 70], reliability: 0.98, borrowRate: 0.6, vendors: ["compute", "api"], bond: 10 },
  { slug: "pixel", name: "Pixel Studio", service: "image generation", operator: "kite", price: [30, 120], reliability: 0.88, borrowRate: 0.85, vendors: ["compute"], bond: 10 },
  { slug: "ledger", name: "Ledger Books", service: "bookkeeping", operator: "kite", price: [40, 140], reliability: 0.99, borrowRate: 0.6, vendors: ["api"], concentration: 0.8, bond: 15 },
  { slug: "scout", name: "Scout Leads", service: "sales lead lists", operator: "orbit", price: [50, 150], reliability: 0.82, borrowRate: 0.9, vendors: ["data"], bond: 5 },
  { slug: "nova", name: "Nova Support", service: "support triage", operator: "orbit", price: [20, 80], reliability: 0.93, borrowRate: 0.7, vendors: ["api"], bond: 10 },
  { slug: "sage", name: "Sage Contracts", service: "contract review", operator: "meridian", price: [70, 180], reliability: 0.96, borrowRate: 0.7, vendors: ["data", "api"], bond: 15 },
  { slug: "relay", name: "Relay Ops", service: "workflow automation", operator: "meridian", price: [30, 100], reliability: 0.94, borrowRate: 0.6, vendors: ["api"], bond: 10 },
  { slug: "prism", name: "Prism Analytics", service: "data dashboards", operator: "summit", price: [60, 170], reliability: 0.97, borrowRate: 0.85, vendors: ["data", "compute"], bond: 15 },
  { slug: "vector", name: "Vector Search", service: "search indexing", operator: "summit", price: [40, 130], reliability: 0.9, borrowRate: 0.9, vendors: ["compute"], bond: 10 },
  { slug: "harbor", name: "Harbor Freight Desk", service: "shipment tracking", operator: "lattice", price: [25, 90], reliability: 0.98, borrowRate: 0.5, vendors: ["api"], concentration: 0.7, bond: 10 },
  { slug: "tally", name: "Tally Payroll", service: "payroll runs", operator: "lattice", price: [50, 150], reliability: 0.99, borrowRate: 0.55, vendors: ["api", "data"], bond: 20 },
  { slug: "lumen", name: "Lumen Video", service: "video editing", operator: "cobalt", price: [80, 200], reliability: 0.86, borrowRate: 0.95, vendors: ["compute"], bond: 10 },
  { slug: "cipher", name: "Cipher Scan", service: "security scans", operator: "cobalt", price: [60, 160], reliability: 0.92, borrowRate: 0.8, vendors: ["compute", "data"], bond: 5 },
];

export const OPERATORS = ["northwind", "helix", "kite", "orbit", "meridian", "summit", "lattice", "cobalt"];

export const CUSTOMERS = [
  "acme", "bluefin", "corvid", "delta", "evergreen", "fjord", "granite",
  "halcyon", "ironwood", "juniper", "kestrel", "lyra", "maple", "nimbus",
];

export interface LenderSpec {
  slug: string; name: string; strategy: LenderStrategy;
  /** The lender's own margin on top of its strategy's price, in basis points (negative = undercuts). */
  spreadBps: number;
}
const [coverage, history, concentration] = STRATEGIES;
export const LENDERS: LenderSpec[] = [
  { slug: "cover-capital", name: "Cover Capital", strategy: coverage, spreadBps: 0 },
  { slug: "track-fund", name: "Track Record Fund", strategy: history, spreadBps: 0 },
  { slug: "spread-credit", name: "Spread Credit", strategy: concentration, spreadBps: 0 },
  { slug: "keel-lending", name: "Keel Lending", strategy: coverage, spreadBps: 60 },
  { slug: "beacon-credit", name: "Beacon Credit", strategy: history, spreadBps: -40 },
  { slug: "quarry-fund", name: "Quarry Fund", strategy: concentration, spreadBps: 80 },
  { slug: "tidewater", name: "Tidewater Capital", strategy: coverage, spreadBps: -60 },
];

/** The lender's bid: its strategy's price plus its own spread, still capped by the borrower's max fee. */
export function lenderQuote(l: LenderSpec, ctx: BidContext): BidDecision {
  const d = l.strategy.decide(ctx);
  if (!d.bid || !l.spreadBps) return d;
  const feeBps = Math.max(50, d.feeBps + l.spreadBps);
  const fee = (BigInt(ctx.request.amount) * BigInt(feeBps)) / 10_000n;
  if (fee > BigInt(ctx.request.max_fee)) return { bid: false, rationale: [...d.rationale, `fee ${feeBps}bps exceeds borrower max`] };
  return { ...d, feeBps, fee };
}

export const VENDORS: { slug: string; name: string; kind: VendorKind }[] = [
  { slug: "datahub", name: "DataHub", kind: "data" },
  { slug: "searchgrid", name: "SearchGrid", kind: "data" },
  { slug: "gpu-pool", name: "GPU Pool", kind: "compute" },
  { slug: "tensor-farm", name: "Tensor Farm", kind: "compute" },
  { slug: "api-mart", name: "API Mart", kind: "api" },
  { slug: "mailroute", name: "MailRoute", kind: "api" },
];
export const vendorsOf = (kind: VendorKind) => VENDORS.filter((v) => v.kind === kind).map((v) => v.slug);

export const ACTORS = [
  "arbiter", ...AGENTS.map((a) => a.slug), ...OPERATORS, ...CUSTOMERS, ...LENDERS.map((l) => l.slug), ...VENDORS.map((v) => v.slug),
];

export const DISPUTE_WINDOW_SEC = 30;
/** Methods an agent's function-call key may call on the market. */
export const AGENT_METHODS = ["request_credit", "accept_offer", "mark_delivered", "withdraw", "update_profile"];
