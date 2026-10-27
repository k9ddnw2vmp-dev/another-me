/* 另一个我 · sync
 * Local-first sync between this device and the cloud. No DOM and no Supabase here:
 * the app passes in a `store` (IndexedDB) and a `remote` (Supabase), the tests pass in fakes.
 *
 * store:  all() → records · get(id) → record | undefined · put(record) · meta(key) · setMeta(key, value)
 *         record = { id, doc, deleted, base, dirty }   base = the cloud seq this edit started from
 * remote: pull(afterSeq, limit) → rows with seq > afterSeq, ordered by seq
 *         push([{ id, doc, deleted }]) → [{ id, seq }]
 *         row = { id, doc, deleted, seq }   seq = a database sequence, bumped on every write
 *
 * Rules: an edit is never lost. Two edits of one memory merge (AM.merge keeps the other wording in
 * the history). An edit beats a delete.
 */
(function (root) {
  'use strict';
  const AM = root.AM || require('./core.js');

  const PAGE = 500;
  const OVERLAP = 50; // re-read a few versions behind the cursor, in case a slower write committed late
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Local wins nothing by default; it only survives where it holds words the cloud does not.
  function reconcile(local, row) {
    if (local.deleted && row.deleted) return { id: row.id, doc: row.doc, deleted: true, base: row.seq, dirty: false };
    if (local.deleted) return { id: row.id, doc: row.doc, deleted: false, base: row.seq, dirty: false };
    if (row.deleted) return { ...local, base: row.seq, dirty: true };
    return { id: row.id, doc: AM.merge(local.doc, row.doc), deleted: false, base: row.seq, dirty: true };
  }

  function createSync({ store, remote }) {
    let inflight = null;

    async function pull() {
      const cursor = Number(await store.meta('cursor')) || 0;
      let after = Math.max(0, cursor - OVERLAP);
      let newest = cursor, changed = 0;
      for (;;) {
        const rows = await remote.pull(after, PAGE);
        for (const row of rows) {
          row.seq = Number(row.seq);
          const local = await store.get(row.id);
          if (local && local.base === row.seq) {
            // Already seen this cloud version; only an unpushed local edit could differ, and it stays dirty.
          } else if (local && local.dirty) {
            await store.put(reconcile(local, row)); changed++;
          } else if (!local || !same(local.doc, row.doc) || local.deleted !== row.deleted) {
            await store.put({ id: row.id, doc: row.doc, deleted: row.deleted, base: row.seq, dirty: false }); changed++;
          } else {
            await store.put({ ...local, base: row.seq });
          }
          if (row.seq > newest) newest = row.seq;
        }
        if (rows.length < PAGE) break;
        after = rows[rows.length - 1].seq;
      }
      await store.setMeta('cursor', newest);
      return changed;
    }

    async function push() {
      const dirty = (await store.all()).filter(r => r.dirty);
      if (!dirty.length) return 0;
      const sent = new Map(dirty.map(r => [r.id, r]));
      const saved = await remote.push(dirty.map(r => ({ id: r.id, doc: r.doc, deleted: r.deleted })));
      for (const s of saved) {
        const cur = await store.get(s.id), was = sent.get(s.id);
        // If the memory was edited again while this push was in flight, keep it dirty for the next round.
        const untouched = cur && same(cur.doc, was.doc) && cur.deleted === was.deleted;
        await store.put({ ...cur, base: Number(s.seq), dirty: !untouched });
      }
      return saved.length;
    }

    // Pull first so concurrent edits from other devices merge before ours go up.
    function run() {
      if (!inflight) {
        inflight = (async () => {
          try {
            const pulled = await pull();
            const pushed = await push();
            return { pulled, pushed };
          } finally { inflight = null; }
        })();
      }
      return inflight;
    }

    async function save(id, doc) {
      const cur = await store.get(id);
      await store.put({ id, doc, deleted: false, base: cur ? cur.base : null, dirty: true });
    }

    async function remove(id) {
      const cur = await store.get(id);
      if (!cur) return;
      await store.put({ id, doc: { deletedAt: new Date().toISOString() }, deleted: true, base: cur.base, dirty: true });
    }

    async function pending() { return (await store.all()).filter(r => r.dirty).length; }

    return { run, pull, push, save, remove, pending };
  }

  root.AMSync = { createSync, reconcile };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AMSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
