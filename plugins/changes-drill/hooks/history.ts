// The History section's reading and judgements, all pure: git's log parsed
// into commits, each commit given a lane and its lines routed (the graph),
// each line of work named and colored (main, your branch, a PR), the story
// of what happened in sentences, the subway map's stops and loops, and the
// changed files as a tree. Nothing here runs git; register.tsx does.

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

// --- the graph -------------------------------------------------------------

// A commit's place: its row and lane. A line from a commit to one of its
// parents: from its row and lane, down lane `via`, into the parent's row and
// lane (`to` is the row count when the parent lies past the last row).
export type Placed = { id: string; row: number; lane: number }
export type Line = { from: number; to: number; fromLane: number; via: number; toLane: number; parent: string; isMerge: boolean }
export type Graph = { placed: Placed[]; lines: Line[]; lanes: number }

// Lanes in the way GitKraken and `git log --graph` share: newest first, a
// commit takes the lane that waits for it (else the first free one), its first
// parent then waits in its lane, and each further parent in a lane already
// waiting for it or a free one. Lanes other than its own that waited for the
// same commit end there, curving into it.
export function layout(commits: readonly { id: string; parents: readonly string[] }[]): Graph {
  const active: (string | null)[] = []
  const placed: Placed[] = []
  const pending: { from: number; fromLane: number; via: number; parent: string; isMerge: boolean }[] = []
  const free = (not: number) => {
    for (let l = 0; l < active.length; l++) if (active[l] === null && l !== not) return l
    active.push(null)
    return active.length - 1
  }
  let lanes = 0
  commits.forEach((c, row) => {
    let lane = active.indexOf(c.id)
    if (lane < 0) lane = free(-1)
    for (let l = 0; l < active.length; l++) if (active[l] === c.id) active[l] = null
    placed.push({ id: c.id, row, lane })
    c.parents.forEach((p, k) => {
      if (k === 0) {
        active[lane] = p
        pending.push({ from: row, fromLane: lane, via: lane, parent: p, isMerge: false })
        return
      }
      let slot = active.indexOf(p)
      if (slot < 0) {
        slot = free(lane)
        active[slot] = p
      }
      pending.push({ from: row, fromLane: lane, via: slot, parent: p, isMerge: true })
    })
    lanes = Math.max(lanes, active.length, lane + 1)
    while (active.length && active[active.length - 1] === null) active.pop()
  })
  const at = new Map(placed.map(p => [p.id, p]))
  const lines = pending.map(l => {
    const p = at.get(l.parent)
    return { ...l, to: p ? p.row : commits.length, toLane: p ? p.lane : l.via }
  })
  return { placed, lines, lanes: Math.max(1, lanes) }
}

// Where a line crosses the boundary under row `b` (between b and b+1), in lane
// units, or null when it does not: mid-curve where it bends there.
export function crossing(line: Line, b: number): number | null {
  if (line.from > b || line.to <= b) return null
  const bendsOut = line.fromLane !== line.via
  const bendsIn = line.via !== line.toLane
  if (line.to === line.from + 1 && (bendsOut || bendsIn)) return (line.fromLane + line.toLane) / 2
  if (bendsOut && b === line.from) return (line.fromLane + line.via) / 2
  if (bendsIn && b === line.to - 1) return (line.via + line.toLane) / 2
  return line.via
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

// --- the subway map --------------------------------------------------------

// Stations on main (its last merges, oldest left), loops for the lines of
// work that left main and came back (above or below, stacked so none overlap)
// with a stop per commit, dotted ties where a branch took main in, and your
// branch leaving its fork point toward the draft.
export type Station = { id: string; x: number; label: string; at: number; isFork: boolean }
export type Loop = { key: string; color: string; name: string; x1: number; x2: number; y: number; stops: { id: string; x: number }[]; isYou: boolean }
export type Tie = { x1: number; x2: number; y: number; color: string }
export type Subway = { width: number; height: number; mainY: number; stations: Station[]; loops: Loop[]; ties: Tie[]; draft: { x: number; y: number; files: number } | null }

export function subway(commits: readonly Commit[], main: string | null, head: string | null, fork: string | null, draftFiles: number, width = 390): Subway | null {
  const line = mainLine(commits, main)
  if (!line.length) return null
  const shown = line.slice(0, 5).reverse()
  const left = 30
  const right = width - (draftFiles > 0 || (head && head !== main) ? 70 : 50)
  const step = shown.length > 1 ? (right - left) / (shown.length - 1) : 0
  const stations: Station[] = shown.map((c, i) => {
    const pr = prOf(c.subject)
    return { id: c.id, x: Math.round(left + i * step), label: pr ? `#${pr.pr}` : c.id.slice(0, 7), at: c.at, isFork: c.id === fork }
  })
  const xOf = new Map(stations.map(s => [s.id, s.x]))
  const onMain = new Set(line.map(c => c.id))
  const by = new Map(commits.map(c => [c.id, c]))
  const work = workOf(commits, head, main)
  const above: [number, number][][] = []
  const below: [number, number][][] = []
  const place = (side: [number, number][][], x1: number, x2: number) => {
    let level = side.findIndex(spans => spans.every(([a, b]) => x2 <= a + 4 || x1 >= b - 4))
    if (level < 0) {
      level = side.length
      side.push([])
    }
    side[level]?.push([x1, x2])
    return level
  }
  type Raw = { key: string; color: string; name: string; x1: number; x2: number; ids: string[]; isYou: boolean; side: 'up' | 'down' }
  const raws: Raw[] = []
  let flip = 0
  for (const s of stations) {
    const m = by.get(s.id)
    if (!m || m.parents.length < 2) continue
    const taken = takenIn(commits, m, onMain)
    if (!taken.all.length) continue
    const base = by.get(taken.all[taken.all.length - 1]?.parents[0] ?? '')
    const x1 = base && xOf.has(base.id) ? (xOf.get(base.id) ?? left) : Math.max(8, (stations[0]?.x ?? left) - 22)
    const w = work.get(taken.all[0]?.id ?? '')
    if (s.x - Math.min(x1, s.x) < 50) continue
    raws.push({ key: w?.key ?? s.id, color: colorOf(w), name: w?.name ?? 'branch', x1: Math.min(x1, s.x), x2: s.x, ids: taken.all.map(c => c.id).reverse(), isYou: false, side: flip++ % 2 === 0 ? 'up' : 'down' })
  }
  // Your branch: from the fork point toward the right edge.
  let youIds: string[] = []
  if (head && !onMain.has(head)) {
    let id: string | undefined = head
    while (id && by.has(id) && !onMain.has(id)) {
      youIds.push(id)
      id = by.get(id)?.parents[0]
    }
    youIds = youIds.reverse()
  }
  const forkX = fork && xOf.has(fork) ? (xOf.get(fork) ?? right) : head && onMain.has(head) && xOf.has(head) ? (xOf.get(head) ?? right) : null
  const hasYou = forkX !== null && (youIds.length > 0 || draftFiles > 0)
  // Wider spans first, so short loops nest inside.
  raws.sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1))
  const levelOf = new Map<Raw, number>()
  for (const r of raws) levelOf.set(r, place(r.side === 'up' ? above : below, r.x1, r.x2))
  let youLevel = 0
  // Your branch below every other loop, as its own line.
  if (hasYou && forkX !== null) {
    youLevel = below.length
    below.push([[forkX, width - 20]])
  }
  const gap = 30
  const mainY = 34 + Math.max(1, above.length) * gap
  const loops: Loop[] = raws.map(r => {
    const level = levelOf.get(r) ?? 0
    const y = r.side === 'up' ? mainY - (level + 1) * gap : mainY + (level + 1) * gap
    const inner = Math.max(1, r.x2 - r.x1 - 40)
    const stops = r.ids.map((id, i) => ({ id, x: Math.round(r.x1 + 20 + ((i + 1) * inner) / (r.ids.length + 1)) }))
    return { key: r.key, color: r.color, name: r.name, x1: r.x1, x2: r.x2, y, stops, isYou: false }
  })
  let draft: Subway['draft'] = null
  if (hasYou && forkX !== null) {
    const y = mainY + (youLevel + 1) * gap
    const x2 = width - 34
    const inner = Math.max(1, x2 - forkX - 30)
    loops.push({ key: 'you', color: YOU, name: 'your branch', x1: forkX, x2, y, isYou: true, stops: youIds.map((id, i) => ({ id, x: Math.round(forkX + 22 + ((i + 1) * inner) / (youIds.length + 1)) })) })
    draft = { x: x2 + 6, y, files: draftFiles }
  }
  // Ties: a branch that merged main in, from the station it took to its stop.
  const ties: Tie[] = []
  for (const loop of loops)
    for (const stop of loop.stops) {
      const c = by.get(stop.id)
      const from = c && c.parents.length > 1 && SYNC_MERGE.test(c.subject) ? xOf.get(c.parents[1] ?? '') : undefined
      if (from !== undefined) ties.push({ x1: from, x2: stop.x, y: loop.y, color: loop.color })
    }
  const height = mainY + Math.max(1, below.length) * gap + 34
  return { width, height, mainY, stations, loops, ties, draft }
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
