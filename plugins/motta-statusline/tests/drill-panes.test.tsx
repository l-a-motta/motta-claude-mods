import { expect, test } from 'claude-code/testing'

import { answerSession } from './session.tsx'

const HOUR = 3_600_000
const WORKTREE = { cwd: 'C:/code/vtex-copilot-fse/.claude/worktrees/ui-tweaks', status: '## feat/ui-tweaks...origin/feat/ui-tweaks [ahead 2]\n M manifest.json\n?? notes.md\n' }

// files, ctx, 5h and 7d ask changes-drill, context-drill and usage-drill for
// their panes, and the ✦ asks prompt-enhancer for its Enhance pane, through the nouns those mods add to `$`; this mod has no panes
// of its own. The test loads this mod alone (not its dependencies), so the
// nouns are missing: no pane opens, and a toast names the mod to install.
test('files, ctx, 5h and ✦ open no pane of their own, and say which mod to install', async ($, on) => {
  const clock = answerSession(on, null, 'nothing', WORKTREE)
  const opened: string[] = []
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  await $.session.measure({
    context: { tokens: 360_000, window: 1_000_000, percent: 36 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 19, resetsAt: new Date(clock.now() + 1.8 * HOUR).toISOString() }],
    changed: ['rateLimits'],
  })
  await ui.press({ key: 'changes' })
  await ui.press({ key: 'context' })
  await ui.press({ key: 'usage-5h' })
  await ui.press({ key: 'enhance' })
  expect(opened).toEqual([])
  expect(toasts).toEqual([
    'Install changes-drill for the Changes pane',
    'Install context-drill for the Context pane',
    'Install usage-drill for the Usage pane',
    'Install prompt-enhancer for the Enhance pane',
  ])
  await ui.unmount()
})
