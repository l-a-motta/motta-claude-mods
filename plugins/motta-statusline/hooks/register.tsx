// motta-statusline: a two-line status line.
//
//   📁 folder  🔗 repo  🌿 branch  +staged ~modified | clean
//   [model | effort] · CTX n% used/window · 5h n% ~reset · 7d n% ~reset · In n Out n
//
// `placement` picks where it draws:
// - below (default): drawn in the hint line under the prompt (PromptHint),
//   above the engine's own hint, and it stays while a turn runs. The desktop
//   app never raises that line, so there it draws as the band instead.
//   $.ui.status is not used, since it draws as a warning notice.
// - above: a colored band above the prompt. The engine gives that space to
//   the spinner during a turn. The band is shared: this hook asks the plugins
//   beneath it first and draws only when none of them drew, so a mod such as
//   replay-theater takes the band while it has something to show.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import type { EngineInterface, Register } from 'claude-code'

const GIT_REFRESH_MS = 10_000

type Git = { branch: string; staged: number; modified: number }

type Data = {
  dir: string
  repoName: string | null
  repoUrl: string | null
  git: Git | null
  model: string
  effort: string | null
  ctxPercent: number
  ctxTokens: number
  ctxWindow: number
  limits: { label: string; percent: number; resetsAt: number | null }[]
  outTokens: number
}

let data: Data | null = null
let gitRoot: string | null = null
let outTokens = 0
let liveEffort: string | null = null
let isTicking = false
let placement: 'above' | 'below' = 'below'

export const register: Register = (on, options) => {
  placement = options.placement === 'above' ? 'above' : 'below'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    outTokens = 0
    liveEffort = null
    await refreshAll($)
    return started
  })

  // The main loop's requests carry the effort actually sent, after any
  // downgrade for the model; subagents' requests are left out. Refreshing
  // after each one keeps the figures moving while a turn runs.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) {
      if (e.effort !== undefined) liveEffort = String(e.effort)
      outTokens += result?.usage?.output_tokens ?? 0
      await refreshAll($, false)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refreshAll($)
    return result
  })

  // Also the first-load trigger in both placements: a plugin reload does not
  // fire session.start, but the band is drawn as soon as the plugin loads.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (data === null) await refreshAll($, true)
    // The desktop app never raises PromptHint, so `below` draws in the band there.
    const isBand = placement === 'above' || e.surface === 'desktop'
    if (!isBand || e.props.hasSurvey) return next(e)
    const below = await next(e)
    if (!isFree(below) || data === null) return below
    const { Box, Text, Link } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" paddingX={1}>
        {lines(Box, Text, Link, data, await $.clock.now())}
      </Box>
    )
  })

  // The hint line under the prompt stays up while a turn runs. The engine's own
  // line (mode pills, `esc to interrupt`) is kept under ours.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (data === null) await refreshAll($, true)
    const hint = await next(e)
    if (placement !== 'below' || data === null) return hint
    const { Box, Text, Link } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines(Box, Text, Link, data, await $.clock.now())}
        {hint}
      </Box>
    )
  })
}

// What `next(e)` hands back when no plugin beneath drew: the engine's own band
// as an opaque `{ type: 'engine' }` reference, or nothing. Surveys, the one
// engine content of the band, are yielded to before this runs.
function isFree(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === '') return true
  return typeof node === 'object' && (node as { type?: unknown }).type === 'engine'
}

async function refreshAll($: EngineInterface, withGit = true) {
  if (!isTicking) {
    isTicking = true
    $.clock.every(GIT_REFRESH_MS, () => void refreshGit($))
    // Drops the pinned notice an earlier version of this mod left behind.
    $.ui.status(undefined)
  }
  try {
    const cwd = await $.session.cwd()
    const repo = await $.session.repo().catch(() => null)
    gitRoot = repo?.root ?? null
    const repoUrl = repo?.remote ? httpsUrl(repo.remote) : null
    const usage = await $.session.usage()
    const ctx = usage.context
    data = {
      dir: basename(cwd),
      repoName: repoUrl ? basename(repoUrl) : null,
      repoUrl,
      git: data?.git ?? null,
      model: modelLabel(await $.session.model()),
      effort: liveEffort ?? (await settingsEffort($)),
      ctxPercent: Math.round(ctx.percent ?? (ctx.window ? ((ctx.tokens ?? 0) / ctx.window) * 100 : 0)),
      ctxTokens: ctx.tokens ?? 0,
      ctxWindow: ctx.window ?? 0,
      limits: usage.rateLimits.map(l => ({
        label: LIMIT_LABELS[l.kind] ?? l.kind,
        percent: Math.round(l.percentUsed),
        resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
      })),
      outTokens,
    }
    if (withGit) await refreshGit($)
    else await paint($)
  } catch {
    // Keep the last reading; the next step, turn or timer tries again.
  }
}

async function paint($: EngineInterface) {
  $.ui.invalidate('ui.render')
}

async function refreshGit($: EngineInterface) {
  if (data === null) return
  if (gitRoot === null) {
    data = { ...data, git: null }
    await paint($)
    return
  }
  try {
    const run = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], {
      cwd: gitRoot,
      timeoutMs: 5_000,
    })
    if (run.exitCode === 0) data = { ...data, git: parseStatus(run.stdout) }
  } catch {
    // git missing or slow: keep the last reading.
  }
  await paint($)
}

async function settingsEffort($: EngineInterface): Promise<string | null> {
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    return typeof settings.effortLevel === 'string' ? settings.effortLevel : null
  } catch {
    return null
  }
}

// `## dev...origin/dev [ahead 1]` then one `XY path` line per change. Like the
// shell status line, untracked files count as neither staged nor modified.
export function parseStatus(out: string): Git {
  const lines = out.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines[0].slice(3) : ''
  const branch = head.startsWith('No commits yet on ')
    ? head.slice('No commits yet on '.length)
    : (head.split('...')[0] ?? '').split(' ')[0] || 'HEAD'
  let staged = 0
  let modified = 0
  for (const line of lines.slice(1)) {
    if (line.startsWith('??')) continue
    if (line[0] !== ' ') staged++
    if (line[1] !== ' ') modified++
  }
  return { branch, staged, modified }
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

function lines(Box: any, Text: any, Link: any, d: Data, now: number) {
  const sep = <Text color="subtle">  ·  </Text>

  const line1 = [<Text color="suggestion">📁 {d.dir}</Text>]
  if (d.repoUrl && d.repoName) {
    const href = d.git ? `${d.repoUrl}/tree/${d.git.branch}` : d.repoUrl
    line1.push(<Text>  </Text>, <Link href={href} label={`🔗 ${d.repoName}`} />)
  }
  if (d.git) {
    line1.push(<Text color="success">  🌿 {d.git.branch}</Text>)
    if (d.git.staged > 0) line1.push(<Text color="success">  +{d.git.staged}</Text>)
    if (d.git.modified > 0) line1.push(<Text color="warning">  ~{d.git.modified}</Text>)
    if (d.git.staged === 0 && d.git.modified === 0) line1.push(<Text color="subtle">  clean</Text>)
  }

  const model = d.effort ? `[${d.model} | ${d.effort}]` : `[${d.model}]`
  const line2 = [
    <Text color="subtle">{model}</Text>,
    sep,
    <Text>CTX </Text>,
    <Text color={level(d.ctxPercent, 70, 90)}>{d.ctxPercent}%</Text>,
    <Text color="subtle"> {short(d.ctxTokens)}/{short(d.ctxWindow)}</Text>,
  ]
  for (const l of d.limits) {
    line2.push(sep, <Text>{l.label} </Text>, <Text color={level(l.percent, 60, 80)}>{l.percent}%</Text>)
    const left = l.resetsAt === null ? '' : resetIn(l.resetsAt - now)
    if (left) line2.push(<Text color="subtle"> ~{left}</Text>)
  }
  line2.push(sep, <Text>In </Text>, <Text color="subtle">{short(d.ctxTokens)}</Text>)
  line2.push(<Text>  Out </Text>, <Text color="subtle">{short(d.outTokens)}</Text>)

  return [
    <Box key="line1" flexDirection="row">{line1}</Box>,
    <Box key="line2" flexDirection="row">{line2}</Box>,
  ]
}

function level(percent: number, warn: number, crit: number) {
  if (percent >= crit) return 'error'
  if (percent >= warn) return 'warning'
  return 'success'
}

function resetIn(ms: number) {
  if (ms <= 0) return 'now'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

function short(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// `claude-opus-5-5[1m]` -> `Opus 5.5 (1M context)`, `claude-haiku-4-5-20251001`
// -> `Haiku 4.5`; anything else (an alias, another provider's id) as given.
export function modelLabel(id: string) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (!m) return id
  const [, family = '', major, minor, isLong] = m
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `${name} ${major}${minor ? `.${minor}` : ''}${isLong ? ' (1M context)' : ''}`
}

function basename(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

export function httpsUrl(remote: string) {
  return remote
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/')
    .replace(/\.git$/, '')
}
