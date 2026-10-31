// Rotating sphere of mono letters, after the NEAR Hackathon key visual.

export function letterSphere(canvas: HTMLCanvasElement, word = "loca", count = 520) {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 360;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  // Fibonacci lattice gives an even spread of points.
  const pts = Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r, ch: word[i % word.length] };
  });

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const R = size * 0.4;
  let a = 0.6;

  function frame() {
    ctx.clearRect(0, 0, size, size);
    const cos = Math.cos(a), sin = Math.sin(a);
    const proj = pts
      .map((p) => ({ x: p.x * cos - p.z * sin, y: p.y, z: p.x * sin + p.z * cos, ch: p.ch }))
      .sort((p, q) => p.z - q.z);
    for (const p of proj) {
      const depth = (p.z + 1) / 2; // 0 back, 1 front
      ctx.font = `${500} ${Math.round(7 + depth * 7)}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = `rgba(42, 37, 32, ${0.12 + depth * 0.7})`;
      ctx.fillText(p.ch, size / 2 + p.x * R, size / 2 + p.y * R);
    }
    a += 0.0035;
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
}
