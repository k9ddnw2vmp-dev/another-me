const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const AM = require(path.join(__dirname, '../core.js'));
const { createSync } = require(path.join(__dirname, '../sync.js'));

// A fake cloud with the same contract as the Supabase adapter: a database sequence bumped on every write.
// Like PostgREST, it returns seq as a string.
function fakeCloud() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    online: true,
    async pull(after, limit) {
      if (!this.online) throw new Error('offline');
      return [...rows.values()]
        .filter(r => r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map(r => ({ ...structuredClone(r), seq: String(r.seq) }));
    },
    async push(list) {
      if (!this.online) throw new Error('offline');
      return list.map(({ id, doc, deleted }) => {
        const row = { id, doc: structuredClone(doc), deleted, seq: ++seq };
        rows.set(id, row);
        return { id, seq: String(row.seq) };
      });
    },
  };
}

function memoryStore() {
  const recs = new Map(), meta = new Map();
  return {
    recs,
    async all() { return [...recs.values()].map(r => structuredClone(r)); },
    async get(id) { return recs.has(id) ? structuredClone(recs.get(id)) : undefined; },
    async put(r) { recs.set(r.id, structuredClone(r)); },
    async meta(k) { return meta.get(k); },
    async setMeta(k, v) { meta.set(k, v); },
  };
}

function device(cloud) {
  const store = memoryStore();
  const sync = createSync({ store, remote: cloud });
  return {
    store, sync,
    async write(id, body, at, prev) {
      const cur = await store.get(id);
      const doc = AM.revise(cur && !cur.deleted ? cur.doc : null, { kind: 'scene', body }, at);
      await sync.save(id, doc);
    },
    async doc(id) { const r = await store.get(id); return r && { ...r.doc, deleted: r.deleted }; },
  };
}

test('a memory written on the phone arrives on the laptop', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud), laptop = device(cloud);
  await phone.write('m1', '外婆的手', '2026-10-27T01:00:00Z');
  assert.equal(await phone.sync.pending(), 1);
  assert.deepEqual(await phone.sync.run(), { pulled: 0, pushed: 1 });
  assert.equal(await phone.sync.pending(), 0);
  await laptop.sync.run();
  assert.equal((await laptop.doc('m1')).body, '外婆的手');
});

test('offline edits on two devices merge without losing a word', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud), laptop = device(cloud);
  await phone.write('m1', '最初', '2026-10-27T01:00:00Z');
  await phone.sync.run(); await laptop.sync.run();

  cloud.online = false;
  await phone.write('m1', '手机上改的', '2026-10-27T02:00:00Z');
  await laptop.write('m1', '电脑上改的', '2026-10-27T03:00:00Z');
  await assert.rejects(phone.sync.run(), /offline/);
  assert.equal(await phone.sync.pending(), 1, 'the edit waits while offline');

  cloud.online = true;
  await phone.sync.run();
  await laptop.sync.run();
  await phone.sync.run();

  const a = await phone.doc('m1'), b = await laptop.doc('m1');
  assert.deepEqual(a, b, 'both devices converge');
  assert.equal(a.body, '电脑上改的');
  const words = [a.body, ...a.revisions.map(r => r.body)];
  for (const w of ['最初', '手机上改的', '电脑上改的']) assert.ok(words.includes(w), w);
  assert.equal(await phone.sync.pending(), 0);
  assert.equal(await laptop.sync.pending(), 0);
});

test('an edit beats a delete, whichever device syncs first', async () => {
  for (const deleterFirst of [true, false]) {
    const cloud = fakeCloud();
    const phone = device(cloud), laptop = device(cloud);
    await phone.write('m1', '旧', '2026-10-27T01:00:00Z');
    await phone.sync.run(); await laptop.sync.run();

    await phone.sync.remove('m1');
    await laptop.write('m1', '补充了细节', '2026-10-27T02:00:00Z');
    const order = deleterFirst ? [phone, laptop, phone] : [laptop, phone, laptop];
    for (const d of order) await d.sync.run();
    await phone.sync.run(); await laptop.sync.run();

    for (const d of [phone, laptop]) {
      const m = await d.doc('m1');
      assert.equal(m.deleted, false, `deleterFirst=${deleterFirst}`);
      assert.equal(m.body, '补充了细节');
    }
  }
});

test('a delete with no competing edit reaches every device', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud), laptop = device(cloud);
  await phone.write('m1', '要删掉的', '2026-10-27T01:00:00Z');
  await phone.sync.run(); await laptop.sync.run();
  await laptop.sync.remove('m1');
  await laptop.sync.run(); await phone.sync.run();
  assert.equal((await phone.doc('m1')).deleted, true);
  assert.equal((await phone.doc('m1')).body, undefined, 'the words are gone from the cloud copy');
});

test('an edit made while a push is in flight is not marked synced', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud);
  await phone.write('m1', '第一稿', '2026-10-27T01:00:00Z');
  const realPush = cloud.push.bind(cloud);
  cloud.push = async list => { const out = await realPush(list); await phone.write('m1', '第二稿', '2026-10-27T01:00:05Z'); return out; };
  await phone.sync.run();
  cloud.push = realPush;
  assert.equal(await phone.sync.pending(), 1);
  await phone.sync.run();
  assert.equal(cloud.rows.get('m1').doc.body, '第二稿');
});

test('paging walks through more rows than one page', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud), laptop = device(cloud);
  for (let i = 0; i < 1203; i++) await phone.write('m' + String(i).padStart(4, '0'), '记忆 ' + i, '2026-10-27T01:00:00Z');
  await phone.sync.run();
  const r = await laptop.sync.run();
  assert.equal(r.pulled, 1203);
  assert.equal((await laptop.store.all()).length, 1203);
  assert.deepEqual(await laptop.sync.run(), { pulled: 0, pushed: 0 }, 'a second sync changes nothing');
});

test('two overlapping runs share one round trip', async () => {
  const cloud = fakeCloud();
  const phone = device(cloud);
  await phone.write('m1', 'x', '2026-10-27T01:00:00Z');
  let pushes = 0;
  const realPush = cloud.push.bind(cloud);
  cloud.push = async l => { pushes++; return realPush(l); };
  await Promise.all([phone.sync.run(), phone.sync.run()]);
  assert.equal(pushes, 1);
});
