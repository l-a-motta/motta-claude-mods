import { describe, expect, test } from 'claude-code/testing'

import { ago, barCells, branchOf, isGenerated, isSensitive, parseChanges, parseNameStatus, repoPath, statusLetter, withNumstat } from '../hooks/git.ts'
import { settingsOf, trimHunk } from '../hooks/register.tsx'

const STATUS = '## feat/ui-tweaks...origin/feat/ui-tweaks [ahead 2]\n M manifest.json\n?? notes.md\n?? .env.local\n'

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

  test('reads name-status, a rename by its new path', () => {
    expect(parseNameStatus('M\ta.ts\nR100\told.ts\tnew.ts\n').map(c => [c.status, c.path])).toEqual([['M ', 'a.ts'], ['R ', 'new.ts']])
  })
})

describe('judgements', () => {
  test('sensitive and generated files by name', () => {
    expect(['.env', '.env.local', 'keys/server.pem', 'id_ed25519', 'credentials.json'].every(isSensitive)).toBe(true)
    expect(['.env.example', 'env.ts', 'README.md'].some(isSensitive)).toBe(false)
    expect(['package-lock.json', 'web/dist/app.js', 'a.min.js', 'tests/__snapshots__/a.snap'].every(isGenerated)).toBe(true)
    expect(isGenerated('src/build.ts')).toBe(false)
  })

  test('bars scale to the largest file and keep a cell for each side', () => {
    expect(barCells(10, 0, 10, 5)).toEqual({ plus: 5, minus: 0, empty: 0 })
    expect(barCells(1, 1, 100, 5)).toEqual({ plus: 1, minus: 0, empty: 4 })
    expect(barCells(30, 30, 60, 5)).toEqual({ plus: 3, minus: 2, empty: 0 })
    expect(barCells(0, 0, 60, 5)).toEqual({ plus: 0, minus: 0, empty: 5 })
  })

  test('a hunk cut to its first lines keeps a header that counts them', () => {
    expect(trimHunk(['diff --git a/x b/x', '@@ -10,4 +10,5 @@ fn', ' a', '-b', '+c', '+d', ' e'], 3)).toEqual(['@@ -10,2 +10,2 @@ fn', ' a', '-b', '+c'])
    expect(trimHunk(['@@ -0,0 +1 @@', '+one', '+two', '+'], 2)).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two'])
    expect(trimHunk(['no hunk'], 3)).toEqual([])
  })

  test('a tool path as a repository path, and an age', () => {
    expect(repoPath('C:/code/app', 'c:\\Code\\App\\src\\a.ts', true)).toBe('src/a.ts')
    expect(repoPath('/srv/app', '/srv/other/a.ts', false)).toBe(null)
    expect([0, 4 * 60_000, 3 * 3_600_000, 50 * 3_600_000].map(ago)).toEqual(['now', '4m', '3h', '2d'])
  })

  test('settings fall back to the defaults the manifest gives', () => {
    const s = settingsOf({ groupBy: 'nope', peekLines: 7, scope: './plugins/x' })
    expect([s.group, s.baseline, s.sort, s.bars, s.peekLines, s.scope, s.churn, s.peek, s.history]).toEqual(['turn', 'HEAD', 'recent', 'blocks', 7, 'plugins/x', false, false, true])
  })
})

function repo(on: any, toasts?: string[]) {
  on('session.cwd', () => ({ value: 'C:/code/app' }))
  on('clock.now', () => ({ value: 1_700_000_600_000 }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const stdout = e.argv.includes('rev-parse') ? 'C:/code/app\n' : e.argv.includes('status') ? STATUS : e.argv.includes('--numstat') ? '3\t1\tmanifest.json\n' : e.argv.includes('-U1') ? 'diff --git a/manifest.json b/manifest.json\n@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: 1_700_000_000_000, isLink: false } }))
  on('fs.read', () => ({ value: 'one\ntwo\n' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.toast', (_$: any, e: any) => {
    toasts?.push(typeof e === 'string' ? e : (e.text ?? JSON.stringify(e)))
    return { value: undefined }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  // The noun's own path is tested from motta-statusline, whose module calls
  // it: the host refuses a noun call from a module whose scan lists none.
  test(`/changes-drill opens the pane: files by turn, who changed them, and what to check (${surface})`, async ($, on) => {
    const opened: string[] = []
    repo(on)
    on('ui.open', (_$: any, e: any) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
    await $.turn.start({ text: 'tidy the manifest\nand more', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'C:\\code\\app\\manifest.json', old_string: 'a', new_string: 'b' } as never)
    expect((await $.command.run({ command: 'changes-drill', args: '' } as never)).text).toBe('Changes pane opened.')
    expect(opened).toEqual(['changes-drill'])

    const pane = await $.ui.mount({ plugin: 'changes-drill', surface, component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 80 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('Turn 1 · tidy the manifest')
    expect(drawn).toContain('Not changed in a turn of this session')
    expect(await pane.find({ type: 'Text', text: 'Claude' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'you' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '+3' })).toBeDefined()
    // notes.md's two lines come from the file itself, untracked.
    expect(await pane.find({ type: 'Text', text: '+2' })).toBeDefined()
    expect(drawn).toContain('looks sensitive')
    // No review budget and no commit plan any more.
    expect(drawn).not.toContain('lines to review')
    expect(drawn).not.toContain('Commit plan')
    // Read-only: no button stages, copies, opens or reverts.
    for (const key of ['stage:manifest.json', 'copy:manifest.json', 'open:manifest.json', 'revert:manifest.json', 'plan-stage:chore', 'plan-copy:chore']) expect(await pane.find({ key })).toBeUndefined()
    expect(await pane.find({ key: 'file:manifest.json' })).toBeUndefined()
  })
}

test('a turn that changed files ends with a toast naming them, read while the pane is closed', async ($, on) => {
  const toasts: string[] = []
  repo(on, toasts)
  on('ui.panes', () => ({ value: [] }))
  await $.turn.start({ text: 'edit', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'C:/code/app/manifest.json', content: 'x' } as never)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(toasts.some(t => t.includes('Turn 1 changed 1 file: manifest.json'))).toBe(true)
  expect(toasts.some(t => t.includes('.env.local looks sensitive'))).toBe(true)
})

test('options: churn, folder groups, and a press that shows the peek', { options: { churn: true, churnEdits: 2, groupBy: 'folder', peek: true, peekLines: 2 } }, async ($, on) => {
  repo(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  await $.turn.start({ text: 'edit twice', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/code/app/manifest.json', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/code/app/manifest.json', old_string: 'b', new_string: 'c' } as never)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'terminal', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 80 } as never })
  expect(await pane.find({ type: 'Text', text: '↻ ×2' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: './' })).toBeDefined()
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await pane.press({ key: 'file:manifest.json' })
  expect(await pane.find({ key: 'copy:manifest.json' })).toBeUndefined()
  const code = (await pane.find({ type: 'Code' })) as any
  expect(code?.props?.source).toBe('@@ -1,1 +1,1 @@\n-old\n+new')
})

test('after a restart, the turns and Claude\'s edits come back from the transcript', async ($, on) => {
  repo(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'set things up', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: 'C:/code/app/manifest.json' } }] },
      { role: 'user', text: '<command-name>/x</command-name>', toolUses: [] },
      { role: 'user', text: 'tidy the manifest', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u2', tool: 'Edit', input: { file_path: 'C:\\code\\app\\manifest.json' } }] },
    ],
  }))
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  await $.turn.start({ text: 'look at it', turnId: 't9' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'desktop', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 80 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Turn 2 · tidy the manifest')
  expect(await pane.find({ type: 'Text', text: 'Claude' })).toBeDefined()
})
