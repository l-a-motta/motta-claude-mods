// The History section's reading and judgements, all pure: git's log parsed
// into commits, each line of work named and colored (main, your branch, a
// PR), what a merge took in, and the changed files as a tree. Nothing here
// runs git; register.tsx does. The lanes graph and the subway map moved to
// branch-drill with Me and All.

// One commit of `git log --format=LOG_FORMAT`: its id, parents (first one
// first), the refs pointing at it, when (ms), who, and its subject.
export type Commit = { id: string; parents: string[]; refs: string[]; at: number; author: string; subject: string }

export const LOG_FORMAT = '%H%x1f%P%x1f%D%x1f%ct%x1f%an%x1f%s%x1e'

export function parseLog(out: string): Commit[] {
  return out
    .split('\x1e')
    .map(r => r.replace(/^[\r\n]+/, ''))
    .filter(r => r.includes('\x1f'))
    .map(r => {
      const [id = '', parents = '', refs = '', at = '0', author = '', ...subject] = r.split('\x1f')
      return {
        id: id.trim(),
        parents: parents.trim() ? parents.trim().split(/\s+/) : [],
        refs: refs.trim() ? refs.split(',').map(x => x.trim()).filter(Boolean) : [],
        at: Number(at) * 1000,
        author,
        subject: subject.join('\x1f').replace(/\s+$/, ''),
      }
    })
}

// `git rev-list --left-right --count A...B`: commits only in A, only in B.
export function parseCounts(out: string): [number, number] | null {
  const m = /^(\d+)\s+(\d+)/.exec(out.trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

// `git diff-tree --numstat` lines: [added, deleted, path], a binary file 0 0.
export function parseFiles(out: string): [number, number, string][] {
  return out
    .split('\n')
    .map(l => l.replace(/\r$/, '').split('\t'))
    .filter(p => p.length >= 3 && p[2])
    .map(([a, d, path]) => [a === '-' ? 0 : Number(a), d === '-' ? 0 : Number(d), path ?? ''] as [number, number, string])
}

// --- lines of work ---------------------------------------------------------

// What a commit belongs to: main, your branch, a PR (by the merge that took
// it in), another branch by name, or `other`; with a short name to show.
export type Work = { key: string; name: string; pr?: number }

const PR_MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/
const BRANCH_MERGE = /^Merge branch '([^']+)'/
export const SYNC_MERGE = /^Merge (remote-tracking )?branch '(origin\/)?(main|master)'/

// A branch's name without the `claude/` prefix and a worktree's hash suffix.
export const shortBranch = (name: string) => name.replace(/^(origin\/)?(claude\/)?/, '').replace(/-[0-9a-f]{6}$/, '')

export function prOf(subject: string) {
  const m = PR_MERGE.exec(subject)
  return m ? { pr: Number(m[1]), name: shortBranch(m[2] ?? '') } : null
}

// A merge's subject as the rows say it: `Merge PR #12 · statusline-bar-height`.
export function shortSubject(subject: string) {
  const pr = prOf(subject)
  if (pr) return { lead: `Merge PR #${pr.pr}`, rest: pr.name }
  if (SYNC_MERGE.test(subject)) return { lead: 'Sync', rest: 'main merged in' }
  const b = BRANCH_MERGE.exec(subject)
  if (b) return { lead: 'Merge', rest: shortBranch(b[1] ?? '') }
  return { lead: '', rest: subject }
}

export function workOf(commits: readonly Commit[], head: string | null, main: string | null): Map<string, Work> {
  const by = new Map(commits.map(c => [c.id, c]))
  const work = new Map<string, Work>()
  const follow = (from: string | undefined, w: Work, stop?: (id: string) => boolean) => {
    let id = from
    while (id && by.has(id) && !work.has(id) && !(stop?.(id) ?? false)) {
      work.set(id, w)
      id = by.get(id)?.parents[0]
    }
  }
  follow(main ?? undefined, { key: 'main', name: 'main' })
  if (head) follow(head, { key: 'you', name: 'your branch' })
  for (const c of commits) {
    if (c.parents.length < 2) continue
    const pr = prOf(c.subject)
    const b = BRANCH_MERGE.exec(c.subject)
    const w: Work | null = pr ? { key: `pr${pr.pr}`, name: pr.name, pr: pr.pr } : b && !SYNC_MERGE.test(c.subject) ? { key: `br:${b[1]}`, name: shortBranch(b[1] ?? '') } : null
    if (w) follow(c.parents[1], w)
  }
  for (const c of commits) {
    if (work.has(c.id)) continue
    const ref = c.refs.map(r => r.replace(/^HEAD -> /, '')).find(r => r !== 'HEAD' && !r.endsWith('/HEAD') && !r.startsWith('tag: '))
    follow(c.id, { key: `lane:${c.id}`, name: ref ? shortBranch(ref) : 'a branch' })
  }
  return work
}

const PR_COLORS = ['#f7768e', '#7dcfff', '#ff9e64', '#9ece6a', '#bb9af7', '#73daca']
const OTHER = ['#c0caf5', '#2ac3de', '#ff757f', '#41a6b5']
export const MAIN = '#7aa2f7'
export const YOU = '#e0af68'

export function colorOf(w: Work | undefined) {
  if (!w) return '#9c9a94'
  if (w.key === 'main') return MAIN
  if (w.key === 'you') return YOU
  if (w.pr !== undefined) return PR_COLORS[w.pr % PR_COLORS.length] ?? MAIN
  let h = 0
  for (const ch of w.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return OTHER[h % OTHER.length] ?? MAIN
}

// The commits of main's first-parent line, newest first, as far as the list goes.
export function mainLine(commits: readonly Commit[], main: string | null) {
  const by = new Map(commits.map(c => [c.id, c]))
  const out: Commit[] = []
  let id = main ?? undefined
  while (id && by.has(id)) {
    const c = by.get(id)
    if (!c) break
    out.push(c)
    id = c.parents[0]
  }
  return out
}

// What a merge took in: the commits on its second parent's first-parent line
// down to main's line, syncs from main counted apart.
export function takenIn(commits: readonly Commit[], merge: Commit, onMain: ReadonlySet<string>) {
  const by = new Map(commits.map(c => [c.id, c]))
  const out: Commit[] = []
  let id = merge.parents[1]
  while (id && by.has(id) && !onMain.has(id)) {
    const c = by.get(id)
    if (!c) break
    out.push(c)
    id = c.parents[0]
  }
  return { commits: out.filter(c => !(c.parents.length > 1 && SYNC_MERGE.test(c.subject))), syncs: out.filter(c => c.parents.length > 1 && SYNC_MERGE.test(c.subject)).length, all: out }
}

// --- the changed files as a tree ------------------------------------------

export type TreeNode = { key: string; label: string; depth: number; parent: string | null; path?: string }

// The changed paths as folders and files from the root, a chain of folders
// with one child each folded into one node (`plugins/changes-drill/`).
export function fileTree(paths: readonly string[]): TreeNode[] {
  type Dir = { dirs: Map<string, Dir>; files: string[] }
  const root: Dir = { dirs: new Map(), files: [] }
  for (const path of [...paths].sort()) {
    const parts = path.replace(/\/$/, '').split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      const next = dir.dirs.get(part) ?? { dirs: new Map(), files: [] }
      dir.dirs.set(part, next)
      dir = next
    }
    dir.files.push(path)
  }
  const out: TreeNode[] = [{ key: '', label: '', depth: 0, parent: null }]
  const walk = (dir: Dir, prefix: string, depth: number, parent: string) => {
    for (const [name, sub] of dir.dirs) {
      let label = `${name}/`
      let at = sub
      let path = `${prefix}${name}/`
      while (at.files.length === 0 && at.dirs.size === 1) {
        const [only, next] = [...at.dirs.entries()][0] ?? []
        if (!only || !next) break
        label += `${only}/`
        path += `${only}/`
        at = next
      }
      out.push({ key: path, label, depth, parent })
      walk(at, path, depth + 1, path)
    }
    for (const file of dir.files) out.push({ key: file, label: file.slice(file.lastIndexOf('/', file.length - 2) + 1), depth, parent, path: file })
  }
  walk(root, '', 1, '')
  return out
}

// --- times -----------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// `23:05` within the last 20 hours, `Oct 12` before.
export function clock(at: number, now: number) {
  const d = new Date(at)
  if (now - at < 20 * 3_600_000 && now >= at) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
