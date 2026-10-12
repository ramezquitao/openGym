/* The exercise catalogue the Coach reasons over, in the five fields it needs.
 *
 * `library-data.js` is generated from the frontend dataset and committed (see
 * scripts/build-coach-assets.mjs) — the same arrangement the translated instruction packs use.
 * It is an ES module rather than JSON on purpose: bare node needs createRequire for JSON, Vite
 * needs an import attribute, and this file has to load under both without either knowing.
 */
import { EXERCISES } from './library-data.js';

export const LIBRARY = EXERCISES;
export const LIB_BY_ID = new Map(LIBRARY.map(e => [e.id, e]));

export const libraryHas = id => LIB_BY_ID.has(id);
export const libraryName = id => LIB_BY_ID.get(id)?.n || null;

/* Whether the person's equipment covers a catalogue exercise. Body weight is never gated, the
   same rule the app's own equipment profiles follow (frontend lib/equipment.js), and an id the
   catalogue does not hold (one of their own exercises) is theirs to judge, not ours. No
   equipment stated means the whole catalogue. */
const ALWAYS_AVAILABLE = 'body weight';
export function equipmentAllows(equipment, id) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  if (!wanted.length) return true;
  const eq = (LIB_BY_ID.get(id)?.eq || '').toLowerCase();
  return !eq || eq === ALWAYS_AVAILABLE || wanted.includes(eq);
}

/* ---------- the library slice the model gets to choose from ----------
   Bounded. The catalogue is 5,632 rows — far more tokens on every job than a small local model
   can hold, and a model does not choose better from thousands of options than from a hundred.
   So the slice is capped, and balanced: a weighted share of every body part, in catalogue order
   (deterministic, so repeated jobs keep the same prefix), with the exercises already in the
   user's plan or history always included — a review has to be able to name what it is talking
   about. The one case the balancing is skipped is a starred list (favOnly): see the branch in
   librarySlice. */
export const MAX_LIBRARY = 160;

/* How many candidates a *starred* list may carry. The cap above is sized for the catalogue:
   5,632 rows, far more than a small local model can hold, and a model does not choose better
   from thousands of options than from a hundred. A starred list is a different thing — the
   person already made the choice, and cutting it to 160 throws away most of it (and, run
   through the lanes, drops whole patterns: four hammer curls in, none out). So a curated list
   gets its own, generous bound: high enough that no realistic list meets it, low enough that a
   pathological one cannot fill the request. The payload guard (MAX_PAYLOAD_CHARS) is the real
   backstop, and at this size a full list is a fifth of it. */
export const MAX_FAVOURITES = 1000;

// What one library entry tells the model: enough to pick it, nothing more. The taxonomy
// fields beyond body part never appear in a rationale and cost ~30 tokens an entry.
const slim = e => ({ id: e.id, n: e.n, bp: e.bp, ...(e.custom ? { custom: true } : {}) });

/* Mobility work is not what a plan is built from, and at an even share per body part the
   catalogue's 57 stretches crowded out the lifts that are: a first plan for someone who
   stated no equipment arrived with "upper legs" as five stretches, a balance board and some
   band work — no squat, no hinge, no lunge anywhere in the lane.

   Dropped from the candidate pool, never from the catalogue. One already in someone's plan or
   history is pinned by `keep` below and still travels, because a review has to be able to name
   what it is talking about, and the validator still accepts every id the catalogue holds.

   The word boundary is what stops this being a silent data bug: "single leg bridge with
   outstretched leg" is a glute exercise, not a stretch. */
export const isStretch = e => /\bstretch(es|ing)?\b/i.test((e && e.n) || '');

/* ---------- what each body part is worth in candidates ----------
   An equal lane per body part reads fair and is not: it spent as many of the 160 slots on
   "lower arms" (37 rows, wrist curls to a one) as on "chest", and gave "neck" (two rows, both
   stretches) a lane of its own. A plan is not drawn from an even spread of the catalogue's
   taxonomy, so the lanes are weighted by how much programming actually draws on them.

   These are shares, not quotas — a lane that runs out hands its remainder to the others, which
   is what keeps a narrow equipment filter from returning a short slice. Anything not listed
   gets 1, so a body part added to the catalogue later still appears rather than vanishing. */
const LANE_WEIGHT = {
  'back': 4, 'chest': 4, 'upper legs': 4,
  'shoulders': 3,
  'upper arms': 2, 'waist': 2,
  'cardio': 1, 'lower arms': 1, 'lower legs': 1, 'neck': 1
};
const laneWeight = bp => LANE_WEIGHT[bp] ?? 1;

export function librarySlice(S, equipment, { keep = [], max = MAX_LIBRARY, favOnly = false } = {}) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  // A custom exercise's name and body part are whatever the person typed, and its id is
  // whatever the client wrote; all three ride into every prompt. Cut to the bounds payload.js
  // gives every other name (NAME_MAX, 80) and id (ID_MAX, 64); a non-string reads as absent.
  const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const customs = (Array.isArray(S.customEx) ? S.customEx : [])
    .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
    .map(c => ({ id: cut(c.id, 64), n: cut(c.n, 80), bp: cut(c.bp, 40), tg: null, eq: 'custom', custom: true }));
  // No equipment stated (or "everything") ⇒ the whole catalogue. Filtering to nothing would
  // leave the Coach unable to propose anything at all, which is a worse failure than a
  // slightly larger payload.
  const filtered = wanted.length ? LIBRARY.filter(e => equipmentAllows(wanted, e.id)) : LIBRARY;
  const equipped = filtered.length ? filtered : LIBRARY;
  // Favourites as a whitelist: the intake can ask the Coach to work only from the exercises the
  // person starred. The pool then narrows to those — inside the equipment above, so a favourite
  // needing kit they do not have does not come back, and their own exercises are untouched (they
  // exist nowhere else and the model cannot guess them, which is why they always travel).
  // A starred set that reaches nothing the equipment allows is not a filter worth honouring
  // either: an empty library leaves the Coach unable to propose anything at all, which is the
  // worse failure. The slice then falls back to the equipment, exactly as with the feature off.
  const starredIds = favOnly ? (Array.isArray(S.favEx) ? S.favEx.map(String) : []) : [];
  // In the person's own order, not the catalogue's: this is their list, and the order they
  // starred it in is the only order it has. Resolved through the catalogue so every entry is
  // the real one, and through `equipped` so a favourite the equipment cannot reach stays out.
  const favourites = starredIds.length
    ? starredIds.map(id => equipped.find(e => e.id === id)).filter(Boolean)
    : null;
  // A starred set the equipment cannot reach is not a curated list — it is a list that came to
  // nothing, and it falls back to the equipment below like every other filter that removes
  // everything. An empty array is truthy, so this is a length test, not a truthiness one.
  const curated = !!(favourites && favourites.length);
  const pool = curated ? favourites : equipped;
  // Same reasoning as the equipment fallback: a filter that removed everything is not a filter
  // worth honouring. Someone whose only kit reaches nothing but stretches gets the stretches.
  const lifts = pool.filter(e => !isStretch(e));
  const base = lifts.length ? lifts : pool;

  const pinned = new Set(keep.filter(id => LIB_BY_ID.has(id)));
  const out = [];
  const taken = new Set();
  const add = e => { if (!taken.has(e.id)) { taken.add(e.id); out.push(e); } };
  // What the user already trains comes first, filter or no filter.
  for (const id of pinned) add(LIB_BY_ID.get(id));
  if (base.length + out.length <= max) {
    base.forEach(add);
  } else if (curated) {
    // The person starred these, so the slice is their list — in their order, and up to
    // MAX_FAVOURITES rather than the catalogue's cap. The weighted round-robin below exists to
    // stop a 292-row "upper arms" crowding out a 37-row "lower arms" in a catalogue of
    // thousands; over a list somebody curated by hand it does two bad things. It recuts the
    // very selection the toggle promised to honour, and because the lanes are weighted by what
    // a catalogue holds, the group starred most (arms, for a cable machine) is thinned hardest
    // while others lose nothing — whole patterns disappearing on the way, four hammer curls in
    // and none out. Their bound is MAX_FAVOURITES; the payload guard bounds the request.
    const curatedMax = Math.max(max, MAX_FAVOURITES);
    for (const e of base) { if (out.length >= curatedMax) break; add(e); }
  } else {
    // Weighted round-robin across body parts, so a 292-row "upper arms" cannot crowd out a
    // 37-row "lower arms" and a 37-row "lower arms" cannot claim as much room as "chest";
    // order within a body part is the catalogue's own. Lanes are visited in sorted key order
    // and each takes its weight per pass, so the slice stays deterministic.
    const groups = new Map();
    for (const e of base) { if (!groups.has(e.bp)) groups.set(e.bp, []); groups.get(e.bp).push(e); }
    const keys = [...groups.keys()].sort();
    const lanes = keys.map(k => groups.get(k));
    const weights = keys.map(laneWeight);
    const cursor = lanes.map(() => 0);
    let progressed = true;
    while (out.length < max && progressed) {
      progressed = false;
      for (let i = 0; i < lanes.length && out.length < max; i++) {
        for (let n = 0; n < weights[i] && out.length < max; n++) {
          while (cursor[i] < lanes[i].length && taken.has(lanes[i][cursor[i]].id)) cursor[i]++;
          if (cursor[i] >= lanes[i].length) break;   // lane spent; its share flows to the rest
          add(lanes[i][cursor[i]++]);
          progressed = true;
        }
      }
    }
  }
  return [...customs, ...out].map(slim);
}
