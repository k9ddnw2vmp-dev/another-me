/* 另一个我 · core
 * Pure functions shared by the page and its tests. No DOM, no network.
 * - Interview: McAdams' Life Story Interview, plus Conway-style retrieval cues.
 * - Dates: a subset of EDTF (Library of Congress Extended Date/Time Format).
 * - Archive: Markdown with YAML front matter + JSON, laid out like the desktop folder.
 */
(function (root) {
  'use strict';

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byteLength = s => new TextEncoder().encode(s).length;

  const KINDS = {
    chapter: { label: '人生章节', folder: '01-时间线/章节' },
    scene:   { label: '关键场景', folder: '03-关键事件' },
    person:  { label: '人物',     folder: '02-人物' },
    belief:  { label: '信念',     folder: '04-价值观与思考' },
    voice:   { label: '说话方式', folder: '05-说话方式' },
    diary:   { label: '日记',     folder: '06-日记' },
  };
  const CERTAINTY = { clear: '清楚记得', hazy: '有些模糊', told: '听别人说的' };
  const ACCESS = { self: '仅自己', family: '留给家人', twin: '交给另一个我' };
  const MEANING_LABEL = {
    chapter: '这一章让我成为了什么样的人',
    scene: '它为什么重要',
    person: '他/她在我身上留下了什么',
    belief: '这个看法从哪里来',
  };

  const SCENE_HINT = '说说发生了什么、在哪里、和谁在一起，当时你在想什么、感受到什么，以及它为什么重要。';

  // Order follows the Life Story Interview: chapters frame everything that comes after.
  const SECTIONS = [
    { id: 'A', label: '人生章节' },
    { id: 'B', label: '关键场景' },
    { id: 'C', label: '挑战' },
    { id: 'G', label: '重要的人' },
    { id: 'H', label: '记忆线索' },
    { id: 'D', label: '未来' },
    { id: 'E', label: '信念' },
    { id: 'F', label: '人生主题' },
    { id: 'I', label: '说话方式' },
  ];

  const PROMPTS = [
    { id: 'A1', sec: 'A', kind: 'chapter', short: '分章', q: '把你的人生想成一本书。它可以分成哪几章？先写下其中一章：它叫什么，从哪年到哪年，大致讲了什么。', hint: '一章写一条，可以反复回答。章节会成为时间线的骨架。' },

    { id: 'B1', sec: 'B', kind: 'scene', short: '高峰', q: '人生中的一个高峰时刻：你感到最快乐、最满足的一个具体场景。', hint: SCENE_HINT },
    { id: 'B2', sec: 'B', kind: 'scene', short: '低谷', q: '人生中的一个低谷时刻：你感到最痛苦、最绝望的一个具体场景。', hint: SCENE_HINT },
    { id: 'B3', sec: 'B', kind: 'scene', short: '转折', q: '一个转折点：你意识到自己从此不一样了的那一刻。', hint: SCENE_HINT },
    { id: 'B4', sec: 'B', kind: 'scene', short: '童年·好', q: '童年里一段美好的记忆。', hint: SCENE_HINT },
    { id: 'B5', sec: 'B', kind: 'scene', short: '童年·坏', q: '童年里一段不好的记忆。', hint: SCENE_HINT },
    { id: 'B6', sec: 'B', kind: 'scene', short: '鲜明', q: '成年后一段特别鲜明的记忆，至今历历在目。', hint: SCENE_HINT },
    { id: 'B7', sec: 'B', kind: 'scene', short: '智慧', q: '一次你表现得很有智慧的时刻，或者你学到一个重要道理的时刻。', hint: SCENE_HINT },
    { id: 'B8', sec: 'B', kind: 'scene', short: '超越', q: '一次你感到与比自己更大的东西相连的时刻：信仰、自然，或某种说不清的感受。', hint: SCENE_HINT },

    { id: 'C1', sec: 'C', kind: 'scene', short: '最大挑战', q: '你人生中最大的一个挑战是什么？你是怎么面对的？', hint: SCENE_HINT },
    { id: 'C2', sec: 'C', kind: 'scene', short: '健康', q: '一次健康上的危机，发生在你自己或你身边的人身上。', hint: SCENE_HINT },
    { id: 'C3', sec: 'C', kind: 'scene', short: '失去', q: '一次失去：一个重要的人或东西离开了你。', hint: SCENE_HINT },
    { id: 'C4', sec: 'C', kind: 'scene', short: '遗憾', q: '一次失败，或一件至今让你遗憾的事。', hint: SCENE_HINT },

    { id: 'G1', sec: 'G', kind: 'person', short: '影响最深', q: '对你影响最深的一个人。', hint: '他/她是个什么样的人，你们之间发生过什么，他/她在你身上留下了什么。' },
    { id: 'G2', sec: 'G', kind: 'person', short: '父亲', q: '你的父亲，或像父亲一样的人。', hint: '用三个词形容他，再讲一件只有你知道的事。' },
    { id: 'G3', sec: 'G', kind: 'person', short: '母亲', q: '你的母亲，或像母亲一样的人。', hint: '用三个词形容她，再讲一件只有你知道的事。' },
    { id: 'G4', sec: 'G', kind: 'person', short: '想再见', q: '你最想再见一面的人。', hint: '如果真的见到了，你想说什么？' },

    { id: 'H1', sec: 'H', kind: 'scene', short: '老房子', q: '闭上眼，走进你小时候的家。从大门开始，你看到了什么？', hint: '地点是记忆最强的线索。慢慢走，看到什么写什么。' },
    { id: 'H2', sec: 'H', kind: 'scene', short: '物件', q: '一样你保留了很多年的东西。它从哪里来？', hint: '可以拍一张照片附上。' },
    { id: 'H3', sec: 'H', kind: 'scene', short: '一首歌', q: '一首一听就把你带回某个时候的歌。', hint: '那时你在哪里，和谁在一起？' },
    { id: 'H4', sec: 'H', kind: 'scene', short: '气味', q: '一种气味或味道，让你想起某个人或某个地方。', hint: '气味唤起的记忆往往最早、最情绪化。' },

    { id: 'D1', sec: 'D', kind: 'belief', short: '下一章', q: '你人生的下一章会是什么样？', hint: '写下你希望发生的，也写下你担心的。' },
    { id: 'D2', sec: 'D', kind: 'belief', short: '梦想', q: '你还有什么梦想、希望或计划？', hint: '' },
    { id: 'D3', sec: 'D', kind: 'belief', short: '被记住', q: '你希望别人怎样记住你？', hint: '' },

    { id: 'E1', sec: 'E', kind: 'belief', short: '价值', q: '对你来说最重要的是什么？你相信什么？', hint: '' },
    { id: 'E2', sec: 'E', kind: 'belief', short: '意义', q: '你怎么看信仰、命运，或生命的意义？', hint: '' },
    { id: 'E3', sec: 'E', kind: 'belief', short: '底线', q: '有什么事是你绝不会妥协的？', hint: '' },
    { id: 'E4', sec: 'E', kind: 'belief', short: '改变', q: '你的某个重要看法，曾经发生过一次大的改变。', hint: '以前怎么想，现在怎么想，是什么让它变了。' },

    { id: 'F1', sec: 'F', kind: 'belief', short: '主线', q: '回看你的全部章节，你的人生有没有一条贯穿的主线？', hint: '这是生命故事访谈的最后一问，适合在其他问题之后回答。' },

    { id: 'I1', sec: 'I', kind: 'voice', short: '口头禅', q: '你的口头禅是什么？什么时候会说？', hint: '原样写下来，方言、语气词都留着。' },
    { id: 'I2', sec: 'I', kind: 'voice', short: '安慰', q: '别人难过的时候，你通常会怎么说？', hint: '' },
    { id: 'I3', sec: 'I', kind: 'voice', short: '讲道理', q: '你会怎么给一个孩子讲道理？', hint: '' },
  ];

  /* ---------- EDTF ---------- */

  // Supported: YYYY, YYYY-MM, YYYY-MM-DD, 199X, 19XX, qualifiers ? ~ %, intervals A/B with open ends (..).
  const POINT_RE = /^(\d{4}|\d{3}X|\d{2}XX)(?:-(\d{2})(?:-(\d{2}))?)?([?~%])?$/;

  function parsePoint(s) {
    const m = POINT_RE.exec(s);
    if (!m) return null;
    const [, y, mo, d, q = ''] = m;
    if (y.includes('X') && mo) return null;
    if (mo && (+mo < 1 || +mo > 12)) return null;
    const yLo = +y.replace(/X/g, '0'), yHi = +y.replace(/X/g, '9');
    if (d && (+d < 1 || +d > daysIn(yLo, +mo))) return null;
    const endMo = mo ? +mo : 12;
    return {
      y, mo: mo || null, d: d || null, q,
      precision: d ? 10 : mo ? 7 : 4,
      start: `${pad(yLo, 4)}-${mo || '01'}-${d || '01'}`,
      end: `${pad(yHi, 4)}-${pad(endMo)}-${d || pad(daysIn(yHi, endMo))}`,
    };
  }

  function pointLabel(p) {
    let t;
    if (p.y.endsWith('XX')) t = `${+p.y.slice(0, 2) + 1} 世纪`;
    else if (p.y.endsWith('X')) t = `${p.y.slice(0, 3)}0 年代`;
    else t = `${p.y} 年` + (p.mo ? ` ${+p.mo} 月` : '') + (p.d ? ` ${+p.d} 日` : '');
    if (p.q === '~' || p.q === '%') t = '约 ' + t;
    if (p.q === '?' || p.q === '%') t += '（不确定）';
    return t;
  }

  function parseEDTF(s) {
    s = String(s || '').trim();
    if (!s) return null;
    if (s.includes('/')) {
      const parts = s.split('/');
      if (parts.length !== 2) return null;
      const [a, b] = parts;
      const open = x => x === '' || x === '..';
      const pa = open(a) ? null : parsePoint(a);
      const pb = open(b) ? null : parsePoint(b);
      if ((!open(a) && !pa) || (!open(b) && !pb) || (!pa && !pb)) return null;
      const start = pa ? pa.start : '0000-01-01';
      const end = pb ? pb.end : '9999-12-31';
      if (start > end) return null;
      return { edtf: s, interval: true, start, end, precision: pa ? pa.precision : 4,
        label: `${pa ? pointLabel(pa) : '某时'} — ${pb ? pointLabel(pb) : '至今'}` };
    }
    const p = parsePoint(s);
    return p && { edtf: s, interval: false, start: p.start, end: p.end, precision: p.precision, label: pointLabel(p) };
  }

  // Everyday Chinese → EDTF. Returns null when the text is not a date we can place; the raw text is kept separately.
  function humanPoint(p) {
    let approx = false, unsure = false;
    p = p.replace(/^(大约|大概|差不多|约)/, () => { approx = true; return ''; })
         .replace(/(左右|前后|上下)$/, () => { approx = true; return ''; })
         .replace(/^(可能是?|也许是?|好像是?)/, () => { unsure = true; return ''; })
         .replace(/(\?+|（?不确定）?)$/, () => { unsure = true; return ''; });
    const q = approx && unsure ? '%' : approx ? '~' : unsure ? '?' : '';
    let m, core = null;
    if ((m = /^(\d{1,2})世纪$/.exec(p))) core = `${pad(+m[1] - 1)}XX`;
    else if ((m = /^(\d{4})年代$/.exec(p))) core = `${m[1].slice(0, 3)}X`;
    else if ((m = /^(\d)0年代$/.exec(p))) core = `${+m[1] >= 3 ? '19' : '20'}${m[1]}X`;
    else if ((m = /^(\d{4})(?:年|[-.])?(?:(\d{1,2})(?:月|[-.])?(?:(\d{1,2})(?:日|号)?)?)?$/.exec(p)))
      core = m[1] + (m[2] ? '-' + pad(+m[2]) : '') + (m[3] ? '-' + pad(+m[3]) : '');
    if (!core) return null;
    return parsePoint(core + q) ? core + q : null;
  }

  function fromHuman(input) {
    let s = String(input || '').trim()
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/？/g, '?').replace(/～/g, '~').replace(/\s+/g, '');
    if (!s) return null;
    if (parseEDTF(s)) return s;
    s = s.replace(/^(\d{4})-(\d{4})$/, '$1/$2')
         .replace(/(到|至)?(至今|现在|今天|如今)$/, '/..');
    const parts = s.includes('/') ? s.split('/') : s.split(/到|至|—|–|－/);
    if (parts.length > 2) return null;
    const conv = parts.map(x => (x === '..' ? '..' : humanPoint(x)));
    if (conv.includes(null)) return null;
    const out = conv.join('/');
    return parseEDTF(out) ? out : null;
  }

  /* ---------- Memories ---------- */

  const promptById = id => PROMPTS.find(p => p.id === id) || null;

  function titleOf(m) {
    if (m.title) return m.title;
    const p = promptById(m.promptId);
    if (m.kind === 'diary') return `${(m.recordedAt || '').slice(0, 10)} 的日记`;
    return p ? p.short : '无题';
  }

  function whenLabel(m) {
    const r = parseEDTF(m.when);
    return r ? r.label : (m.whenText || '');
  }

  // Creation order gives each memory a permanent number.
  function numbers(mems) {
    const sorted = [...mems].sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)) || String(a.id).localeCompare(String(b.id)));
    return new Map(sorted.map((m, i) => [m.id, i + 1]));
  }

  function answeredPrompts(mems) {
    const set = new Set(mems.map(m => m.promptId).filter(Boolean));
    if (mems.some(m => m.kind === 'chapter')) set.add('A1');
    return set;
  }

  // Conway: lifetime periods hold the events inside them. Each memory goes to the narrowest chapter containing its start.
  function bucket(mems) {
    const span = r => Date.parse(r.end) - Date.parse(r.start);
    const groups = mems.filter(m => m.kind === 'chapter')
      .map(c => ({ chapter: c, range: parseEDTF(c.when), items: [] }))
      .sort((a, b) => (a.range ? a.range.start : '9999').localeCompare(b.range ? b.range.start : '9999'));
    const unplaced = [], undated = [];
    for (const m of mems) {
      if (m.kind === 'chapter') continue;
      const r = parseEDTF(m.when);
      if (!r) { undated.push(m); continue; }
      let best = null;
      for (const g of groups) {
        if (g.range && r.start >= g.range.start && r.start <= g.range.end && (!best || span(g.range) < span(best.range))) best = g;
      }
      (best ? best.items : unplaced).push(m);
    }
    const byTime = (a, b) => (parseEDTF(a.when)?.start || '').localeCompare(parseEDTF(b.when)?.start || '') || String(a.recordedAt).localeCompare(String(b.recordedAt));
    groups.forEach(g => g.items.sort(byTime));
    unplaced.sort(byTime);
    undated.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    return { groups, unplaced, undated };
  }

  const TRACKED = ['title', 'when', 'whenText', 'body', 'feeling', 'meaning'];
  const DOC_BUDGET = 200 * 1024; // the store caps a document at 256 KiB

  // Memory is reconstructive: an edit appends the previous wording. The first version is never dropped.
  function revise(prev, next, now) {
    const out = {
      ...next,
      recordedAt: prev ? prev.recordedAt : now,
      updatedAt: now,
      revisions: prev ? [...(prev.revisions || [])] : [],
    };
    if (prev && TRACKED.some(k => (prev[k] || '') !== (next[k] || ''))) out.revisions.push(snapshot(prev));
    return trimRevisions(out);
  }

  function snapshot(doc, extra) {
    const snap = { at: doc.updatedAt || doc.recordedAt, ...extra };
    for (const k of TRACKED) snap[k] = doc[k] || '';
    return snap;
  }

  // Drop middle versions when over the cap or the size budget; the first version always survives.
  function trimRevisions(doc) {
    while (doc.revisions.length > 2 && (doc.revisions.length > 20 || byteLength(JSON.stringify(doc)) > DOC_BUDGET)) {
      doc.revisions.splice(1, 1);
    }
    return doc;
  }

  // Two devices edited the same memory. The newer edit becomes the text; the other wording joins the history.
  function merge(a, b) {
    const [win, lose] = String(a.updatedAt || '') >= String(b.updatedAt || '') ? [a, b] : [b, a];
    const key = r => r.at + '|' + TRACKED.map(k => r[k] || '').join('\u0000');
    const seen = new Set(), revisions = [];
    const add = r => { const k = key(r); if (!seen.has(k)) { seen.add(k); revisions.push(r); } };
    [...(a.revisions || []), ...(b.revisions || [])].forEach(add);
    if (TRACKED.some(k => (win[k] || '') !== (lose[k] || ''))) add(snapshot(lose, { from: 'other-device' }));
    revisions.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const atts = new Map();
    for (const att of [...(lose.attachments || []), ...(win.attachments || [])]) atts.set(att.id, att);
    const recorded = [a.recordedAt, b.recordedAt].filter(Boolean).sort()[0] || win.recordedAt;
    return trimRevisions({ ...win, recordedAt: recorded, revisions, attachments: [...atts.values()] });
  }

  /* ---------- Archive ---------- */

  function safeName(s) {
    const t = String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 40);
    return t || '无题';
  }

  function uniquePath(used, p) {
    let out = p, i = 2;
    while (used.has(out)) out = p.replace(/(\.[^./]+)?$/, `-${i++}$1`);
    used.add(out);
    return out;
  }

  function datePrefix(m) {
    const r = parseEDTF(m.when);
    return r && r.start !== '0000-01-01' ? r.start.slice(0, r.precision) : '';
  }

  function pathFor(m) {
    const name = safeName(titleOf(m));
    const pre = datePrefix(m);
    switch (m.kind) {
      case 'chapter': return `01-时间线/章节/${pre ? pre + '-' : ''}${name}.md`;
      case 'scene':   return `03-关键事件/${pre || '时间未定'}-${name}.md`;
      case 'person':  return `02-人物/${name}.md`;
      case 'belief':  return `04-价值观与思考/${name}.md`;
      case 'voice':   return `05-说话方式/${name}.md`;
      case 'diary':   return `06-日记/${pre || (m.recordedAt || '').slice(0, 10)}${m.title ? '-' + name : ''}.md`;
      default:        return `09-其他/${name}.md`;
    }
  }

  const yq = v => JSON.stringify(v == null ? '' : String(v));

  function toMarkdown(m, no, filePath, attachmentPaths) {
    const prompt = promptById(m.promptId);
    const up = '../'.repeat(filePath.split('/').length - 1);
    const fm = [
      '---',
      `id: ${yq(m.id)}`,
      `no: ${no}`,
      `kind: ${yq(m.kind)}`,
      `kind_label: ${yq((KINDS[m.kind] || {}).label)}`,
      `prompt_id: ${yq(m.promptId)}`,
      `prompt: ${yq(prompt ? prompt.q : '')}`,
      `title: ${yq(titleOf(m))}`,
      `when: ${yq(m.when)}`,
      `when_text: ${yq(m.whenText)}`,
      `when_label: ${yq(whenLabel(m))}`,
      `where: ${yq(m.where)}`,
      `relation: ${yq(m.relation)}`,
      `people: ${JSON.stringify((m.people || []).map(String))}`,
      `certainty: ${yq(m.certainty)}`,
      `certainty_label: ${yq(CERTAINTY[m.certainty])}`,
      `access: ${yq(m.access)}`,
      `access_label: ${yq(ACCESS[m.access])}`,
      `recorded_at: ${yq(m.recordedAt)}`,
      `updated_at: ${yq(m.updatedAt)}`,
      `revision_count: ${(m.revisions || []).length}`,
      `attachments: ${JSON.stringify(attachmentPaths)}`,
      '---',
    ];
    const meta = [whenLabel(m), m.where, m.relation, (m.people || []).join('、'), CERTAINTY[m.certainty] && m.kind !== 'belief' && m.kind !== 'voice' ? CERTAINTY[m.certainty] : '']
      .filter(Boolean).join(' · ');
    const out = [...fm, '', `# ${titleOf(m)}`, ''];
    if (prompt) out.push(`> ${prompt.q}`, '');
    if (meta) out.push(meta, '');
    if (m.body) out.push(m.body, '');
    if (m.feeling) out.push('## 当时的感受', '', m.feeling, '');
    if (m.meaning) out.push(`## ${MEANING_LABEL[m.kind] || '它为什么重要'}`, '', m.meaning, '');
    if (attachmentPaths.length) {
      out.push('## 原始素材', '');
      for (const a of attachmentPaths) out.push(`- [${a.split('/').pop()}](${encodeURI(up + a)})`);
      out.push('');
    }
    const revs = m.revisions || [];
    if (revs.length) {
      out.push('## 修改历史', '', '记忆每回忆一次都会被改写。以下是这段记忆之前的写法，最早的在前。', '');
      revs.forEach((r, i) => {
        out.push(`### 第 ${i + 1} 版 · 写于 ${String(r.at || '').slice(0, 10)}`, '');
        if (r.title) out.push(`**${r.title}**`, '');
        const wl = parseEDTF(r.when); if (wl || r.whenText) out.push(`时间：${wl ? wl.label : r.whenText}`, '');
        if (r.body) out.push(r.body, '');
        if (r.feeling) out.push(`感受：${r.feeling}`, '');
        if (r.meaning) out.push(`意义：${r.meaning}`, '');
      });
    }
    return out.join('\n').replace(/\n+$/, '\n');
  }

  function timelineMarkdown(mems, nos, paths) {
    const { groups, unplaced, undated } = bucket(mems);
    const line = m => `- ${whenLabel(m) || '时间未定'} · ${titleOf(m)}（N°${pad(nos.get(m.id), 4)}）→ [${paths.get(m.id)}](${encodeURI('../' + paths.get(m.id))})`;
    const out = ['# 时间线', '', '按我自己划分的人生章节排列。每段记忆归入时间上包含它的、最窄的那一章。', ''];
    groups.forEach((g, i) => {
      out.push(`## 第 ${i + 1} 章 · ${titleOf(g.chapter)}`, '', g.range ? g.range.label : (g.chapter.whenText || '时间未定'), '');
      if (g.chapter.body) out.push(g.chapter.body, '');
      g.items.forEach(m => out.push(line(m)));
      out.push('');
    });
    if (unplaced.length) { out.push('## 章节之外', ''); unplaced.forEach(m => out.push(line(m))); out.push(''); }
    if (undated.length) { out.push('## 时间未定', ''); undated.forEach(m => out.push(line(m))); out.push(''); }
    return out.join('\n');
  }

  function readme(now, count, attachmentCount) {
    return [
      '# 另一个我 · 记忆包',
      '',
      `导出于 ${now}。共 ${count} 段记忆，${attachmentCount} 个原始素材。`,
      '',
      '## 检验完整性',
      '',
      '在终端里进入这个文件夹，运行：',
      '',
      '    shasum -a 256 -c MANIFEST.sha256',
      '',
      '每一行都显示 OK，说明所有文件与导出时完全一致。',
      '',
      '## 结构',
      '',
      '- `data/memories.json`：全部记忆的完整数据，包括每一次修改前的版本。这是最权威的一份。',
      '- `00`–`06` 文件夹：同样的记忆，每段一个 Markdown 文件，任何文本编辑器都能打开。',
      '- `01-时间线/时间线.md`：按人生章节排列的总览。',
      '- `07-原始素材/`：录音、照片等原件，未经压缩或改动。',
      '- `MANIFEST.sha256`：每个文件的 SHA-256 校验码。',
      '',
      '## 字段说明',
      '',
      '- `when`：EDTF 日期（美国国会图书馆扩展日期格式）。`1998` 是某一年，`1998-07` 是某月，`1998~` 是约 1998 年，`1998?` 是可能是 1998 年，`199X` 是 90 年代，`1990/2002` 是一段时间，`2015/..` 是 2015 年至今。',
      '- `when_text`：我当时输入的原话。',
      '- `certainty`：clear 清楚记得 · hazy 有些模糊 · told 听别人说的。',
      '- `access`：self 仅自己 · family 留给家人 · twin 交给另一个我。标为「仅自己」的记忆，请不要交给 AI，也不要给别人看。',
      '- `prompt_id`：引出这段记忆的问题，来自 McAdams 的生命故事访谈（Life Story Interview）。',
      '- `revisions`：修改历史。最初的版本永远保留。',
      '',
    ].join('\n');
  }

  // Where each memory's attachments live inside an archive. Deterministic, so an importer can
  // rebuild the same paths for archives that predate the `archivePath` field.
  function attachmentPaths(mems) {
    const nos = numbers(mems);
    const used = new Set(['README.md', 'MANIFEST.sha256', 'data/memories.json', '01-时间线/时间线.md']);
    const ordered = [...mems].sort((a, b) => nos.get(a.id) - nos.get(b.id));
    const out = new Map();
    for (const m of ordered) {
      out.set(m.id, (m.attachments || []).map(a => uniquePath(used, `07-原始素材/${pad(nos.get(m.id), 4)}-${safeName(a.name || a.id)}`)));
    }
    return { nos, used, ordered, paths: out };
  }

  // Returns every text file and every attachment to fetch. The app adds the bytes and the manifest.
  function buildArchive(mems, now) {
    const { nos, used, ordered, paths: attPaths } = attachmentPaths(mems);
    const attachments = [];
    const paths = new Map();
    const files = [];
    for (const m of ordered) {
      const no = nos.get(m.id);
      const aPaths = attPaths.get(m.id);
      (m.attachments || []).forEach((a, i) => attachments.push({ path: aPaths[i], att: a, memoryId: m.id }));
      const p = uniquePath(used, pathFor(m));
      paths.set(m.id, p);
      files.push({ path: p, text: toMarkdown(m, no, p, aPaths) });
    }
    const data = {
      schema: 'another-me/1',
      exported_at: now,
      vocab: { kinds: KINDS, certainty: CERTAINTY, access: ACCESS },
      interview: { sections: SECTIONS, prompts: PROMPTS },
      memories: ordered.map(m => ({
        no: nos.get(m.id), path: paths.get(m.id), ...m,
        ...(m.attachments ? { attachments: m.attachments.map((a, i) => ({ ...a, archivePath: attPaths.get(m.id)[i] })) } : {}),
      })),
    };
    files.unshift(
      { path: 'README.md', text: readme(now, mems.length, attachments.length) },
      { path: 'data/memories.json', text: JSON.stringify(data, null, 2) + '\n' },
      { path: '01-时间线/时间线.md', text: timelineMarkdown(mems, nos, paths) },
    );
    return { files, attachments };
  }

  // Same format as `shasum -a 256` output, so `shasum -a 256 -c` can check it.
  function manifestText(entries) {
    return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(e => `${e.hex}  ${e.path}`).join('\n') + '\n';
  }

  // Reads data/memories.json from an archive (this app's or the Claude version's) back into memories,
  // each attachment paired with the archive path its bytes sit at.
  function readArchiveData(data) {
    if (!data || data.schema !== 'another-me/1' || !Array.isArray(data.memories)) {
      throw new Error('这不是「另一个我」的记忆包：找不到 another-me/1 格式的 data/memories.json。');
    }
    const mems = data.memories.map(({ no, path, ...m }) => ({
      ...m, ...(m.attachments ? { attachments: m.attachments.map(({ archivePath, ...a }) => a) } : {}),
    }));
    const rebuilt = attachmentPaths(mems).paths;
    const sources = new Map(data.memories.map(m => [m.id, (m.attachments || []).map((a, i) => a.archivePath || rebuilt.get(m.id)[i])]));
    return { mems, sources };
  }

  root.AM = {
    KINDS, CERTAINTY, ACCESS, MEANING_LABEL, SECTIONS, PROMPTS,
    parseEDTF, fromHuman, promptById, titleOf, whenLabel, numbers, answeredPrompts, bucket, revise, merge,
    safeName, pathFor, toMarkdown, buildArchive, readArchiveData, manifestText, pad,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
