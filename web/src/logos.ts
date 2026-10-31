// Logo candidates side by side, at the sizes the site actually uses. Not linked from the nav.

import { LOGOS, esc, logoChoice, markSvg } from "./ui";

const lockup = (k: string, size: number, ink: string, accent: string, sub = true) =>
  `<span class="lg-lockup" style="color:${ink}">${markSvg(k, size, ink, accent)}<span><b style="font-size:${size * 0.72}px">Loca</b>${sub ? `<small>Line of Credit for Agents</small>` : ""}</span></span>`;

export function logosPage() {
  const current = logoChoice();
  return `<div class="lg">
  <header class="lg-head"><h1>Logo options</h1><p>Each mark at the sizes the site uses. "Use this" swaps it into the nav, footer and app sidebar on this browser so you can see it in place.</p><a href="#/">Back to the site</a></header>
  <div class="lg-grid">${Object.entries(LOGOS)
    .map(([k, l]) => `<section class="lg-card${k === current ? " on" : ""}">
      <div class="lg-top"><span class="lg-n">${k}</span><div><b>${esc(l.name)}</b><p>${esc(l.idea)}</p></div></div>
      <div class="lg-hero">${markSvg(k, 120)}</div>
      <div class="lg-row light">${lockup(k, 34, "#1e1e1e", "#2A4C9C")}</div>
      <div class="lg-row dark">${lockup(k, 30, "#efe8d6", "#8aa3e6")}</div>
      <div class="lg-row blue">${lockup(k, 30, "#ffffff", "#e7dcc4", false)}</div>
      <div class="lg-row tiny"><span>Favicon</span>${markSvg(k, 16)}${markSvg(k, 24)}${markSvg(k, 32)}<span class="lg-tab">${markSvg(k, 14)} Loca</span></div>
      <button class="lg-use" data-logo="${k}">${k === current ? "In use" : "Use this"}</button>
    </section>`)
    .join("")}</div>
</div>`;
}

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-logo]");
  if (!b) return;
  localStorage.setItem("loca.logo", b.dataset.logo!);
  location.reload();
});
