import "./style.css";
import "./landing.css";
import "./app-theme.css";
import { listTokens } from "../../src/intents/oneclick";
import { CONTRACT, accessKeys, deriveFeed, latestBlock, loadStore, view as viewCall, type FeedItem, type KeyInfo, type Store } from "./data";
import { landing, resetLanding, updateLanding } from "./landing";
import { logosPage } from "./logos";
import { activity, agentDetail, agents, dashboard, lenders, market, orderDetail, orders } from "./pages";
import { mountPay, pay } from "./pay";
import { joinPage, mountJoin } from "./join";
import { swarmPage, updateSwarm } from "./swarm-view";
import { ICON, LOGO, accountLink, esc, label, tooltips } from "./ui";

const POLL_MS = 8000;

const NAV = [
  { path: "", name: "Market", icon: ICON.overview },
  { path: "swarm", name: "Live swarm", icon: ICON.activity },
  { path: "agents", name: "Agents", icon: ICON.agents },
  { path: "orders", name: "Orders", icon: ICON.orders },
  { path: "market", name: "Credit auctions", icon: ICON.market },
  { path: "lenders", name: "Lenders", icon: ICON.lenders },
  { path: "pay", name: "Pay with any token", icon: ICON.pay },
  { path: "activity", name: "Activity", icon: ICON.search },
  { path: "join", name: "Join the market", icon: ICON.agents },
];

const app = document.querySelector("#app") as HTMLElement;
let mode: "landing" | "app" | null = null;
let store: Store | null = null;
let feed: FeedItem[] = [];
let loadError = "";
let assets: number | null = null;
const seen = new Map<string, number>();
let known = new Set<string>();
let lastRoute = "";

const shell = () => `
<aside class="side">
  <a class="brand" href="#/">${LOGO(28)}<b class="wm">Loca</b></a>
  <nav>${NAV.map((n) => `<a href="#/app${n.path ? `/${n.path}` : ""}" data-nav="${n.path}">${n.icon}<span>${n.name}</span></a>`).join("")}</nav>
  <div class="side-foot">
    <div class="net"><i id="net-dot"></i><span>NEAR testnet</span></div>
    <div class="muted small mono" id="block">connecting…</div>
    <div class="small">${accountLink(CONTRACT, "Market contract ↗")}</div>
    <div class="muted small">Prototype · not audited</div>
  </div>
</aside>
<div class="main">
  <div class="topbar">
    <button class="menu" id="menu" aria-label="Menu">≡</button>
    <form class="search" id="search">${ICON.search}<input name="q" placeholder="Agent name or account, or order #" autocomplete="off" spellcheck="false" /></form>
    <div class="top-r"><span class="ro" data-tip="This app only reads chain state. Transactions are sent by the agents themselves.">Read-only</span><a class="btn ghost" href="#/">About Loca</a></div>
  </div>
  <main id="view" class="view"></main>
</div>`;

function setMode(next: "landing" | "app") {
  if (mode === next) return;
  mode = next;
  resetLanding();
  document.body.className = next === "landing" ? "is-landing" : "";
  app.innerHTML = next === "landing" ? landing() : shell();
  if (next === "app") wireShell();
  else app.querySelectorAll<HTMLButtonElement>("[data-scroll]").forEach((b) => b.addEventListener("click", () => document.getElementById(b.dataset.scroll!)?.scrollIntoView({ behavior: "smooth" })));
}

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, params: new URLSearchParams(query), raw };
}

/** Render the current route. `refresh` keeps scroll and leaves forms alone. */
function route(refresh = false, fresh = new Set<string>()) {
  const { parts, params, raw } = parse();
  if (parts[0] === "logos" || location.pathname.replace(/\/$/, "").endsWith("/logos")) {
    mode = null;
    document.body.className = "is-landing";
    app.innerHTML = logosPage();
    return;
  }
  if (parts[0] !== "app") {
    setMode("landing");
    if (!refresh) window.scrollTo(0, 0);
    if (store) updateLanding(store, feed, assets);
    return;
  }
  setMode("app");
  const section = parts[1] ?? "";
  const id = parts[2];
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === section));
  document.body.classList.remove("nav-open");
  const view = document.querySelector("#view") as HTMLElement;
  const same = raw === lastRoute;
  lastRoute = raw;

  // The join page needs no market data, so it renders before the store loads.
  if (section === "join") {
    if (refresh && same && view.querySelector(".steps-j")) return; // keep form state and scroll
    view.innerHTML = joinPage(params.get("role") ?? "agent");
    mountJoin();
    if (!refresh) window.scrollTo(0, 0);
    return;
  }
  if (!store) {
    view.innerHTML = loadError
      ? `<div class="empty big"><div class="empty-t">Testnet RPC unreachable</div><div class="muted">${esc(loadError)}</div><button class="btn" onclick="location.reload()">Retry</button></div>`
      : `<div class="loading">Reading the market from NEAR testnet…</div>`;
    return;
  }
  const s = store;
  if (section === "pay") {
    if (refresh && same) return; // keep the checkout form state
    view.innerHTML = pay([...s.agents.keys()].map((k) => ({ id: k, name: label(k) })));
    void mountPay();
    return;
  }
  if (section === "swarm" && refresh && same && document.querySelector("#sw-counters")) {
    updateSwarm(s, feed, fresh);
    return;
  }
  const html =
    section === "swarm" ? swarmPage(s, feed)
    : section === "agents" ? (id ? agentDetail(s, id) : agents(s))
    : section === "orders" ? (id ? orderDetail(s, Number(id)) : orders(s, params.get("status") ?? "All"))
    : section === "market" ? market(s)
    : section === "lenders" ? lenders(s)
    : section === "activity" ? activity(feed, params.get("kind") ?? "all")
    : dashboard(s, feed);
  const y = window.scrollY;
  view.innerHTML = html;
  window.scrollTo(0, refresh && same ? y : 0);
  void fillAgentKeys();
}

// An agent's NEAR access keys and prepaid storage, read live; cached briefly across refreshes.
const keyCache = new Map<string, { at: number; html: string }>();
async function fillAgentKeys() {
  const el = document.querySelector<HTMLElement>("#agent-keys");
  if (!el) return;
  const id = el.dataset.agent!;
  const hit = keyCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return void (el.innerHTML = hit.html);
  try {
    const [keys, storage] = await Promise.all([accessKeys(id), viewCall<string>("storage_balance_of", { account_id: id })]);
    const fc = keys.filter((k) => !k.full), full = keys.length - fc.length;
    const near = (y: string | null | undefined) => (y == null ? "unlimited" : `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(3)} NEAR`);
    const row = (k: KeyInfo) => `<div class="key-row"><span class="pill s-open">function-call</span> <span class="mono small">${esc(k.publicKey.slice(0, 16))}…</span><div class="muted small">only ${esc(k.methods!.join(", "))} on ${esc(label(k.receiver!))} · gas allowance ${near(k.allowance)} · can't attach NEAR or touch tokens</div></div>`;
    const html = `${fc.map(row).join("") || '<div class="muted small">No restricted key: the agent signs with a full-access key.</div>'}
      <div class="muted small" style="margin-top:6px">${full} full-access key${full === 1 ? "" : "s"}, held by the operator · storage prepaid ${near(storage)}</div>`;
    keyCache.set(id, { at: Date.now(), html });
    if (document.body.contains(el)) el.innerHTML = html;
  } catch {
    el.innerHTML = '<span class="muted small">Couldn\'t read keys from RPC</span>';
  }
}

async function poll() {
  try {
    store = await loadStore(store ?? undefined);
    loadError = "";
    feed = deriveFeed(store, seen, label);
    const keys = new Set(feed.map((f) => f.key));
    const fresh = known.size ? new Set([...keys].filter((k) => !known.has(k))) : new Set<string>();
    known = keys;
    route(true, fresh);
  } catch (e) {
    loadError = String(e);
    if (!store) route(true);
  }
}

async function tick() {
  const el = document.querySelector("#block");
  if (!el) return;
  try {
    const b = await latestBlock();
    el.textContent = `block ${b.height.toLocaleString("en-US")}`;
    document.querySelector("#net-dot")!.className = "on";
  } catch {
    el.textContent = "RPC unreachable";
  }
}

function wireShell() {
  document.querySelector("#search")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).q as HTMLInputElement;
    const q = input.value.trim().toLowerCase();
    input.value = "";
    if (!q) return;
    if (/^#?\d+$/.test(q)) return void (location.hash = `#/app/orders/${q.replace("#", "")}`);
    const hit = store && [...store.agents.keys()].find((k) => k === q || label(k).toLowerCase().includes(q) || k.startsWith(q));
    location.hash = `#/app/agents/${encodeURIComponent(hit || q)}`;
  });
  document.querySelector("#view")!.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("a, button")) return;
    const row = t.closest("[data-href]") as HTMLElement | null;
    if (row) location.hash = row.dataset.href!;
  });
  document.querySelector("#menu")!.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  void tick();
}

window.addEventListener("hashchange", () => route());
tooltips();
route();
void poll();
setInterval(poll, POLL_MS);
setInterval(tick, 6000);
listTokens().then((t) => { assets = t.length; if (mode === "landing" && store) updateLanding(store, feed, assets); }).catch(() => {});
