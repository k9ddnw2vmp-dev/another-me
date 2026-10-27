/* 另一个我 · 星空
 * Every memory is one star, and nothing else in the sky is decoration. Left to right is when it happened,
 * from the earliest year you wrote about to today; your life chapters lie along the horizon, mirrored in the sea.
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

  function mount(el, { onOpen } = {}) {
    const canvas = el.canvas, ctx = canvas.getContext('2d');
    const still = root.matchMedia('(prefers-reduced-motion: reduce)');
    const SEEN = 'am.sky.seen';
    let L = layout([]), pts = [], sel = -1, visible = false, raf = 0, W = 0, H = 0, geo = null;
    let replay = null, fresh = new Set(), freshAt = 0, colors = null;

    const readSeen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
    const writeSeen = () => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch {} };

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
      const small = W < 560;
      const laneH = 20, seaH = Math.max(small ? 56 : 76, L.lanes * laneH + 18), axisH = 26;
      const horizon = H - axisH - seaH;
      const padX = small ? 14 : 24;
      geo = { small, laneH, seaH, axisH, horizon, padX, top: 18, bottom: horizon - 14, w: W - padX * 2 };
      pts = L.stars.map(s => ({ x: geo.padX + s.x * geo.w, y: geo.top + s.y * (geo.bottom - geo.top) }));
    }

    function shown() {
      if (!replay) return null;
      return new Set(L.order.slice(0, replay.count));
    }

    function draw(t = performance.now()) {
      if (!geo) return;
      const { horizon, seaH, axisH, laneH, padX, small } = geo;
      const on = colors.on, sky = shown(), motion = !still.matches;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = colors.sheet; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = on;

      // The sea: every star again, as a broken streak on the water.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, horizon, W, seaH); ctx.clip();
      L.stars.forEach((s, i) => {
        if (sky && !sky.has(i)) return;
        const p = pts[i], depth = (horizon - p.y) / (horizon - geo.top);
        const y = horizon + 3 + depth * (seaH - 6);
        const wobble = motion ? Math.sin(t / 900 + rand(s.id, 'w') * 6.28) * 1.5 : 0;
        const len = 2 + s.size * 7;
        ctx.globalAlpha = (s.cert === 'hazy' ? 0.1 : 0.2) * (1 - depth * 0.5);
        ctx.fillRect(Math.round(p.x - len / 2 + wobble), Math.round(y), Math.round(len), 1);
      });
      ctx.restore();

      // Horizon and the chapters lying on it.
      ctx.globalAlpha = 0.55; ctx.fillRect(0, horizon, W, 1);
      ctx.font = `400 ${small ? 10 : 11}px "Sometype Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      for (const c of L.chapters) {
        const x0 = padX + c.x0 * geo.w, x1 = Math.max(x0 + 2, padX + c.x1 * geo.w), y = horizon + 12 + c.lane * laneH;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(x0), y, Math.round(x1 - x0), 1);
        ctx.fillRect(Math.round(x0), y - 3, 1, 7); ctx.fillRect(Math.round(x1) - 1, y - 3, 1, 7);
        const room = x1 - x0 - 10;
        if (room > 14) {
          let label = c.title;
          while (label.length > 1 && ctx.measureText(label).width > room) label = label.slice(0, -2) + '…';
          const w = ctx.measureText(label).width + 8;
          ctx.globalAlpha = 1; ctx.fillStyle = colors.sheet; ctx.fillRect(x0 + 4, y - 7, w, 14);
          ctx.fillStyle = on; ctx.fillText(label, x0 + 8, y);
        }
      }

      // Years along the bottom; a dashed wall before the memories that have no date yet.
      ctx.globalAlpha = 0.66; ctx.textBaseline = 'alphabetic';
      const axisY = H - 9;
      let lastRight = -Infinity;
      for (const tk of L.ticks) {
        const x = padX + tk.x * geo.w, w = ctx.measureText(tk.label).width;
        if (x - w / 2 < lastRight + 8 || x + w / 2 > W - 2) continue;
        ctx.fillText(tk.label, Math.max(2, x - w / 2), axisY); lastRight = x + w / 2;
      }
      if (L.undated) {
        const x = padX + (L.timeW + 0.02) * geo.w;
        ctx.globalAlpha = 0.34;
        for (let y = geo.top; y < horizon; y += 6) ctx.fillRect(Math.round(x), y, 1, 3);
        ctx.globalAlpha = 0.66;
        const label = '时间未定', w = ctx.measureText(label).width;
        if (x + 6 + w < W) ctx.fillText(label, x + 6, axisY);
      }

      // Constellations.
      const selNames = sel >= 0 ? new Set(namesOf(L.stars[sel].m)) : null;
      for (const ln of L.links) {
        if (sky && (!sky.has(ln.a) || !sky.has(ln.b))) continue;
        const hot = selNames && selNames.has(ln.name);
        ctx.globalAlpha = hot ? 0.8 : 0.2;
        ctx.strokeStyle = on; ctx.lineWidth = hot ? 1 : 0.75;
        ctx.beginPath(); ctx.moveTo(pts[ln.a].x, pts[ln.a].y); ctx.lineTo(pts[ln.b].x, pts[ln.b].y); ctx.stroke();
      }

      // Stars: square pixels, like everything else in this app.
      const scale = small ? 0.85 : 1;
      L.stars.forEach((s, i) => {
        if (sky && !sky.has(i)) return;
        const p = pts[i], side = Math.max(2, Math.round((2 + s.size * 5) * scale));
        const twinkle = motion ? 0.82 + 0.18 * Math.sin(t / (700 + rand(s.id, 't') * 900) + rand(s.id, 'p') * 6.28) : 1;
        const x = Math.round(p.x - side / 2), y = Math.round(p.y - side / 2);
        if (s.cert !== 'told') {
          // halo
          ctx.globalAlpha = (s.cert === 'hazy' ? 0.16 : 0.12) * twinkle;
          const g = side * (s.cert === 'hazy' ? 2.6 : 1.8);
          ctx.fillRect(Math.round(p.x - g / 2), Math.round(p.y - g / 2), Math.round(g), Math.round(g));
        }
        ctx.globalAlpha = (s.cert === 'hazy' ? 0.5 : 1) * twinkle;
        if (s.cert === 'told') {
          ctx.strokeStyle = on; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, side, side);
        } else ctx.fillRect(x, y, side, side);
        if (s.key) {
          const ray = side + 4 + s.size * 6;
          ctx.globalAlpha = 0.7 * twinkle;
          ctx.fillRect(Math.round(p.x - ray), Math.round(p.y), Math.round(ray * 2), 1);
          ctx.fillRect(Math.round(p.x), Math.round(p.y - ray), 1, Math.round(ray * 2));
        }
      });

      // Stars that lit up since the last visit, or during the replay, flare once.
      const flare = (i, age) => {
        if (age < 0 || age > 1) return;
        const p = pts[i], r = 6 + age * 22;
        ctx.globalAlpha = (1 - age) * 0.9; ctx.strokeStyle = on; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(p.x - r) + 0.5, Math.round(p.y - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
      };
      if (motion && replay) for (const [i, at] of replay.lit) flare(i, (t - at) / 700);
      if (motion && !replay && fresh.size && t - freshAt < 6600) for (const i of fresh) flare(i, ((t - freshAt) % 2200) / 1400);

      if (sel >= 0 && (!sky || sky.has(sel))) {
        const p = pts[sel];
        ctx.globalAlpha = 1; ctx.strokeStyle = on; ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.round(p.x) - 9.25, Math.round(p.y) - 9.25, 18.5, 18.5);
      }
      ctx.globalAlpha = 1;
    }

    function loop(t) {
      raf = 0;
      if (!visible) return;
      if (replay) stepReplay(t);
      draw(t);
      const busy = replay || (!still.matches && (L.stars.length || fresh.size));
      if (busy && document.visibilityState === 'visible') raf = requestAnimationFrame(loop);
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
      if (p >= 1 && t - replay.t0 > replay.dur + 900) stopReplay();
    }
    function startReplay() {
      if (!L.stars.length) return;
      const n = L.stars.length;
      replay = { t0: performance.now(), dur: clamp(2400 + n * 60, 3000, 9000), count: 0, lit: new Map() };
      sel = -1; el.onSelect && el.onSelect(null);
      kick();
    }
    function stopReplay() {
      replay = null;
      el.onReplay && el.onReplay(null);
      draw(); kick();
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
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
    document.addEventListener('visibilitychange', () => { if (visible && document.visibilityState === 'hidden') writeSeen(); kick(); });
    document.fonts && document.fonts.ready.then(() => draw());

    return {
      update(mems) {
        const keep = sel >= 0 ? L.stars[sel].id : null;
        L = layout(mems);
        sel = keep ? L.stars.findIndex(s => s.id === keep) : -1;
        if (sel < 0) el.onSelect && el.onSelect(null);
        if (replay) stopReplay();
        if (visible) { measure(); draw(); kick(); }
        return L;
      },
      show() {
        visible = true; readColors();
        const seen = readSeen();
        fresh = new Set(seen ? L.stars.map((s, i) => (String(s.m.recordedAt || '') > seen ? i : -1)).filter(i => i >= 0) : []);
        freshAt = performance.now();
        measure(); draw(); kick();
        return fresh.size;
      },
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
