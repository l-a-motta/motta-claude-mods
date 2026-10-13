import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  addRise,
  burnRate,
  dayKey,
  hoursOf,
  addSpend,
  familyOf,
  modelShares,
  shade,
  fileWindow,
  hourlyBudget,
  limitLevel,
  limitsOf,
  projection,
  runwayMs,
  settingsOf,
  sparkDots,
  toastText,
} from '../hooks/figures.ts'
import { grid } from '../hooks/activity.tsx'
import { barBlocks, blockDots, seriesBlocks } from '../hooks/meter.tsx'
import { BUDGET, countNodes, fit, TOP_LEVEL, usagePane } from '../hooks/draw.tsx'

const HOUR = 3_600_000

describe('projection', () => {
  test('says where the pace so far ends, and when it is too early to tell', () => {
    expect(projection(19, 0.64, 5 * HOUR)).toBe('64% of the window gone · at this pace about 30% by the reset')
    expect(projection(40, 0.2, 5 * HOUR)).toBe('20% of the window gone · at this pace 100% in about 1h30m, before the reset')
    expect(projection(5, 0.01, 5 * HOUR)).toBe('1% of the window gone, too early to project')
    expect(projection(5, null, null)).toBe('')
  })
})

describe('sparkDots', () => {
  test('a braille cell per slice of the window gone, each as tall as its last reading', () => {
    // A 10-hour window opened at 0: readings of 0% then 50% five hours in, drawn at hour 6.
    const { dots, upTo } = sparkDots([[0, 0], [5 * HOUR, 50]], 10 * HOUR, 10 * HOUR, 6 * HOUR, 10)
    expect(upTo).toBe(6)
    expect(dots).toEqual([0, 0, 0, 0, 4, 4, 0, 0, 0, 0])
  })
})

describe('bars', () => {
  test('a 0-100 figure fills ten blocks left to right; a series lights a block per value', () => {
    expect(barBlocks(42)).toEqual([10, 10, 10, 10, 2, 0, 0, 0, 0, 0])
    expect(seriesBlocks([0, 0.4, 2])).toEqual([0, 2, 10])
    expect(blockDots([0, 1, 10])).toEqual([0, 1, 8])
  })
})

describe('the figures', () => {
  test('burn rate, runway and budget', () => {
    // 20% an hour ago, 30% now: 10 points an hour, 7 hours to 100%; nothing since.
    expect(burnRate([[0, 20], [HOUR, 30]], 30, 0, HOUR, HOUR)).toBe(10)
    expect(burnRate([[0, 20], [HOUR, 30]], 30, 0, 2 * HOUR, HOUR)).toBe(0)
    expect(runwayMs(30, 10)).toBe(7 * HOUR)
    expect(runwayMs(30, 0)).toBe(null)
    // 60% with 3 hours left: 10 points an hour ends it at 90%.
    expect(hourlyBudget(60, 90, 3 * HOUR)).toBe(10)
    expect(hourlyBudget(95, 90, 3 * HOUR)).toBe(null)
  })

  test('colors as motta-statusline does, its thresholds the settings', () => {
    expect(limitLevel(80, 0.9)).toBe('error')
    expect(limitLevel(35, 0.2)).toBe('#ff8700')
    expect(limitLevel(65, 0.9)).toBe('warning')
    expect(limitLevel(20, 0.5)).toBe('success')
    expect(limitLevel(75, 0.9, { redFrom: 70, paceMargin: 10 })).toBe('error')
  })

  test('a window is filed once, with its peak and its last reading', () => {
    const past = fileWindow([], { resetsAt: 5 * HOUR, points: [[0, 10], [HOUR, 70], [2 * HOUR, 64]] })
    expect(past).toEqual([{ resetsAt: 5 * HOUR, peak: 70, last: 64 }])
    expect(fileWindow(past, { resetsAt: 5 * HOUR + 60_000, points: [[0, 99]] })).toBe(past)
  })
})

describe('settings', () => {
  test('the defaults, and a value outside its choices falls back to its default', () => {
    const s = settingsOf({})
    expect(s.gauge).toBe('bar')
    expect(s.burnLookbackMs).toBe(HOUR)
    expect(s.toastAt).toEqual([50, 75, 90])
    expect(s.dollars).toBe('per-point')
    expect(s.redFrom).toBe(80)
    expect(settingsOf({ gauge: 'ring', turnCount: 400, toastAt: 'off' })).toMatchObject({ gauge: 'bar', turnCount: 40, toastAt: [] })
  })
})

describe('toasts', () => {
  const s = settingsOf({})
  const at = (exact: number) => limitsOf([{ kind: 'five_hour', percentUsed: exact, resetsAt: new Date(4 * HOUR).toISOString() }])[0]

  test('says when a limit passes a threshold', () => {
    expect(toastText(at(51), { exact: 49, color: 'success' }, 'success', 0.5, 0, s)).toBe('5h limit passed 50%, resets in 4h00m')
    expect(toastText(at(52), { exact: 51, color: 'success' }, 'success', 0.5, 0, s)).toBe(null)
  })

  test('says when it turns orange, before any threshold', () => {
    expect(toastText(at(51), { exact: 40, color: 'success' }, '#ff8700', 0.2, HOUR, s)).toBe(
      '5h limit is 31 points ahead of its window: 20% of the window gone · at this pace 100% in about 57m, before the reset',
    )
    expect(toastText(at(51), { exact: 40, color: 'success' }, '#ff8700', 0.2, HOUR, { ...s, toastAhead: false })).toBe('5h limit passed 50%, resets in 3h00m')
  })
})

// The session the pane reads: a 5h limit at `percent()` resetting four
// hours from the clock's start, this session `s1`, $1.50 spent.
function answerSession(on: Parameters<TestBody>[1], percent: () => number, entries: (now: number) => Record<string, unknown> = () => ({}), cost: () => number = () => 1.5) {
  const clock = mock.clock(on)
  mock.store(on, entries(clock.now()))
  const resetsAt = new Date(clock.now() + 4 * HOUR).toISOString()
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: percent(), resetsAt }], cost: { usd: cost() } },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  // The noun's own path is tested from motta-statusline, whose module calls
  // it: the host refuses a noun call from a module whose scan lists none.
  test(`/usage-drill opens the pane on the limits, with their projection (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    const opened: string[] = []
    const rateLimits = [{ kind: 'five_hour', percentUsed: 19, resetsAt: new Date(clock.now() + 1.8 * HOUR).toISOString() }]
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits } }))
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    expect((await $.command.run({ command: 'usage-drill', args: '' } as never)).text).toBe('Usage pane opened.')
    expect(opened).toEqual(['usage-drill'])

    const pane = await $.ui.mount({ plugin: 'usage-drill', surface, component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: '5h' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'On track' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'about 30% by the reset' })).toBeDefined()
  })

  test(`a turn's cost and the session's share come from turn.start to turn.complete (${surface})`, async ($, on) => {
    let percent = 10
    answerSession(on, () => percent)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: 'done' }) as never)
    await $.command.run({ command: 'usage-drill', args: '' } as never)
    await $.turn.start({ text: 'go', turnId: 't1' })
    percent = 12.5
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

    const pane = await $.ui.mount({ plugin: 'usage-drill', surface, component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: 'avg 2.5%' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '2.5 of 12.5 pts' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '$0.60 per 1%' })).toBeDefined()
    // Details are open by default; pressed, they close.
    await pane.press({ key: 'details' })
    expect(await pane.find({ type: 'Text', text: 'Per turn' })).toBeUndefined()
  })
}

test('toasts once when a limit turns orange, running ahead of its window', async ($, on) => {
  const clock = answerSession(on, () => 0)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const resetsAt = new Date(clock.now() + 4 * HOUR).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({ context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], changed: ['rateLimits'] })
  // 20% of the window gone: 25% is 5 points ahead, 35% is 15.
  await measure(25)
  await measure(35)
  await measure(36)
  expect(toasts).toEqual(['5h limit is 15 points ahead of its window: 20% of the window gone · at this pace 100% in about 1h51m, before the reset'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws with every feature off but the headline number (${surface})`, { options: { gauge: 'number', burnRate: false, runway: false, budget: false, turnCosts: false, sessionShare: false, dollars: 'off', history: false, heatmap: false, idleHint: false, density: 'compact', resetAs: 'relative' } }, async ($, on) => {
    answerSession(on, () => 42)
    await $.command.run({ command: 'usage-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'usage-drill', surface, component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'resets in 4h00m' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Ahead of pace' })).toBeDefined()
  })
}

describe('activity', () => {
  test('spend splits by model family, Opus, Sonnet, Haiku, Fable, then other', () => {
    expect(familyOf('claude-opus-5-5[1m]')).toBe('opus')
    expect(familyOf('claude-haiku-5-5')).toBe('haiku')
    expect(familyOf('gpt-x')).toBe('other')
    const at = new Date(2026, 9, 12, 10).getTime()
    let spend = addSpend({}, at, 'claude-opus-5-5', 3)
    spend = addSpend(spend, at, 'claude-haiku-5-5', 1)
    expect(modelShares(spend)).toEqual({ shares: [0.75, 0, 0.25, 0], other: 0, total: 4 })
  })

  test('the grid sums each three-hour slot of each day', async () => {
    const at = (h: number) => new Date(2026, 9, 12, h, 30).getTime()
    let days = addRise({}, at(9), 2)
    days = addRise(days, at(10), 1)
    days = addRise(days, at(20), 3)
    const { cells } = grid(days, at(23), 2)
    expect(cells[3]).toEqual([0, 3])
    expect(cells[6]).toEqual([0, 3])
    expect(hoursOf(days)[20]).toBe(3)
    expect(shade(3, 3)).toBe(4)
    expect(shade(0.5, 3)).toBe(1)
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test('draws the activity from the days kept (' + surface + ')', async ($, on) => {
    answerSession(on, () => 30, now => {
      const hours = new Array(24).fill(0)
      hours[new Date(now).getHours()] = 4
      return { 'usage:days': { [dayKey(now)]: hours }, 'usage:models': { [dayKey(now)]: { opus: 3, haiku: 1 } } }
    })
    await $.command.run({ command: 'usage-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'usage-drill', surface, component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 100 } as never })
    expect(await pane.find({ type: 'Text', text: 'Activity' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '4 pts' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Opus' })).toBeDefined()
  })
}

// Both limits, a 5h window with readings, turns (this session's and
// another's) and a past window, and a day of activity.
function answerBoth(on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on)
  const now = clock.now()
  const five = now + 2 * HOUR
  const seven = now + 72 * HOUR
  const hours = new Array(24).fill(0)
  hours[new Date(now).getHours()] = 4
  mock.store(on, {
    'usage:5h': { resetsAt: five, points: [[now - 2 * HOUR, 10], [now - HOUR, 20]] },
    'usage:turns:5h': { resetsAt: five, turns: [{ at: now - HOUR, session: 's1', delta: 1.5 }, { at: now - HOUR / 2, session: 's2', delta: 2 }] },
    'usage:history:5h': [{ resetsAt: five - 5 * HOUR, peak: 70, last: 64 }],
    'usage:days': { [dayKey(now)]: hours },
    'usage:models': { [dayKey(now)]: { opus: 3, haiku: 1 } },
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({
    value: {
      startedAt: now - 2 * HOUR,
      context: { tokens: 0, window: 1_000_000, percent: 0 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 30.4, resetsAt: new Date(five).toISOString() },
        { kind: 'seven_day', percentUsed: 41.2, resetsAt: new Date(seven).toISOString() },
      ],
      cost: { usd: 1.5 },
    },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('hover cards carry the figures behind the rows (desktop)', async ($, on) => {
  answerBoth(on)
  await $.command.run({ command: 'usage-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'usage-drill', surface: 'desktop', component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 100 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  // Card text is split into styled pieces: values plain, labels dim.
  // The 5h head sits on the pane's top line: its card is revealed below it.
  expect(drawn).toContain('"30.4%"')
  expect(drawn).toContain('" used of a 5-hour window"')
  expect(drawn).toContain('"69.6 pts"')
  expect(drawn).toContain('tip:5h:head')
  expect(drawn).toContain('"41.2%"')
  expect(drawn).toContain('" used of a 7-day window"')
  // The verdict card takes its status: on track, its color word green.
  expect(drawn).toContain('"green"')
  expect(drawn).toContain('": heading for under 80% by the reset"')
  expect(drawn).toContain('"other sessions: "')
  expect(drawn).toContain('"1 turn, +2"')
  expect(drawn).toContain('"70%"')
  expect(drawn).toContain('" at its end"')
  // The Details button's card: the action, then its hotkey as a chip.
  expect(drawn).toContain('"Hides the 5h and 7d details "')
  expect(drawn).toContain('" d "')
  expect(drawn).toContain('"Opus "')
  expect(drawn).toContain('"$3.00"')
  // Tone colors: the action's accent, the verdict's good, the plain cards' faint.
  expect(drawn).toContain('#8db4f0')
  expect(drawn).toContain('#7fc97f')
  expect(drawn).toContain('#6f6d68')
  expect(await pane.find({ key: 'details' } as never)).toBeDefined()
})

test('the terminal draws no hover cards, the rows and the Details button kept', async ($, on) => {
  answerBoth(on)
  await $.command.run({ command: 'usage-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'usage-drill', surface: 'terminal', component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 100 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('41%')
  expect(drawn).not.toContain('"display":"none"')
  expect(drawn).not.toContain('" used of a 5-hour window"')
  expect(drawn).not.toContain('"69.6 pts"')
  expect(drawn).not.toContain('tip:5h:head')
  expect(drawn).not.toContain('": heading for under 80% by the reset"')
  expect(drawn).not.toContain('"Hides the 5h and 7d details "')
  expect(drawn).not.toContain('" d "')
  expect(await pane.find({ key: 'tip-room' } as never)).toBeUndefined()
  expect(await pane.find({ key: 'details' } as never)).toBeDefined()
})

test('no hover cards on a phone', async ($, on) => {
  answerBoth(on)
  await $.command.run({ command: 'usage-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'usage-drill', surface: 'mobile', component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 60 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('41%')
  expect(drawn).not.toContain('pts left')
  expect(drawn).not.toContain('" left"')
  expect(drawn).not.toContain('tip:5h:head')
  expect(drawn).not.toContain('" d "')
})

test('a step’s cost goes to the model that answered it', async ($, on) => {
  let usd = 1
  answerSession(on, () => 30, () => ({}), () => usd)
  on('turn.step', async function* () {
    usd = 1.75
    return { turnId: 't1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-haiku-5-5', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never
  })
  await $.command.run({ command: 'usage-drill', args: '' } as never)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream) {
    // Drained only.
  }
  await stream.result
  const pane = await $.ui.mount({ plugin: 'usage-drill', surface: 'desktop', component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 100 } as never })
  expect(await pane.find({ type: 'Text', text: 'Haiku' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '100% of $0.75 by model' })).toBeDefined()
})

// The element budget. This pane is fixed in size (about 340 elements here,
// 393 measured live), so it never reaches BUDGET itself: the ladder is shown
// with a lower budget, drawing straight from usagePane with a plain table.
describe('the element budget', () => {
  const now = new Date(2026, 9, 12, 10).getTime()
  const hours = new Array(24).fill(0)
  hours[10] = 4
  const view = (surface: 'desktop' | 'terminal') => ({
    limits: limitsOf([
      { kind: 'five_hour', percentUsed: 30.4, resetsAt: new Date(now + 2 * HOUR).toISOString() },
      { kind: 'seven_day', percentUsed: 41.2, resetsAt: new Date(now + 72 * HOUR).toISOString() },
    ] as never),
    kept: {},
    days: { [dayKey(now)]: hours },
    models: { [dayKey(now)]: { opus: 3, haiku: 1 } },
    columns: 100,
    session: { id: 's1', startedAt: now - 2 * HOUR, costUsd: 1.5 },
    settings: settingsOf({}),
    showDetails: true,
    onToggleDetails: () => {},
    now,
    surface,
  })
  const table = { Box: 'Box', Text: 'Text', Button: 'Button' }
  const draw = (surface: 'desktop' | 'terminal') => (level: number) => usagePane(table, surface === 'desktop' ? 'Svg' : null, view(surface), level)
  const counts = [0, 1, 2].map(level => countNodes(draw('desktop')(level)))

  test('each level draws fewer elements; info cards go first, then every card; the terminal draws none', () => {
    expect(counts[0]).toBeGreaterThan(counts[1])
    expect(counts[1]).toBeGreaterThan(counts[2])
    // Between level 1 and level 0: level 1, the action and status cards kept.
    const one = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[1]))
    expect(countNodes(JSON.parse(one))).toBe(counts[1])
    expect(one).not.toContain('" used of a 5-hour window"')
    expect(one).not.toContain('local hours, over every day kept')
    expect(one).toContain('"Hides the 5h and 7d details "')
    expect(one).toContain('#7fc97f')
    // Under level 1: no card, and no host lit or scoped for one.
    const two = JSON.stringify(fit('desktop', TOP_LEVEL, draw('desktop'), counts[2]))
    expect(two).not.toContain('#8db4f0')
    expect(two).not.toContain('#7fc97f')
    expect(two).not.toContain('#ffffff10')
    expect(two).not.toContain('"scope":"tip:')
    // The terminal draws no card at all, however much room the budget leaves.
    const terminal = JSON.stringify(fit('terminal', TOP_LEVEL, draw('terminal')))
    expect(countNodes(JSON.parse(terminal))).toBe(countNodes(draw('terminal')(2)))
    expect(terminal).not.toContain('" used of a 5-hour window"')
    expect(terminal).not.toContain('"Hides the 5h and 7d details "')
    expect(terminal).not.toContain('"display":"none"')
    expect(terminal).not.toContain('"scope":"tip:')
  })

  test('the mounted desktop pane stays under the budget with every card', async ($, on) => {
    answerBoth(on)
    await $.command.run({ command: 'usage-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'usage-drill', surface: 'desktop', component: 'Pane', requestId: 'usage-drill', props: { title: 'Usage', isFocused: false, bodyColumns: 100 } as never })
    const drawn = await pane.drawn()
    expect(countNodes(drawn)).toBeLessThanOrEqual(BUDGET)
    expect(JSON.stringify(drawn)).toContain('" used of a 5-hour window"')
  })
})
