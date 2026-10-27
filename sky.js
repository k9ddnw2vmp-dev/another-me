/* 另一个我 · 星空
 * Every star is one memory, drawn in square pixels like the rest of the app. Left to right is when it happened,
 * from the earliest year you wrote about to today; each life chapter is a dithered nebula over its years and a
 * segment on the horizon, mirrored in the sea. The faint dust stands for what has not been written yet;
 * passing meteors are the only pure ornament.
 * layout() is pure (tested in node); mount() draws it and handles taps, keys and the day-by-day replay.
 */
(function (root) {
  const AM = root.AM || (typeof require === 'function' ? require('./core.js') : null);

  // FNV-1a: the same memory always lands in the same place, on every device.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    // Finish with an avalanche so ids that differ by one character still scatter across the whole sky.
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const rand = (id, salt) => hash(salt + ':' + id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // 'YYYY-MM-DD' → fractional year, without Date (EDTF ranges run from 0000 to 9999).
  function yearOf(iso) {
    const [y, m = 1, d = 1] = String(iso).split('-').map(Number);
    return y + (m - 1) / 12 + (d - 1) / 365;
  }
  function nowYear(now) { return now.getFullYear() + now.getMonth() / 12 + (now.getDate() - 1) / 365; }
  const dayOf = m => String(m.recordedAt || '').slice(0, 10);

  // The names a memory is about: a person entry is about its title, anything else about the people it lists.
  function namesOf(m) {
    if (m.kind === 'person') return m.title ? [m.title.trim()] : [];
    return (Array.isArray(m.people) ? m.people : []).map(s => String(s).trim()).filter(Boolean);
  }

  function layout(mems, now = new Date()) {
    const end = nowYear(now);
    const usable = y => y >= 1800 && y <= end + 1;
    const chapters = [], dated = [], undated = [];
    for (const m of mems) {
      const r = AM.parseEDTF(m.when);
      if (m.kind === 'chapter') { if (r) chapters.push({ m, a: yearOf(r.start), b: yearOf(r.end) + 1 / 365 }); continue; }
      (r ? dated : undated).push({ m, a: yearOf(r ? r.start : '0'), b: r ? yearOf(r.end) + 1 / 365 : 0 });
    }

    const years = [...chapters, ...dated].flatMap(o => [o.a, Math.min(o.b, end)]).filter(usable);
    let from = years.length ? Math.floor(Math.min(...years)) : Math.floor(end) - 9;
    if (end - from < 3) from = Math.floor(end) - 3;
    const to = end + (end - from) * 0.02;
    const timeW = undated.length ? 0.88 : 1;
    const xOf = y => clamp((y - from) / (to - from), 0, 1) * timeW;

    const stars = [];
    for (const { m, a, b } of dated) {
      const lo = usable(a) ? a : from, hi = Math.max(lo, Math.min(b, end));
      // A memory dated "199X" or "1998~" is spread across its range instead of piling onto one point.
      stars.push({ m, dated: true, x: xOf(lo + rand(m.id, 'x') * (hi - lo)) });
    }
    for (const { m } of undated) stars.push({ m, dated: false, x: 0.925 + rand(m.id, 'x') * 0.075 });
    for (const s of stars) {
      const m = s.m, words = (m.body || '').length + ((m.feeling || '').length + (m.meaning || '').length) / 2;
      s.id = m.id;
      s.y = 0.06 + rand(m.id, 'y') * 0.88;
      s.size = clamp(Math.sqrt(words / 900), 0.12, 1); // the more you wrote, the brighter it burns
      s.cert = m.certainty === 'hazy' || m.certainty === 'told' ? m.certainty : 'clear';
      s.key = m.kind === 'scene';
      s.day = dayOf(m);
    }
    stars.sort((p, q) => p.x - q.x || String(p.id).localeCompare(String(q.id)));

    // Constellations: memories about the same person, joined in the order they happened.
    const byName = new Map();
    stars.forEach((s, i) => { for (const n of namesOf(s.m)) (byName.get(n) || byName.set(n, []).get(n)).push(i); });
    const links = [];
    for (const [name, idx] of byName) for (let k = 1; k < idx.length; k++) links.push({ a: idx[k - 1], b: idx[k], name });

    // Chapters become segments along the horizon, stacked into lanes where they overlap.
    const lanes = [];
    const segs = chapters
      .map(({ m, a, b }) => {
        const y0 = usable(a) ? a : from, y1 = Math.min(b, end);
        return { id: m.id, title: AM.titleOf(m), y0, y1, x0: xOf(y0), x1: xOf(y1) };
      })
      .sort((p, q) => p.y0 - q.y0 || q.y1 - p.y1);
    for (const s of segs) {
      // "1990/1995" then "1995/2008" share a year at the seam; that is a hand-off, not an overlap.
      let lane = lanes.findIndex(y1 => y1 <= s.y0 + 1.05);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = s.y1; s.lane = lane;
      delete s.y0; delete s.y1;
      s.count = stars.filter(t => t.dated && t.x >= s.x0 && t.x <= s.x1).length; // a fuller chapter glows brighter
    }

    const span = to - from;
    const step = span > 70 ? 20 : span > 30 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
    const ticks = [];
    for (let y = Math.ceil(from / step) * step; y <= end; y += step) ticks.push({ x: xOf(y), label: String(y) });

    const order = stars.map((s, i) => i).sort((p, q) =>
      String(stars[p].m.recordedAt || '').localeCompare(String(stars[q].m.recordedAt || '')) || p - q);
    return { from, to: end, nowX: xOf(end), timeW, stars, links, chapters: segs, lanes: lanes.length, ticks, order, undated: undated.length };
  }

  // Calendar days between two 'YYYY-MM-DD' strings, counted from 1.
  function dayNumber(first, day) {
    const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return first && day ? Math.round((t(day) - t(first)) / 864e5) + 1 : 1;
  }


  /* ---------- drawing: square pixels, like the rest of the app ---------- */

  const U = 2; // one sky pixel, in CSS px
  const snap = v => Math.round(v / U) * U;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const dither = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

  // Pixel sprites: '#' full, '+' half. Four sizes; the more you wrote, the bigger the star.
  const SPARK = [
    ['#'],
    ['.+.', '+#+', '.+.'],
    ['..+..', '..#..', '+###+', '..#..', '..+..'],
    ['...+...', '...#...', '..+#+..', '+#####+', '..+#+..', '...#...', '...+...'],
  ];
  const HAZY = [['+'], ['+.+', '.+.', '+.+'], ['.+.+.', '+.+.+', '.+.+.', '+.+.+', '.+.+.'], ['+.+.+.+', '.+.+.+.', '+.+.+.+', '.+.+.+.', '+.+.+.+', '.+.+.+.', '+.+.+.+']];
  const TOLD = [['###', '#.#', '###'], ['###', '#.#', '###'], ['#####', '#...#', '#...#', '#...#', '#####'], ['#####', '#...#', '#...#', '#...#', '#####']];
  const sizeClass = s => (s.size < 0.25 ? 0 : s.size < 0.5 ? 1 : s.size < 0.78 ? 2 : 3);

  function sprite(w, h, paint) {
    const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); paint(c.getContext('2d')); return c;
  }

  function mount(el, { onOpen } = {}) {
    const canvas = el.canvas, ctx = canvas.getContext('2d');
    const still = root.matchMedia('(prefers-reduced-motion: reduce)');
    const SEEN = 'am.sky.seen';
    let L = layout([]), pts = [], sel = -1, hov = -1, visible = false, raf = 0, W = 0, H = 0, geo = null, colors = null;
    let replay = null, fresh = new Map(), seenAt = '', arrived = 0;
    let bg = null, neb = null, waves = [], meteors = [], nextMeteor = 0, lastDraw = 0;

    const readSeen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
    const writeSeen = () => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch {} };
    const motion = () => !still.matches;

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      colors = { sheet: cs.getPropertyValue('--sheet').trim() || '#0a1ff0', on: cs.getPropertyValue('--on-sheet').trim() || '#fff' };
    }

    function measure() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const small = W < 560;
      const laneH = 20, seaH = Math.max(small ? 60 : 84, L.lanes * laneH + 22), axisH = 26;
      const horizon = snap(H - axisH - seaH);
      const padX = small ? 14 : 24;
      geo = { small, laneH, seaH: H - axisH - horizon, axisH, horizon, padX, top: 22, bottom: horizon - 18, w: W - padX * 2, dpr };
      pts = L.stars.map(s => ({ x: snap(geo.padX + s.x * geo.w), y: snap(geo.top + s.y * (geo.bottom - geo.top)) }));
      paintBackdrop(); paintNebulae(); planWaves();
    }

    // Sheet blue, dithered darker toward the top and brighter at the horizon, ruled like a star chart, with dust.
    function paintBackdrop() {
      const { horizon, dpr, seaH } = geo;
      bg = sprite(W * dpr, H * dpr, g => {
        g.scale(dpr, dpr);
        g.fillStyle = colors.sheet; g.fillRect(0, 0, W, H);
        const C = U * 2;
        for (let y = 0; y < horizon; y += C) for (let x = 0; x < W; x += C) {
          const d = dither(x / C, y / C), up = (1 - y / horizon) * 0.7, glow = Math.max(0, 1 - (horizon - y) / 56);
          if (up > d) { g.fillStyle = 'rgba(0,0,30,.13)'; g.fillRect(x, y, C, C); }
          if (glow * 0.8 > d) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, y, C, C); }
        }
        g.fillStyle = 'rgba(0,0,40,.16)'; g.fillRect(0, horizon, W, H - horizon);
        for (let y = horizon; y < horizon + seaH; y += C) for (let x = 0; x < W; x += C) {
          if ((y - horizon) / seaH * 0.8 > dither(x / C, y / C)) { g.fillStyle = 'rgba(0,0,30,.12)'; g.fillRect(x, y, C, C); }
        }
        // chart rulings: a dotted meridian for every year mark, and three parallels
        g.fillStyle = colors.on;
        g.globalAlpha = 0.13;
        for (const tk of L.ticks) { const x = snap(geo.padX + tk.x * geo.w); for (let y = geo.top - 10; y < horizon; y += 6) g.fillRect(x, y, 1, 1); }
        g.globalAlpha = 0.08;
        for (const f of [0.25, 0.5, 0.75]) { const y = snap(geo.top + f * (horizon - geo.top)); for (let x = geo.padX; x < W - geo.padX; x += 6) g.fillRect(x, y, 1, 1); }
        // dust: what has not been written yet
        const n = Math.round((W * horizon) / (geo.small ? 1100 : 1500));
        for (let i = 0; i < n; i++) {
          const big = Math.random() < 0.12;
          g.globalAlpha = big ? 0.3 : 0.16 + Math.random() * 0.22;
          g.fillRect(Math.round(Math.random() * W), Math.round(Math.random() * (horizon - 4)), big ? 2 : 1, big ? 2 : 1);
        }
        g.globalAlpha = 1;
      });
    }

    // Each chapter is an ordered-dither cloud over its years; a chapter with more memories glows thicker.
    function paintNebulae() {
      const { horizon, top, dpr } = geo, C = U * 2, cols = Math.ceil(W / C), rows = Math.ceil(horizon / C);
      const dens = new Float32Array(cols * rows), skyH = horizon - top;
      for (const c of L.chapters) {
        const x0 = geo.padX + c.x0 * geo.w, x1 = geo.padX + c.x1 * geo.w;
        const blobs = 3 + Math.min(9, Math.floor(c.count / 2)), amp = Math.min(1, 0.4 + c.count * 0.07);
        for (let k = 0; k < blobs; k++) {
          const cx = x0 + rand(c.id, 'nx' + k) * (x1 - x0), cy = top + (0.15 + rand(c.id, 'ny' + k) * 0.7) * skyH;
          const r = clamp((x1 - x0) * 0.42, 40, geo.small ? 130 : 230) * (0.5 + rand(c.id, 'nr' + k) * 0.8);
          const a = amp * (0.5 + rand(c.id, 'na' + k) * 0.5);
          const i0 = Math.max(0, Math.floor((cx - r) / C)), i1 = Math.min(cols - 1, Math.ceil((cx + r) / C));
          const j0 = Math.max(0, Math.floor((cy - r) / C)), j1 = Math.min(rows - 1, Math.ceil((cy + r) / C));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const dx = (i * C - cx) / r, dy = (j * C - cy) / (r * 0.7), q = dx * dx + dy * dy;
            if (q < 1) dens[j * cols + i] += a * (1 - q) * (1 - q);
          }
        }
      }
      neb = sprite(W * dpr, horizon * dpr, g => {
        g.scale(dpr, dpr); g.fillStyle = colors.on;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const v = Math.min(1.4, dens[j * cols + i]);
          if (!v) continue;
          const d = dither(i, j);
          if (v * 0.7 > d) { g.globalAlpha = 0.13; g.fillRect(i * C, j * C, C, C); }
          if (v - 0.75 > d) { g.globalAlpha = 0.12; g.fillRect(i * C, j * C, U, U); }
        }
      });
    }

    function planWaves() {
      const { horizon, seaH } = geo;
      waves = [];
      for (let y = horizon + 8, k = 0; y < horizon + seaH - 4; y += 8, k++) {
        const dashes = [];
        for (let x = 0; x < W * 2;) { const len = (3 + Math.floor(hash(k + ':' + x) * 6)) * U; dashes.push([x, len]); x += len + (4 + Math.floor(hash(x + '/' + k) * 14)) * U; }
        waves.push({ y, dashes, dir: k % 2 ? 1 : -1, a: 0.14 - k * 0.012 });
      }
    }

    function plot(rows, cx, cy, alpha) {
      const n = rows.length, x0 = cx - Math.floor(n / 2) * U, y0 = cy - Math.floor(n / 2) * U;
      for (let r = 0; r < n; r++) for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === '.') continue;
        ctx.globalAlpha = alpha * (ch === '+' ? 0.45 : 1);
        ctx.fillRect(x0 + c * U, y0 + r * U, U, U);
      }
    }

    function spawnMeteor(t, target, delay = 0) {
      const ang = Math.PI * (0.78 + Math.random() * 0.06), dx = Math.cos(ang), dy = Math.sin(ang);
      const dist = target ? 220 + Math.random() * 120 : 240 + Math.random() * 240;
      const end = target || { x: W * (0.1 + Math.random() * 0.8), y: geo.top + Math.random() * (geo.bottom - geo.top) * 0.6 };
      meteors.push({ sx: end.x - dx * dist, sy: end.y - dy * dist, dx, dy, dist, t0: t + delay, dur: target ? 650 : 950, target: !!target });
    }
    function drawMeteor(m, t) {
      const p = (t - m.t0) / m.dur;
      if (p < 0) return true;
      if (p > 1.2) return false;
      const q = Math.min(p, 1), hx = m.sx + m.dx * m.dist * q, hy = m.sy + m.dy * m.dist * q;
      const fade = m.target ? (p > 1 ? 0 : 1) : 1 - Math.max(0, (p - 0.7) / 0.5);
      const tail = Math.min(16, Math.floor(q * 40));
      for (let k = 0; k <= tail; k++) {
        ctx.globalAlpha = fade * (1 - k / (tail + 1)) * (k < 2 ? 1 : 0.8);
        ctx.fillRect(snap(hx - m.dx * k * 4), snap(hy - m.dy * k * 4), U, U);
      }
      return true;
    }
    // A stepped square ring opening outward: where a memory lands, or lights up in the replay.
    function flare(p, age) {
      if (age < 0 || age > 1) return;
      const step = Math.floor(age * 7), r = (3 + step * 3) * U, a = 1 - step / 7;
      ctx.globalAlpha = a;
      ctx.fillRect(p.x - r, p.y - r, r * 2 + U, U); ctx.fillRect(p.x - r, p.y + r, r * 2 + U, U);
      ctx.fillRect(p.x - r, p.y - r, U, r * 2); ctx.fillRect(p.x + r, p.y - r, U, r * 2);
      if (step < 2) plot(SPARK[3], p.x, p.y, 1);
    }

    function tag(i, strong) {
      const p = pts[i], m = L.stars[i].m, arm = 6, o = 12;
      ctx.globalAlpha = strong ? 1 : 0.7; ctx.fillStyle = colors.on;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = p.x + sx * o, cy = p.y + sy * o;
        ctx.fillRect(sx < 0 ? cx : cx - arm + U, cy, arm, U * (strong ? 1 : 0.5));
        ctx.fillRect(cx, sy < 0 ? cy : cy - arm + U, U * (strong ? 1 : 0.5), arm);
      }
      let text = AM.titleOf(m);
      ctx.font = `400 12px "Noto Sans SC", "PingFang SC", system-ui, sans-serif`;
      while (text.length > 1 && ctx.measureText(text).width > 180) text = text.slice(0, -2) + '…';
      const w = Math.ceil(ctx.measureText(text).width) + 14, h = 22;
      let x = p.x + o + 8, y = p.y - o - h / 2;
      if (x + w > W - 4) x = p.x - o - 8 - w;
      y = clamp(y, 4, geo.horizon - h - 4);
      ctx.fillStyle = colors.sheet; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = colors.on; ctx.globalAlpha = strong ? 1 : 0.8;
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
      ctx.textBaseline = 'middle'; ctx.fillText(text, x + 7, y + h / 2 + 1);
    }

    function draw(t = performance.now()) {
      if (!geo) return;
      lastDraw = t;
      const { horizon, seaH, laneH, padX, small } = geo, move = motion(), on = colors.on;
      const sky = replay ? new Set(L.order.slice(0, replay.count)) : null;
      const lit = i => (!sky || sky.has(i)) && !(move && fresh.has(i) && t < fresh.get(i));
      ctx.globalAlpha = 1; ctx.drawImage(bg, 0, 0, W, H);
      ctx.globalAlpha = replay ? Math.min(1, replay.count / Math.max(1, L.order.length) + 0.1) : 1;
      ctx.drawImage(neb, 0, 0, W, horizon);
      ctx.fillStyle = on;

      // constellations: dotted lines between memories about the same person
      const selNames = sel >= 0 ? new Set(namesOf(L.stars[sel].m)) : null;
      for (const ln of L.links) {
        if (!lit(ln.a) || !lit(ln.b)) continue;
        const a = pts[ln.a], b = pts[ln.b], hot = selNames && selNames.has(ln.name);
        const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.floor(len / (hot ? 4 : 5));
        ctx.globalAlpha = hot ? 0.95 : 0.5;
        for (let k = 1; k < steps; k++) ctx.fillRect(snap(a.x + (b.x - a.x) * k / steps), snap(a.y + (b.y - a.y) * k / steps), U, hot ? U : 1);
      }

      // stars
      L.stars.forEach((s, i) => {
        if (!lit(i)) return;
        const p = pts[i], cls = sizeClass(s);
        const q = move ? (t / (1600 + rand(s.id, 't') * 2600) + rand(s.id, 'p')) % 1 : 0.5;
        const dim = q < 0.1 && cls > 0, glint = q > 0.5 && q < 0.56 && cls >= 2;
        const c = dim ? cls - 1 : cls;
        if (s.cert === 'clear') {
          const side = (SPARK[c].length + 2) * U;
          ctx.globalAlpha = 0.12; ctx.fillRect(p.x - side / 2 + U / 2, p.y - side / 2 + U / 2, side, side);
          plot(SPARK[c], p.x, p.y, 1);
        } else if (s.cert === 'hazy') {
          const side = (HAZY[c].length + 4) * U;
          ctx.globalAlpha = 0.1; ctx.fillRect(p.x - side / 2 + U / 2, p.y - side / 2 + U / 2, side, side);
          plot(HAZY[c], p.x, p.y, 0.9);
        } else plot(TOLD[c], p.x, p.y, 0.95);
        if (glint) {
          const g = (Math.floor(SPARK[c].length / 2) + 1) * U;
          ctx.globalAlpha = 0.7;
          for (const [gx, gy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(p.x + gx * g, p.y + gy * g, U, U);
        }
        if (s.key) {
          const half = Math.floor(SPARK[c].length / 2), n = 3 + cls * 2;
          for (let k = 1; k <= n; k++) {
            ctx.globalAlpha = 0.65 * (1 - k / (n + 1));
            const d = (half + k) * U;
            ctx.fillRect(p.x - d, p.y, U, U); ctx.fillRect(p.x + d, p.y, U, U);
            ctx.fillRect(p.x, p.y - d, U, U); ctx.fillRect(p.x, p.y + d, U, U);
          }
        }
      });

      if (move) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horizon); ctx.clip();
        if (!replay && t > nextMeteor) { if (nextMeteor) spawnMeteor(t); nextMeteor = t + 7000 + Math.random() * 9000; }
        meteors = meteors.filter(m => drawMeteor(m, t));
        if (replay) for (const [i, at] of replay.lit) flare(pts[i], (t - at) / 900);
        for (const [i, at] of fresh) flare(pts[i], (t - at) / 1000);
        ctx.restore();
      }

      // the sea: drifting wave dashes, and every star again as a broken streak on the water
      ctx.save(); ctx.beginPath(); ctx.rect(0, horizon + 1, W, seaH); ctx.clip();
      const tick = move ? Math.floor(t / 260) : 0;
      for (const wv of waves) {
        ctx.globalAlpha = Math.max(0.03, wv.a);
        const off = ((tick * U * wv.dir) % W + W) % W;
        for (const [x, len] of wv.dashes) { const xx = x - off; if (xx > -len && xx < W) ctx.fillRect(xx, wv.y, len, 1); }
      }
      L.stars.forEach((s, i) => {
        if (!lit(i)) return;
        const p = pts[i], depth = (horizon - p.y) / (horizon - geo.top), y = snap(horizon + 4 + depth * (seaH - 8));
        const wob = move ? ((Math.floor(t / 320 + rand(s.id, 'w') * 9) % 3) - 1) * U : 0;
        const len = snap(4 + s.size * 12);
        ctx.globalAlpha = (s.cert === 'hazy' ? 0.14 : 0.3) * (1 - depth * 0.5);
        ctx.fillRect(p.x - len / 2 + wob, y, len, 1);
        if (len > 8) ctx.fillRect(p.x - len / 4 - wob, y + 3, len / 2, 1);
      });
      ctx.restore();

      // horizon, a blinking cursor at today, chapters, years
      ctx.globalAlpha = 0.6; ctx.fillRect(0, horizon, W, 1);
      const nx = snap(padX + L.nowX * geo.w);
      ctx.globalAlpha = !move || Math.floor(t / 550) % 2 === 0 ? 1 : 0;
      ctx.fillRect(nx - U, horizon - 7 * U, 2 * U, 7 * U);
      ctx.font = `400 ${small ? 10 : 11}px "Sometype Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      for (const c of L.chapters) {
        const x0 = snap(padX + c.x0 * geo.w), x1 = Math.max(x0 + U, snap(padX + c.x1 * geo.w)), y = horizon + 14 + c.lane * laneH;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x0, y, x1 - x0, 1);
        ctx.fillRect(x0, y - 3, 1, 7); ctx.fillRect(x1 - 1, y - 3, 1, 7);
        ctx.globalAlpha = 0.45;
        for (let x = x0 + 12; x < x1 - 6; x += 12) ctx.fillRect(x, y - 1, 1, 3);
        const room = x1 - x0 - 10;
        if (room > 14) {
          let label = c.title;
          while (label.length > 1 && ctx.measureText(label).width > room) label = label.slice(0, -2) + '…';
          const w = ctx.measureText(label).width + 8;
          ctx.globalAlpha = 1; ctx.fillStyle = colors.sheet; ctx.fillRect(x0 + 4, y - 7, w, 14);
          ctx.fillStyle = on; ctx.fillText(label, x0 + 8, y + 0.5);
        }
      }
      ctx.globalAlpha = 0.66; ctx.textBaseline = 'alphabetic';
      const axisY = H - 9;
      let lastRight = -Infinity;
      for (const tk of L.ticks) {
        const x = snap(padX + tk.x * geo.w), w = ctx.measureText(tk.label).width;
        ctx.globalAlpha = 0.4; ctx.fillRect(x, H - geo.axisH + 2, 1, 4);
        if (x - w / 2 < lastRight + 8 || x + w / 2 > W - 2) continue;
        ctx.globalAlpha = 0.66; ctx.fillText(tk.label, Math.max(2, x - w / 2), axisY); lastRight = x + w / 2;
      }
      if (L.undated) {
        const x = snap(padX + (L.timeW + 0.02) * geo.w);
        ctx.globalAlpha = 0.34;
        for (let y = geo.top; y < horizon; y += 6) ctx.fillRect(x, y, 1, 3);
        ctx.globalAlpha = 0.66;
        const label = '时间未定', w = ctx.measureText(label).width;
        ctx.fillText(label, Math.min(x + 6, W - 4 - w), axisY);
      }

      if (hov >= 0 && hov !== sel && lit(hov)) tag(hov, false);
      if (sel >= 0 && lit(sel)) tag(sel, true);
      ctx.globalAlpha = 1;
    }

    function loop(t) {
      raf = 0;
      if (!visible) return;
      if (replay) stepReplay(t);
      if (t - lastDraw >= 33) draw(t); // about 30 frames a second: enough for stepped pixel motion, easy on the battery
      if ((motion() || replay) && document.visibilityState === 'visible') raf = requestAnimationFrame(loop);
    }
    function kick() { if (visible && !raf) raf = requestAnimationFrame(loop); }

    /* ---------- replay: the sky as it filled, one day at a time ---------- */
    function stepReplay(t) {
      const n = L.order.length, p = clamp((t - replay.t0) / replay.dur, 0, 1);
      const count = Math.max(1, Math.ceil(p * n));
      for (let k = replay.count; k < count; k++) replay.lit.set(L.order[k], t);
      replay.count = count;
      const star = L.stars[L.order[count - 1]];
      el.onReplay && el.onReplay({ count, total: n, day: dayNumber(L.stars[L.order[0]].day, star.day), date: star.day, done: p >= 1 });
      if (p >= 1 && t - replay.t0 > replay.dur + 1200) stopReplay();
    }
    function startReplay() {
      if (!L.stars.length) return;
      replay = { t0: performance.now(), dur: clamp(2400 + L.stars.length * 60, 3000, 9000), count: 0, lit: new Map() };
      fresh = new Map(); meteors = [];
      sel = -1; el.onSelect && el.onSelect(null);
      kick();
    }
    function stopReplay() {
      replay = null;
      el.onReplay && el.onReplay(null);
      draw(); kick();
    }

    // New memories fall in as meteors, one after another, and light up where they land.
    function arrive(list) {
      arrived += list.length;
      const now = performance.now();
      list.slice(0, 12).forEach((i, k) => {
        const delay = 400 + k * 380;
        if (motion()) spawnMeteor(now, pts[i], delay);
        fresh.set(i, now + delay + 650);
      });
    }

    /* ---------- picking ---------- */
    function pick(x, y) {
      let best = -1, bd = (geo && geo.small ? 26 : 20) ** 2;
      pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function select(i) {
      sel = i;
      el.onSelect && el.onSelect(i >= 0 ? L.stars[i].m : null);
      draw(); kick();
    }
    canvas.addEventListener('click', e => {
      if (replay) stopReplay();
      const r = canvas.getBoundingClientRect();
      const i = pick(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0 && i === sel && onOpen) return onOpen(L.stars[i].m.id);
      select(i);
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || replay) return;
      const r = canvas.getBoundingClientRect(), i = pick(e.clientX - r.left, e.clientY - r.top);
      if (i !== hov) { hov = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; draw(); }
    });
    canvas.addEventListener('pointerleave', () => { if (hov >= 0) { hov = -1; draw(); } });
    canvas.addEventListener('keydown', e => {
      const n = L.stars.length;
      if (!n) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') select(sel < 0 ? 0 : (sel + 1) % n);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') select(sel < 0 ? n - 1 : (sel - 1 + n) % n);
      else if ((e.key === 'Enter' || e.key === ' ') && sel >= 0 && onOpen) onOpen(L.stars[sel].m.id);
      else if (e.key === 'Escape') select(-1);
      else return;
      e.preventDefault();
    });

    new ResizeObserver(() => { if (visible) { measure(); draw(); } }).observe(canvas);
    still.addEventListener && still.addEventListener('change', () => { draw(); kick(); });
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (visible) { readColors(); measure(); draw(); } });
    document.addEventListener('visibilitychange', () => { if (visible && document.visibilityState === 'hidden') writeSeen(); kick(); });
    document.fonts && document.fonts.ready.then(() => visible && draw());

    return {
      update(mems) {
        const keep = sel >= 0 ? L.stars[sel].id : null;
        const before = new Set(L.stars.map(s => s.id)), hadAny = before.size > 0;
        const wasFresh = new Map([...fresh].map(([i, at]) => [L.stars[i].id, at]));
        L = layout(mems);
        sel = keep ? L.stars.findIndex(s => s.id === keep) : -1; hov = -1;
        if (sel < 0) el.onSelect && el.onSelect(null);
        if (replay) stopReplay();
        fresh = new Map();
        L.stars.forEach((s, i) => { if (wasFresh.has(s.id)) fresh.set(i, wasFresh.get(s.id)); });
        if (visible) {
          measure();
          // On first load, what was written since the last visit falls in; later, anything that syncs in does.
          arrive(L.stars.map((s, i) => i).filter(i => !before.has(L.stars[i].id) && (hadAny || (seenAt && String(L.stars[i].m.recordedAt || '') > seenAt))));
          draw(); kick();
        }
        return L;
      },
      show() {
        visible = true; seenAt = readSeen(); arrived = 0;
        fresh = new Map(); meteors = []; nextMeteor = 0;
        readColors(); measure();
        arrive(L.stars.map((s, i) => i).filter(i => seenAt && String(L.stars[i].m.recordedAt || '') > seenAt));
        draw(); kick();
      },
      hide() {
        if (!visible) return;
        visible = false; replay = null; el.onReplay && el.onReplay(null);
        if (raf) cancelAnimationFrame(raf); raf = 0;
        writeSeen();
      },
      replay() { if (replay) stopReplay(); else startReplay(); return !!replay; },
      get arrived() { return arrived; },
      get layout() { return L; },
    };
  }

  root.AMSky = { layout, mount, dayNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AMSky;
})(typeof globalThis !== 'undefined' ? globalThis : this);
