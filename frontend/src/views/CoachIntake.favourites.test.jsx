// @vitest-environment happy-dom
// The equipment screen's favourites toggle: what it reads, what it writes, and what the
// first plan request carries. The interesting part is the last one — the toggle's answer has
// to ride on the request that builds the plan, because the state's own copy reaches the server
// on a debounced PUT and the plan would otherwise be built before the answer arrived.
//
// Driven the same way CoachIntake.test.jsx drives the screen, so this pins behaviour rather
// than internals.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachIntake from './CoachIntake.jsx'
import { requestPlan, disclosure } from '../lib/coach-api.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, search: '', nav: vi.fn(), toast: vi.fn() }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    config: state.config,
    coachLocal: null,
    update: mut => mut(state.S),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useSearchParams: () => [new URLSearchParams(mocks.search), vi.fn()],
}))
vi.mock('../lib/coach-api.js', () => ({
  requestPlan: vi.fn(() => Promise.resolve({})),
  disclosure: vi.fn(() => Promise.resolve(null)),
  JOB_ERRORS: {},
}))
vi.mock('../coach.css', () => ({}))

let host, root
// Consent already on file, so the flow opens on the first question rather than the terms.
const fresh = favEx => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {}, favEx: favEx || [],
  coach: { consent: { agreedAt: '2026-01-01T00:00:00.000Z', version: 2 } },
})

beforeEach(() => {
  mocks.S = fresh([])
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.search = ''
  mocks.nav.mockReset(); mocks.toast.mockReset()
  vi.mocked(requestPlan).mockReset().mockResolvedValue({})
  vi.mocked(disclosure).mockReset().mockResolvedValue(null)
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<CoachIntake />))
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

const eyebrow = () => host.querySelector('.ob-eyebrow')?.textContent
const all = sel => [...host.querySelectorAll(sel)]
const find = (sel, text) => all(sel).find(el => el.textContent.trim().startsWith(text))
const tap = (sel, text) => {
  const el = find(sel, text)
  expect(el, `no ${sel} starting with "${text}"`).toBeTruthy()
  act(() => el.click())
}
const footBtn = () => host.querySelector('.ob-foot .btn')
const cont = () => act(() => footBtn().click())

// Walk the flow to a named screen, answering only what Continue is actually waiting for.
const walkTo = target => {
  for (let i = 0; i < 12 && eyebrow() !== target; i++) {
    if (eyebrow() === 'Before we start') { tap('button', 'I understand'); continue }
    if (footBtn().disabled) {
      if (eyebrow() === 'Your goal') tap('.ob-choice', 'Build muscle')
      else if (eyebrow() === 'Experience') tap('.ob-choice', 'Training regularly')
    }
    cont()
  }
  expect(eyebrow()).toBe(target)
}

const star = () => host.querySelector('.ob-star')
const toggle = () => host.querySelector('.ob-star .sw')
const flip = () => act(() => toggle().click())

describe('CoachIntake — the favourites toggle', () => {
  it('is on the equipment screen, off by default', () => {
    mount()
    walkTo('Equipment')
    expect(star()).toBeTruthy()
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })

  it('says how many are starred, so it never promises a restriction that cannot bite', () => {
    mocks.S = fresh(['0001', '0002', '0003', '0004', '0005', '0006', '0007'])
    mount()
    walkTo('Equipment')
    expect(star().textContent).toContain('7')
  })

  it('admits when nothing is starred rather than promising the restriction', () => {
    mount()
    walkTo('Equipment')
    expect(star().textContent).toMatch(/Nothing starred yet/)
  })

  it('turns on and reads back on', () => {
    mocks.S = fresh(['0001', '0002'])
    mount()
    walkTo('Equipment')
    flip()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
  })

  it('carries the answer on the plan request, not only in the state', async () => {
    mocks.S = fresh(['0001', '0002'])
    mount()
    walkTo('Equipment')
    flip()
    walkTo('Almost there')
    cont()   // Build my plan
    await settle()
    expect(requestPlan).toHaveBeenCalledTimes(1)
    expect(requestPlan.mock.calls[0][1]).toEqual({ favOnly: true })
  })

  it('writes the answer into the state beside the profile, and keeps it out of the profile', async () => {
    mocks.S = fresh(['0001'])
    mount()
    walkTo('Equipment')
    flip()
    walkTo('Almost there')
    cont()
    await settle()
    expect(mocks.S.coach.favOnly).toBe(true)
    expect(mocks.S.coach.profile.favOnly).toBeUndefined()
  })

  it('sends false when it is left alone, so the server never has to guess', async () => {
    mocks.S = fresh(['0001'])
    mount()
    walkTo('Equipment')
    walkTo('Almost there')
    cont()
    await settle()
    expect(requestPlan.mock.calls[0][1]).toEqual({ favOnly: false })
    expect(mocks.S.coach.favOnly).toBe(false)
  })

  it('opens already on when the state says so, so editing shows what is set', () => {
    mocks.S = fresh(['0001'])
    mocks.S.coach.favOnly = true
    mount()
    walkTo('Equipment')
    expect(toggle().getAttribute('aria-checked')).toBe('true')
  })
})
