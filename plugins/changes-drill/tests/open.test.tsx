import { describe, expect, test } from 'claude-code/testing'

import { branchOf, parseChanges, statusLetter, withNumstat } from '../hooks/register.tsx'

const STATUS = '## feat/ui-tweaks...origin/feat/ui-tweaks [ahead 2]\n M manifest.json\n?? notes.md\n'

describe('parseChanges and withNumstat', () => {
  test('lists each changed file, a rename by its new path, with its lines', () => {
    const changes = parseChanges('## dev\nM  a.ts\nR  old.ts -> new.ts\n?? notes.md\n')
    expect(changes.map(c => [c.status, c.path])).toEqual([['M ', 'a.ts'], ['R ', 'new.ts'], ['??', 'notes.md']])
    const counted = withNumstat(changes, '4\t2\ta.ts\n-\t-\tnew.ts\n')
    expect(counted.map(c => [c.added, c.deleted])).toEqual([[4, 2], [null, null], [null, null]])
  })

  test('names a status by one letter, and the branch from the status header', () => {
    expect(['M ', ' M', 'A ', 'D ', 'R ', 'UU', '??'].map(statusLetter)).toEqual(['M', 'M', 'A', 'D', 'R', 'U', '?'])
    expect(branchOf(STATUS)).toBe('feat/ui-tweaks')
    expect(branchOf('## No commits yet on main\n')).toBe('main')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  // The noun's own path is tested from motta-statusline, whose module calls
  // it: the host refuses a noun call from a module whose scan lists none.
  test(`/changes-drill opens the pane, each file with its lines (${surface})`, async ($, on) => {
    const opened: string[] = []
    on('session.cwd', () => ({ value: 'C:/code/app' }))
    on('process.run', ($, e) => {
      const stdout = e.argv.includes('status') ? STATUS : '3\t1\tmanifest.json\n'
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('ui.open', ($, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    expect((await $.command.run({ command: 'changes-drill', args: '' } as never)).text).toBe('Changes pane opened.')
    expect(opened).toEqual(['changes-drill'])

    const pane = await $.ui.mount({ plugin: 'changes-drill', surface, component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 80 } as never })
    expect(await pane.find({ type: 'Text', text: 'manifest.json' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '+3' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'notes.md' })).toBeDefined()
  })
}
