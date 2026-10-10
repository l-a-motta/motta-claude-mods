// The engine beneath the mod, shared by the test files: it records what the
// mod registers, opens, submits and appends, and answers the rest plainly.

import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

export const ENGINE_SECTION = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }

// A prompt typed at the composer, and a slash command run from it.
export const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
export const command = (args: string) => ({
  command: 'assumption-check',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

export const SUMMARY = { role: 'user', text: 'Summary of the conversation so far.', toolUses: [] } as never

export const PANE_PROPS = {
  title: 'Assumptions',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const LOGGED = {
  assumptions: [
    {
      statement: 'Retries apply to GET requests only',
      why: 'POST is not idempotent',
      confidence: 'low',
      category: 'scope',
      source: 'api/client.ts:42',
      impact: 'Failed POSTs are not retried',
    },
    { statement: 'Use axios', why: 'It is in package.json', confidence: 'high', category: 'tech', impact: 'Adds a dependency' },
  ],
}

export function world(on: Parameters<TestBody>[1]) {
  const seen = { tools: [] as string[], opened: [] as string[], submitted: [] as string[], written: [] as string[] }
  mock.clock(on)
  const session = mock.session(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => {
    seen.tools.push(e.name)
    return { value: { tool: `mcp__assumption-check__${e.name}` } }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.describe', ($, e) => ({ description: e.description }))
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [ENGINE_SECTION] }))
  on('session.compact', () => ({ messages: [SUMMARY] }))
  on('session.id', () => ({ value: '0123456789abcdef' }))
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : undefined }))
  on('fs.write', ($, e) => {
    seen.written.push(e.path)
    return { value: undefined }
  })
  const rows = (type: 'user' | 'system') =>
    session
      .appended()
      .filter(row => row.message.type === type)
      .map(row => row.message.content)
      .flatMap(content => (Array.isArray(content) ? content : []))
      .map(block => ('text' in block ? String(block.text) : ''))
  return { seen, notes: () => rows('user'), notices: () => rows('system') }
}
