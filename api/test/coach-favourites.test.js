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
