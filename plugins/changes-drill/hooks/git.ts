// What git says, read into plain values, and the pure judgements the pane
// draws from them: which files look sensitive or generated, how a set of
// paths splits into commits, and the bars a file's lines draw as.

// One changed file: git's two-letter status, the path from the repository's
// root, and its lines added and deleted against the baseline (null for a
// binary file or one git has no count for, such as an untracked one).
export type Change = { status: string; path: string; added: number | null; deleted: number | null }

// The branch from `git status --branch`'s `## ` line.
export function branchOf(out: string) {
  const head = out.split('\n')[0]?.startsWith('## ') ? (out.split('\n')[0] ?? '').slice(3) : ''
  const name = head.startsWith('No commits yet on ') ? head.slice('No commits yet on '.length) : head
  return (name.split('...')[0] ?? '').split(' ')[0] || 'HEAD'
}

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

// The files of `git diff --name-status`, each with its letter as a staged
// status (`M `), the new path of a rename or copy.
export function parseNameStatus(out: string): Change[] {
  return out
    .split('\n')
    .map(line => line.replace(/\r$/, '').split('\t'))
    .filter(parts => parts.length >= 2 && parts[0])
    .map(parts => ({ status: `${(parts[0] ?? '?')[0]} `, path: unquote(parts[parts.length - 1] ?? ''), added: null, deleted: null }))
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

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)

// A file that likely holds a secret: `.env` files, keys and certificates,
// credentials. Matched on the name alone; nothing is read.
export function isSensitive(path: string) {
  const name = base(path).toLowerCase()
  if (name === '.env.example' || name === '.env.sample' || name === '.env.template') return false
  return /^\.env(\..+)?$/.test(name) || /\.(pem|key|p12|pfx|keystore|jks)$/.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) || /^(credentials|secrets?)(\.[a-z]+)?$/.test(name) || name === '.npmrc' || name === '.netrc'
}

// A file a tool writes rather than a person: lockfiles, build output, minified
// or generated sources, snapshots.
export function isGenerated(path: string) {
  const name = base(path)
  return /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|Pipfile\.lock|flake\.lock)$/.test(name) || /\.(min\.(js|css)|map|snap)$/.test(name) || /(^|\/)(dist|build|out|coverage|node_modules|__generated__)\//.test(path) || /\.generated\.[a-z]+$/.test(name)
}

export function isTest(path: string) {
  return /(^|\/)(tests?|__tests__|spec)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(base(path)) || /^test_.+\.py$/.test(base(path))
}

export const isDoc = (path: string) => /\.(md|mdx|rst|txt|adoc)$/i.test(path) || /(^|\/)docs?\//.test(path)

// A source file: what a test should come with.
export const isSource = (path: string) => /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|c|cc|cpp|h)$/.test(path) && !isTest(path) && !isGenerated(path) && !path.endsWith('.d.ts')

// The unit a path belongs to: `plugins/<x>/`, `packages/<x>/` and the like by
// its name, any other folder by its top one, a root file by none.
export function scopeOf(path: string) {
  const unit = /^(plugins|packages|apps|libs|services|crates|modules)\/([^/]+)\//.exec(path)
  if (unit) return unit[2] ?? ''
  return path.includes('/') ? (path.split('/')[0] ?? '') : ''
}

export type Commit = { title: string; paths: string[] }

// The changed paths split into commits by unit: lockfiles and other generated
// files on their own, a unit of only docs or only tests by that, any other a
// feature with its docs and tests; root files by kind. Sensitive files are
// left out. `conventional` titles read `feat(scope)`, `plain` ones the
// scope's name.
export function commitPlan(paths: readonly string[], style: 'conventional' | 'plain'): Commit[] {
  const units = new Map<string, string[]>()
  const generated: string[] = []
  for (const path of paths) {
    if (isSensitive(path)) continue
    if (isGenerated(path)) {
      generated.push(path)
      continue
    }
    const scope = scopeOf(path)
    units.set(scope, [...(units.get(scope) ?? []), path])
  }
  const plan: Commit[] = []
  for (const [scope, list] of units) {
    if (!scope) {
      // Root files form no unit: docs, tests and the rest (config) apart.
      const kinds = new Map<string, string[]>()
      for (const path of list) {
        const type = isDoc(path) ? 'docs' : isTest(path) ? 'test' : 'chore'
        kinds.set(type, [...(kinds.get(type) ?? []), path])
      }
      for (const [type, paths] of kinds) plan.push({ title: style === 'conventional' || type !== 'chore' ? type : 'root files', paths })
      continue
    }
    const type = list.every(isDoc) ? 'docs' : list.every(isTest) ? 'test' : 'feat'
    plan.push({ title: style === 'conventional' ? `${type}(${scope})` : scope, paths: list })
  }
  if (generated.length) plan.push({ title: style === 'conventional' ? 'chore(deps)' : 'generated files', paths: generated })
  return plan
}

// The cells of a file's bar: `plus` green, `minus` red, the rest empty, the
// filled share scaled to the largest file shown so a big diff reads big.
export function barCells(added: number | null, deleted: number | null, max: number, cells: number) {
  const a = added ?? 0
  const d = deleted ?? 0
  const n = a + d
  if (n === 0 || max <= 0) return { plus: 0, minus: 0, empty: cells }
  const filled = Math.max(1, Math.min(cells, Math.round((n / max) * cells)))
  const plus = a === 0 ? 0 : d === 0 ? filled : Math.max(1, Math.min(filled - 1, Math.round((filled * a) / n)))
  return { plus, minus: filled - plus, empty: cells - filled }
}

// A path from Claude's tools (absolute, either slash, any case on Windows) as
// a path from the repository's root, or null outside it.
export function repoPath(top: string, file: string, isWindows: boolean) {
  const root = top.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = file.replace(/\\/g, '/')
  const same = isWindows ? path.toLowerCase().startsWith(`${root.toLowerCase()}/`) : path.startsWith(`${root}/`)
  return same ? path.slice(root.length + 1) : null
}

// How long ago, in the fewest characters: `now`, `4m`, `3h`, `2d`.
export function ago(ms: number) {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
