// The Branches pane: Me and All, moved from changes-drill's History section,
// drawn on each surface over this repository's own history (PRs #8 to #12,
// Oct 12), a commit opening its files, the hover cards, and the element
// budget the desktop needs.

import { describe, expect, test } from 'claude-code/testing'

import { crossing, layout, parseLog, subway } from '../hooks/history.ts'
import { parseChanges, withNumstat } from '../hooks/git.ts'
import { BUDGET, branchesPane, countNodes } from '../hooks/view.tsx'
import type { HistoryReading, Picks } from '../hooks/view.tsx'
import { settingsOf } from '../hooks/register.tsx'

// git log -n15 --topo-order --format=LOG_FORMAT b5c4b97
const LOG = "b5c4b97f896628a29d6271c17fd1b78fd4464429\u001f392381beabda00a8a30bdfde209f7eab54f89cf3 c7cdb12f070367a5e6919cf94a4f3b19e7528fc8\u001forigin/main, origin/HEAD, main\u001f1791857121\u001fLeonardo Antonetti da Motta\u001fMerge pull request #12 from l-a-motta/claude/statusline-bar-height\u001e\nc7cdb12f070367a5e6919cf94a4f3b19e7528fc8\u001f574bcc7f9dfda823b3bbb7ff3e18a4cce15b1b84\u001forigin/claude/statusline-bar-height, claude/statusline-bar-height\u001f1791857078\u001fLeonardo Antonetti da Motta\u001fchore(motta-statusline): 0.17.1\u001e\n574bcc7f9dfda823b3bbb7ff3e18a4cce15b1b84\u001f392381beabda00a8a30bdfde209f7eab54f89cf3\u001f\u001f1791857078\u001fLeonardo Antonetti da Motta\u001ffeat(motta-statusline): taller bars of separate squares, a little more room between lines\u001e\n392381beabda00a8a30bdfde209f7eab54f89cf3\u001fa0a183909c93bdaa8a421c5983b840a635718c30 77c7af635dc49e79913d53508fe1073f61d244e1\u001fHEAD -> claude/changes-list-hot-reload-4b3886\u001f1791856406\u001fLeonardo Antonetti da Motta\u001fMerge pull request #11 from l-a-motta/claude/mod-usage-drill-hot-reload-b58139\u001e\n77c7af635dc49e79913d53508fe1073f61d244e1\u001f0550c286bf7cab91cf1a9b9d2b060e9c3f96a63b a0a183909c93bdaa8a421c5983b840a635718c30\u001forigin/claude/mod-usage-drill-hot-reload-b58139, claude/mod-usage-drill-hot-reload-b58139\u001f1791856357\u001fLeonardo Antonetti da Motta\u001fMerge remote-tracking branch 'origin/main' into claude/mod-usage-drill-hot-reload-b58139\u001e\na0a183909c93bdaa8a421c5983b840a635718c30\u001fce548a1718a4ac29164f01f834e4c9552d1b6183 ca63f82a8ac06608d6077d060ba7577100a0bfcc\u001f\u001f1791856262\u001fLeonardo Antonetti da Motta\u001fMerge pull request #10 from l-a-motta/claude/mod-context-drill-hot-reload-4348b3\u001e\nca63f82a8ac06608d6077d060ba7577100a0bfcc\u001fd7ad09194b445b3bd963ed67a3b3b64057107740 ce548a1718a4ac29164f01f834e4c9552d1b6183\u001forigin/claude/mod-context-drill-hot-reload-4348b3, claude/mod-context-drill-hot-reload-4348b3\u001f1791856246\u001fLeonardo Antonetti da Motta\u001fMerge remote-tracking branch 'origin/main' into claude/mod-context-drill-hot-reload-4348b3\u001e\nce548a1718a4ac29164f01f834e4c9552d1b6183\u001f21f5f77509f3cddef37a401e756fd1f998e64da5 899979c528a4fad8b1c2b865bf543d876a7d3511\u001f\u001f1791855802\u001fLeonardo Antonetti da Motta\u001fMerge pull request #9 from l-a-motta/claude/hot-reload-mod-drill-b52111\u001e\n899979c528a4fad8b1c2b865bf543d876a7d3511\u001f0012661e9e30912ac76d07bfbd9a2256bcdbdecd\u001forigin/claude/hot-reload-mod-drill-b52111, claude/hot-reload-mod-drill-b52111\u001f1791855727\u001fLeonardo Antonetti da Motta\u001fchore(changes-drill): 0.2.0\u001e\n0012661e9e30912ac76d07bfbd9a2256bcdbdecd\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791855727\u001fLeonardo Antonetti da Motta\u001ffeat(changes-drill): files by turn and by who, a baseline, a budget, a guard and a commit plan\u001e\nd7ad09194b445b3bd963ed67a3b3b64057107740\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791856172\u001fLeonardo Antonetti da Motta\u001ffeat(context-drill): a fuller Context pane, every part a setting\u001e\n0550c286bf7cab91cf1a9b9d2b060e9c3f96a63b\u001ff05e43e989a46d69c13b805461601d338fb3fce1\u001f\u001f1791856321\u001fLeonardo Antonetti da Motta\u001fchore(usage-drill): 0.2.0; motta-statusline 0.17.0\u001e\nf05e43e989a46d69c13b805461601d338fb3fce1\u001f7934363eca7bf3a16894b227b791af62c71bc1bc\u001f\u001f1791856321\u001fLeonardo Antonetti da Motta\u001frefactor(motta-statusline): usage-drill toasts the limit colors\u001e\n7934363eca7bf3a16894b227b791af62c71bc1bc\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791856321\u001fLeonardo Antonetti da Motta\u001ffeat(usage-drill): a verdict per limit, details side by side, activity and spend by model\u001e\n21f5f77509f3cddef37a401e756fd1f998e64da5\u001f2c8d2e10e2484da2d40f26a5f26845dbc8bbb4db 9c08eb3a90cee3e6af0a343b6309e74e6813fe22\u001fclaude/mod-updates-installation-9a0dc0\u001f1791851907\u001fLeonardo Antonetti da Motta\u001fMerge pull request #8 from l-a-motta/claude/filetree-action-labels-48379a\u001e\n"

const MAIN_TIP = 'b5c4b97f896628a29d6271c17fd1b78fd4464429'
const HEAD = '392381beabda00a8a30bdfde209f7eab54f89cf3'
const commits = parseLog(LOG)
const short = (id: string) => id.slice(0, 7)

describe('the graph', () => {
  const g = layout(commits)

  test('main stays in lane 0 and the graph needs four lanes at most', () => {
    const lane = (id: string) => g.placed.find(p => short(p.id) === id)?.lane
    expect(['b5c4b97', '392381b', 'a0a1839', 'ce548a1', '21f5f77'].map(lane)).toEqual([0, 0, 0, 0, 0])
    expect(g.lanes).toBeLessThanOrEqual(4)
  })

  test('no two lines run down the same lane through the same row', () => {
    for (let row = 0; row < commits.length; row++) {
      const byLane = new Map<number, Set<string>>()
      for (const l of g.lines.filter(l => l.from < row && l.to > row)) byLane.set(l.via, (byLane.get(l.via) ?? new Set<string>()).add(l.parent))
      for (const parents of byLane.values()) expect(parents.size).toBe(1)
    }
  })

  test('a line crosses the boundary under a row where it runs, mid-curve where it bends', () => {
    const merge12 = g.lines.find(l => l.from === 0 && l.isMerge)
    expect(merge12).toBeDefined()
    if (!merge12) return
    expect(crossing(merge12, 0)).toBe((merge12.fromLane + merge12.toLane) / 2)
    expect(crossing(merge12, 5)).toBe(null)
  })

})

describe('the subway map', () => {
  test('five stations on main, a loop per PR never overlapping another on its level, your branch to the draft', () => {
    const map = subway(commits, MAIN_TIP, HEAD, HEAD, 4)
    expect(map).not.toBe(null)
    if (!map) return
    expect(map.stations.map(s => s.label)).toEqual(['#8', '#9', '#10', '#11', '#12'])
    expect(map.stations.find(s => s.isFork)?.label).toBe('#11')
    expect(
      map.loops
        .filter(l => !l.isYou)
        .map(l => l.key)
        .sort(),
    ).toEqual(['pr10', 'pr11', 'pr12', 'pr9'])
    for (const a of map.loops) for (const b of map.loops) if (a !== b && a.y === b.y) expect(a.x2 <= b.x1 + 4 || a.x1 >= b.x2 - 4).toBe(true)
    expect(map.draft?.files).toBe(4)
    expect(map.loops.find(l => l.key === 'pr11')?.stops.length).toBe(4)
  })
})

describe('reading git', () => {
  test('the changed files with their lines, and the depth option', () => {
    const changes = withNumstat(parseChanges('## dev\n M a.ts\n?? b.md\n'), '4\t2\ta.ts\n')
    expect(changes.map(c => [c.status, c.path, c.added])).toEqual([[' M', 'a.ts', 4], ['??', 'b.md', null]])
    expect(settingsOf({}).historyDepth).toBe(40)
    expect(settingsOf({ historyDepth: 999 }).historyDepth).toBe(200)
  })
})

const STATUS = '## claude/changes-list-hot-reload-4b3886\n M plugins/changes-drill/hooks/pane.tsx\n?? plugins/changes-drill/hooks/history.ts\n'

type Repo = { log?: string; head?: string; main?: string; status?: string; counts?: string; opened?: string[] }

function repo(on: any, calls: string[][], r: Repo = {}) {
  const log = r.log ?? LOG
  const head = r.head ?? HEAD
  const main = r.main ?? MAIN_TIP
  const at = parseLog(log)[0]?.at ?? 0
  on('session.cwd', () => ({ value: 'C:/code/app' }))
  on('clock.now', () => ({ value: at + 13 * 60_000 }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const a: string[] = e.argv
    calls.push(a)
    const has = (...w: string[]) => w.every(x => a.includes(x))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (has('--show-toplevel')) return out('C:/code/app\n')
    if (has('status')) return out(r.status ?? STATUS)
    if (has('show-ref')) return out(`${head} HEAD\n${main} refs/remotes/origin/main\n`)
    if (has('--symbolic-full-name')) return out('', 128)
    if (has('--abbrev-ref', 'origin/HEAD')) return out('origin/main\n')
    if (has('--abbrev-ref', 'HEAD')) return out('claude/changes-list-hot-reload-4b3886\n')
    if (has('--verify', 'origin/main^{commit}')) return out(`${main}\n`)
    if (has('--verify', 'HEAD')) return out(`${head}\n`)
    if (has('rev-list')) return out(r.counts ?? '0\t3\n')
    if (has('merge-base')) return out(`${head}\n`)
    if (a.includes('log') && a.some(x => x.startsWith('HEAD..'))) return out(r.log ? '' : `${LOG.split('\x1e').slice(0, 3).join('\x1e')}\x1e`)
    if (a.includes('log')) return out(log)
    if (has('diff-tree')) return out('31\t21\tplugins/motta-statusline/hooks/register.tsx\n')
    if (has('--numstat')) return out('5\t1\tplugins/changes-drill/hooks/pane.tsx\n')
    return out('')
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$: any, e: any) => {
    r.opened?.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [{ id: 'branch-drill', title: 'Branches', isShown: true, isFocused: false, isPlaced: true }] }))
}

const mount = ($: any, surface: string, columns = 60) => $.ui.mount({ plugin: 'branch-drill', surface, component: 'Pane', requestId: 'branch-drill', props: { title: 'Branches', isFocused: false, bodyColumns: columns } as never })

for (const surface of ['desktop', 'terminal'] as const) {
  test(`/branch-drill opens the pane: Me and All, ${surface === 'desktop' ? 'their cards' : 'no hover cards'}, and a commit's files (${surface})`, async ($, on) => {
    const calls: string[][] = []
    const opened: string[] = []
    repo(on, calls, { opened })
    expect((await $.command.run({ command: 'branch-drill', args: '' } as never)).text).toBe('Branches pane opened.')
    expect(opened).toEqual(['branch-drill:Branches'])
    const pane = await mount($, surface)
    const drawn = JSON.stringify(await pane.drawn())
    for (const text of ['Branches', 'your branch and your work', 'every branch']) expect(drawn).toContain(text)
    // Current stays in changes-drill.
    expect(drawn).not.toContain("what's happening now")
    // Me: you vs main, with the counts from git.
    expect(drawn).toContain('3 behind main')
    expect(drawn).toContain('0 ahead')
    expect(drawn).toContain('not on GitHub yet')
    // All: the lanes, a merge said the short way, the draft on top.
    expect(drawn).toContain('Merge PR #12 ·')
    expect(drawn).toContain('Your changes ·')
    expect(drawn).toContain('you are here')
    if (surface === 'desktop') {
      expect(drawn).toContain('statusline-bar-height')
      // Hover cards: the head's Refresh, a picker, a chip, a lane's tags, the oldest row.
      expect(drawn).toContain('Refresh re-reads the branches and commits from git')
      expect(drawn).toContain('Switches All between Lanes and Subway')
      expect(drawn).toContain("Click to see what's in it.")
      expect(drawn).toContain('You are here: HEAD, on')
      expect(drawn).toContain('The historyDepth option sets how many')
      // A commit's card: its id bold, its subject italic; Refresh's an action.
      expect(drawn).toContain(`{"bold":true},"children":["${MAIN_TIP.slice(0, 7)}"]`)
      expect(drawn).toMatch(/\{"italic":true\},"children":\["[^"]*statusline-bar-height/)
      expect(drawn).toContain('{"width":0.25,"backgroundColor":"#8db4f0"}')
    } else {
      // The merge's row, cut to the 60 columns: its card held the whole subject.
      expect(drawn).toContain('"label":"statusline-ba…"')
      // The terminal draws no hover card: none of their text, no hidden box.
      expect(drawn).not.toContain('Refresh re-reads the branches and commits from git')
      expect(drawn).not.toContain('Switches All between Lanes and Subway')
      expect(drawn).not.toContain("Click to see what's in it.")
      expect(drawn).not.toContain('You are here: HEAD, on')
      expect(drawn).not.toContain('The historyDepth option sets how many')
      expect(drawn).not.toContain('"display":"none"')
      expect(drawn).not.toContain('"borderStyle":"round"')
    }
    // Only reads: no git command that writes.
    for (const a of calls) expect(['commit', 'push', 'fetch', 'checkout', 'reset', 'add'].some(w => a.includes(w))).toBe(false)
    // Opening a commit reads its files, once.
    const before = calls.filter(a => a.includes('diff-tree')).length
    await pane.press({ key: `c:${MAIN_TIP}` })
    expect(JSON.stringify(await pane.drawn())).toContain('plugins/motta-statusline/hooks/register.tsx')
    expect(calls.filter(a => a.includes('diff-tree')).length).toBe(before + 1)
  })
}

test('the pickers switch each section: places and subway, a stop opening its files', async ($, on) => {
  const calls: string[][] = []
  repo(on, calls)
  await $.command.run({ command: 'branch-drill', args: '' } as never)
  const pane = await mount($, 'desktop')
  await pane.select({ key: 'branches-pick-me', value: 'places' })
  await pane.select({ key: 'branches-pick-all', value: 'subway' })
  let drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Files on this computer')
  expect(drawn).toContain('Your branch on GitHub')
  expect(drawn).toContain('STOPS')
  expect(drawn).toContain('you started here')
  // A place's card says what it stands for.
  expect(drawn).toContain('Working tree: the files on disk.')
  await pane.press({ key: `stop-c:${MAIN_TIP}` })
  drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('plugins/motta-statusline/hooks/register.tsx')
})

test('no hover cards on a phone', async ($, on) => {
  repo(on, [])
  await $.command.run({ command: 'branch-drill', args: '' } as never)
  const drawn = JSON.stringify(await (await mount($, 'mobile', 50)).drawn())
  expect(drawn).toContain('3 behind main')
  expect(drawn).not.toContain('Refresh re-reads')
})

// --- the element budget -------------------------------------------------------

// A main line of `n` plain commits, newest first, HEAD at its tip.
function longLog(n: number): Repo {
  const id = (i: number) => (0x1000 + i).toString(16).padStart(40, 'a')
  let out = ''
  for (let i = n; i >= 1; i--) out += `${id(i)}\x1f${i > 1 ? id(i - 1) : ''}\x1f${i === n ? 'HEAD -> main, origin/main' : ''}\x1f${1_791_850_000 + i * 60}\x1fA Person\x1ffeat: change number ${i}\x1e\n`
  return { log: out, head: id(n), main: id(n), status: '## main\n', counts: '0\t0\n' }
}

test('over the budget, the desktop drops the cards before it cuts any commit', { options: { historyDepth: 50 } }, async ($, on) => {
  repo(on, [], longLog(50))
  await $.command.run({ command: 'branch-drill', args: '' } as never)
  const desk = await (await mount($, 'desktop', 80)).drawn()
  const term = await (await mount($, 'terminal', 80)).drawn()
  const d = JSON.stringify(desk)
  const t = JSON.stringify(term)
  expect(countNodes(desk)).toBeLessThanOrEqual(BUDGET)
  // A commit's card says what its press does (action), so 50 of them keep the
  // pane over the budget at level 1: level 2 draws no card at all.
  expect(d).not.toContain('Click to see its files.')
  expect(d).not.toContain('Refresh re-reads the branches and commits from git')
  // Every row is still there; level 0 draws the commits' cards.
  expect(d).toContain('feat: change number 1"')
  expect(JSON.stringify(drawAt(0, longLog(50), { me: 'tracks', all: 'lanes' }))).toContain('Click to see its files.')
  // The terminal draws none, and every row.
  expect(t).not.toContain('Click to see its files.')
  expect(t).not.toContain('Refresh re-reads the branches and commits from git')
  expect(t).toContain('feat: change number 1"')
})

test('far over the budget, the desktop cuts the lanes to 15 commits and says how many are hidden', { options: { historyDepth: 120 } }, async ($, on) => {
  repo(on, [], longLog(120))
  await $.command.run({ command: 'branch-drill', args: '' } as never)
  const desk = await (await mount($, 'desktop', 80)).drawn()
  const term = await (await mount($, 'terminal', 80)).drawn()
  const d = JSON.stringify(desk)
  console.log('branch-drill 120 commits: desktop', countNodes(desk), 'terminal', countNodes(term))
  expect(countNodes(desk)).toBeLessThanOrEqual(BUDGET)
  expect(d).toContain('105 more commits hidden: the pane is too full to draw them')
  expect(d).not.toContain('Refresh re-reads')
  expect(d).toContain('feat: change number 120"')
  expect(d).not.toContain('feat: change number 100"')
  // The terminal draws them all, uncut, and no card.
  const t = JSON.stringify(term)
  expect(t).toContain('feat: change number 1"')
  expect(t).not.toContain('more commits hidden')
  expect(t).not.toContain('Click to see its files.')
})

// Each level drawn straight from the view, plain element names standing in
// for a surface's: what each level costs, and the Stops folded at level 4.
function drawAt(level: number, r: Repo, picks: Picks) {
  const list = parseLog(r.log ?? LOG)
  const history: HistoryReading = { commits: list, head: r.head ?? HEAD, branch: 'claude/x', base: 'origin/main', main: r.main ?? MAIN_TIP, fork: r.head ?? HEAD, ahead: 0, behind: 3, behindList: list.slice(0, 3), upstream: null, unpushed: null, at: list[0]?.at ?? 0 }
  const rows = [{ status: ' M', path: 'plugins/a.ts', added: 5, deleted: 1, isCommitted: false }]
  return branchesPane({ Box: 'Box', Text: 'Text', Button: 'Button', Svg: 'Svg', Select: 'Select', surface: 'desktop', columns: 80, history, isReading: false, rows, picks, open: new Set<string>(), files: new Map(), now: (list[0]?.at ?? 0) + 60_000, level, on: { refresh: () => undefined, pick: () => undefined, toggle: () => undefined } })
}

test('each level draws less: cards by tone, then the lanes cut, then the stops folded', () => {
  const lanes = [0, 1, 2, 3, 4].map(level => countNodes(drawAt(level, longLog(50), { me: 'tracks', all: 'lanes' })))
  console.log('branch-drill levels, 50 commits as lanes:', lanes.join(' / '))
  for (let i = 1; i < lanes.length; i++) expect(lanes[i] ?? 0).toBeLessThanOrEqual(lanes[i - 1] ?? 0)
  expect(lanes[0] ?? 0).toBeGreaterThan(BUDGET)
  expect(lanes[3] ?? 0).toBeLessThanOrEqual(BUDGET)
  const stops = [3, 4].map(level => JSON.stringify(drawAt(level, {}, { me: 'places', all: 'subway' })))
  console.log('branch-drill subway, level 3 / 4:', [3, 4].map(level => countNodes(drawAt(level, {}, { me: 'places', all: 'subway' }))).join(' / '))
  expect(stops[0]).toContain('Stop #12')
  expect(stops[1]).not.toContain('Stop #12')
  expect(stops[1]).toContain('6 stops folded: the pane is too full to list them. Pick Lanes to open a commit.')
})
