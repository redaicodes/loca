import "./style.css";
import { CONTRACT, latestBlock, loadStore, view, watchAgent, type Agent, type Store } from "./data";
import { activity, agentDetail, agents, lenders, market, orderDetail, orders, overview } from "./pages";
import { mountPay, pay } from "./pay";
import { ICON, accountLink, esc, label, tooltips } from "./ui";

const NAV = [
  { path: "", name: "Overview", icon: ICON.overview },
  { path: "agents", name: "Agents", icon: ICON.agents },
  { path: "orders", name: "Orders", icon: ICON.orders },
  { path: "market", name: "Credit market", icon: ICON.market },
  { path: "lenders", name: "Lenders", icon: ICON.lenders },
  { path: "pay", name: "Pay with any token", icon: ICON.pay },
  { path: "activity", name: "Activity", icon: ICON.activity },
];

document.querySelector("#app")!.innerHTML = `
<aside class="side">
  <a class="brand" href="#/"><span class="mark">L</span><span><b>LOCA</b><small>Line of credit for agents</small></span></a>
  <nav>${NAV.map((n) => `<a href="#/${n.path}" data-nav="${n.path}">${n.icon}<span>${n.name}</span></a>`).join("")}</nav>
  <div class="side-foot">
    <div class="net"><i id="net-dot"></i><span>NEAR testnet</span></div>
    <div class="muted small mono" id="block">connecting…</div>
    <div class="small">${accountLink(CONTRACT, "Contract ↗")}</div>
    <div class="muted small">Prototype · not audited</div>
  </div>
</aside>
<div class="main">
  <div class="topbar">
    <button class="menu" id="menu" aria-label="Menu">≡</button>
    <form class="search" id="search">${ICON.search}<input name="q" placeholder="Look up an agent account or order #" autocomplete="off" spellcheck="false" /></form>
    <div class="top-r"><span class="ro" data-tip="This dashboard only reads chain state. Transactions are sent by the agents and scripts.">Read-only</span><button class="btn ghost" id="refresh">Refresh</button></div>
  </div>
  <main id="view" class="view"></main>
</div>`;

let store: Store | null = null;
let loadError = "";
const viewEl = document.querySelector("#view") as HTMLElement;

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const [section = "", id] = path.split("/").map(decodeURIComponent);
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === section));
  document.body.classList.remove("nav-open");

  if (section === "activity") return render(activity(params.get("event") ?? "all"));
  if (!store) return render(loadError ? errorView() : `<div class="loading">Reading contract state from NEAR testnet…</div>`);
  const s = store;
  switch (section) {
    case "agents": return render(id ? agentDetail(s, id) : agents(s));
    case "orders": return render(id ? orderDetail(s, Number(id)) : orders(s, params.get("status") ?? "All"));
    case "market": return render(market(s));
    case "lenders": return render(lenders(s));
    case "pay":
      render(pay([...s.agents.keys()].map((k) => ({ id: k, name: label(k) }))));
      return void mountPay();
    default: return render(overview(s));
  }
}

function render(html: string) {
  viewEl.innerHTML = html;
  window.scrollTo(0, 0);
}

const errorView = () =>
  `<div class="empty big"><div class="empty-t">Testnet RPC unreachable</div><div class="muted">${esc(loadError)}</div><button class="btn" onclick="location.reload()">Retry</button></div>`;

async function refresh() {
  const btn = document.querySelector("#refresh") as HTMLButtonElement;
  btn.disabled = true;
  try {
    store = await loadStore();
    loadError = "";
  } catch (e) {
    loadError = String(e);
  }
  btn.disabled = false;
  route();
}

async function tick() {
  try {
    const b = await latestBlock();
    document.querySelector("#block")!.textContent = `block ${b.height.toLocaleString("en-US")}`;
    document.querySelector("#net-dot")!.className = "on";
  } catch {
    document.querySelector("#block")!.textContent = "RPC unreachable";
    document.querySelector("#net-dot")!.className = "";
  }
}

document.querySelector("#search")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = (e.target as HTMLFormElement).q as HTMLInputElement;
  const q = input.value.trim();
  if (!q) return;
  if (/^#?\d+$/.test(q)) return void (location.hash = `#/orders/${q.replace("#", "")}`);
  const agent = await view<Agent | null>("get_agent", { agent_id: q }).catch(() => null);
  if (agent && store && !store.agents.has(q)) {
    watchAgent(q);
    await refresh();
  }
  location.hash = `#/agents/${encodeURIComponent(q)}`;
  input.value = "";
});

// Whole table rows act as links.
viewEl.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("a, button")) return;
  const row = t.closest("[data-href]") as HTMLElement | null;
  if (row) location.hash = row.dataset.href!;
});

document.querySelector("#refresh")!.addEventListener("click", refresh);
document.querySelector("#menu")!.addEventListener("click", () => document.body.classList.toggle("nav-open"));
window.addEventListener("hashchange", route);

tooltips();
route();
refresh();
tick();
setInterval(tick, 5000);
