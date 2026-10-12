import { describe, expect, mock, test } from 'claude-code/testing'

import { projection, sparkText } from '../hooks/register.tsx'

const HOUR = 3_600_000

describe('projection', () => {
  test('says where the pace so far ends, and when it is too early to tell', () => {
    expect(projection(19, 0.64, 5 * HOUR)).toBe('64% of the window gone · at this pace about 30% by the reset')
    expect(projection(40, 0.2, 5 * HOUR)).toBe('20% of the window gone · at this pace 100% in about 1h30m, before the reset')
    expect(projection(5, 0.01, 5 * HOUR)).toBe('1% of the window gone, too early to project')
    expect(projection(5, null, null)).toBe('')
  })
})

describe('sparkText', () => {
  test('draws a block per slice of the window gone, each as tall as its last reading', () => {
    // A 10-hour window opened at 0: readings of 0% then 50% five hours in, drawn at hour 6.
    const line = sparkText([[0, 0], [5 * HOUR, 50]], 10 * HOUR, 10 * HOUR, 6 * HOUR, 10)
    expect(line).toBe('▁▁▁▁▅▅····')
  })
})

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
    expect(await pane.find({ type: 'Text', text: '64% of the window gone · at this pace about 30% by the reset' })).toBeDefined()
  })
}
