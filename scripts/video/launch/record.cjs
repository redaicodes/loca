// Records the launch video: opens web/video/stage.html on the dev server, captures the screen through
// the Chrome DevTools screencast, then encodes it with the voiceover and music from audio.py.
//   python3 scripts/video/launch/audio.py && pnpm web:dev   (then, in another shell)
//   CH=<chromium path> node scripts/video/launch/record.cjs   -> runs/launch/loca-launch.mp4
const { chromium } = require('playwright-core'); // pnpm add -D playwright-core
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'runs/launch');
const STAGE = process.env.STAGE || 'http://localhost:5180/video/stage.html';

(async () => {
  fs.rmSync(path.join(OUT, 'frames'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CH });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(STAGE);
  console.log('preparing…');
  await page.evaluate(() => window.prepare(), null, { timeout: 600000 });
  await page.waitForTimeout(1500);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ t: Date.now() / 1000, data }); // arrival time, on the same clock as the page's scene log
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080 });
  await page.waitForTimeout(800);
  const planned = await page.evaluate(() => window.start());
  console.log(`recording ~${planned}s`);
  await page.waitForTimeout(planned * 1000 + 3000);
  await cdp.send('Page.stopScreencast');
  const { t0ms, log } = await page.evaluate(() => ({ t0ms: window.__t0, log: window.__log }));
  await browser.close();
  const t0 = t0ms / 1000;
  // The video runs from the start call to the last scene's start plus the planned tail.
  const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/video/timeline.json'), 'utf8'));
  const lastLine = timeline.lines.at(-1), lastScene = log.find((x) => x.id === lastLine.id);
  const total = (lastScene.at / 1000 - t0) + 0.25 + (planned - lastLine.start);
  const scenes = log.map((x) => ({ id: x.id, t: x.at / 1000 - t0 }));
  scenes.forEach((x) => { const l = timeline.lines.find((y) => y.id === x.id); console.log(`  ${x.id.padEnd(9)} planned ${(l.start - 0.25).toFixed(2)}  actual ${x.t.toFixed(2)}`); });
  fs.writeFileSync(path.join(OUT, 'offsets.json'), JSON.stringify({ total, scenes }, null, 1));
  execFileSync('python3', [path.join(__dirname, 'audio.py'), 'place', path.join(OUT, 'offsets.json')], { stdio: 'inherit' });

  // Frames from t0 on; the last frame before t0 stands in for time zero.
  const before = frames.filter((f) => f.t < t0).at(-1);
  const use = [...(before ? [{ ...before, t: t0 }] : []), ...frames.filter((f) => f.t >= t0)];
  const list = ['ffconcat version 1.0'];
  use.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', name), Buffer.from(f.data, 'base64'));
    const next = i + 1 < use.length ? use[i + 1].t : t0 + total;
    list.push(`file 'frames/${name}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  list.push(`file 'frames/f${String(use.length - 1).padStart(5, '0')}.jpg'`);
  fs.writeFileSync(path.join(OUT, 'list.ffconcat'), list.join('\n'));
  console.log(`${use.length} frames`);

  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: OUT, stdio: 'inherit' });
  ff(['-f', 'concat', '-safe', '0', '-i', 'list.ffconcat', '-t', String(total),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', 'video.mp4']);
  // Music ducks under the voice.
  ff(['-i', 'video.mp4', '-i', 'vo.wav', '-i', 'music.wav', '-filter_complex',
    '[1:a]asplit=2[vo][key];[2:a]volume=0.5[m];[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=500[md];' +
    '[vo]volume=1.6,highpass=f=80,acompressor=threshold=0.1:ratio=3[v];[md][v]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'loca-launch.mp4']);
  console.log(path.join(OUT, 'loca-launch.mp4'));
})().catch((e) => { console.error(e); process.exit(1); });
