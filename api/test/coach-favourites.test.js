// The Coach's favourites whitelist: when the intake asks for it, the slice the model chooses
// from is the person's starred exercises — inside the equipment they declared, never their own
// exercises (those are theirs to judge, and always travel), and never empty: a starred set that
// reaches nothing falls back to the equipment slice rather than leaving the Coach with nothing
// to propose.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as payload from '../coach/core/payload.js';

// Real catalogue ids, so the assertions read the dataset rather than an assumption about it.
const idsOf = eq => payload.LIBRARY.filter(e => e.eq === eq).map(e => e.id);
const someCable = idsOf('cable').slice(0, 4);
const someDumbbell = idsOf('dumbbell').slice(0, 4);

const ids = slice => slice.map(e => e.id);

test('favOnly narrows the slice to the starred exercises', () => {
  const slice = payload.librarySlice({ favEx: someCable }, [], { favOnly: true });
  assert.ok(slice.length > 0, 'a starred set still yields candidates');
  assert.ok(slice.every(e => someCable.includes(e.id)), 'nothing outside the favourites');
});

test('favOnly is ANDed with the equipment: a favourite out of reach does not come back', () => {
  const slice = payload.librarySlice({ favEx: [...someCable, ...someDumbbell] }, ['dumbbell'], { favOnly: true });
  assert.ok(slice.length > 0);
  assert.ok(slice.every(e => someDumbbell.includes(e.id)), 'the cable favourites are not in reach');
  assert.ok(slice.every(e => (payload.LIBRARY.find(x => x.id === e.id) || {}).eq === 'dumbbell'));
});

test('favOnly with nothing starred falls back to the equipment slice, not an empty one', () => {
  assert.deepEqual(
    ids(payload.librarySlice({ favEx: [] }, ['dumbbell'], { favOnly: true })),
    ids(payload.librarySlice({ favEx: [] }, ['dumbbell'], { favOnly: false })),
  );
});

test('favOnly with favourites the equipment cannot reach falls back too', () => {
  assert.deepEqual(
    ids(payload.librarySlice({ favEx: someCable }, ['dumbbell'], { favOnly: true })),
    ids(payload.librarySlice({ favEx: someCable }, ['dumbbell'], { favOnly: false })),
  );
});

test('favOnly with no equipment at all narrows to the favourites, body weight included', () => {
  const slice = payload.librarySlice({ favEx: someCable }, [], { favOnly: true });
  assert.ok(slice.length <= someCable.length, 'no wider than the starred set');
});

test("the person's own exercises always travel, whitelist or not", () => {
  const S = { favEx: someCable, customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }] };
  assert.equal(payload.librarySlice(S, [], { favOnly: true })[0].id, 'cx1');
});

test('favOnly is the person\'s whole list: their order, past the catalogue cap, uncut', () => {
  // A starred list bigger than MAX_LIBRARY — the case the catalogue cap would cut, and the
  // lanes would thin by body part (hardest where the person starred most).
  const many = payload.LIBRARY.filter(e => e.eq === 'cable').map(e => e.id);
  assert.ok(many.length > payload.MAX_LIBRARY, 'the fixture has to exceed the cap, or this proves nothing');
  assert.ok(many.length <= payload.MAX_FAVOURITES, 'and stay inside the curated bound');
  const slice = payload.librarySlice({ favEx: many }, ['cable'], { favOnly: true });
  // Stretches are still skipped — the Coach does not build a plan from them — but nothing else is.
  const kept = many.filter(id => !payload.isStretch(payload.LIBRARY.find(e => e.id === id)));
  assert.deepEqual(slice.map(e => e.id), kept, 'the whole list, in the person\'s order');
});

test('a starred list is read in the order it was starred, not the catalogue order', () => {
  // Same equipment, and not in catalogue order: the catalogue lists 0007 before 0148, so a
  // catalogue-order slice would come back as the catalogue's, not this one.
  const pick = ['0148', '0007', '0150'];
  assert.ok(pick.every(id => (payload.LIBRARY.find(e => e.id === id) || {}).eq === 'cable'));
  const slice = payload.librarySlice({ favEx: pick }, ['cable'], { favOnly: true });
  assert.deepEqual(slice.map(e => e.id), pick, 'their order, not the catalogue\'s');
});

test('the lanes still run when the toggle is off, so the catalogue keeps its balance', () => {
  const many = payload.LIBRARY.filter(e => e.eq === 'cable').map(e => e.id);
  const slice = payload.librarySlice({ favEx: many }, ['cable'], { favOnly: false });
  assert.equal(slice.length, payload.MAX_LIBRARY, 'the catalogue keeps its own cap');
  // The lanes reorder by body part; a starred list does not. They must not be the same slice.
  assert.notDeepEqual(slice.map(e => e.id), many.slice(0, payload.MAX_LIBRARY));
});

test('the curated bound still bounds a pathological list', () => {
  const all = payload.LIBRARY.map(e => e.id);
  assert.ok(all.length > payload.MAX_FAVOURITES, 'the catalogue has to be bigger, or this proves nothing');
  const slice = payload.librarySlice({ favEx: all }, [], { favOnly: true });
  assert.ok(slice.length <= payload.MAX_FAVOURITES, 'the curated bound holds');
});

test('off by default: an untouched state gets the slice it had before the feature', () => {
  assert.deepEqual(
    ids(payload.librarySlice({ favEx: someCable }, ['dumbbell'], {})),
    ids(payload.librarySlice({ favEx: someCable }, ['dumbbell'], { favOnly: false })),
  );
});

/* ---------- through build(), where the job and the state meet ---------- */

// `favEx` is top-level state (it is the Library's own list), and the answer to the intake's
// question rides on `coach`. Both, so the two paths can be told apart.
const stateWith = coach => ({
  unit: 'kg', lang: 'en', routines: [], week: {}, workouts: [], customEx: [], favEx: someCable,
  coach: { consent: { agreedAt: '2026-01-01T00:00:00.000Z' }, profile: { goal: 'muscle', equipment: [] }, ...coach },
});

test("build() carries the job's favOnly into the slice", () => {
  const S = stateWith({});
  const on = payload.build(S, { handle: 'h'.repeat(16), kind: 'create', favOnly: true });
  assert.ok(on.library.length > 0);
  assert.ok(on.library.every(e => someCable.includes(e.id)), 'the job asked for favourites only');

  const off = payload.build(S, { handle: 'h'.repeat(16), kind: 'create', favOnly: false });
  assert.ok(off.library.length > someCable.length, 'and off is the wider slice, or this proves nothing');
});

test("build() reads the state's favOnly when the job carries none", () => {
  const S = stateWith({ favOnly: true });
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'create' });
  assert.ok(p.library.length > 0);
  assert.ok(p.library.every(e => someCable.includes(e.id)), 'the synced answer was honoured');
});

test('a review honours it too, and never leaves the slice empty', () => {
  const S = stateWith({});
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'review', favOnly: true });
  assert.ok(p.library.length > 0);
  assert.ok(p.library.every(e => someCable.includes(e.id)));
});

test('a job that says false beats a state that says true', () => {
  const S = stateWith({ favOnly: true });
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'create', favOnly: false });
  assert.ok(p.library.length > someCable.length);
});

test('the state answer alone is enough when the state carries no favourites', () => {
  const S = { ...stateWith({ favOnly: true }), favEx: [] };
  const p = payload.build(S, { handle: 'h'.repeat(16), kind: 'create' });
  assert.ok(p.library.length > 0, 'an empty starred set never leaves the Coach with nothing');
});
