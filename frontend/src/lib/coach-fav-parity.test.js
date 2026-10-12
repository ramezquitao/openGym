// @vitest-environment happy-dom
// The favourites toggle has to reach the Coach on every path that can build a payload — not
// just the server one.
//
// Three runtimes build a payload: the server (api/coach/jobs.js), the phone running the Coach
// itself (lib/coach-local.js, which imports the *same* api/coach/core/payload.js), and the
// demo. The toggle's answer is asked on the intake screen and handed over with the request,
// because the synced state may not be saved yet — so a path that drops it builds the first
// plan without the restriction, silently. That is exactly what the phone did.
//
// This pins the wiring rather than the pipeline: that `requestPlan`'s options survive the trip
// through coach-api.js into coach-local.js and out the other side into payload.build.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  localPlan: vi.fn(() => Promise.resolve({ job: { id: 'j1' } })),
  localReview: vi.fn(() => Promise.resolve({ job: { id: 'j2' } })),
  build: vi.fn(() => ({ library: [] })),
  api: vi.fn(() => Promise.resolve({})),
}))

vi.mock('./coach-local.js', () => ({
  localPlan: mocks.localPlan,
  localReview: mocks.localReview,
  localStatus: vi.fn(),
  localRefine: vi.fn(),
  localDebrief: vi.fn(),
  localResolve: vi.fn(),
  localForget: vi.fn(),
  localDisclosure: vi.fn(),
  localModels: vi.fn(),
  setNotifier: vi.fn(),
}))

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { coach: { consent: { agreedAt: 'x' } } }, coachLocal: { mode: 'byok' } })
  const useStore = sel => sel ? sel(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn() })
  const useUI = sel => sel ? sel(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('./api.js', () => ({ api: mocks.api }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('./demo.js', () => ({ DEMO: false }))
vi.mock('./i18n.js', () => ({ t: s => s, getLang: () => 'en' }))

// coach-local imports the shared payload builder; stub it so this test is about the wiring.
vi.mock('../../../api/coach/core/payload.js', () => ({
  build: mocks.build,
  DATA_CATEGORIES: [],
  langTag: () => 'en',
}))

const { requestPlan } = await import('./coach-api.js')

describe('the favourites toggle reaches every runtime', () => {
  beforeEach(() => { mocks.localPlan.mockClear(); mocks.build.mockClear() })

  it('hands the answer to the phone path, not just the server one', async () => {
    await requestPlan({ goal: 'muscle' }, { favOnly: true })
    expect(mocks.localPlan).toHaveBeenCalledTimes(1)
    // (S, intake, opts) — the third argument is the one that was missing.
    expect(mocks.localPlan.mock.calls[0][2]).toEqual({ favOnly: true })
  })

  it('passes false when the toggle is off, so the phone never has to guess', async () => {
    await requestPlan({ goal: 'muscle' }, { favOnly: false })
    expect(mocks.localPlan.mock.calls[0][2]).toEqual({ favOnly: false })
  })

  it('says nothing when no options were given, and the state decides', async () => {
    await requestPlan({ goal: 'muscle' })
    const opts = mocks.localPlan.mock.calls[0][2]
    expect(opts?.favOnly).toBeUndefined()
  })
})
