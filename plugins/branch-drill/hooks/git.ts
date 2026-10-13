// What git says about the work tree, read into plain values: the changed
// files the Me and All sections count and list as your work not committed
// yet. A copy of changes-drill's reading (a mod imports only its own files).

// One changed file: git's two-letter status, the path from the repository's
// root, and its lines added and deleted against HEAD (null for a binary file
// or one git has no count for, such as an untracked one).
export type Change = { status: string; path: string; added: number | null; deleted: number | null }

// The changed files of `git status --porcelain=v1`, a rename by its new path.
export function parseChanges(out: string): Change[] {
  return out
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.length > 3 && !line.startsWith('## '))
    .map(line => {
      const path = unquote(line.slice(3))
      return { status: line.slice(0, 2), path: path.includes(' -> ') ? (path.split(' -> ')[1] ?? path) : path, added: null, deleted: null }
    })
}

// The changes with their lines from `git diff --numstat`: `added deleted
// path` per file, `-` for a binary one.
export function withNumstat(changes: Change[], out: string): Change[] {
  const counts = numstat(out)
  return changes.map(c => {
    const n = counts.get(c.path)
    return n ? { ...c, added: n[0], deleted: n[1] } : c
  })
}

export function numstat(out: string) {
  const counts = new Map<string, [number | null, number | null]>()
  for (const line of out.split('\n')) {
    const [added, deleted, path] = line.replace(/\r$/, '').split('\t')
    if (path === undefined) continue
    counts.set(unquote(path), [added === '-' ? null : Number(added), deleted === '-' ? null : Number(deleted)])
  }
  return counts
}

// git quotes a path with unusual characters: `"a \"b\".txt"`.
function unquote(path: string) {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, '$1') : path
}

// `M`, `A`, `D`, `R`, `U` (a conflict) or `?` (untracked), from git's XY.
export function statusLetter(xy: string) {
  if (xy === '??') return '?'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'U'
  return (xy[0] !== ' ' ? xy[0] : xy[1]) ?? '?'
}

export function statusColor(xy: string) {
  const letter = statusLetter(xy)
  if (letter === '?') return 'subtle'
  if (letter === 'A') return 'success'
  if (letter === 'D' || letter === 'U') return 'error'
  if (letter === 'R') return 'suggestion'
  return 'warning'
}

// Whether the index holds a change of the file, and whether the work tree
// holds one the index does not.
export const isStaged = (xy: string) => xy[0] !== ' ' && xy[0] !== '?'
export const isUnstaged = (xy: string) => xy[1] !== ' ' && xy !== '??'

// A status in words: what its letter means, and where the change sits.
export function statusWord(xy: string) {
  const words: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'In conflict', '?': 'Untracked' }
  return words[statusLetter(xy)] ?? 'Changed'
}
export function stageWord(xy: string) {
  if (xy === '??') return 'not added to git'
  return isStaged(xy) && isUnstaged(xy) ? 'partly staged' : isStaged(xy) ? 'staged' : 'unstaged'
}

// How long ago, in the fewest characters: `now`, `4m`, `3h`, `2d`.
export function ago(ms: number) {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
