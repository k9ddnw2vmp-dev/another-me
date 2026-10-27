/* 另一个我 · 星空
 * Every bright star is one memory. Left to right is when it happened, from the earliest year you wrote about
 * to today; each life chapter glows as a nebula over its years and lies on the horizon, mirrored in the sea.
 * The faint dust behind them stands for what has not been written yet; meteors are the only pure ornament.
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
    return { from, to: end, timeW, stars, links, chapters: segs, lanes: lanes.length, ticks, order, undated: undated.length };
  }

  // Calendar days between two 'YYYY-MM-DD' strings, counted from 1.
  function dayNumber(first, day) {
    const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return first && day ? Math.round((t(day) - t(first)) / 864e5) + 1 : 1;
  }

  /* ---------- drawing ---------- */

  // Chapter nebulae, in the blues and violets of the rest of the app.
  const PAL = ['#3d5cff', '#7b4dff', '#1fb6ff', '#5b3dff', '#b04dff', '#2f8bff'];
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

  function sprite(w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c;
  }
  function radial(stops) {
    return sprite(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      stops.forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  function streak(vertical) {
    return sprite(vertical ? 4 : 128, vertical ? 128 : 4, (g, w, h) => {
      const gr = vertical ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(200,215,255,0)'); gr.addColorStop(0.5, 'rgba(235,240,255,1)'); gr.addColorStop(1, 'rgba(200,215,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }

  function mount(el, { onOpen } = {}) {
    const canvas = el.canvas, ctx = canvas.getContext('2d');
    const still = root.matchMedia('(prefers-reduced-motion: reduce)');
    const SEEN = 'am.sky.seen';
    const GLOW = radial([[0, 'rgba(255,255,255,1)'], [0.06, 'rgba(240,244,255,.95)'], [0.18, 'rgba(160,180,255,.45)'], [0.45, 'rgba(90,110,255,.12)'], [1, 'rgba(60,80,255,0)']]);
    const HAZE = radial([[0, 'rgba(210,200,255,.55)'], [0.35, 'rgba(150,130,255,.22)'], [1, 'rgba(110,90,255,0)']]);
    const MILKY = radial([[0, 'rgba(110,130,255,.6)'], [0.5, 'rgba(70,90,255,.2)'], [1, 'rgba(40,60,255,0)']]);
    const SPIKE_H = streak(false), SPIKE_V = streak(true);

    let L = layout([]), pts = [], sel = -1, visible = false, raf = 0, W = 0, H = 0, geo = null;
    let replay = null, fresh = new Map(), seenAt = '', arrived = 0;
    let bg = null, dust = null, neb = null, meteors = [], nextMeteor = 0;
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

    const readSeen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
    const writeSeen = () => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch {} };
    const motion = () => !still.matches;

    function measure() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const small = W < 560;
      const laneH = 20, seaH = Math.max(small ? 60 : 84, L.lanes * laneH + 22), axisH = 26;
      const horizon = H - axisH - seaH;
      const padX = small ? 14 : 24;
      geo = { small, laneH, seaH, axisH, horizon, padX, top: 22, bottom: horizon - 18, w: W - padX * 2, dpr };
      pts = L.stars.map(s => ({ x: geo.padX + s.x * geo.w, y: geo.top + s.y * (geo.bottom - geo.top) }));
      paintBackdrop(); paintDust(); paintNebulae();
    }

    // Deep space fading to an electric-blue horizon, and the dark sea beneath it.
    function paintBackdrop() {
      const { horizon, dpr } = geo;
      bg = sprite(W * dpr, H * dpr, g => {
        g.scale(dpr, dpr);
        const sky = g.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#010209'); sky.addColorStop(0.55, '#040824'); sky.addColorStop(1, '#0c1a5e');
        g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
        const sea = g.createLinearGradient(0, horizon, 0, H);
        sea.addColorStop(0, '#071040'); sea.addColorStop(0.5, '#02051a'); sea.addColorStop(1, '#010209');
        g.fillStyle = sea; g.fillRect(0, horizon, W, H - horizon);
        g.save(); g.translate(W / 2, horizon); g.scale(1, 0.16);
        const glow = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.75);
        glow.addColorStop(0, 'rgba(40,70,255,.55)'); glow.addColorStop(0.5, 'rgba(30,50,255,.18)'); glow.addColorStop(1, 'rgba(20,30,255,0)');
        g.fillStyle = glow; g.fillRect(-W, -W, W * 2, W * 2); g.restore();
      });
    }

    // Dust: what has not been written yet. Drawn twice as wide so it can drift and wrap.
    function paintDust() {
      const { horizon, dpr } = geo, n = Math.round((W * horizon) / (geo.small ? 900 : 1300));
      dust = sprite(W * dpr, horizon * dpr, g => {
        g.scale(dpr, dpr);
        for (let i = 0; i < n; i++) {
          const x = Math.random() * W, y = Math.random() * horizon, big = Math.random() < 0.08;
          g.globalAlpha = (big ? 0.35 : 0.12) + Math.random() * 0.3 * (1 - y / horizon * 0.5);
          g.fillStyle = Math.random() < 0.2 ? '#b9a8ff' : '#c9d4ff';
          g.beginPath(); g.arc(x, y, big ? 0.9 : 0.5, 0, 6.283); g.fill();
        }
      });
    }

    function paintNebulae() {
      const { horizon, top, dpr } = geo, skyH = horizon - top;
      neb = sprite(W * dpr, horizon * dpr, g => {
        g.scale(dpr, dpr); g.globalCompositeOperation = 'lighter';
        L.chapters.forEach((c, i) => {
          const col = PAL[i % PAL.length], x0 = geo.padX + c.x0 * geo.w, x1 = geo.padX + c.x1 * geo.w;
          const blobs = 3 + Math.min(9, Math.floor(c.count / 2)), a = Math.min(0.32, 0.1 + c.count * 0.012);
          for (let k = 0; k < blobs; k++) {
            const cx = x0 + rand(c.id, 'nx' + k) * (x1 - x0);
            const cy = top + (0.15 + rand(c.id, 'ny' + k) * 0.7) * skyH;
            const r = clamp((x1 - x0) * 0.5, 50, geo.small ? 160 : 280) * (0.55 + rand(c.id, 'nr' + k) * 0.8);
            const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
            gr.addColorStop(0, rgba(col, a)); gr.addColorStop(0.45, rgba(col, a * 0.4)); gr.addColorStop(1, rgba(col, 0));
            g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
          }
        });
      });
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

    function blit(img, x, y, r, alpha) {
      ctx.globalAlpha = alpha; ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    }

    function spawnMeteor(t, target, delay = 0) {
      const ang = Math.PI * (0.78 + Math.random() * 0.08), dx = Math.cos(ang), dy = Math.sin(ang);
      const dist = target ? 240 + Math.random() * 120 : 260 + Math.random() * 260;
      const end = target ? { x: target.x, y: target.y } : { x: W * (0.1 + Math.random() * 0.8), y: geo.top + Math.random() * (geo.bottom - geo.top) * 0.6 };
      meteors.push({ sx: end.x - dx * dist, sy: end.y - dy * dist, dx, dy, dist, t0: t + delay, dur: target ? 650 : 900, target: !!target, len: 90 + Math.random() * 90 });
    }

    function drawMeteor(m, t) {
      const p = (t - m.t0) / m.dur;
      if (p < 0 || p > 1.15) return p <= 1.15;
      const q = Math.min(p, 1), hx = m.sx + m.dx * m.dist * q, hy = m.sy + m.dy * m.dist * q;
      const tail = m.len * Math.min(1, q * 3), fade = m.target ? 1 : 1 - Math.max(0, (p - 0.75) / 0.4);
      const gr = ctx.createLinearGradient(hx - m.dx * tail, hy - m.dy * tail, hx, hy);
      gr.addColorStop(0, 'rgba(160,180,255,0)'); gr.addColorStop(1, `rgba(235,240,255,${0.9 * fade})`);
      ctx.globalAlpha = 1; ctx.strokeStyle = gr; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx - m.dx * tail, hy - m.dy * tail); ctx.lineTo(hx, hy); ctx.stroke();
      if (p <= 1) blit(GLOW, hx, hy, 9, fade);
      return true;
    }

    function flare(p, age) {
      if (age < 0 || age > 1) return;
      blit(GLOW, p.x, p.y, 10 + age * 46, (1 - age) * 0.9);
      ctx.globalAlpha = (1 - age) * 0.7; ctx.strokeStyle = '#dfe6ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 + age * 28, 0, 6.283); ctx.stroke();
    }

    function draw(t = performance.now()) {
      if (!geo) return;
      const { horizon, seaH, laneH, padX, small } = geo, move = motion();
      const sky = replay ? new Set(L.order.slice(0, replay.count)) : null;
      const pending = i => fresh.has(i) && move && t < fresh.get(i);
      const lit = i => (!sky || sky.has(i)) && !pending(i);
      tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;

      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(bg, 0, 0, W, H);

      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horizon); ctx.clip();
      // far layer: dust drifts slowly and leans away from the pointer
      const drift = move ? (t * 0.004) % W : 0, dx = -drift + tilt.x * 10, dy = tilt.y * 6;
      for (const ox of [dx - W, dx, dx + W]) ctx.drawImage(dust, ox, dy, W, horizon);
      ctx.globalCompositeOperation = 'lighter';
      const breathe = move ? 0.88 + 0.12 * Math.sin(t / 3200) : 1;
      ctx.globalAlpha = breathe * (replay ? Math.min(1, replay.count / Math.max(1, L.order.length) + 0.15) : 1);
      ctx.drawImage(neb, tilt.x * 5, tilt.y * 3, W, horizon);

      // the galaxy: where many memories crowd together, their light pools
      L.stars.forEach((s, i) => { if (lit(i)) blit(MILKY, pts[i].x, pts[i].y, (small ? 24 : 34) + s.size * (small ? 34 : 52), 0.075); });

      // constellations
      const selNames = sel >= 0 ? new Set(namesOf(L.stars[sel].m)) : null;
      ctx.globalCompositeOperation = 'source-over';
      for (const ln of L.links) {
        if (!lit(ln.a) || !lit(ln.b)) continue;
        const hot = selNames && selNames.has(ln.name);
        ctx.globalAlpha = 1; ctx.strokeStyle = hot ? 'rgba(210,225,255,.9)' : 'rgba(140,170,255,.26)'; ctx.lineWidth = hot ? 1.2 : 0.8;
        ctx.beginPath(); ctx.moveTo(pts[ln.a].x, pts[ln.a].y); ctx.lineTo(pts[ln.b].x, pts[ln.b].y); ctx.stroke();
      }

      // stars
      ctx.globalCompositeOperation = 'lighter';
      const scale = small ? 0.85 : 1;
      L.stars.forEach((s, i) => {
        if (!lit(i)) return;
        const p = pts[i], s0 = (1.1 + s.size * 2.6) * scale;
        const tw = move ? 0.78 + 0.22 * Math.sin(t / (600 + rand(s.id, 't') * 900) + rand(s.id, 'p') * 6.283) : 1;
        if (s.cert === 'clear') {
          blit(GLOW, p.x, p.y, s0 * 8 * (0.88 + 0.12 * tw), 0.95 * tw);
          ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, s0 * 0.55, 0, 6.283); ctx.fill();
        } else if (s.cert === 'hazy') {
          blit(HAZE, p.x, p.y, s0 * 7.5, 0.8 * tw);
        } else {
          blit(GLOW, p.x, p.y, s0 * 4, 0.3 * tw);
          ctx.globalAlpha = 0.9; ctx.strokeStyle = '#a8dcff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, s0 + 1.6, 0, 6.283); ctx.stroke();
        }
        if (s.key) {
          const len = s0 * 9 + 8;
          ctx.globalAlpha = 0.8 * tw;
          ctx.drawImage(SPIKE_H, p.x - len, p.y - 0.75, len * 2, 1.5);
          ctx.drawImage(SPIKE_V, p.x - 0.75, p.y - len, 1.5, len * 2);
        }
      });

      // meteors and arrivals
      if (move) {
        if (!replay && t > nextMeteor) { if (nextMeteor) spawnMeteor(t); nextMeteor = t + 5000 + Math.random() * 9000; }
        meteors = meteors.filter(m => drawMeteor(m, t));
        if (replay) for (const [i, at] of replay.lit) flare(pts[i], (t - at) / 900);
        for (const [i, at] of fresh) flare(pts[i], (t - at) / 1100);
      }
      ctx.restore();

      // the sea: each star again, as a shimmer on the water
      ctx.save(); ctx.beginPath(); ctx.rect(0, horizon + 1, W, seaH); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      L.stars.forEach((s, i) => {
        if (!lit(i)) return;
        const p = pts[i], depth = (horizon - p.y) / (horizon - geo.top), y = horizon + 4 + depth * (seaH - 8);
        const wob = move ? Math.sin(t / 800 + rand(s.id, 'w') * 6.283) * 2 : 0, len = 4 + s.size * 12;
        ctx.globalAlpha = (s.cert === 'hazy' ? 0.2 : 0.38) * (1 - depth * 0.55);
        ctx.drawImage(SPIKE_H, p.x - len + wob, y - 1, len * 2, 2);
      });
      ctx.restore();

      // horizon, chapters, years
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.8; ctx.fillStyle = '#8fa2ff'; ctx.fillRect(0, horizon, W, 1);
      ctx.font = `400 ${small ? 10 : 11}px "Sometype Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      L.chapters.forEach((c, i) => {
        const col = PAL[i % PAL.length];
        const x0 = padX + c.x0 * geo.w, x1 = Math.max(x0 + 2, padX + c.x1 * geo.w), y = horizon + 14 + c.lane * laneH;
        ctx.globalAlpha = 1; ctx.fillStyle = rgba(col, 0.95);
        ctx.fillRect(x0, y, x1 - x0, 1.5); ctx.fillRect(x0, y - 3, 1.5, 7.5); ctx.fillRect(x1 - 1.5, y - 3, 1.5, 7.5);
        const room = x1 - x0 - 10;
        if (room > 14) {
          let label = c.title;
          while (label.length > 1 && ctx.measureText(label).width > room) label = label.slice(0, -2) + '…';
          const w = ctx.measureText(label).width + 8;
          ctx.fillStyle = 'rgba(2,4,20,.85)'; ctx.fillRect(x0 + 4, y - 7, w, 14);
          ctx.fillStyle = '#eef1ff'; ctx.fillText(label, x0 + 8, y + 0.5);
        }
      });
      ctx.globalAlpha = 0.62; ctx.fillStyle = '#dfe5ff'; ctx.textBaseline = 'alphabetic';
      const axisY = H - 9;
      let lastRight = -Infinity;
      for (const tk of L.ticks) {
        const x = padX + tk.x * geo.w, w = ctx.measureText(tk.label).width;
        if (x - w / 2 < lastRight + 8 || x + w / 2 > W - 2) continue;
        ctx.fillText(tk.label, Math.max(2, x - w / 2), axisY); lastRight = x + w / 2;
      }
      if (L.undated) {
        const x = padX + (L.timeW + 0.02) * geo.w;
        ctx.globalAlpha = 0.3;
        for (let y = geo.top; y < horizon; y += 6) ctx.fillRect(Math.round(x), y, 1, 3);
        ctx.globalAlpha = 0.62;
        const label = '时间未定', w = ctx.measureText(label).width;
        if (x + 6 + w < W) ctx.fillText(label, x + 6, axisY);
      }

      if (sel >= 0 && lit(sel)) {
        const p = pts[sel];
        ctx.globalAlpha = 0.95; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 6.283); ctx.stroke();
        ctx.beginPath();
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(p.x + ax * 16, p.y + ay * 16); ctx.lineTo(p.x + ax * 22, p.y + ay * 22); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function loop(t) {
      raf = 0;
      if (!visible) return;
      if (replay) stepReplay(t);
      draw(t);
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

    /* ---------- picking and parallax ---------- */
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
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      tilt.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; tilt.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });
    canvas.addEventListener('pointerleave', () => { tilt.tx = 0; tilt.ty = 0; });
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
    document.addEventListener('visibilitychange', () => { if (visible && document.visibilityState === 'hidden') writeSeen(); kick(); });
    document.fonts && document.fonts.ready.then(() => visible && draw());

    return {
      update(mems) {
        const keep = sel >= 0 ? L.stars[sel].id : null;
        const before = new Map(L.stars.map(s => [s.id, s])), hadAny = before.size > 0;
        const wasFresh = new Map([...fresh].map(([i, at]) => [L.stars[i].id, at]));
        L = layout(mems);
        sel = keep ? L.stars.findIndex(s => s.id === keep) : -1;
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
        measure();
        arrive(L.stars.map((s, i) => i).filter(i => seenAt && String(L.stars[i].m.recordedAt || '') > seenAt));
        draw(); kick();
      },
      get arrived() { return arrived; },
      hide() {
        if (!visible) return;
        visible = false; replay = null; el.onReplay && el.onReplay(null);
        if (raf) cancelAnimationFrame(raf); raf = 0;
        writeSeen();
      },
      replay() { if (replay) stopReplay(); else startReplay(); return !!replay; },
      get layout() { return L; },
    };
  }

  root.AMSky = { layout, mount, dayNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AMSky;
})(typeof globalThis !== 'undefined' ? globalThis : this);
