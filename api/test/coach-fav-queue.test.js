/* The favourites toggle has to survive the trip through the job queue.

   The intake screen asks about favourites and posts the answer with the request — the state's
   own copy only reaches the server on a debounced PUT, so a job that dropped the answer would
   build the first plan from whatever the state happened to hold. That is not a hypothetical:
   the flag was read from the state in payload.build and passed into enqueue by the route, but
   the queue's own job object never carried it, so `job.favOnly` was always undefined and the
   request-carried answer was silently discarded. On a fresh toggle the state on disk still said
   `false`, the PUT had not arrived, and the first plan came back with exercises the person had
   never starred.

   The suite that shipped with the feature tested librarySlice() and build() directly, so it
   passed throughout: it built the opts by hand and never went near the queue. These tests go
   through enqueue() and read the payload the provider actually received, which is the only
   place the missing link is visible. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payload = await import('../coach/core/payload.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');

cfg.save({ enabled: true, provider: 'fixture' });

// The privilege drop fails closed on a host that is not the container, the same reason the rest
// of the suite pins it.
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

// Real catalogue ids: the payload is asserted against the dataset, not an assumption about it.
const idsOf = eq => payload.LIBRARY.filter(e => e.eq === eq).map(e => e.id);
const FAVOURITES = [...idsOf('cable').slice(0, 6), ...idsOf('dumbbell').slice(0, 6)];

/** A state whose synced copy says `favOnly` false — the fresh-toggle case: the answer is only
 *  in the request, and the state on disk has not caught up yet. No routines: a routine's
 *  exercises are pinned into the slice by `keep` whatever the toggle says, and this test is
 *  about the toggle. */
const freshToggle = () => {
  const S = sampleState({
    favEx: FAVOURITES,
    routines: [], workouts: [], exWeights: {},
    coach: { consent: { agreedAt: new Date().toISOString(), version: 1 }, favOnly: false,
      profile: { goal: 'muscle', daysPerWeek: 3, equipment: [] } },
  });
  return S;
};

/** A local server on the Chat Completions wire, so the payload that reached the provider can be
 *  read back out of the request body. It answers with a plan built from the ids it was offered,
 *  which is what a real model would do. */
async function wire() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      seen.push(parsed);
      const m = (parsed.messages?.[1]?.content || '').match(/```json\s*([\s\S]*?)```/);
      let lib = [];
      try { lib = JSON.parse(m[1]).library || []; } catch { /* answered below anyway */ }
      const ex = lib.slice(0, 3).map(e => ({ id: e.id, sets: 3, reps: 10 }));
      const plan = {
        coach_contract: 1, opengym_plan: 1, name: 'T', summary: 's',
        routines: [{ id: 'r1', name: 'A', ex }], week: { 1: 'r1', 3: 'r1', 5: 'r1' },
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { seen, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const offeredIds = seen => {
  const m = (seen[0].messages?.[1]?.content || '').match(/```json\s*([\s\S]*?)```/);
  return JSON.parse(m[1]).library.map(e => String(e.id));
};

const withWire = async fn => {
  const w = await wire();
  cfg.save({ enabled: true, provider: 'compatible', providerOptions: { compatible: { baseUrl: w.base } }, models: { compatible: 'local-model' } });
  forcePrivilegeVerdict({ ok: false, dropped: false, why: 'no `coach` user exists in this image' });
  try { await fn(w); } finally {
    forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
    cfg.save({ provider: 'fixture' });
    w.close();
  }
};

const INTAKE = { goal: 'muscle', daysPerWeek: 3, equipment: [] };

test('a create carries the request-carried favOnly through the queue, over a state that says otherwise', async () => {
  await withWire(async w => {
    const uid = 'u-fav-carried';
    // The state says false — the PUT has not arrived. Only the request carries the answer.
    writeState(DIR, uid, freshToggle());
    jobs.enqueue(uid, { kind: 'create', intake: INTAKE, favOnly: true });
    await settle(uid);

    const offered = offeredIds(w.seen);
    assert.ok(offered.length > 0, 'the provider was given a library');
    assert.ok(offered.every(id => FAVOURITES.includes(id)),
      'the request-carried answer reached the payload, not the state that said false');
  });
});

test('a create with favOnly false is the wider slice, even over a state that says true', async () => {
  await withWire(async w => {
    const uid = 'u-fav-false';
    const S = freshToggle();
    S.coach.favOnly = true;          // the state says true; the request says false
    writeState(DIR, uid, S);
    jobs.enqueue(uid, { kind: 'create', intake: INTAKE, favOnly: false });
    await settle(uid);

    const offered = offeredIds(w.seen);
    assert.ok(offered.length > FAVOURITES.length,
      'false is a real answer and must beat a state that says true');
  });
});

test('a job that carries no answer falls through to the synced state', async () => {
  await withWire(async w => {
    const uid = 'u-fav-state';
    const S = freshToggle();
    S.coach.favOnly = true;          // no answer on the job: the state is what speaks
    writeState(DIR, uid, S);
    jobs.enqueue(uid, { kind: 'create', intake: INTAKE });
    await settle(uid);

    const offered = offeredIds(w.seen);
    assert.ok(offered.every(id => FAVOURITES.includes(id)),
      'with no answer on the job, the synced state decided');
  });
});
