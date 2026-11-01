// Records the Loca demo video from the hosted app: CDP screencast frames -> ffmpeg (see encode step).
const { chromium } = require('playwright-core'); // pnpm add -D playwright-core
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'https://loca.shashank7-iitd-f71.workers.dev/';
const OUT = process.env.OUT || path.join(__dirname, 'video');
const AGENT = 'quill.loca-swarm-mvwu8dfo.testnet';

const CAPTION_CSS = `
#vcap { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 99999; pointer-events: none;
  width: max-content; max-width: 1080px; background: #1e1e1e; color: #fefefe; border: 2px solid #1e1e1e;
  box-shadow: 6px 6px 0 #2A4C9C; font: 500 27px/1.3 "Inter Tight", Inter, sans-serif; letter-spacing: -0.015em;
  padding: 16px 24px; text-align: center; opacity: 0; transition: opacity .35s ease; }
#vcap.on { opacity: 1; }
#vcap.high { bottom: 118px; }
.lt .hero .links { visibility: hidden; }
#vend { position: fixed; inset: 0; z-index: 99998; display: grid; place-items: center; align-content: center; gap: 22px;
  background: #fefefe; opacity: 0; transition: opacity .6s ease; font-family: "Inter Tight", Inter, sans-serif; color: #1e1e1e; }
#vend.on { opacity: 1; }
#vend .row { display: flex; align-items: center; gap: 18px; }
#vend b { font-weight: 600; font-size: 96px; letter-spacing: -0.05em; line-height: 1; }
#vend p { margin: 0; font-size: 30px; letter-spacing: -0.02em; }
#vend small { font: 22px "VT323", monospace; color: #555; }
`;

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });

  // Load the landing page and wait for live data before recording anything.
  await page.goto(BASE + '#/');
  await page.waitForFunction(() => [...document.querySelectorAll('.strip b')].every((b) => /\d/.test(b.textContent || '')), null, { timeout: 60000 });
  await page.waitForSelector('#lx-ticket .lx-t-steps', { timeout: 60000 });
  await page.addStyleTag({ content: CAPTION_CSS });
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'vcap'; document.body.appendChild(c);
    // Resolves on the next new order in the replay window.
    window.__nextTicket = () => new Promise((res) => {
      const t = document.getElementById('lx-ticket');
      const mo = new MutationObserver(() => { if (t.querySelector('.lx-t-steps')) { mo.disconnect(); res(); } });
      mo.observe(t, { childList: true });
    });
  });

  const caption = async (text, cls = '') => {
    await page.evaluate(([t, k]) => {
      const c = document.getElementById('vcap');
      c.className = c.className.includes('on') ? 'on ' + k : k;
      if (!t) { c.classList.remove('on'); return; }
      c.classList.remove('on');
      setTimeout(() => { c.textContent = t; c.className = 'on ' + k; }, c.textContent ? 300 : 0);
    }, [text, cls]);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (hash, ready) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    if (ready) await page.waitForSelector(ready, { timeout: 30000 });
    await wait(600);
  };
  const scrollTo = (sel, offset = 90) => page.evaluate(([s, o]) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' });
  }, [sel, offset]);

  // Start the screencast on a fresh replay so its timing is predictable.
  await page.evaluate(() => window.__nextTicket());
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const t0 = Date.now();
  const mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${s}`);

  // 1. Hero
  mark('hero');
  await wait(600);
  await caption("AI agents get paid for work. They can't borrow against it.", 'high');
  const nextTicket = page.evaluate(() => window.__nextTicket());
  await wait(7000);

  // 2. Order replay: start scrolling as the next real loan begins.
  await nextTicket;
  mark('replay');
  await scrollTo('#lt-how .pair', 64);
  await caption('A customer pays an agent into escrow. Lender agents bid to advance part of it. The cheapest bid wins.');
  await wait(3900);
  await caption('The loan pays the vendor directly. On approval, escrow repays the lender first. The agent keeps the rest.');
  await wait(4700);

  // 3. Live swarm
  mark('swarm');
  await caption('');
  await go('#/app/swarm', '.net');
  await page.evaluate(() => window.scrollTo(0, 0));
  await caption('This runs live on NEAR testnet: 16 agents, 14 customers, 7 lender agents and 6 vendors.');
  await wait(6500);
  await scrollTo('.net', 70);
  await caption('Every line is a real transaction: escrow, credit, payment to a vendor.');
  await wait(7500);

  // 4. Agent page
  mark('agent');
  await caption('');
  await go('#/app/agents/' + AGENT, '#agent-keys');
  await page.evaluate(() => window.scrollTo(0, 0));
  await caption('Each agent has a credit score built only from its onchain record.');
  await wait(5500);
  await page.waitForFunction(() => /function-call|methods/i.test(document.getElementById('agent-keys')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await scrollTo('#agent-keys', 260);
  await caption('It signs with a NEAR key that can call only five market methods. It can never move tokens.');
  await wait(6000);

  // 5. Lenders
  mark('lenders');
  await caption('');
  await go('#/app/market', '.auction-top');
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(300);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3.sec')].find((x) => /Recent auctions/.test(x.textContent));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  });
  await caption('Seven lender agents bid on every request, priced from that record. Defaults cost more; too many and the bids stop.');
  await wait(8000);

  // 6. Guardrails
  mark('guardrails');
  await caption('');
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3.sec')].find((x) => /Guardrails/.test(x.textContent));
    if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
  });
  await caption('We attacked the live market 16 ways. All 16 were refused: 13 by the contract, 3 by NEAR itself.');
  await wait(8500);

  // 7. Pay with any token
  mark('pay');
  await caption('');
  await go('#/app/pay', '#pay-form');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => (document.querySelector('#asset')?.options.length || 0) > 2, null, { timeout: 30000 }).catch(() => {});
  await caption('Customers can pay from any chain. NEAR Intents converts it to USDC and opens the order in one step.', 'high');
  await wait(1200);
  await page.click('#quote-btn');
  await page.waitForFunction(() => /USDC/.test(document.getElementById('quote-out')?.textContent || '') && !/Requesting|Loading/i.test(document.getElementById('quote-out')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await wait(6500);

  // 8. End card
  mark('end');
  await caption('');
  await page.evaluate((logo) => {
    const e = document.createElement('div'); e.id = 'vend';
    e.innerHTML = `<div class="row">${logo}<b>Loca</b></div><p>Line of Credit for Agents</p><small>Built on NEAR &nbsp;·&nbsp; github.com/redaicodes/loca &nbsp;·&nbsp; #NEARHackathon</small>`;
    document.body.appendChild(e); requestAnimationFrame(() => e.classList.add('on'));
  }, '<svg width="88" height="88" viewBox="0 0 32 32"><path d="M16 28A12 12 0 0 1 16 4" fill="none" stroke="#1e1e1e" stroke-width="3"/><path d="M16 2.5a13.5 13.5 0 0 1 0 27z" fill="#2A4C9C"/></svg>');
  await wait(5000);
  mark('done');

  await cdp.send('Page.stopScreencast');
  await wait(300);
  await browser.close();

  // Write frames plus an ffconcat list that keeps each frame on screen until the next one arrived.
  const list = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', name), Buffer.from(f.data, 'base64'));
    const dur = i + 1 < frames.length ? frames[i + 1].t - f.t : 0.5;
    list.push(`file 'frames/${name}'`, `duration ${Math.max(0.001, dur).toFixed(4)}`);
  });
  list.push(`file 'frames/f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(path.join(OUT, 'list.ffconcat'), list.join('\n'));
  console.log(`${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
