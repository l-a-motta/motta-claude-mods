import { expect, test } from 'claude-code/testing'

import { answerSession, runs } from './session.tsx'

const ROOT = 'C:/code/sample-app'
const mtimes: Record<string, number> = { '.git/HEAD': 1, '.git/index': 1, '.git/refs/heads/dev': 1 }
const count = (word: string) => runs.filter(r => r.argv.includes(word)).length
const ghCount = () => runs.filter(r => r.argv[0] === 'gh').length

const HINT = {
  plugin: 'motta-statusline',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
} as const

// The desktop app draws only the session on screen: a redraw nobody drew
// means the session is out of sight, and it runs no git or gh until it is
// drawn again, when it reads git at once.
test('runs no git or gh while nothing draws the line, and reads git when it is drawn again', async ($, on) => {
  const clock = answerSession(on, null, 'nothing', { cwd: ROOT, status: '## dev\n M a.ts\n' })
  on('fs.stat', (_$: any, e: any) => {
    const path = String(e.path).replace(/\\/g, '/')
    if (path === `${ROOT}/.git`) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    const rel = path.slice(ROOT.length + 1)
    if (path.startsWith(`${ROOT}/`) && rel in mtimes) return { value: { kind: 'file', size: 1, mtimeMs: mtimes[rel], isLink: false } }
    throw new Error(`ENOENT ${path}`)
  })
  on('tool.call', () => ({ result: {} }))
  const ui = await $.ui.mount(HINT)
  await clock.settle()
  await clock.advance(10_000)
  await ui.unmount()
  // One more tick still counts the last draw; the one after finds none.
  await clock.advance(20_000)

  const status = count('status')
  const gh = ghCount()
  mtimes['.git/index'] = 2
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' } as never)
  await clock.advance(300_000)
  expect(count('status')).toBe(status)
  expect(ghCount()).toBe(gh)

  const back = await $.ui.mount(HINT)
  await clock.settle()
  expect(count('status')).toBe(status + 1)
  await back.unmount()
})
