/** Rising embers + drifting ash on a 2D canvas over the menus (hidden while racing). */
export function startEmbers(cv: HTMLCanvasElement, count = 90) {
  const c = cv.getContext('2d')!;
  let w = 0, h = 0, dpr = 1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr; };
  resize(); addEventListener('resize', resize);
  type P = { x: number; y: number; vx: number; vy: number; r: number; life: number; ash: boolean; ph: number };
  const spawn = (p: Partial<P> = {}, anyY = false): P => {
    const ash = Math.random() < 0.35;
    return { x: Math.random() * w, y: anyY ? Math.random() * h : h + 10, vx: (Math.random() - 0.5) * 20, vy: -(ash ? 10 + Math.random() * 20 : 30 + Math.random() * 70),
      r: (ash ? 1.2 + Math.random() * 2.2 : 0.8 + Math.random() * 1.8) * dpr, life: 1, ash, ph: Math.random() * 6, ...p };
  };
  const ps: P[] = Array.from({ length: count }, () => spawn({}, true));
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (document.body.classList.contains('racing') || document.hidden) return;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.ph += dt * 2; p.x += (p.vx + Math.sin(p.ph) * 14) * dt * dpr; p.y += p.vy * dt * dpr;
      p.life -= dt * (p.ash ? 0.06 : 0.12);
      if (p.y < -10 || p.life <= 0) { ps[i] = spawn(); continue; }
      const fl = 0.6 + 0.4 * Math.sin(p.ph * 5 + i);
      if (p.ash) { c.globalCompositeOperation = 'source-over'; c.fillStyle = `rgba(70,60,58,${0.55 * p.life})`; }
      else { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,${(90 + 110 * fl * p.life) | 0},30,${p.life * fl})`; c.shadowColor = '#ff4a10'; }
      c.shadowBlur = p.ash ? 0 : 8 * dpr;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill();
    }
    c.shadowBlur = 0;
  };
  requestAnimationFrame(frame);
}
