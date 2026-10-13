import { expect, test } from 'claude-code/testing'

import { isCompact } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS } from './session.tsx'

test('isCompact: under 80 cells, and never on an unknown width', () => {
  expect(isCompact(79)).toBe(true)
  expect(isCompact(80)).toBe(false)
  expect(isCompact(0)).toBe(false)
  expect(isCompact(undefined)).toBe(false)
})

// A narrow band keeps the root, the branch, its files and the bars, and
// leaves out the worktree's repository, the last commit, the context's token
// counts and the last slot.
test('a narrow band draws compact, a wide one in full', async ($, on) => {
  const cwd = 'C:/code/vtex-copilot-fse/.claude/worktrees/ui-tweaks'
  const clock = answerSession(on, null, 'nothing', { cwd, status: '## feat/ui-tweaks\n M manifest.json\n' })
  for (const [bodyColumns, isNarrow] of [[50, true], [120, false]] as const) {
    const ui = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns } })
    await clock.settle()
    expect(await ui.find({ key: 'folder' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feat\/ui-tweaks/ })).toBeDefined()
    expect(await ui.find({ key: 'context' })).toBeDefined()
    const has = async (q: object) => (await ui.find(q as never)) !== undefined
    expect(await has({ type: 'Text', text: 'vtex-copilot-fse' })).toBe(!isNarrow)
    expect(await has({ type: 'Text', text: /^committed / })).toBe(!isNarrow)
    expect(await has({ type: 'Text', text: '360k/1M' })).toBe(!isNarrow)
    expect(await has({ key: 'slot' })).toBe(!isNarrow)
    await ui.unmount()
  }
})
