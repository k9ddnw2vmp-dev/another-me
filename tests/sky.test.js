const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '../core.js'));
const { layout, dayNumber } = require(path.join(__dirname, '../sky.js'));

const NOW = new Date(2026, 9, 27);
const mem = (id, extra) => ({ id, kind: 'scene', body: 'x', recordedAt: '2026-10-20T08:00:00Z', ...extra });

test('every memory is exactly one star; chapters lie on the horizon instead', () => {
  const L = layout([
    mem('a', { when: '1998' }),
    mem('b', { when: '' }),
    { id: 'c', kind: 'chapter', title: '小时候', when: '1990/1995' },
  ], NOW);
  assert.deepEqual(L.stars.map(s => s.id).sort(), ['a', 'b']);
  assert.equal(L.chapters.length, 1);
  assert.equal(L.chapters[0].title, '小时候');
  assert.equal(L.undated, 1);
});

test('time runs left to right from the earliest year to today', () => {
  const L = layout([mem('old', { when: '1990-03' }), mem('mid', { when: '2008' }), mem('new', { when: '2026-10' })], NOW);
  const x = id => L.stars.find(s => s.id === id).x;
  assert.equal(L.from, 1990);
  assert.ok(x('old') < x('mid') && x('mid') < x('new'));
  assert.ok(x('new') <= 1);
  for (const t of L.ticks) assert.ok(+t.label >= 1990 && +t.label <= 2026);
});

test('undated memories gather in their own column past the dated sky', () => {
  const L = layout([mem('d', { when: '2001' }), mem('u1'), mem('u2', { when: '不知道' })], NOW);
  const dated = L.stars.find(s => s.id === 'd');
  for (const s of L.stars.filter(s => !s.dated)) assert.ok(s.x > L.timeW && s.x <= 1);
  assert.ok(dated.x <= L.timeW);
});

test('a star sits in the same place every time, and inside its own date range', () => {
  const mems = [mem('a', { when: '199X' }), mem('b', { when: '1990/2002' })];
  const one = layout(mems, NOW), two = layout(mems, NOW);
  assert.deepEqual(one.stars.map(s => [s.x, s.y]), two.stars.map(s => [s.x, s.y]));
  const yr = s => one.from + s.x / one.timeW * (one.to + (one.to - one.from) * 0.02 - one.from);
  for (const s of one.stars) assert.ok(yr(s) >= 1990 && yr(s) <= 2003, `${s.id} at ${yr(s)}`);
});

test('open-ended dates are clamped to the sky, never off its edges', () => {
  const L = layout([mem('a', { when: '2015/..' }), mem('b', { when: '../1999' }), mem('c', { when: '2001' })], NOW);
  for (const s of L.stars) assert.ok(s.x >= 0 && s.x <= L.timeW && s.y > 0 && s.y < 1);
});

test('memories about the same person are joined into a constellation, in time order', () => {
  const L = layout([
    { id: 'p', kind: 'person', title: '外婆', when: '1990', body: '' },
    mem('s1', { when: '1994', people: ['外婆', '妈妈'] }),
    mem('s2', { when: '1992', people: ['外婆'] }),
    mem('s3', { when: '2010', people: ['老王'] }),
  ], NOW);
  const id = i => L.stars[i].id;
  const grandma = L.links.filter(l => l.name === '外婆').map(l => [id(l.a), id(l.b)]);
  assert.deepEqual(grandma, [['p', 's2'], ['s2', 's1']]);
  assert.equal(L.links.filter(l => l.name === '老王').length, 0);
});

test('certainty, length and key scenes change how a star looks', () => {
  const L = layout([
    mem('short', { when: '2000', body: '一句', certainty: 'clear' }),
    mem('long', { when: '2000', body: '很多字'.repeat(400), certainty: 'hazy' }),
    { id: 'told', kind: 'person', when: '2000', certainty: 'told', title: '某人' },
  ], NOW);
  const s = id => L.stars.find(x => x.id === id);
  assert.ok(s('long').size > s('short').size);
  assert.equal(s('long').cert, 'hazy');
  assert.equal(s('told').cert, 'told');
  assert.equal(s('short').key, true);
  assert.equal(s('told').key, false);
});

test('overlapping chapters stack into lanes; the replay follows the order you wrote them', () => {
  const L = layout([
    { id: 'c1', kind: 'chapter', title: '上学', when: '1996/2008' },
    { id: 'c2', kind: 'chapter', title: '初中', when: '2002/2005' },
    { id: 'c3', kind: 'chapter', title: '工作', when: '2010/..' },
    mem('later', { when: '1999', recordedAt: '2026-10-22T00:00:00Z' }),
    mem('first', { when: '2012', recordedAt: '2026-10-01T00:00:00Z' }),
  ], NOW);
  const lane = id => L.chapters.find(c => c.id === id).lane;
  assert.equal(lane('c1'), 0); assert.equal(lane('c2'), 1); assert.equal(lane('c3'), 0);
  assert.equal(L.lanes, 2);
  assert.deepEqual(L.order.map(i => L.stars[i].id), ['first', 'later']);
  assert.equal(dayNumber('2026-10-01', '2026-10-22'), 22);
  assert.equal(dayNumber('2026-10-01', '2026-10-01'), 1);
});

test('chapters that only share the year at their seam stay on one lane', () => {
  const L = layout([
    { id: 'a', kind: 'chapter', title: '小时候', when: '1990/1995' },
    { id: 'b', kind: 'chapter', title: '上学', when: '1995/2008' },
  ], NOW);
  assert.deepEqual(L.chapters.map(c => c.lane), [0, 0]);
});

test('stars spread over the whole height, even for ids that differ by one character', () => {
  const L = layout(Array.from({ length: 200 }, (_, i) => mem('id-' + i, { when: '2000' })), NOW);
  const ys = L.stars.map(s => s.y);
  const quart = [0, 1, 2, 3].map(q => ys.filter(y => y >= 0.06 + q * 0.22 && y < 0.06 + (q + 1) * 0.22).length);
  for (const n of quart) assert.ok(n > 25, `uneven: ${quart}`);
});

test('an empty sky still has a time axis', () => {
  const L = layout([], NOW);
  assert.equal(L.stars.length, 0);
  assert.ok(L.ticks.length > 0);
});
