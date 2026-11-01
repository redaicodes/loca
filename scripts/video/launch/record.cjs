// Renders the launch video frame by frame: the stage page (web/video/stage.html) runs on a virtual clock
// that this script advances by exactly 1/30 s per frame (timers, requestAnimationFrame, Date, and every
// CSS animation and transition), and each frame is captured. No dropped frames, and the voiceover from
// audio.py lines up exactly because scene timing and frame timing share the same clock.
//   python3 scripts/video/launch/audio.py && pnpm web:dev   (then, in another shell)
//   CH=<chromium path> node scripts/video/launch/record.cjs   -> runs/launch/loca-launch.mp4
const { chromium } = require('playwright-core'); // pnpm add -D playwright-core
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'runs/launch');
const STAGE = process.env.STAGE || 'http://localhost:5180/video/stage.html';
const FPS = 30;

// Installed before the page's own scripts: replaces the page's notion of time with a clock we step.
const VIRTUAL_TIME = () => {
  let vt = 0, nextId = 1;
  const timers = [], rafs = [], vstart = new WeakMap();
  const epoch = Date.now();
  window.setTimeout = (fn, ms = 0, ...a) => { const id = nextId++; timers.push({ id, at: vt + Math.max(0, ms), fn: () => fn(...a) }); return id; };
  window.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  window.setInterval = (fn, ms = 0) => { const id = nextId++; const tick = () => { fn(); timers.push({ id, at: vt + ms, fn: tick }); }; timers.push({ id, at: vt + ms, fn: tick }); return id; };
  window.clearInterval = window.clearTimeout;
  window.requestAnimationFrame = (fn) => { const id = nextId++; rafs.push({ id, fn }); return id; };
  window.cancelAnimationFrame = (id) => { const i = rafs.findIndex((r) => r.id === id); if (i >= 0) rafs.splice(i, 1); };
  performance.now = () => vt;
  Date.now = () => epoch + vt;
  window.__advance = (ms) => {
    const target = vt + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > target) break;
      timers.shift(); vt = t.at;
      try { t.fn(); } catch (e) { console.error(e); }
    }
    vt = target;
    for (const r of rafs.splice(0)) { try { r.fn(vt); } catch (e) { console.error(e); } }
  };
  // After the page's callbacks (and their promise continuations) have run: pin every animation to the clock.
  window.__pin = () => {
    for (const a of document.getAnimations()) {
      if (!vstart.has(a)) vstart.set(a, vt);
      const local = vt - vstart.get(a);
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && local >= end) { a.finish(); continue; }
      a.pause(); a.currentTime = local;
    }
  };
};

(async () => {
  fs.rmSync(path.join(OUT, 'frames'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CH });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
  await page.addInitScript(VIRTUAL_TIME);
  await page.goto(STAGE);
  await page.evaluate(() => window.prepare());
  const total = await page.evaluate(() => window.start());
  const cdp = await page.context().newCDPSession(page);
  const n = Math.ceil(total * FPS);
  console.log(`rendering ${n} frames (${total}s at ${FPS} fps)`);
  for (let i = 0; i < n; i++) {
    await page.evaluate((ms) => window.__advance(ms), i === 0 ? 0 : 1000 / FPS);
    await page.evaluate(() => window.__pin());
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, optimizeForSpeed: true });
    fs.writeFileSync(path.join(OUT, 'frames', `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (i % 300 === 0) console.log(`  ${(i / FPS).toFixed(0)}s`);
  }
  await browser.close();

  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: OUT, stdio: 'inherit' });
  ff(['-framerate', String(FPS), '-i', 'frames/f%05d.jpg', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', 'video.mp4']);
  // Voice on top; music ducks under it; loudness normalised for social video.
  ff(['-i', 'video.mp4', '-i', 'vo.wav', '-i', 'music.wav', '-filter_complex',
    '[1:a]asplit=2[vo][key];[2:a]volume=0.5[m];[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=500[md];' +
    '[vo]volume=1.6,highpass=f=80,acompressor=threshold=0.1:ratio=3[v];[md][v]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'loca-launch.mp4']);
  console.log(path.join(OUT, 'loca-launch.mp4'));
})().catch((e) => { console.error(e); process.exit(1); });
