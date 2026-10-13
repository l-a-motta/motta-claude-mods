import { describe, expect, test } from 'claude-code/testing'

import { ago, barCells, branchOf, isGenerated, isSensitive, parseChanges, parseNameStatus, repoPath, statusLetter, withNumstat } from '../hooks/git.ts'
import { settingsOf, trimHunk } from '../hooks/register.tsx'
import { BUDGET, countNodes, setLevel } from '../hooks/historyView.tsx'
import { changesPane } from '../hooks/pane.tsx'

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

function repo(on: any, toasts?: string[], status = STATUS, stat = '3\t1\tmanifest.json\n') {
  on('session.cwd', () => ({ value: 'C:/code/app' }))
  on('clock.now', () => ({ value: 1_700_000_600_000 }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const stdout = e.argv.includes('rev-parse') ? 'C:/code/app\n' : e.argv.includes('status') ? status : e.argv.includes('--numstat') ? stat : e.argv.includes('-U1') ? 'diff --git a/manifest.json b/manifest.json\n@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n' : ''
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
    // A sensitive file's cards are danger (red): its row's, and the warning's.
    // The terminal draws no hover card: no hidden box, no card border.
    if (surface === 'desktop') {
      expect(drawn).toContain('{"width":0.25,"backgroundColor":"#ef8a80"}')
    } else {
      expect(drawn).not.toContain('"display":"none"')
      expect(drawn).not.toContain('"borderStyle":"round"')
    }
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

// A path longer than a hover scope may be (64 characters).
const LONG = 'plugins/a-plugin-with-a-long-name/hooks/deeply/nested/folders/for/the/file.tsx'

for (const surface of ['desktop', 'terminal'] as const) {
  const title = surface === 'desktop' ? 'hover cards say what each figure stands for, and what a press does' : 'no hover cards in the terminal: the rows, their figures and their keys stay'
  test(`${title} (${surface})`, { options: { peek: true, churn: true, churnEdits: 2 } }, async ($, on) => {
    repo(on, undefined, `## main\n M ${LONG}\n M manifest.json\n`, `3\t1\tmanifest.json\n12\t4\t${LONG}\n`)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
    await $.turn.start({ text: 'tidy the manifest', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'C:/code/app/manifest.json', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Edit', file_path: 'C:/code/app/manifest.json', old_string: 'b', new_string: 'c' } as never)
    await $.command.run({ command: 'changes-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'changes-drill', surface, component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 90 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    // The rows on every surface: the long one keeps its key, and the path
    // still presses by its key.
    expect(drawn).toContain('Turn 1 · tidy the manifest')
    expect(drawn).toContain(LONG)
    expect(await pane.find({ key: `row:${LONG}` })).toBeDefined()
    expect(await pane.find({ key: 'file:manifest.json' })).toBeDefined()
    if (surface === 'terminal') {
      // The terminal draws no hover card: none of their text, no hidden box,
      // no card border, no hover scope.
      expect(drawn).not.toContain('Refresh re-reads git status and the diff vs HEAD')
      for (const piece of ['"0 staged"', '"2 unstaged"', '"16 lines changed"', '"2 edits"']) expect(drawn).not.toContain(piece)
      expect(drawn).not.toContain('Press the path to peek')
      expect(drawn).not.toContain('"display":"none"')
      expect(drawn).not.toContain('"borderStyle":"round"')
      expect(drawn).not.toContain('"scope"')
      return
    }
    // The header and its Refresh; one card per row: the press, the path, the
    // flags, who and the figures.
    // A card's text is pieces (nested Text): check the pieces.
    expect(drawn).toContain('Refresh re-reads git status and the diff vs HEAD')
    for (const piece of ['"0 staged"', '"2 unstaged"', '"0 untracked"', '"16 lines changed"', '"2 edits"', '" this session, the last in turn 1"']) expect(drawn).toContain(piece)
    expect(drawn).toContain('Press the path to peek at the first 4 diff lines')
    // Styles: the prompt italic, + green and − red, the status word a tinted
    // chip, the path's file name bold, the `·` faint.
    expect(drawn).toContain('{"italic":true},"children":["tidy the manifest"]')
    expect(drawn).toContain('{"color":"#7fc97f"},"children":["+12"]')
    expect(drawn).toContain('{"color":"#ef8a80"},"children":["−4"]')
    expect(drawn).toContain('{"color":"#e7c06b","backgroundColor":"#e7c06b26"},"children":[" Modified "]')
    expect(drawn).toContain('{"bold":true},"children":["manifest.json"]')
    expect(drawn).toContain('{"color":"#6f6d68"},"children":[" · "]')
    // Tones: Refresh and a row with the peek on are actions (blue), the
    // header is info (faint): a bar at the card's side.
    expect(drawn).toContain('{"width":0.25,"backgroundColor":"#8db4f0"}')
    expect(drawn).toContain('{"width":0.25,"backgroundColor":"#6f6d68"}')
    // One card per row, not one per figure: a lighter tree for the desktop.
    expect((drawn.match(/Press the path to peek/g) ?? []).length).toBe(2)
    // Every hover scope is one the surface takes (64 characters at most).
    const scopes = [...drawn.matchAll(/"scope":"([^"]*)"/g)].map(m => m[1] ?? '')
    expect(scopes.length).toBeGreaterThan(0)
    for (const scope of scopes) expect(scope.length).toBeLessThanOrEqual(64)
  })
}

test('no hover cards on a phone', { options: { peek: true } }, async ($, on) => {
  repo(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'mobile', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 50 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('manifest.json')
  expect(drawn).not.toContain('Press to peek')
  expect(drawn).not.toContain('Refresh re-reads')
})

test('turns before the last two fold under one line until pressed', async ($, on) => {
  repo(on, undefined, '## dev\n M a.json\n M b.json\n M c.json\n', '1\t0\ta.json\n2\t0\tb.json\n3\t0\tc.json\n')
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  for (const [n, file] of [[1, 'a'], [2, 'b'], [3, 'c']] as const) {
    await $.turn.start({ text: `edit ${file}`, turnId: `t${n}` } as never)
    await $.tool.call({ tool: 'Edit', file_path: `C:\\code\\app\\${file}.json`, old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' } as never)
  }
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'desktop', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 80 } as never })
  let drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Turn 3 · edit c')
  expect(drawn).toContain('Turn 2 · edit b')
  expect(drawn).not.toContain('Turn 1 · edit a')
  expect(drawn).toContain('1 older turn folded · 1 file · +1 −0')
  await pane.press({ key: 'older-toggle' })
  drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Turn 1 · edit a')
  expect(drawn).toContain('1 older turn shown')
})

// --- the element budget -------------------------------------------------------

// `turns` turns of `each` files, each file edited by Claude in its turn: the
// status and numstat git gives for them.
function many(turns: number, each: number) {
  const files = Array.from({ length: turns * each }, (_, i) => `src/area${Math.floor(i / each) + 1}/file${i + 1}.ts`)
  return { files, status: `## dev\n${files.map(f => ` M ${f}`).join('\n')}\n`, stat: files.map((f, i) => `${(i % 7) + 1}\t${i % 3}\t${f}`).join('\n') + '\n' }
}

async function edited($: any, turns: number, each: number, files: string[]) {
  for (let t = 1; t <= turns; t++) {
    await $.turn.start({ text: `work on area ${t}`, turnId: `t${t}` } as never)
    for (const f of files.slice((t - 1) * each, t * each)) await $.tool.call({ tool: 'Edit', file_path: `C:/code/app/${f}`, old_string: 'a', new_string: 'b' } as never)
  }
}

const mountAt = ($: any, surface: string) => $.ui.mount({ plugin: 'changes-drill', surface, component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 90 } as never })

test('over the budget, the desktop drops the drill-down cards first and keeps the action cards', async ($, on) => {
  const m = many(2, 18)
  repo(on, undefined, m.status, m.stat)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  await edited($, 2, 18, m.files)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const desk = await (await mountAt($, 'desktop')).drawn()
  const term = await (await mountAt($, 'terminal')).drawn()
  console.log('changes-drill 2 turns x 18 files: desktop', countNodes(desk), 'terminal', countNodes(term))
  const d = JSON.stringify(desk)
  const t = JSON.stringify(term)
  expect(countNodes(desk)).toBeLessThanOrEqual(BUDGET)
  // The rows' cards (info) are gone; Refresh's (action) stays; every row is drawn.
  expect(d).not.toContain(' changed"')
  expect(d).toContain('Refresh re-reads git status and the diff vs HEAD')
  expect(d).toContain('file36.ts')
  expect(d).toContain('Turn 1 · work on area 1')
  // Level 0 draws the rows' cards.
  const all = JSON.stringify(listAt(0, 2, 18))
  setLevel(0)
  expect(all).toContain(' changed"')
  expect(all).toContain('Refresh re-reads git status and the diff vs HEAD')
  // The terminal draws none, and every row.
  expect(t).not.toContain(' changed"')
  expect(t).not.toContain('Refresh re-reads git status and the diff vs HEAD')
  expect(t).toContain('file36.ts')
})

test('far over the budget, the desktop keeps only the last turn open, then cuts the list to 30 rows', async ($, on) => {
  const m = many(4, 30)
  repo(on, undefined, m.status, m.stat)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  await edited($, 4, 30, m.files)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const desk = await (await mountAt($, 'desktop')).drawn()
  const term = await (await mountAt($, 'terminal')).drawn()
  console.log('changes-drill 4 turns x 30 files: desktop', countNodes(desk), 'terminal', countNodes(term))
  const d = JSON.stringify(desk)
  expect(countNodes(desk)).toBeLessThanOrEqual(BUDGET)
  // Level 3: the last turn open, the three before under the fold line.
  expect(d).toContain('Turn 4 · work on area 4')
  expect(d).not.toContain('Turn 3 · work on area 3')
  expect(d).toContain('3 older turns folded · 90 files')
  // The terminal keeps the last two open.
  expect(JSON.stringify(term)).toContain('Turn 3 · work on area 3')
})

test('a single turn too long for the pane is cut to 30 rows, a line saying how many more', async ($, on) => {
  const m = many(1, 120)
  repo(on, undefined, m.status, m.stat)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill' }] }))
  await edited($, 1, 120, m.files)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const desk = await (await mountAt($, 'desktop')).drawn()
  const term = await (await mountAt($, 'terminal')).drawn()
  console.log('changes-drill 1 turn x 120 files: desktop', countNodes(desk), 'terminal', countNodes(term))
  const d = JSON.stringify(desk)
  expect(countNodes(desk)).toBeLessThanOrEqual(BUDGET)
  expect(d).toContain('⋮ 90 more · the pane is too full to draw them')
  expect(JSON.stringify(term)).not.toContain('the pane is too full')
})

// The list drawn straight from its view at a level, `turns` turns of `each`
// files, plain element names standing in for a desktop's: the tree and the
// cards that open downward. It sets the module's level: set it back after.
function listAt(level: number, turns: number, each: number) {
  const m = many(turns, each)
  const list = Array.from({ length: turns }, (_, i) => ({ n: i + 1, id: `t${i + 1}`, text: `work on area ${i + 1}`, at: 1_700_000_000_000 + i + 1 }))
  const rows = m.files.map((path, i) => ({ status: ' M', path, added: (i % 7) + 1, deleted: i % 3, isCommitted: false, changedAt: 1_700_000_000_000, touch: { who: 'claude' as const, turn: Math.floor(i / each) + 1, edits: 1, at: 1_700_000_000_000 } }))
  setLevel(level)
  const floating: any[] = []
  const tree = changesPane({ Box: 'Box', Text: 'Text', Button: 'Button', Code: 'Code', isDesktop: true, surface: 'desktop', columns: 90, floating, settings: settingsOf(undefined), reading: { top: 'C:/code/app', branch: 'dev', against: 'HEAD', base: 'HEAD', rows, at: 1_700_000_600_000 }, turns: list, session: null, now: 1_700_000_600_000, selected: null, showGenerated: false, showOlder: false, peek: null, level, on: { refresh: () => undefined, select: () => undefined, toggleGenerated: () => undefined, toggleOlder: () => undefined } })
  return [tree, floating]
}

// Each level drawn straight from the list's view: what each level costs.
test('each level draws less: cards by tone, then one turn open, then 30 rows', () => {
  const counts = [0, 1, 2, 3, 4].map(level => countNodes(listAt(level, 4, 30)))
  setLevel(0)
  console.log('changes-drill levels, 4 turns x 30 files:', counts.join(' / '))
  for (let i = 1; i < counts.length; i++) expect(counts[i] ?? 0).toBeLessThanOrEqual(counts[i - 1] ?? 0)
  expect(counts[0] ?? 0).toBeGreaterThan(BUDGET)
  expect(counts[4] ?? 0).toBeLessThanOrEqual(BUDGET)
})
