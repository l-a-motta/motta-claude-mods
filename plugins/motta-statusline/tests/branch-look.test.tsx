import { describe, expect, test } from 'claude-code/testing'

import { branchLook, parsePr, parseStatus } from '../hooks/register.tsx'
import { answerSession, BAND_PROPS, PR_JSON } from './session.tsx'

const clean = parseStatus('## feat/x...origin/feat/x\n')
const open = { ...JSON.parse(PR_JSON), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', statusCheckRollup: [] }
const pr = (raw: object) => parsePr(JSON.stringify({ ...open, ...raw }))
const check = (status: string, conclusion: string) => ({ __typename: 'CheckRun', name: 'build', status, conclusion })

describe('branchLook', () => {
  test("follows the PR's state when the branch has one", () => {
    expect(branchLook(clean, pr({ state: 'MERGED' }), 'main')).toEqual({ icon: 'merged', color: 'merged' })
    expect(branchLook(clean, pr({ state: 'CLOSED' }), 'main')).toEqual({ icon: 'closed', color: 'error' })
    expect(branchLook(clean, pr({ isDraft: true }), 'main')).toEqual({ icon: 'draft', color: 'subtle' })
    expect(branchLook(clean, pr({ statusCheckRollup: [check('COMPLETED', 'FAILURE')] }), 'main')).toEqual({ icon: 'pr', color: 'error' })
    expect(branchLook(clean, pr({ mergeable: 'CONFLICTING' }), 'main')).toEqual({ icon: 'pr', color: 'error' })
    expect(branchLook(clean, pr({ reviewDecision: 'CHANGES_REQUESTED' }), 'main')).toEqual({ icon: 'pr', color: 'error' })
    expect(branchLook(clean, pr({ statusCheckRollup: [check('IN_PROGRESS', '')] }), 'main')).toEqual({ icon: 'pr', color: 'warning' })
    expect(branchLook(clean, pr({ statusCheckRollup: [check('COMPLETED', 'SUCCESS')] }), 'main')).toEqual({ icon: 'pr', color: 'success' })
  })

  test('with no PR, says whether files changed, commits wait to be pushed, or all is in step', () => {
    expect(branchLook(parseStatus('## feat/x...origin/feat/x [ahead 1]\n M a.ts\n'), null, 'main')).toEqual({ icon: 'branch', color: 'warning' })
    expect(branchLook(parseStatus('## feat/x...origin/feat/x [ahead 1]\n'), null, 'main')).toEqual({ icon: 'branch', color: 'suggestion' })
    expect(branchLook(parseStatus('## feat/x\n'), null, 'main')).toEqual({ icon: 'branch', color: 'suggestion' })
    expect(branchLook(parseStatus('## main\n'), null, 'main')).toEqual({ icon: 'branch', color: 'success' })
    expect(branchLook(clean, null, 'main')).toEqual({ icon: 'branch', color: 'success' })
  })
})

// The fixture's PR fails CI and conflicts with main: the branch draws red
// with the pull-request icon, and no link to the repository is left.
test('draws the branch in its PR color with its icon, and no repo link', async ($, on) => {
  const clock = answerSession(on, PR_JSON)
  const terminal = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
  })
  await clock.settle()
  expect((await terminal.find({ type: 'Text', text: 'dev' }))?.props).toMatchObject({ color: 'error' })
  expect((await terminal.find({ type: 'Text', text: '⇄' }))?.props).toMatchObject({ color: 'error' })
  expect(await terminal.find({ type: 'Text', text: '⎇' })).toBeUndefined()
  const drawn = JSON.stringify(await terminal.drawn())
  expect(drawn).not.toContain('"href":"https://github.com/o/vtex-copilot-fse"')
  expect(drawn).toContain('https://github.com/o/vtex-copilot-fse/compare/main...dev')
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  const band = JSON.stringify(await desktop.drawn())
  expect(band).toContain('"alt":"pr"')
  expect(band).toContain('#ef5350')
  expect(band).not.toContain('"alt":"link"')
  await desktop.unmount()
})
