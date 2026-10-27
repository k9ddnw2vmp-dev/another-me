/* 另一个我 · app
 * Screens, the on-device database (IndexedDB), sign-in and the Supabase adapters.
 * Memory logic lives in core.js, sync rules in sync.js.
 */
(() => {
  'use strict';
  const AM = window.AM, AMSync = window.AMSync;
  const $ = id => document.getElementById(id);
  const pad = AM.pad;
  const CFG_KEY = 'am.config';
  const BUCKET = 'attachments';
  const MAX_FILE = 50 * 1024 * 1024;

  const FIELDS = {
    chapter: { title: '这一章叫什么', when: '从哪年到哪年，例如 1990—2002、2015 至今', body: '这一章大致讲了什么？', meaning: '这一章让你成为了什么样的人？', certainty: true },
    scene:   { title: '给这段记忆起个名字（可不填）', when: '什么时候，例如 1998、约1998、90年代', where: true, people: true, body: '发生了什么？用你自己的话，不必修饰。', feeling: '当时你在想什么，感受到什么？', meaning: '它为什么重要？它说明了你是谁？', certainty: true },
    person:  { title: '他/她的名字或称呼', when: '认识于，例如 2008', relation: true, body: '他/她是个什么样的人？你们之间发生过什么？', meaning: '他/她在你身上留下了什么？', certainty: true },
    belief:  { title: '关于什么，例如：爱、金钱、死亡', when: '这个看法形成于（可不填）', body: '你怎么看？', meaning: '这个看法从哪里来？哪段经历让你这样想？' },
    voice:   { title: '例如：口头禅、安慰人的时候', body: '把你会说的话原样写下来，方言、语气词都留着。' },
    diary:   { title: '给今天起个名字（可不填）', when: '日期', whenToday: true, people: true, body: '今天发生了什么？', feeling: '今天的心情' },
  };
  const FREE_KINDS = ['scene', 'diary', 'person', 'belief', 'voice', 'chapter'];
  const ACCESS_NOTE = {
    self: '只给自己看。导出时请不要把它交给 AI。',
    family: '你离开后，家人可以读到。另一个我不会说出它。',
    twin: '家人可以读到，另一个我也可以用它来回答问题。',
  };

  const S = {
    mode: 'loading', client: null, user: null, store: null, sync: null,
    mems: [], nos: new Map(), answered: new Set(), pending: 0,
    syncing: false, lastSync: null, syncError: null, signed: new Map(),
    view: 'today', filter: 'all', skip: 0, form: null, readerId: null,
  };

  /* ---------- small helpers ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const safe = fn => { try { return fn(); } catch { return null; } };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }));
  const no4 = id => 'N°' + pad(S.nos.get(id) || S.mems.length + 1, 4);
  let toastTimer;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200); }
  function friendly(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/fetch|network|load failed|offline/i.test(m)) return '连不上云端';
    if (/could not find the table|PGRST205|relation .* does not exist/i.test(m)) return '云端还没有建表，请在 Supabase 的 SQL Editor 里运行 supabase/schema.sql';
    if (/jwt|token|401|not authenticated/i.test(m)) return '登录已过期，请到「备份」里退出后重新登录';
    if (/row-level security|violates/i.test(m)) return '云端拒绝了写入，请检查数据库权限设置';
    return m || '未知错误';
  }

  /* ---------- on-device database ---------- */
  function idbStore(name) {
    const opened = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('mems', { keyPath: 'id' });
        req.result.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = async (store, mode, fn) => {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    };
    return {
      opened,
      all: () => tx('mems', 'readonly', s => s.getAll()),
      get: id => tx('mems', 'readonly', s => s.get(id)),
      put: rec => tx('mems', 'readwrite', s => s.put(rec)),
      meta: async key => { const r = await tx('meta', 'readonly', s => s.get(key)); return r ? r.value : undefined; },
      setMeta: (key, value) => tx('meta', 'readwrite', s => s.put({ key, value })),
      async destroy() { (await opened).close(); await new Promise(r => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = d.onblocked = r; }); },
    };
  }

  async function openStore(name) {
    const s = idbStore(name);
    await s.opened; // throws where IndexedDB is unavailable
    return s;
  }

  /* ---------- cloud ---------- */
  function supabaseRemote(client) {
    return {
      async pull(after, limit) {
        const { data, error } = await client.from('memories').select('id,doc,deleted,seq').gt('seq', after).order('seq').limit(limit);
        if (error) throw error;
        return data;
      },
      async push(list) {
        const out = [];
        for (let i = 0; i < list.length; i += 100) {
          const { data, error } = await client.from('memories').upsert(list.slice(i, i + 100), { onConflict: 'id' }).select('id,seq');
          if (error) throw error;
          out.push(...data);
        }
        return out;
      },
    };
  }

  function readConfig() {
    const file = window.AM_CONFIG || {};
    if (file.supabaseUrl && file.supabaseAnonKey) return file;
    const saved = safe(() => JSON.parse(localStorage.getItem(CFG_KEY)));
    return saved && saved.supabaseUrl && saved.supabaseAnonKey ? saved : null;
  }

  /* ---------- pixel transition (the one loud moment) ---------- */
  const px = $('px'), ctx = px.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function pixels(mode) {
    return new Promise(done => {
      if (still.matches) return done();
      const w = innerWidth, h2 = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      px.width = w * dpr; px.height = h2 * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); px.hidden = false;
      const cols = w < 640 ? 6 : 12, size = Math.ceil(w / cols), rows = Math.ceil(h2 / size), total = cols * rows;
      const order = [...Array(total).keys()];
      for (let i = total - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const color = getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim();
      const t0 = performance.now(), dur = 420, steps = 7;
      const frame = t => {
        const p = Math.min(1, (t - t0) / dur), n = Math.round(Math.ceil(p * steps) / steps * total);
        ctx.clearRect(0, 0, w, h2); ctx.fillStyle = color;
        const [a, b] = mode === 'cover' ? [0, n] : [n, total];
        for (let i = a; i < b; i++) { const k = order[i]; ctx.fillRect((k % cols) * size, Math.floor(k / cols) * size, size, size); }
        if (p < 1) requestAnimationFrame(frame);
        else { if (mode === 'reveal') px.hidden = true; done(); }
      };
      frame(t0);
    });
  }
  const lock = on => document.documentElement.classList.toggle('locked', on);

  /* ---------- screens ---------- */
  const APP_VIEWS = ['today', 'sky', 'timeline', 'backup'];
  const ALL_VIEWS = [...APP_VIEWS, 'login', 'setup'];

  function showGate(name, message) {
    for (const v of ALL_VIEWS) $('v-' + v).hidden = v !== name;
    $('nav').hidden = true; $('fab').hidden = true;
    if (name === 'setup') $('c-msg').textContent = message || '';
    if (name === 'login') { $('l-msg').textContent = message || ''; setTimeout(() => $('l-email').focus(), 50); }
  }

  function setView(v, quiet) {
    if (!APP_VIEWS.includes(v)) v = 'today';
    S.view = v;
    for (const id of ALL_VIEWS) $('v-' + id).hidden = id !== v;
    if (v === 'sky') showSky(); else sky.hide();
    document.querySelectorAll('.nav button').forEach(b => (b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    safe(() => history.replaceState(null, '', '#' + v));
    if (!quiet) scrollTo(0, 0);
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => setView(b.dataset.go)));
  $('brand').addEventListener('click', e => { e.preventDefault(); if (S.mode === 'cloud' || S.mode === 'local') setView('today'); });

  function showApp() {
    $('nav').hidden = false; $('fab').hidden = false;
    setView((location.hash || '').slice(1), true);
  }

  /* ---------- data in, screens out ---------- */
  async function reload() {
    const recs = await S.store.all();
    S.mems = recs.filter(r => !r.deleted && r.doc && r.doc.kind).map(r => ({ id: r.id, ...r.doc }));
    S.pending = recs.filter(r => r.dirty).length;
    render(); renderSync();
    if (S.readerId && !$('reader').hidden) {
      if (S.mems.some(m => m.id === S.readerId)) openReader(S.readerId); else closeReader();
    }
  }

  function render() {
    S.nos = AM.numbers(S.mems);
    S.answered = AM.answeredPrompts(S.mems);
    renderAsk(); renderMap(); renderRecent(); renderFilters(); renderTimeline(); renderSky(); renderBackup();
  }

  function renderSync() {
    let state = 'idle', text;
    if (S.mode === 'local') text = `只保存在这台设备上（没有连接云端）· 共 ${S.mems.length} 段`;
    else if (S.syncing) { state = 'busy'; text = '正在同步…'; }
    else if (!navigator.onLine) text = S.pending ? `离线 · ${S.pending} 段等联网后同步` : '离线 · 可以照常写，联网后自动同步';
    else if (S.syncError) { state = 'error'; text = `同步没有完成：${S.syncError}。内容已保存在这台设备上。`; }
    else if (S.pending) text = `${S.pending} 段等待同步`;
    else if (S.lastSync) { state = 'synced'; text = `已同步 · ${hhmm(S.lastSync)} · 共 ${S.mems.length} 段`; }
    else text = '正在连接云端…';
    $('dot').dataset.state = state;
    $('dot').setAttribute('aria-label', text);
    $('status').textContent = text;
    $('b-sync').textContent = text;
  }

  function pending() { return AM.PROMPTS.filter(p => !S.answered.has(p.id)); }
  function currentPrompt() { const list = pending(); return list.length ? list[S.skip % list.length] : null; }

  function renderAsk() {
    const p = currentPrompt();
    const done = S.answered.size, total = AM.PROMPTS.length;
    $('ask-pos').textContent = `${pad(done)} / ${total}`;
    $('today-line').textContent = `生命故事访谈 · 第 ${Math.min(done + 1, total)} 问`;
    const label = $('ask-go').querySelector('.t');
    if (!p) {
      $('ask-sec').textContent = '全部回答完了';
      $('ask-q').textContent = '32 个问题都回答了。接下来，写写今天吧。';
      $('ask-hint').textContent = '你随时可以回到地图里补充或修改，旧的写法会一直保留。';
      label.textContent = '写今天的日记';
      $('ask-skip').hidden = true;
      return;
    }
    const sec = AM.SECTIONS.find(s => s.id === p.sec);
    const inSec = AM.PROMPTS.filter(x => x.sec === p.sec);
    $('ask-sec').textContent = `${sec.label} · ${p.short}` + (inSec.length > 1 ? ` · ${inSec.indexOf(p) + 1} / ${inSec.length}` : '');
    $('ask-q').textContent = p.q;
    $('ask-hint').textContent = p.hint;
    label.textContent = '回答这个问题';
    $('ask-skip').hidden = pending().length < 2;
  }
  $('ask-go').addEventListener('click', () => { const p = currentPrompt(); openEditor(p ? { promptId: p.id } : { kind: 'diary' }); });
  $('ask-skip').addEventListener('click', () => { S.skip++; renderAsk(); renderMap(); });

  function latestFor(promptId) {
    const list = S.mems.filter(m => (promptId === 'A1' ? m.kind === 'chapter' : m.promptId === promptId));
    return list.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null;
  }

  function renderMap() {
    const next = currentPrompt();
    const map = $('map'); map.replaceChildren();
    for (const sec of AM.SECTIONS) {
      const ps = AM.PROMPTS.filter(p => p.sec === sec.id);
      map.append(h('div', { class: 'map-row' },
        h('span', { text: sec.label }),
        h('div', { class: 'cells' }, ps.map(p => {
          const on = S.answered.has(p.id);
          return h('button', {
            type: 'button', class: 'cell' + (on ? ' on' : '') + (next && next.id === p.id ? ' next' : ''),
            title: `${p.short}：${p.q}`, 'aria-label': `${sec.label}，${p.short}，${on ? '已回答，打开' : '未回答，开始回答'}`,
            text: p.id,
            onclick: () => {
              if (!on) return openEditor({ promptId: p.id });
              if (p.id === 'A1') return setView('timeline');
              const m = latestFor(p.id); if (m) openReader(m.id);
            },
          });
        })),
      ));
    }
    const free = S.mems.filter(m => !m.promptId && m.kind !== 'chapter').length;
    $('map-count').textContent = `${S.answered.size} / ${AM.PROMPTS.length}` + (free ? ` · 另有 ${free} 段自由记录` : '');
  }

  function entryRow(m) {
    const kind = AM.KINDS[m.kind] ? AM.KINDS[m.kind].label : '记忆';
    return h('li', null, h('button', { type: 'button', class: 'entry', onclick: () => openReader(m.id) },
      h('span', { class: 'e-when', text: AM.whenLabel(m) || '时间未定' }),
      h('span', { class: 'e-main' },
        h('span', { class: 'e-kind', text: `${no4(m.id)} · ${kind}` }),
        h('span', { class: 'e-title', text: AM.titleOf(m) }),
        m.body ? h('span', { class: 'e-ex', text: m.body.slice(0, 160) }) : null)));
  }

  function renderRecent() {
    const list = $('recent'); list.replaceChildren();
    const recent = [...S.mems].sort((a, b) => String(b.updatedAt || b.recordedAt).localeCompare(String(a.updatedAt || a.recordedAt))).slice(0, 5);
    if (!recent.length) list.append(h('li', { class: 'empty', text: '还没有记忆。从上面的问题开始，或者点右下角的「记录」随手写一段。' }));
    recent.forEach(m => list.append(entryRow(m)));
  }

  function renderFilters() {
    const f = $('filters'); f.replaceChildren();
    const opts = [['all', '全部'], ...FREE_KINDS.filter(k => k !== 'chapter').map(k => [k, AM.KINDS[k].label])];
    for (const [k, label] of opts) {
      const n = k === 'all' ? S.mems.filter(m => m.kind !== 'chapter').length : S.mems.filter(m => m.kind === k).length;
      f.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.filter === k), text: `${label} ${n}`,
        onclick: () => { S.filter = k; renderFilters(); renderTimeline(); } }));
    }
  }

  function renderTimeline() {
    const tl = $('tl'); tl.replaceChildren();
    const { groups, unplaced, undated } = AM.bucket(S.mems);
    const keep = m => S.filter === 'all' || m.kind === S.filter;
    if (!groups.length) {
      tl.append(h('div', { class: 'callout' },
        h('p', { class: 'label', text: '还没有人生章节' }),
        h('p', { text: '生命故事访谈从这里开始：把人生想成一本书，分成几章。章节会成为时间线的骨架，之后写下的每段记忆都会自动归进对应的一章。' }),
        h('div', null, h('button', { type: 'button', class: 'btn', onclick: () => openEditor({ promptId: 'A1' }) }, '写下第一章 ', h('span', { 'aria-hidden': 'true', text: '→' })))));
    }
    groups.forEach((g, i) => {
      const items = g.items.filter(keep);
      tl.append(h('section', { class: 'chapter' },
        h('div', { class: 'chapter-head' },
          h('span', { class: 'chapter-no', text: `第 ${i + 1} 章 · ${g.range ? g.range.label : (g.chapter.whenText || '时间未定')}` }),
          h('button', { type: 'button', class: 'chapter-title', text: AM.titleOf(g.chapter), onclick: () => openReader(g.chapter.id) }),
          g.chapter.body ? h('button', { type: 'button', class: 'chapter-ex', text: g.chapter.body, onclick: () => openReader(g.chapter.id) }) : null),
        items.length ? h('ol', { class: 'entries' }, items.map(entryRow))
          : h('p', { class: 'muted small', style: 'margin:0', text: '还没有归进这一章的记忆。写下这段时间里发生的事，它会自动出现在这里。' })));
    });
    if (groups.length) tl.append(h('div', null, h('button', { type: 'button', class: 'link', onclick: () => openEditor({ promptId: 'A1' }) }, '＋ 再加一章')));
    const tail = [['章节之外', unplaced.filter(keep), '这些记忆有时间，但不在任何一章的范围里。'], ['时间未定', undated.filter(keep), '没有写时间，或写的时间无法识别。']];
    for (const [title, items, note] of tail) {
      if (!items.length) continue;
      tl.append(h('section', { class: 'chapter' },
        h('div', { class: 'chapter-head' }, h('span', { class: 'chapter-no', text: note }), h('p', { class: 'chapter-title', text: title })),
        h('ol', { class: 'entries' }, items.map(entryRow))));
    }
  }

  /* ---------- sky: every memory a star ---------- */
  const sky = AMSky.mount({
    canvas: $('sky'),
    onSelect: m => renderSkyCard(m),
    onReplay: r => {
      $('sky-play').setAttribute('aria-pressed', String(!!r));
      $('sky-play').textContent = r ? '停止回放' : '回放 · 一天天亮起来';
      if (!r) return renderSkyCount();
      $('sky-n').textContent = r.count;
      $('sky-sub').textContent = `颗星 · 第 ${r.day} 天 · ${r.date}`;
    },
  }, { onOpen: id => openReader(id) });

  function renderSky() {
    const L = sky.update(S.mems);
    renderSkyCount();
    const n = L.stars.length;
    $('sky').setAttribute('aria-label', n
      ? `记忆星空：${n} 颗星，从 ${Math.floor(L.from)} 年到今天${L.undated ? `，其中 ${L.undated} 颗时间未定` : ''}。用左右方向键逐颗查看，回车打开。完整列表在「时间线」。`
      : '记忆星空：还没有星星。');
  }
  function renderSkyCount() {
    const L = sky.layout, n = L.stars.length;
    const days = new Set(L.stars.map(s => s.day).filter(Boolean)).size;
    $('sky-n').textContent = n;
    $('sky-sub').textContent = !n ? '颗星' : [`颗星`, `${Math.floor(L.from)} — 今天`, `写了 ${days} 天`, sky.arrived ? `新亮起 ${sky.arrived} 颗` : null].filter(Boolean).join(' · ');
    $('sky-play').hidden = n < 2;
  }
  function showSky() { sky.show(); renderSkyCount(); }
  function renderSkyCard(m) {
    const card = $('sky-card'); card.replaceChildren();
    if (!m) {
      card.append(h('p', { class: 'hint', text: sky.layout.stars.length
        ? '点一颗星，看看它是哪段记忆；再点一次打开。电脑上也可以用左右方向键逐颗看。'
        : '还没有星星。写下第一段记忆，这片天空会亮起第一颗星。' }));
      if (!sky.layout.stars.length) card.append(h('button', { type: 'button', class: 'go', onclick: () => $('ask-go').click() }, '写第一段记忆 →'));
      return;
    }
    const kind = AM.KINDS[m.kind] ? AM.KINDS[m.kind].label : '记忆';
    const bits = [no4(m.id), kind, AM.whenLabel(m) || '时间未定', m.certainty && AM.CERTAINTY[m.certainty]].filter(Boolean);
    card.append(
      h('p', { class: 'k', text: bits.join(' · ') }),
      h('p', { class: 't', text: AM.titleOf(m) }),
      m.body ? h('p', { class: 'x', text: m.body }) : null,
      h('button', { type: 'button', class: 'go', onclick: () => openReader(m.id) }, '打开这段记忆 →'));
  }
  $('sky-play').addEventListener('click', () => sky.replay());

  function renderBackup() {
    const count = k => S.mems.filter(m => m.kind === k).length;
    const atts = S.mems.reduce((n, m) => n + (m.attachments || []).length, 0);
    $('tree').textContent = [
      '另一个我/',
      '├── README.md                 怎么读、怎么检验',
      '├── MANIFEST.sha256           每个文件的校验码',
      '├── data/memories.json        完整数据，含全部修改历史',
      `├── 01-时间线/                 时间线.md + ${count('chapter')} 个章节`,
      `├── 02-人物/                   ${count('person')}`,
      `├── 03-关键事件/               ${count('scene')}`,
      `├── 04-价值观与思考/           ${count('belief')}`,
      `├── 05-说话方式/               ${count('voice')}`,
      `├── 06-日记/                   ${count('diary')}`,
      `└── 07-原始素材/               ${atts} 个录音、照片或视频`,
    ].join('\n');
    $('b-user').textContent = S.mode === 'cloud' ? (S.user.email || S.user.id) : '没有连接云端';
    $('b-local').textContent = `${S.mems.length} 段记忆` + (S.pending ? `，${S.pending} 段还没上传` : '');
    $('b-now').hidden = S.mode !== 'cloud';
    $('b-out').textContent = S.mode === 'cloud' ? '退出登录' : '连接云端';
    $('b-out').classList.toggle('danger', S.mode === 'cloud');
  }

  /* ---------- sync ---------- */
  let syncTimer;
  function scheduleSync(ms = 800) { if (S.mode !== 'cloud') return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
  async function syncNow() {
    if (S.mode !== 'cloud' || !S.client) return;
    if (!navigator.onLine) { renderSync(); return; }
    S.syncing = true; renderSync();
    try {
      await S.sync.run();
      S.lastSync = new Date(); S.syncError = null;
    } catch (err) {
      S.syncError = friendly(err);
    } finally {
      S.syncing = false;
      await reload();
    }
  }
  $('b-now').addEventListener('click', syncNow);
  addEventListener('online', () => syncNow());
  addEventListener('offline', renderSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60 * 1000);

  /* ---------- attachments ---------- */
  async function uploadFile(file) {
    if (S.mode !== 'cloud' || !S.client) throw new Error('连接云端后才能保存原始素材');
    if (!navigator.onLine) throw new Error('现在离线，联网后再附上');
    if (file.size > MAX_FILE) throw new Error('超过 50 MB，可以先剪短或压缩');
    const id = uuid();
    const ext = ((file.name || '').match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
    const path = `${S.user.id}/${id}${ext}`;
    const { error } = await S.client.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    return { id, path, type: file.type || '', name: file.name || id + ext, size: file.size };
  }

  async function mediaUrl(a) {
    if (!a.path || !S.client) return null;
    const hit = S.signed.get(a.path);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await S.client.storage.from(BUCKET).createSignedUrl(a.path, 3600);
    if (error) return null;
    S.signed.set(a.path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  /* ---------- editor ---------- */
  function chipGroup(el, entries, current, onPick) {
    el.replaceChildren(...entries.map(([k, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === current), text: label, onclick: () => onPick(k) })));
  }

  function draftKey() { const f = S.form; return f && !f.id ? 'am.draft.' + (f.promptId || 'free') : null; }
  function readForm() {
    return {
      title: $('f-title').value, when: $('f-when').value, where: $('f-where').value, relation: $('f-relation').value,
      people: $('f-people').value, body: $('f-body').value, feeling: $('f-feeling').value, meaning: $('f-meaning').value,
    };
  }
  let draftTimer;
  function saveDraft() {
    const key = draftKey(); if (!key) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => safe(() => localStorage.setItem(key, JSON.stringify({ ...readForm(), kind: S.form.kind, certainty: S.form.certainty, access: S.form.access, attachments: S.form.attachments }))), 400);
  }

  function applyKind() {
    const f = S.form, cfg = FIELDS[f.kind];
    const show = (id, on) => ($(id).hidden = !on);
    show('w-when', !!cfg.when); show('w-where', !!cfg.where); show('w-relation', !!cfg.relation);
    show('w-people', !!cfg.people); show('w-feeling', !!cfg.feeling); show('w-meaning', !!cfg.meaning);
    show('w-certainty', !!cfg.certainty);
    $('f-title').placeholder = cfg.title; $('f-when').placeholder = cfg.when || '';
    $('f-body').placeholder = cfg.body; $('f-feeling').placeholder = cfg.feeling || ''; $('f-meaning').placeholder = cfg.meaning || '';
    $('l-meaning').textContent = AM.MEANING_LABEL[f.kind] || '它为什么重要';
    const free = !f.id && !f.promptId;
    $('kinds').hidden = !free;
    if (free) chipGroup($('kinds'), FREE_KINDS.map(k => [k, AM.KINDS[k].label]), f.kind, k => { f.kind = k; applyKind(); saveDraft(); });
    chipGroup($('certainty'), Object.entries(AM.CERTAINTY), f.certainty, k => { f.certainty = k; applyKind(); saveDraft(); });
    chipGroup($('access'), Object.entries(AM.ACCESS), f.access, k => { f.access = k; applyKind(); saveDraft(); });
    $('access-read').textContent = ACCESS_NOTE[f.access];
    readWhen();
  }

  function readWhen() {
    const raw = $('f-when').value.trim(), out = $('f-when-read');
    if (!raw) { out.textContent = ''; return; }
    const r = AM.parseEDTF(AM.fromHuman(raw));
    out.textContent = r ? `读作：${r.label}` : '认不出具体时间，会原样保存，时间线里归入「时间未定」。';
  }
  $('f-when').addEventListener('input', readWhen);
  $('form').addEventListener('input', saveDraft);

  function renderAtt() {
    const f = S.form;
    $('att').replaceChildren(...f.attachments.map((a, i) => h('span', null, a.name || a.id,
      h('button', { type: 'button', 'aria-label': `移除 ${a.name || ''}`, text: '×', onclick: () => { f.attachments.splice(i, 1); renderAtt(); saveDraft(); } }))));
    const can = S.mode === 'cloud';
    $('att-pick').hidden = !can;
    $('att-note').textContent = can ? '原件不会被压缩。单个文件不超过 50 MB，需要联网。' : '连接云端后才能附上录音和照片。';
  }

  $('f-files').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const file of files) {
      msg(`正在上传「${file.name}」…`);
      try { S.form.attachments.push(await uploadFile(file)); renderAtt(); saveDraft(); msg(''); }
      catch (err) { msg(`「${file.name}」没有上传：${friendly(err)}。`); }
    }
  });

  function msg(t) { $('f-msg').textContent = t; }

  async function openEditor(opts) {
    const prev = opts.id ? S.mems.find(m => m.id === opts.id) : null;
    const prompt = AM.promptById(opts.promptId || (prev && prev.promptId));
    const kind = (prev && prev.kind) || (prompt && prompt.kind) || opts.kind || 'scene';
    S.form = { id: prev ? prev.id : null, kind, promptId: prompt ? prompt.id : null, certainty: 'clear', access: 'twin', attachments: [] };
    const draft = !prev ? safe(() => JSON.parse(localStorage.getItem(draftKey()))) : null;
    const src = prev || draft || {};
    if (!prev && !prompt && src.kind && FIELDS[src.kind]) S.form.kind = src.kind;
    S.form.certainty = src.certainty || 'clear';
    S.form.access = src.access || 'twin';
    S.form.attachments = [...(src.attachments || [])];
    $('f-title').value = src.title || '';
    const whenVal = prev ? (prev.whenText || prev.when || '') : ((draft && draft.when) || '');
    $('f-when').value = whenVal || (!prev && FIELDS[S.form.kind].whenToday ? today() : '');
    $('f-where').value = src.where || '';
    $('f-relation').value = src.relation || '';
    $('f-people').value = Array.isArray(src.people) ? src.people.join('，') : (src.people || '');
    $('f-body').value = src.body || '';
    $('f-feeling').value = src.feeling || '';
    $('f-meaning').value = src.meaning || '';

    const sec = prompt && AM.SECTIONS.find(s => s.id === prompt.sec);
    $('s-no').textContent = prev ? `${no4(prev.id)} · 修改后旧版本会保留` : `N°${pad(S.mems.length + 1, 4)}`;
    $('s-sec').textContent = sec ? `${sec.label} · ${prompt.short}` : (prev ? AM.KINDS[prev.kind].label : '自由记录');
    $('s-title').textContent = prompt ? prompt.q : prev ? '修改这段记忆' : '写下一段记忆';
    $('s-hint').textContent = prompt ? prompt.hint : '';
    $('s-hint').hidden = !(prompt && prompt.hint);
    $('f-save').disabled = false;
    msg(draft && !prev ? '已恢复上次没写完的草稿。' : '');
    applyKind(); renderAtt();

    await pixels('cover');
    $('sheet').hidden = false; $('sheet').scrollTop = 0; lock(true);
    px.hidden = true;
    $('f-body').focus({ preventScroll: true });
  }

  async function closeEditor() {
    const done = pixels('reveal');
    $('sheet').hidden = true; lock(!$('reader').hidden);
    await done;
  }
  $('s-close').addEventListener('click', closeEditor);
  $('fab').addEventListener('click', () => openEditor({ kind: 'scene' }));

  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = S.form, v = readForm();
    if (f.kind === 'chapter' && !v.title.trim()) return msg('给这一章起个名字。');
    if (f.kind === 'person' && !v.title.trim()) return msg('写下他/她的名字或称呼。');
    if (!v.body.trim() && f.kind !== 'person') return msg('「原话」还空着。哪怕写一句也好。');
    const cfg = FIELDS[f.kind], whenRaw = v.when.trim();
    const next = {
      kind: f.kind, promptId: f.promptId || '',
      title: v.title.trim(), when: AM.fromHuman(whenRaw) || '', whenText: whenRaw,
      where: cfg.where ? v.where.trim() : '',
      relation: cfg.relation ? v.relation.trim() : '',
      people: cfg.people ? v.people.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean) : [],
      body: v.body, feeling: cfg.feeling ? v.feeling : '', meaning: cfg.meaning ? v.meaning : '',
      certainty: cfg.certainty ? f.certainty : 'clear', access: f.access,
      attachments: f.attachments,
    };
    const prev = f.id ? S.mems.find(m => m.id === f.id) : null;
    let prevDoc = null;
    if (prev) { const { id, ...rest } = prev; prevDoc = rest; }
    const doc = AM.revise(prevDoc, next, new Date().toISOString());
    const id = f.id || uuid();
    $('f-save').disabled = true; msg('正在保存…');
    try { await S.sync.save(id, doc); }
    catch (err) { $('f-save').disabled = false; return msg('没有保存：这台设备的存储出了问题（' + friendly(err) + '）。内容还在这里。'); }
    const key = draftKey(); if (key) safe(() => localStorage.removeItem(key));
    const changed = prev && doc.revisions.length > (prev.revisions || []).length;
    await reload();
    await closeEditor();
    if (S.readerId === id) openReader(id);
    toast(prev ? (changed ? '已保存。之前的写法留在修改历史里。' : '已保存。') : `已保存为 ${no4(id)}。`);
    scheduleSync();
  });

  /* ---------- reader ---------- */
  function mediaFor(a) {
    const t = a.type || '';
    if (!a.path) {
      return h('p', { class: 'muted small', style: 'margin:0', text: `「${a.name || a.id}」${a.url ? '还在 Claude 版本里。导入当时导出的记忆包，就能把它搬过来。' : '缺失。'}` });
    }
    const el = t.startsWith('image/') ? h('img', { alt: a.name || '' })
      : t.startsWith('audio/') ? h('audio', { controls: true, preload: 'none' })
      : t.startsWith('video/') ? h('video', { controls: true, preload: 'metadata' })
      : h('a', { target: '_blank', rel: 'noopener', text: a.name || a.id });
    mediaUrl(a).then(url => { if (!url) return; if (el.tagName === 'A') el.href = url; else el.src = url; });
    return t.startsWith('audio/') ? h('div', null, h('p', { class: 'muted small', style: 'margin:0', text: a.name }), el) : el;
  }

  function openReader(id) {
    const m = S.mems.find(x => x.id === id); if (!m) return;
    S.readerId = id;
    const p = AM.promptById(m.promptId);
    $('r-no').textContent = `${no4(m.id)} · ${AM.KINDS[m.kind] ? AM.KINDS[m.kind].label : '记忆'}`;
    $('r-q').textContent = p ? p.q : ''; $('r-q').hidden = !p;
    $('r-title').textContent = AM.titleOf(m);
    const meta = [AM.whenLabel(m) || '时间未定', m.where, m.relation, (m.people || []).join('、'),
      FIELDS[m.kind] && FIELDS[m.kind].certainty ? AM.CERTAINTY[m.certainty] : null, AM.ACCESS[m.access]].filter(Boolean);
    $('r-meta').textContent = meta.join(' · ');
    $('r-body').textContent = m.body || '';
    const extra = $('r-extra'); extra.replaceChildren();
    if (m.feeling) extra.append(h('div', { class: 'r-sec' }, h('p', { class: 'label', text: '当时的感受' }), h('p', { text: m.feeling })));
    if (m.meaning) extra.append(h('div', { class: 'r-sec' }, h('p', { class: 'label', text: AM.MEANING_LABEL[m.kind] || '它为什么重要' }), h('p', { text: m.meaning })));
    if ((m.attachments || []).length) {
      extra.append(h('div', { class: 'r-sec' }, h('p', { class: 'label', text: '原始素材' }), h('div', { class: 'r-media' }, m.attachments.map(mediaFor))));
    }
    const revs = m.revisions || [];
    if (revs.length) {
      extra.append(h('details', { class: 'revs' },
        h('summary', { text: `修改过 ${revs.length} 次 · 查看之前的写法` }),
        revs.map((r, i) => h('div', { class: 'rev' },
          h('span', { class: 'label', text: `第 ${i + 1} 版 · ${String(r.at || '').slice(0, 10)}` + (r.from === 'other-device' ? ' · 另一台设备上的写法' : '') }),
          r.title ? h('p', { text: r.title }) : null,
          h('p', { text: r.body || '' })))));
    }
    $('r-confirm').hidden = true; $('r-del').hidden = false;
    $('reader').hidden = false; $('reader').scrollTop = 0; lock(true);
    $('r-close').focus({ preventScroll: true });
  }
  function closeReader() { $('reader').hidden = true; S.readerId = null; lock(!$('sheet').hidden); }
  $('r-close').addEventListener('click', closeReader);
  $('r-edit').addEventListener('click', () => openEditor({ id: S.readerId }));
  $('r-del').addEventListener('click', () => { $('r-confirm').hidden = false; $('r-del').hidden = true; $('r-del-yes').focus(); });
  $('r-del-no').addEventListener('click', () => { $('r-confirm').hidden = true; $('r-del').hidden = false; });
  $('r-del-yes').addEventListener('click', async () => {
    const id = S.readerId, m = S.mems.find(x => x.id === id);
    try { await S.sync.remove(id); }
    catch (err) { return toast('没有删除：' + friendly(err)); }
    const paths = ((m && m.attachments) || []).map(a => a.path).filter(Boolean);
    if (paths.length && S.client && navigator.onLine) S.client.storage.from(BUCKET).remove(paths).catch(() => {});
    closeReader(); await reload(); toast('已删除。'); scheduleSync();
  });

  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('sheet').hidden) closeEditor(); else if (!$('reader').hidden) closeReader();
  });

  /* ---------- export ---------- */
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
  function exMsg(t) { $('ex-msg').textContent = t; }

  async function offerFile(blob, filename) {
    const file = new File([blob], filename, { type: 'application/zip' });
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }

  $('ex-go').addEventListener('click', async () => {
    if (!S.mems.length) return exMsg('还没有记忆可以导出。');
    if (!window.JSZip) return exMsg('打包工具没有加载成功。请联网后刷新再试。');
    if (!(window.crypto && crypto.subtle)) return exMsg('这个浏览器无法计算校验码，请换用新版浏览器。');
    $('ex-go').disabled = true;
    try {
      const now = new Date().toISOString();
      const plan = AM.buildArchive(S.mems, now);
      const zip = new JSZip(), top = zip.folder('另一个我'), sums = [], missing = [];
      const enc = new TextEncoder();
      const add = async (path, bytes) => { top.file(path, bytes); sums.push({ path, hex: await sha(bytes) }); };
      for (const f of plan.files) await add(f.path, enc.encode(f.text));
      let i = 0;
      for (const item of plan.attachments) {
        exMsg(`正在打包原始素材 ${++i} / ${plan.attachments.length}…`);
        try {
          if (!item.att.path || !S.client) throw new Error('missing');
          const { data, error } = await S.client.storage.from(BUCKET).download(item.att.path);
          if (error) throw error;
          await add(item.path, new Uint8Array(await data.arrayBuffer()));
        } catch { missing.push(item); }
      }
      if (missing.length) {
        await add('07-原始素材/缺失的素材.md', enc.encode(['# 缺失的素材', '', '导出时以下文件无法读取，没有包含在这个压缩包里。请联网后重新导出，或从原设备上找回。', '', ...missing.map(a => `- ${a.path}（${a.att.name || a.att.id}）`), ''].join('\n')));
      }
      top.file('MANIFEST.sha256', AM.manifestText(sums));
      exMsg('正在压缩…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      await offerFile(blob, `另一个我-${now.slice(0, 10)}.zip`);
      exMsg(`已生成：${sums.length} 个文件` + (missing.length ? `，${missing.length} 个素材读取失败，清单见 07-原始素材/缺失的素材.md。` : '，全部带校验码。'));
    } catch (err) {
      exMsg(err && err.name === 'AbortError' ? '已取消。' : '导出没有完成：' + friendly(err));
    } finally { $('ex-go').disabled = false; }
  });

  $('cmd-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('cmd').textContent); toast('已复制。'); }
    catch { const r = document.createRange(); r.selectNodeContents($('cmd')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('已选中，按 ⌘C 复制。'); }
  });

  /* ---------- import ---------- */
  function imMsg(t) { $('im-msg').textContent = t; }
  $('im-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!window.JSZip) return imMsg('解压工具没有加载成功。请联网后刷新再试。');
    try {
      imMsg('正在读取…');
      const zip = await JSZip.loadAsync(file);
      const entry = Object.values(zip.files).find(f => !f.dir && /(^|\/)data\/memories\.json$/.test(f.name));
      if (!entry) throw new Error('压缩包里找不到 data/memories.json');
      const prefix = entry.name.slice(0, entry.name.length - 'data/memories.json'.length);
      const { mems, sources } = AM.readArchiveData(JSON.parse(await entry.async('string')));
      const canUpload = S.mode === 'cloud' && navigator.onLine;
      let added = 0, merged = 0, moved = 0, missing = 0, n = 0;
      for (const { id, ...m } of mems) {
        imMsg(`正在导入 ${++n} / ${mems.length}…`);
        if (m.attachments) {
          const srcs = sources.get(id) || [];
          const atts = [];
          for (const [i, a] of m.attachments.entries()) {
            if (a.path) { atts.push(a); continue; }
            const zf = srcs[i] && zip.file(prefix + srcs[i]);
            if (zf && canUpload) {
              try {
                const blob = await zf.async('blob');
                atts.push(await uploadFile(new File([blob], a.name || srcs[i].split('/').pop(), { type: a.type || '' })));
                moved++; continue;
              } catch { /* fall through and keep the reference */ }
            }
            atts.push(a); missing++;
          }
          m.attachments = atts;
        }
        const cur = await S.store.get(id);
        if (cur && !cur.deleted) { await S.sync.save(id, AM.merge(cur.doc, m)); merged++; }
        else { await S.sync.save(id, m); added++; }
      }
      await reload(); scheduleSync(100);
      imMsg(`导入完成：新增 ${added} 段，合并 ${merged} 段` + (moved ? `，搬入 ${moved} 个素材` : '') +
        (missing ? `，${missing} 个素材没有搬入（${canUpload ? '压缩包里找不到' : '需要联网并连接云端'}）` : '') + '。');
    } catch (err) {
      const broken = /zip|end of data|signature|JSON/i.test(String(err && err.message));
      imMsg('没有导入：' + (broken ? '这个文件不是完整的记忆包，可能下载到一半或者被改动过' : friendly(err)) + '。');
    }
  });

  /* ---------- account ---------- */
  $('b-out').addEventListener('click', () => {
    if (S.mode !== 'cloud') return showGate('setup');
    if (!S.pending) return signOut();
    $('b-out-warn').textContent = `还有 ${S.pending} 段没有同步到云端。退出会清除这台设备上的副本，这些内容会丢失。`;
    $('b-out-confirm').hidden = false; $('b-out').hidden = true;
  });
  $('b-out-no').addEventListener('click', () => { $('b-out-confirm').hidden = true; $('b-out').hidden = false; });
  $('b-out-yes').addEventListener('click', signOut);
  async function signOut() {
    try { await S.client.auth.signOut(); } catch { /* signing out offline still clears this device */ }
    if (S.store) await S.store.destroy();
    safe(() => { localStorage.removeItem('am.lastUser'); localStorage.removeItem('am.lastEmail'); });
    location.replace(location.pathname);
  }

  $('login').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('l-email').value.trim(), password = $('l-pass').value;
    if (!email || !password) return ($('l-msg').textContent = '请填写邮箱和密码。');
    $('l-go').disabled = true; $('l-msg').textContent = '正在登录…';
    const { data, error } = await S.client.auth.signInWithPassword({ email, password });
    $('l-go').disabled = false;
    if (error) {
      $('l-msg').textContent = /invalid login/i.test(error.message) ? '邮箱或密码不对。' : '没有登录成功：' + friendly(error) + '。';
      return;
    }
    $('l-pass').value = '';
    startCloud(data.user);
  });

  $('setup').addEventListener('submit', e => {
    e.preventDefault();
    const url = $('c-url').value.trim().replace(/\/+$/, ''), key = $('c-key').value.trim();
    if (!/^https:\/\/[^/]+$/.test(url)) return ($('c-msg').textContent = '项目地址应该像 https://xxxx.supabase.co 这样。');
    if (key.length < 20) return ($('c-msg').textContent = '公开密钥看起来不完整。');
    safe(() => localStorage.setItem(CFG_KEY, JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key })));
    location.reload();
  });
  $('c-local').addEventListener('click', () => { safe(() => localStorage.setItem('am.mode', 'local')); startLocal(); });

  /* ---------- boot ---------- */
  async function startLocal() {
    S.mode = 'local';
    S.store = await openStore('another-me-local');
    S.sync = AMSync.createSync({ store: S.store, remote: null });
    showApp(); await reload();
  }

  async function startCloud(user) {
    S.mode = 'cloud'; S.user = user;
    safe(() => { localStorage.setItem('am.lastUser', user.id); localStorage.setItem('am.lastEmail', user.email || ''); });
    S.store = await openStore('another-me-' + user.id);
    S.sync = AMSync.createSync({ store: S.store, remote: S.client ? supabaseRemote(S.client) : null });
    // Memories written before connecting the cloud move into this account.
    if (safe(() => localStorage.getItem('am.mode')) === 'local') {
      const old = await openStore('another-me-local');
      for (const r of await old.all()) if (!(await S.store.get(r.id))) await S.store.put({ ...r, base: null, dirty: true });
      safe(() => localStorage.removeItem('am.mode'));
    }
    showApp(); await reload(); syncNow();
  }

  async function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    safe(() => navigator.storage && navigator.storage.persist && navigator.storage.persist());
    try {
      const cfg = readConfig();
      if (!cfg) return safe(() => localStorage.getItem('am.mode')) === 'local' ? startLocal() : showGate('setup');
      if (!window.supabase) {
        // Offline before the cloud library was ever cached: keep writing on this device under the last account.
        const id = safe(() => localStorage.getItem('am.lastUser'));
        if (id) return startCloud({ id, email: safe(() => localStorage.getItem('am.lastEmail')) || '' });
        return showGate('setup', '云端组件没有加载成功。请联网后刷新。');
      }
      S.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'am.auth' },
      });
      S.client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT' && S.mode === 'cloud') location.replace(location.pathname); });
      const { data } = await S.client.auth.getSession();
      if (data && data.session) return startCloud(data.session.user);
      showGate('login');
    } catch (err) {
      showGate('setup', '无法打开这台设备上的存储：' + friendly(err) + '。如果是无痕模式，请换成普通模式。');
    }
  }
  boot();
})();
