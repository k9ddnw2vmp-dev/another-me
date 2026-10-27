const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const AM = require(path.join(__dirname, '../core.js'));

test('fromHuman turns everyday Chinese into EDTF', () => {
  const cases = {
    '1998': '1998',
    '1998年': '1998',
    '1998年7月': '1998-07',
    '1998年7月12日': '1998-07-12',
    '1998.7.12': '1998-07-12',
    '１９９８': '1998',
    '约1998': '1998~',
    '1998年左右': '1998~',
    '可能是1998': '1998?',
    '1998？': '1998?',
    '大概1998年？': '1998%',
    '90年代': '199X',
    '00年代': '200X',
    '1990年代': '199X',
    '20世纪': '19XX',
    '1990-2002': '1990/2002',
    '1990到2002': '1990/2002',
    '1990年—2002年': '1990/2002',
    '2015至今': '2015/..',
    '2015年到现在': '2015/..',
    '1998~': '1998~',
    '1990/2002': '1990/2002',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(AM.fromHuman(input), want, input);
  for (const bad of ['', '小学三年级', '1998年夏天', '1998-13', '1998年2月30日', '2002到1990', '199X-05']) {
    assert.equal(AM.fromHuman(bad), null, bad);
  }
});

test('parseEDTF ranges and labels', () => {
  const r = AM.parseEDTF('199X');
  assert.equal(r.start, '1990-01-01');
  assert.equal(r.end, '1999-12-31');
  assert.equal(r.label, '1990 年代');
  assert.equal(AM.parseEDTF('1998~').label, '约 1998 年');
  assert.equal(AM.parseEDTF('1998?').label, '1998 年（不确定）');
  assert.equal(AM.parseEDTF('2000-02').end, '2000-02-29');
  assert.equal(AM.parseEDTF('19XX').label, '20 世纪');
  assert.equal(AM.parseEDTF('2015/..').label, '2015 年 — 至今');
  assert.equal(AM.parseEDTF('2015/..').end, '9999-12-31');
  assert.equal(AM.parseEDTF('2002/1990'), null);
  assert.equal(AM.parseEDTF('1999-02-29'), null);
});

test('bucket places each memory in the narrowest chapter that contains it', () => {
  const mems = [
    { id: 'c1', kind: 'chapter', title: '童年', when: '1990/2002', recordedAt: '1' },
    { id: 'c2', kind: 'chapter', title: '小学', when: '1996/2002', recordedAt: '2' },
    { id: 'm1', kind: 'scene', when: '1998~', recordedAt: '3' },
    { id: 'm2', kind: 'scene', when: '1992', recordedAt: '4' },
    { id: 'm3', kind: 'scene', when: '2010', recordedAt: '5' },
    { id: 'm4', kind: 'scene', when: '', whenText: '小学三年级', recordedAt: '6' },
  ];
  const { groups, unplaced, undated } = AM.bucket(mems);
  assert.deepEqual(groups.map(g => g.items.map(m => m.id)), [['m2'], ['m1']]);
  assert.deepEqual(unplaced.map(m => m.id), ['m3']);
  assert.deepEqual(undated.map(m => m.id), ['m4']);
});

test('revise keeps the first version forever', () => {
  let doc = AM.revise(null, { kind: 'scene', body: 'v0' }, 't0');
  assert.equal(doc.revisions.length, 0);
  assert.equal(doc.recordedAt, 't0');
  for (let i = 1; i <= 30; i++) doc = AM.revise(doc, { kind: 'scene', body: 'v' + i }, 't' + i);
  assert.equal(doc.revisions.length, 20);
  assert.equal(doc.revisions[0].body, 'v0');
  assert.equal(doc.revisions.at(-1).body, 'v29');
  assert.equal(doc.body, 'v30');
  assert.equal(doc.recordedAt, 't0');
  const same = AM.revise(doc, { kind: 'scene', body: 'v30', certainty: 'hazy' }, 'tx');
  assert.equal(same.revisions.length, 20, 'changing only metadata adds no revision');
});

test('revise stays under the document size budget and still keeps the original', () => {
  const big = 'x'.repeat(30000);
  let doc = AM.revise(null, { kind: 'scene', body: 'first' }, 't0');
  for (let i = 1; i <= 15; i++) doc = AM.revise(doc, { kind: 'scene', body: big + i }, 't' + i);
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) <= 200 * 1024);
  assert.equal(doc.revisions[0].body, 'first');
});

test('safeName strips characters that break file systems', () => {
  assert.equal(AM.safeName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(AM.safeName('  ..  '), '无题');
  assert.equal(AM.safeName('妈妈'), '妈妈');
});

function sampleMemories() {
  const tricky = '他说："别怕：明天会好。"\n第二行 # 不是标题\n---\n';
  return [
    { id: 'a', kind: 'chapter', promptId: 'A1', title: '童年', when: '1990/2002', whenText: '1990到2002', body: '在小镇长大。', access: 'twin', certainty: 'clear', recordedAt: '2026-10-26T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z', revisions: [] },
    { id: 'b', kind: 'scene', promptId: 'B3', title: tricky, when: '1998~', whenText: '约1998', where: '外婆家', people: ['外婆', '我'], body: '那天下了雨。', feeling: '害怕', meaning: '我开始自己做决定。', certainty: 'hazy', access: 'family', attachments: [{ id: 'f1', url: '/_blob/f1', name: '外婆的声音.m4a' }], recordedAt: '2026-10-26T11:00:00Z', updatedAt: '2026-10-27T09:00:00Z', revisions: [{ at: '2026-10-26T11:00:00Z', title: '雨', when: '1998', whenText: '1998', body: '下雨。', feeling: '', meaning: '' }] },
    { id: 'c', kind: 'person', title: '外婆', relation: '外婆', body: '她总是笑。', access: 'self', recordedAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:00:00Z', revisions: [] },
    { id: 'd', kind: 'person', title: '外婆', body: '同名的第二个文件。', access: 'twin', recordedAt: '2026-10-26T13:00:00Z', updatedAt: '2026-10-26T13:00:00Z', revisions: [] },
    { id: 'e', kind: 'diary', when: '2026-10-26', whenText: '2026-10-26', body: '今天开始记录。', access: 'twin', recordedAt: '2026-10-26T14:00:00Z', updatedAt: '2026-10-26T14:00:00Z', revisions: [] },
  ];
}

test('buildArchive: unique paths, lossless JSON, parseable front matter', () => {
  const mems = sampleMemories();
  const { files, attachments } = AM.buildArchive(mems, '2026-10-26T15:00:00Z');
  const paths = files.map(f => f.path).concat(attachments.map(a => a.path));
  assert.equal(new Set(paths).size, paths.length, 'paths are unique');
  assert.ok(paths.includes('02-人物/外婆.md') && paths.includes('02-人物/外婆-2.md'));
  assert.ok(paths.includes('03-关键事件/1998-别怕明天会好。 第二行 # 不是标题 ---.md') || paths.some(p => p.startsWith('03-关键事件/1998-')));
  assert.deepEqual(attachments.map(a => a.path), ['07-原始素材/0002-外婆的声音.m4a']);

  const json = JSON.parse(files.find(f => f.path === 'data/memories.json').text);
  assert.equal(json.schema, 'another-me/1');
  const { mems: back, sources } = AM.readArchiveData(json);
  for (const m of mems) assert.deepEqual(back.find(x => x.id === m.id), m, 'JSON round-trip for ' + m.id);
  assert.deepEqual(sources.get('b'), ['07-原始素材/0002-外婆的声音.m4a']);
  assert.equal(attachments[0].att.id, 'f1');

  const scene = files.find(f => f.path.startsWith('03-关键事件/'));
  const fm = scene.text.split('\n---\n')[0].replace(/^---\n/, '');
  const parsed = Object.fromEntries(fm.split('\n').map(l => {
    const i = l.indexOf(': ');
    return [l.slice(0, i), JSON.parse(l.slice(i + 2))];
  }));
  assert.equal(parsed.title, mems[1].title);
  assert.equal(parsed.when, '1998~');
  assert.equal(parsed.when_label, '约 1998 年');
  assert.deepEqual(parsed.people, ['外婆', '我']);
  assert.equal(parsed.access, 'family');
  assert.equal(parsed.revision_count, 1);
  assert.match(scene.text, /\]\(\.\.\/07-%E5%8E%9F/, 'attachment link climbs out of its folder');
  assert.match(scene.text, /### 第 1 版/);

  const timeline = files.find(f => f.path === '01-时间线/时间线.md').text;
  assert.match(timeline, /## 第 1 章 · 童年/);
  assert.ok(timeline.indexOf('约 1998 年') > timeline.indexOf('第 1 章'));
});

test('MANIFEST.sha256 verifies with the system shasum tool', () => {
  const { files } = AM.buildArchive(sampleMemories(), '2026-10-26T15:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'another-me-'));
  const entries = [];
  for (const f of files) {
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const bytes = Buffer.from(f.text, 'utf8');
    fs.writeFileSync(full, bytes);
    entries.push({ path: f.path, hex: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  fs.writeFileSync(path.join(dir, 'MANIFEST.sha256'), AM.manifestText(entries));
  const out = execFileSync('shasum', ['-a', '256', '-c', 'MANIFEST.sha256'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.trim().split('\n').filter(l => l.endsWith(': OK')).length, files.length);

  fs.appendFileSync(path.join(dir, '02-人物/外婆.md'), 'tampered');
  assert.throws(() => execFileSync('shasum', ['-a', '256', '-c', 'MANIFEST.sha256'], { cwd: dir, stdio: 'pipe' }), 'a changed file fails the check');
  fs.rmSync(dir, { recursive: true });
});

test('interview covers every Life Story Interview key scene once', () => {
  const ids = AM.PROMPTS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(AM.PROMPTS.filter(p => p.sec === 'B').length, 8);
  for (const p of AM.PROMPTS) {
    assert.ok(AM.KINDS[p.kind], p.id);
    assert.ok(AM.SECTIONS.some(s => s.id === p.sec), p.id);
  }
  assert.ok(AM.answeredPrompts([{ kind: 'chapter' }]).has('A1'));
});

test('readArchiveData pairs attachments in archives made before archivePath existed', () => {
  const mems = sampleMemories();
  const { files } = AM.buildArchive(mems, 'now');
  const json = JSON.parse(files.find(f => f.path === 'data/memories.json').text);
  for (const m of json.memories) for (const a of m.attachments || []) delete a.archivePath; // the Claude version's format
  const { sources } = AM.readArchiveData(json);
  assert.deepEqual(sources.get('b'), ['07-原始素材/0002-外婆的声音.m4a']);
  assert.throws(() => AM.readArchiveData({ schema: 'other' }), /记忆包/);
});

test('merge keeps both wordings and never loses the first version', () => {
  const base = AM.revise(null, { kind: 'scene', body: '最初' }, '2026-01-01T00:00:00Z');
  const phone = AM.revise(base, { kind: 'scene', body: '手机上改的', attachments: [{ id: 'p' }] }, '2026-01-02T00:00:00Z');
  const laptop = AM.revise(base, { kind: 'scene', body: '电脑上改的', attachments: [{ id: 'l' }] }, '2026-01-03T00:00:00Z');
  const m = AM.merge(phone, laptop);
  assert.equal(m.body, '电脑上改的', 'newer edit is the text');
  const bodies = m.revisions.map(r => r.body);
  assert.deepEqual(bodies, ['最初', '手机上改的']);
  assert.equal(m.revisions[1].from, 'other-device');
  assert.deepEqual(m.attachments.map(a => a.id).sort(), ['l', 'p']);
  assert.deepEqual(AM.merge(laptop, phone), m, 'order of arguments does not matter');
  assert.deepEqual(AM.merge(m, m).revisions, m.revisions, 'merging twice adds nothing');
});
