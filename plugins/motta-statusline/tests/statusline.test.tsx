import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { httpsUrl, modelLabel, parseStatus } from '../hooks/register.tsx'

describe('parseStatus', () => {
  test('reads the branch and counts staged and modified files', () => {
    const out = '## dev...origin/dev [ahead 1]\nM  a.ts\n M b.ts\nMM c.ts\n?? new.ts\n'
    expect(parseStatus(out)).toEqual({ branch: 'dev', staged: 2, modified: 2 })
  })

  test('reads a clean branch with no upstream', () => {
    expect(parseStatus('## feat/x\n')).toEqual({ branch: 'feat/x', staged: 0, modified: 0 })
  })

  test('reads a repository with no commits yet', () => {
    expect(parseStatus('## No commits yet on main\n')).toEqual({ branch: 'main', staged: 0, modified: 0 })
  })
})

describe('modelLabel', () => {
  test('names Claude model ids the way /model does', () => {
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M context)')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  test('leaves anything else as given', () => {
    expect(modelLabel('opus[1m]')).toBe('opus[1m]')
  })
})

describe('httpsUrl', () => {
  test('turns ssh remotes into browsable urls', () => {
    expect(httpsUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r')
    expect(httpsUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r')
  })
})

// Answers each call on $ the mod makes with one fixed session; hooks on a
// call answer `{ value }`. The ui.render stand-ins are the engine beneath the
// plugin: its hint line, and the opaque reference it hands back for an empty band.
function answerSession(on: Parameters<TestBody>[1]) {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'C:/code/vtex-copilot-fse' }))
  on('session.repo', () => ({
    value: { root: 'C:/code/vtex-copilot-fse', remote: 'git@github.com:o/vtex-copilot-fse.git', internal: false, name: null },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 360_000, window: 1_000_000, percent: 36 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 5 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## dev\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-hint">esc to interrupt</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
}

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('draws both lines above the engine hint in the terminal hint line', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'motta-statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' },
  })
  expect(await ui.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5 \(1M context\) \| high/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'esc to interrupt' })).toBeDefined()
  await ui.unmount()
})

test('draws in the band on the desktop, which has no hint line, and leaves the terminal band free', async ($, on) => {
  answerSession(on)
  const desktop = await $.ui.mount({ plugin: 'motta-statusline', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await desktop.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /36%/ })).toBeDefined()
  // The app's model picker already shows the model and effort.
  expect(await desktop.find({ type: 'Text', text: /Opus 5\.5/ })).toBeUndefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'motta-statusline', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await terminal.find({ type: 'Text', text: /vtex-copilot-fse/ })).toBeUndefined()
  await terminal.unmount()
})
