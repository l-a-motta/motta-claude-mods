// The History section: git log parsed, lines of work named, the files tree,
// and the section drawn in the pane on each surface, over this repository's
// own history (PRs #8 to #12, Oct 12). Me and All moved to branch-drill.

import { describe, expect, test } from "claude-code/testing"

import { fileTree, parseCounts, parseFiles, parseLog, shortSubject, workOf } from "../hooks/history.ts"

// git log -n15 --topo-order --format=LOG_FORMAT b5c4b97
export const LOG = "b5c4b97f896628a29d6271c17fd1b78fd4464429\u001f392381beabda00a8a30bdfde209f7eab54f89cf3 c7cdb12f070367a5e6919cf94a4f3b19e7528fc8\u001forigin/main, origin/HEAD, main\u001f1791857121\u001fSam Rivera\u001fMerge pull request #12 from owner/claude/statusline-bar-height\u001e\nc7cdb12f070367a5e6919cf94a4f3b19e7528fc8\u001f574bcc7f9dfda823b3bbb7ff3e18a4cce15b1b84\u001forigin/claude/statusline-bar-height, claude/statusline-bar-height\u001f1791857078\u001fSam Rivera\u001fchore(motta-statusline): 0.17.1\u001e\n574bcc7f9dfda823b3bbb7ff3e18a4cce15b1b84\u001f392381beabda00a8a30bdfde209f7eab54f89cf3\u001f\u001f1791857078\u001fSam Rivera\u001ffeat(motta-statusline): taller bars of separate squares, a little more room between lines\u001e\n392381beabda00a8a30bdfde209f7eab54f89cf3\u001fa0a183909c93bdaa8a421c5983b840a635718c30 77c7af635dc49e79913d53508fe1073f61d244e1\u001fHEAD -> claude/changes-list-hot-reload-4b3886\u001f1791856406\u001fSam Rivera\u001fMerge pull request #11 from owner/claude/mod-usage-drill-hot-reload-b58139\u001e\n77c7af635dc49e79913d53508fe1073f61d244e1\u001f0550c286bf7cab91cf1a9b9d2b060e9c3f96a63b a0a183909c93bdaa8a421c5983b840a635718c30\u001forigin/claude/mod-usage-drill-hot-reload-b58139, claude/mod-usage-drill-hot-reload-b58139\u001f1791856357\u001fSam Rivera\u001fMerge remote-tracking branch 'origin/main' into claude/mod-usage-drill-hot-reload-b58139\u001e\na0a183909c93bdaa8a421c5983b840a635718c30\u001fce548a1718a4ac29164f01f834e4c9552d1b6183 ca63f82a8ac06608d6077d060ba7577100a0bfcc\u001f\u001f1791856262\u001fSam Rivera\u001fMerge pull request #10 from owner/claude/mod-context-drill-hot-reload-4348b3\u001e\nca63f82a8ac06608d6077d060ba7577100a0bfcc\u001fd7ad09194b445b3bd963ed67a3b3b64057107740 ce548a1718a4ac29164f01f834e4c9552d1b6183\u001forigin/claude/mod-context-drill-hot-reload-4348b3, claude/mod-context-drill-hot-reload-4348b3\u001f1791856246\u001fSam Rivera\u001fMerge remote-tracking branch 'origin/main' into claude/mod-context-drill-hot-reload-4348b3\u001e\nce548a1718a4ac29164f01f834e4c9552d1b6183\u001f21f5f77509f3cddef37a401e756fd1f998e64da5 899979c528a4fad8b1c2b865bf543d876a7d3511\u001f\u001f1791855802\u001fSam Rivera\u001fMerge pull request #9 from owner/claude/hot-reload-mod-drill-b52111\u001e\n899979c528a4fad8b1c2b865bf543d876a7d3511\u001f0012661e9e30912ac76d07bfbd9a2256bcdbdecd\u001forigin/claude/hot-reload-mod-drill-b52111, claude/hot-reload-mod-drill-b52111\u001f1791855727\u001fSam Rivera\u001fchore(changes-drill): 0.2.0\u001e\n0012661e9e30912ac76d07bfbd9a2256bcdbdecd\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791855727\u001fSam Rivera\u001ffeat(changes-drill): files by turn and by who, a baseline, a budget, a guard and a commit plan\u001e\nd7ad09194b445b3bd963ed67a3b3b64057107740\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791856172\u001fSam Rivera\u001ffeat(context-drill): a fuller Context pane, every part a setting\u001e\n0550c286bf7cab91cf1a9b9d2b060e9c3f96a63b\u001ff05e43e989a46d69c13b805461601d338fb3fce1\u001f\u001f1791856321\u001fSam Rivera\u001fchore(usage-drill): 0.2.0; motta-statusline 0.17.0\u001e\nf05e43e989a46d69c13b805461601d338fb3fce1\u001f7934363eca7bf3a16894b227b791af62c71bc1bc\u001f\u001f1791856321\u001fSam Rivera\u001frefactor(motta-statusline): usage-drill toasts the limit colors\u001e\n7934363eca7bf3a16894b227b791af62c71bc1bc\u001f21f5f77509f3cddef37a401e756fd1f998e64da5\u001f\u001f1791856321\u001fSam Rivera\u001ffeat(usage-drill): a verdict per limit, details side by side, activity and spend by model\u001e\n21f5f77509f3cddef37a401e756fd1f998e64da5\u001f2c8d2e10e2484da2d40f26a5f26845dbc8bbb4db 9c08eb3a90cee3e6af0a343b6309e74e6813fe22\u001fclaude/mod-updates-installation-9a0dc0\u001f1791851907\u001fSam Rivera\u001fMerge pull request #8 from owner/claude/filetree-action-labels-48379a\u001e\n"

const MAIN_TIP = 'b5c4b97f896628a29d6271c17fd1b78fd4464429'
const HEAD = '392381beabda00a8a30bdfde209f7eab54f89cf3'
const commits = parseLog(LOG)
const short = (id: string) => id.slice(0, 7)

describe('reading git', () => {
  test('parses the log: ids, parents, refs, times and subjects', () => {
    expect(commits.length).toBe(15)
    expect(short(commits[0]?.id ?? '')).toBe('b5c4b97')
    expect(commits[0]?.parents.map(short)).toEqual(['392381b', 'c7cdb12'])
    expect(commits[0]?.subject).toBe('Merge pull request #12 from owner/claude/statusline-bar-height')
    expect(commits.every(c => c.at > 1_700_000_000_000)).toBe(true)
  })

  test('parses counts and files', () => {
    expect(parseCounts('0\t3\n')).toEqual([0, 3])
    expect(parseCounts('')).toBe(null)
    expect(parseFiles('31\t21\tplugins/a.ts\n-\t-\timg.png\n')).toEqual([
      [31, 21, 'plugins/a.ts'],
      [0, 0, 'img.png'],
    ])
  })

  test('says a merge the short way', () => {
    expect(shortSubject(commits[0]?.subject ?? '')).toEqual({ lead: 'Merge PR #12', rest: 'statusline-bar-height' })
    expect(shortSubject("Merge remote-tracking branch 'origin/main' into claude/x")).toEqual({ lead: 'Sync', rest: 'main merged in' })
    expect(shortSubject('feat: a thing')).toEqual({ lead: '', rest: 'feat: a thing' })
  })
})

describe('lines of work', () => {
  test('names each line of work: main, PRs by their merge, syncs inside their PR', () => {
    const work = workOf(commits, HEAD, MAIN_TIP)
    const key = (id: string) => work.get(commits.find(c => short(c.id) === id)?.id ?? '')?.key
    expect(['b5c4b97', '392381b', '21f5f77'].map(key)).toEqual(['main', 'main', 'main'])
    expect(['c7cdb12', '574bcc7'].map(key)).toEqual(['pr12', 'pr12'])
    expect(['77c7af6', '0550c28', '7934363'].map(key)).toEqual(['pr11', 'pr11', 'pr11'])
    expect(['ca63f82', 'd7ad091'].map(key)).toEqual(['pr10', 'pr10'])
    expect(['899979c', '0012661'].map(key)).toEqual(['pr9', 'pr9'])
  })
})


describe('the files tree', () => {
  test('folds a chain of single folders, files under their folder', () => {
    const nodes = fileTree(['plugins/changes-drill/hooks/pane.tsx', 'plugins/changes-drill/hooks/git.ts', 'plugins/changes-drill/tests/history.test.ts'])
    expect(nodes.map(n => [n.label, n.depth])).toEqual([
      ['', 0],
      ['plugins/changes-drill/', 1],
      ['hooks/', 2],
      ['git.ts', 3],
      ['pane.tsx', 3],
      ['tests/', 2],
      ['history.test.ts', 3],
    ])
  })
})

// --- the section in the pane ------------------------------------------------

const STATUS = '## claude/changes-list-hot-reload-4b3886\n M plugins/changes-drill/hooks/pane.tsx\n?? plugins/changes-drill/hooks/history.ts\n'

function repo(on: any, calls: string[][], toasts: string[] = []) {
  on('session.cwd', () => ({ value: 'C:/code/app' }))
  on('clock.now', () => ({ value: (commits[0]?.at ?? 0) + 13 * 60_000 }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: commits[0]?.at ?? 0, isLink: false } }))
  on('fs.read', () => ({ value: 'one\ntwo\n' }))
  on('process.run', (_$: any, e: any) => {
    const a: string[] = e.argv
    calls.push(a)
    const has = (...w: string[]) => w.every(x => a.includes(x))
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (has('--show-toplevel')) return out('C:/code/app\n')
    if (has('status')) return out(STATUS)
    if (has('show-ref')) return out(`${HEAD} HEAD\n${MAIN_TIP} refs/remotes/origin/main\n`)
    if (has('--symbolic-full-name')) return out('', 128)
    if (has('--abbrev-ref', 'origin/HEAD')) return out('origin/main\n')
    if (has('--abbrev-ref', 'HEAD')) return out('claude/changes-list-hot-reload-4b3886\n')
    if (has('--verify', 'origin/main^{commit}')) return out(`${MAIN_TIP}\n`)
    if (has('--verify', 'HEAD')) return out(`${HEAD}\n`)
    if (has('rev-list')) return out('0\t3\n')
    if (has('merge-base')) return out(`${HEAD}\n`)
    if (a.includes('log') && a.some(x => x.startsWith('HEAD..'))) return out(`${LOG.split('\x1e').slice(0, 3).join('\x1e')}\x1e`)
    if (a.includes('log')) return out(LOG)
    if (has('diff-tree')) return out('31\t21\tplugins/motta-statusline/hooks/register.tsx\n')
    if (has('--numstat')) return out('5\t1\tplugins/changes-drill/hooks/pane.tsx\n')
    return out('')
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(typeof e === 'string' ? e : (e.text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'changes-drill', title: 'Changes', isShown: true, isFocused: false, isPlaced: true }] }))
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the History section draws Current and the Branches button under the list (${surface})`, async ($, on) => {
    const calls: string[][] = []
    repo(on, calls)
    await $.command.run({ command: 'changes-drill', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'changes-drill', surface, component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 60 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    for (const text of ['History', "what's happening now", 'Me and All', 'Branches ▸']) expect(drawn).toContain(text)
    // Me and All moved to branch-drill's pane.
    expect(drawn).not.toContain('your branch and your work')
    expect(drawn).not.toContain('3 behind main')
    expect(drawn).not.toContain('Merge PR #12 ·')
    expect(drawn).not.toContain('you are here')
    // Current: the story.
    expect(drawn).toContain('You started this branch')
    expect(drawn).toContain('was merged into main')
    if (surface === 'desktop') {
      // Hover cards: the head's Refresh, the picker, a story item's ▸, the Branches button.
      expect(drawn).toContain('Refresh re-reads the branches and commits from git')
      expect(drawn).toContain('Switches Current between Story and Files tree')
      expect(drawn).toContain('▸ lists the 2 changed files')
      expect(drawn).toContain("Opens the Branches pane, branch-drill's")
      expect(drawn).toContain(': every branch as lanes or a subway map')
      // A commit's card: its id bold, its subject italic; the head's Refresh an action.
      expect(drawn).toContain(`{"bold":true},"children":["${MAIN_TIP.slice(0, 7)}"]`)
      expect(drawn).toMatch(/\{"italic":true\},"children":\["[^"]*statusline-bar-height/)
      expect(drawn).toContain('{"width":0.25,"backgroundColor":"#8db4f0"}')
    } else {
      // The terminal draws no hover card: none of their text, no hidden box.
      expect(drawn).not.toContain('Refresh re-reads the branches and commits from git')
      expect(drawn).not.toContain('Switches Current between Story and Files tree')
      expect(drawn).not.toContain('▸ lists the 2 changed files')
      expect(drawn).not.toContain("Opens the Branches pane, branch-drill's")
      expect(drawn).not.toContain('"display":"none"')
      expect(drawn).not.toContain('"borderStyle":"round"')
    }
    // Only reads: no git command that writes.
    for (const a of calls) expect(['commit', 'push', 'fetch', 'checkout', 'reset', 'add'].some(w => a.includes(w))).toBe(false)
    // Opening a story item reads its commit's files once, and lists what the merge took in.
    const before = calls.filter(a => a.includes('diff-tree')).length
    await pane.press({ key: `st:${MAIN_TIP}` })
    expect(JSON.stringify(await pane.drawn())).toContain('chore(motta-statusline): 0.17.1')
    expect(calls.filter(a => a.includes('diff-tree')).length).toBe(before + 1)
  })
}

test('the Branches button asks branch-drill for its pane, and says to install it when it is missing', async ($, on) => {
  const toasts: string[] = []
  repo(on, [], toasts)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'desktop', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 60 } as never })
  await pane.press({ key: 'history-branches' })
  // `claude plugin test` loads changes-drill alone: no branch-drill, so the fallback.
  expect(toasts.some(t => t.includes('install branch-drill from the motta-claude-mods marketplace'))).toBe(true)
})

test('the picker switches Current to the files tree', async ($, on) => {
  const calls: string[][] = []
  repo(on, calls)
  await $.command.run({ command: 'changes-drill', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'changes-drill', surface: 'desktop', component: 'Pane', requestId: 'changes-drill', props: { title: 'Changes', isFocused: false, bodyColumns: 60 } as never })
  await pane.select({ key: 'history-pick-cur', value: 'files' })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('plugins/changes-drill/')
  expect(drawn).toContain('pane.tsx')
  // A tree file's card: its status word as a chip in the letter's hue.
  expect(drawn).toContain('{"color":"#e7c06b","backgroundColor":"#e7c06b26"},"children":[" Changed "]')
})
