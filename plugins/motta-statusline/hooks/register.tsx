// motta-statusline: a two-line status line.
//
//   📁 folder  🔗 repo  🌿 branch  +staged ~modified | clean  #pr ✓ CI 7/7 · approved
//   [model | effort] · CTX ████··│· used/window · 5h n% ~reset · 7d n% ~reset · In n Out n @n/s
//
// The desktop app leaves out [model | effort]: its model picker shows both.
//
// CTX is a bar of the context window, its used part green under 30%, yellow
// to 50%, orange to 70% and red past it, with a tick where auto-compact
// fires (from the local /context breakdown, no request sent), then the
// tokens used over the window.
//
// `@n/s` is the main session's generation rate: output tokens over the time
// from a request's first streamed token to its end, exact once the request
// ends. While one streams it reads `@~n/s`, estimated from the text received
// so far, and before its first token, past a second, `waiting ns`.
// Subagents are left out, as they are from Out.
//
// The PR segment is the current branch's PR as `gh pr view` reads it: CI
// checks, conflicts or behind its base, review decision. It refreshes every
// 30 s while checks run and every 2 min once they settle, at once after
// Claude pushes or runs `gh pr ...`, and on a GitHub event the session
// receives. A change worth knowing (CI failed or passed, a new conflict, a
// review, merged) raises a toast. No gh, or no PR for the branch: no segment.
// A refresh that fails keeps the last reading, drawn dim until one succeeds.
//
// `placement` picks where it draws:
// - below (default): drawn in the hint line under the prompt (PromptHint),
//   above the engine's own hint, and it stays while a turn runs. The desktop
//   app never raises that line, so there it draws as the band instead.
//   $.ui.status is not used, since it draws as a warning notice.
// - above: a colored band above the prompt. The engine gives that space to
//   the spinner during a turn. The band is shared: this hook asks the plugins
//   beneath it first. A tree whose root Box is keyed `band-beside:<mod>` (a
//   chip, such as prompt-enhancer's) is drawn at the right of the lines, one
//   keyed `band-under:<mod>` (a card) under them, and any other tree takes
//   the band, as replay-theater's does while it has something to show.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import type { EngineInterface, Register, TurnStepChunk } from 'claude-code'

const GIT_REFRESH_MS = 10_000
// How often a streaming request's rate is redrawn, how long a request waits
// for its first token before the wait is shown, and the characters per token
// the live estimate assumes.
const RATE_TICK_MS = 500
const WAIT_SHOWN_MS = 1_000
const CHARS_PER_TOKEN = 4
const PR_PENDING_MS = 30_000
const PR_SETTLED_MS = 120_000
// GitHub takes a few seconds to start the checks of a pushed commit.
const PR_AFTER_PUSH_MS = 20_000
const PR_FIELDS = 'number,url,state,isDraft,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'

type Git = { branch: string; staged: number; modified: number }

export type Pr = {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  base: string
  hasConflicts: boolean
  isBehind: boolean
  isReady: boolean
  review: 'approved' | 'changes' | 'pending' | null
  checks: { total: number; passed: number; pending: number; failed: string[] }
}

type Data = {
  dir: string
  repoName: string | null
  repoUrl: string | null
  git: Git | null
  pr: Pr | null
  isPrStale: boolean
  model: string
  effort: string | null
  ctxPercent: number
  ctxTokens: number
  ctxWindow: number
  compactAt: number | null
  limits: { label: string; percent: number; resetsAt: number | null }[]
  outTokens: number
  rate: Rate | null
}

// The main session's rate: the last finished request's (`exact`), the one
// streaming now (`live`), or how long it has waited for its first token.
export type Rate = { kind: 'exact' | 'live'; perSec: number } | { kind: 'waiting'; ms: number }

// One main-session request while it streams: when it was sent, when its
// first token came, the characters received, and whether it has ended.
type Step = { sentAt: number; firstAt: number | null; chars: number; isDone: boolean }

let data: Data | null = null
let gitRoot: string | null = null
let outTokens = 0
let rate: Rate | null = null
let lastExact: Rate | null = null
// The token count at which Claude Code auto-compacts, null when it is off.
let compactAt: number | null = null
let liveEffort: string | null = null
let isTicking = false
// The branch the PR reading is for, when it was last asked, and whether a
// `gh` call is out.
let prBranch: string | null = null
let prAskedAt = 0
let isAskingPr = false
let placement: 'above' | 'below' = 'below'

export const register: Register = (on, options) => {
  placement = options.placement === 'above' ? 'above' : 'below'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    outTokens = 0
    liveEffort = null
    rate = null
    lastExact = null
    await refreshAll($)
    return started
  })

  // The main loop's requests carry the effort actually sent, after any
  // downgrade for the model; subagents' requests are left out. Refreshing
  // after each one keeps the figures moving while a turn runs. The chunks are
  // passed on as they come; counting them is all the hook does to the stream.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    if (e.effort !== undefined) liveEffort = String(e.effort)
    const step: Step = { sentAt: await $.clock.now(), firstAt: null, chars: 0, isDone: false }
    const tick = $.clock.every(RATE_TICK_MS, () => void tickRate($, step))
    // Runs once, when the stream ends or the dispatch is abandoned (esc), so
    // no tick outlives its request. An interrupted request has no result:
    // its live figure goes and the last finished request's comes back.
    const end = async () => {
      if (step.isDone) return
      step.isDone = true
      tick.cancel()
      rate = lastExact
      await refreshAll($, false)
    }
    const onAbort = () => void end()
    next.signal.addEventListener('abort', onAbort, { once: true })
    let endAt: number | null = null
    try {
      const stream = next(e)
      for await (const chunk of stream) {
        // Timed before the chunk is passed on, so drawing it costs no time.
        if (chunk.kind === 'stop') endAt = await $.clock.now()
        const chars = chunkChars(chunk)
        if (chars > 0) {
          if (step.firstAt === null) step.firstAt = await $.clock.now()
          step.chars += chars
        }
        yield chunk
      }
      const result = await stream.result
      const tokens = result.usage?.output_tokens ?? 0
      outTokens += tokens
      const exact = exactRate(tokens, step.firstAt, endAt ?? (await $.clock.now()))
      if (exact !== null) lastExact = exact
      return result
    } finally {
      next.signal.removeEventListener('abort', onAbort)
      await end()
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refreshAll($)
    return result
  })

  // A push or a `gh pr` command changes the PR: read it at once, and again
  // once GitHub has started the pushed commit's checks.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const op = ran.result.gitOperation
      if (op?.pr || op?.push) {
        void refreshPr($, true)
        $.clock.after(PR_AFTER_PUSH_MS, () => void refreshPr($, true))
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The relay's events for a subscribed PR (checks, reviews, merges).
  on('session.receive', async ($, e, next) => {
    const received = await next(e)
    if (e.event?.source === 'github') void refreshPr($, true)
    return received
  }).catch(($, e, next) => next(e))

  // Also the first-load trigger in both placements: a plugin reload does not
  // fire session.start, but the band is drawn as soon as the plugin loads.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (data === null) await refreshAll($, true)
    // The desktop app never raises PromptHint, so `below` draws in the band there.
    const isBand = placement === 'above' || e.surface === 'desktop'
    if (!isBand || e.props.hasSurvey) return next(e)
    const below = await next(e)
    const share = bandShare(below)
    if (share === 'taken' || data === null) return below
    const { Box, Text, Link } = $.ui.resolve(e)
    // The desktop app shows the model and effort in its own picker.
    const showModel = e.surface !== 'desktop'
    const ours = (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {lines(Box, Text, Link, data, await $.clock.now(), showModel)}
      </Box>
    )
    if (share === 'beside') {
      return (
        <Box flexDirection="row" alignItems="flex-start">
          {ours}
          {below}
        </Box>
      )
    }
    if (share === 'under') {
      return (
        <Box flexDirection="column">
          {ours}
          {below}
        </Box>
      )
    }
    return ours
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

// How a tree a plugin beneath drew shares the band, read from its root Box's
// key: `band-beside:` at the right of the lines, `band-under:` under them.
export function bandShare(node: unknown): 'free' | 'beside' | 'under' | 'taken' {
  if (isFree(node)) return 'free'
  const root = node as { type?: unknown; props?: { key?: unknown } }
  const key = root.type === 'Box' && typeof root.props?.key === 'string' ? root.props.key : ''
  if (key.startsWith('band-beside:')) return 'beside'
  if (key.startsWith('band-under:')) return 'under'
  return 'taken'
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
    const usage = await readUsage($, withGit)
    const ctx = usage.context
    const breakdown = ctx.breakdown
    if (breakdown) compactAt = breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
    data = {
      dir: basename(cwd),
      repoName: repoUrl ? basename(repoUrl) : null,
      repoUrl,
      git: data?.git ?? null,
      pr: data?.pr ?? null,
      isPrStale: data?.isPrStale ?? false,
      model: modelLabel(await $.session.model()),
      effort: liveEffort ?? (await settingsEffort($)),
      ctxPercent: Math.round(ctx.percent ?? (ctx.window ? ((ctx.tokens ?? 0) / ctx.window) * 100 : 0)),
      ctxTokens: ctx.tokens ?? 0,
      ctxWindow: ctx.window ?? 0,
      compactAt,
      limits: usage.rateLimits.map(l => ({
        label: LIMIT_LABELS[l.kind] ?? l.kind,
        percent: Math.round(l.percentUsed),
        resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
      })),
      outTokens,
      rate,
    }
    if (withGit) await refreshGit($)
    else await paint($)
  } catch {
    // Keep the last reading; the next step, turn or timer tries again.
  }
}

// The session's usage. On the full refreshes (the session's start, a turn's
// end) it also asks for the local breakdown, the one place that
// says where auto-compact fires: no request is sent for it. A breakdown that
// fails leaves the last threshold up.
async function readUsage($: EngineInterface, withBreakdown: boolean) {
  if (withBreakdown) {
    try {
      return await $.session.usage({ breakdown: 'summary' })
    } catch {
      // Fall through to the plain reading.
    }
  }
  return $.session.usage()
}

async function paint($: EngineInterface) {
  $.ui.invalidate('ui.render')
}

// Redraws a streaming request's rate: the wait for its first token once it
// passes WAIT_SHOWN_MS, then the estimate from the characters received, once
// they span a tick (a few characters over a few milliseconds would read as
// thousands per second). Until either shows, the last finished request's
// figure stays.
async function tickRate($: EngineInterface, step: Step) {
  const now = await $.clock.now()
  if (step.isDone || data === null) return
  let shown: Rate | null = null
  if (step.firstAt === null) {
    if (now - step.sentAt >= WAIT_SHOWN_MS) shown = { kind: 'waiting', ms: now - step.sentAt }
  } else if (now - step.firstAt >= RATE_TICK_MS) {
    shown = { kind: 'live', perSec: step.chars / CHARS_PER_TOKEN / ((now - step.firstAt) / 1_000) }
  }
  if (shown === null) return
  rate = shown
  data = { ...data, rate }
  await paint($)
}

// The characters a chunk adds to the response: visible text, thinking and a
// tool call's arguments. The rest (a tool call's start, the stop, the
// engine's own items) carries none.
export function chunkChars(chunk: TurnStepChunk): number {
  if (chunk.kind === 'text' || chunk.kind === 'thinking') return chunk.text.length
  if (chunk.kind === 'input') return chunk.json.length
  return 0
}

// The exact rate of a finished request, or null when it streamed nothing or
// ended too soon after its first token to divide by.
export function exactRate(tokens: number, firstAt: number | null, endAt: number): Rate | null {
  if (firstAt === null || tokens <= 0 || endAt - firstAt < 50) return null
  return { kind: 'exact', perSec: tokens / ((endAt - firstAt) / 1_000) }
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
  void refreshPr($)
}

// Asks gh for the branch's PR when the branch changed, when `isNow`, or when
// the reading is older than its cadence. Leaves the last reading up, marked
// stale, when gh fails for any reason other than there being no PR.
async function refreshPr($: EngineInterface, isNow = false) {
  const branch = data?.git?.branch
  if (data === null || gitRoot === null || !branch || branch === 'HEAD' || isAskingPr) return
  const now = await $.clock.now()
  const isNewBranch = branch !== prBranch
  const cadence = data.pr?.state === 'OPEN' && data.pr.checks.pending > 0 ? PR_PENDING_MS : PR_SETTLED_MS
  if (!isNow && !isNewBranch && now - prAskedAt < cadence) return
  if (isNewBranch && data.pr !== null) {
    data = { ...data, pr: null, isPrStale: false }
    await paint($)
  }
  isAskingPr = true
  prBranch = branch
  prAskedAt = now
  try {
    const run = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { cwd: gitRoot, timeoutMs: 15_000 })
    let pr: Pr | null
    if (run.exitCode === 0) pr = parsePr(run.stdout)
    else if (/no (open )?pull requests? found/i.test(run.stderr)) pr = null
    else return await markPrStale($, branch)
    if (data === null || prBranch !== branch) return
    const before = data.pr
    if (before !== null && pr !== null && before.number === pr.number) {
      const change = prChange(before, pr)
      if (change) $.ui.toast(change, { timeoutMs: 8_000 })
    }
    data = { ...data, pr, isPrStale: false }
    await paint($)
  } catch {
    // gh missing, slow or unparsable: keep the last reading.
    await markPrStale($, branch)
  } finally {
    isAskingPr = false
  }
}

async function markPrStale($: EngineInterface, branch: string) {
  if (data === null || data.pr === null || data.isPrStale || prBranch !== branch) return
  data = { ...data, isPrStale: true }
  await paint($)
}

type RawCheck = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'STALE'])

// `gh pr view --json` with PR_FIELDS. Check runs (Actions) carry `status` and
// `conclusion`; commit statuses (external CI) carry `state`.
export function parsePr(json: string): Pr {
  const raw = JSON.parse(json) as {
    number: number
    url: string
    state: Pr['state']
    isDraft: boolean
    baseRefName: string
    mergeable?: string
    mergeStateStatus?: string
    reviewDecision?: string
    statusCheckRollup?: RawCheck[] | null
  }
  const checks: Pr['checks'] = { total: 0, passed: 0, pending: 0, failed: [] }
  for (const c of raw.statusCheckRollup ?? []) {
    checks.total++
    const outcome =
      c.__typename === 'StatusContext'
        ? c.state === 'SUCCESS' ? 'passed' : c.state === 'FAILURE' || c.state === 'ERROR' ? 'failed' : 'pending'
        : c.status !== 'COMPLETED' ? 'pending' : PASSED.has(c.conclusion ?? '') ? 'passed' : 'failed'
    if (outcome === 'passed') checks.passed++
    else if (outcome === 'pending') checks.pending++
    else checks.failed.push(c.name ?? c.context ?? 'check')
  }
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    base: raw.baseRefName,
    hasConflicts: raw.mergeable === 'CONFLICTING' || raw.mergeStateStatus === 'DIRTY',
    isBehind: raw.mergeStateStatus === 'BEHIND',
    isReady: raw.state === 'OPEN' && !raw.isDraft && raw.mergeStateStatus === 'CLEAN',
    review: REVIEWS[raw.reviewDecision ?? ''] ?? null,
    checks,
  }
}

const REVIEWS: Record<string, Pr['review']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'pending',
}

// The toast for what changed between two readings of the same PR, or null.
// One line: a plugin's newer toast replaces its own older one.
export function prChange(before: Pr, after: Pr): string | null {
  const tag = `#${after.number}`
  if (after.state === 'MERGED' && before.state !== 'MERGED') return `${tag} merged`
  if (after.state === 'CLOSED' && before.state === 'OPEN') return `${tag} closed`
  const parts: string[] = []
  const c = after.checks
  if (c.failed.length > 0 && before.checks.failed.length === 0) {
    parts.push(`✗ CI failed: ${checkNames(c.failed)}`)
  } else if (c.total > 0 && c.pending === 0 && c.failed.length === 0 && (before.checks.pending > 0 || before.checks.failed.length > 0)) {
    parts.push('✓ all checks passed')
  }
  if (after.hasConflicts && !before.hasConflicts) parts.push(`⚠ now conflicts with ${after.base}`)
  if (after.review === 'approved' && before.review !== 'approved') parts.push('approved')
  if (after.review === 'changes' && before.review !== 'changes') parts.push('changes requested')
  return parts.length > 0 ? `${tag} ${parts.join(' · ')}` : null
}

function checkNames(names: string[]) {
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
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

function lines(Box: any, Text: any, Link: any, d: Data, now: number, showModel = true) {
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
  if (d.pr) line1.push(<Text>  </Text>, ...prSegment(Text, Link, d.pr, d.isPrStale))

  const model = d.effort ? `[${d.model} | ${d.effort}]` : `[${d.model}]`
  const line2 = [
    ...(showModel ? [<Text color="subtle">{model}</Text>, sep] : []),
    <Text>CTX </Text>,
    ...ctxBar(Text, d),
    <Text color="subtle"> {short(d.ctxTokens)}/{short(d.ctxWindow)}</Text>,
  ]
  for (const l of d.limits) {
    line2.push(sep, <Text>{l.label} </Text>, <Text color={level(l.percent, 60, 80)}>{l.percent}%</Text>)
    const left = l.resetsAt === null ? '' : resetIn(l.resetsAt - now)
    if (left) line2.push(<Text color="subtle"> ~{left}</Text>)
  }
  line2.push(sep, <Text>In </Text>, <Text color="subtle">{short(d.ctxTokens)}</Text>)
  line2.push(<Text>  Out </Text>, <Text color="subtle">{short(d.outTokens)}</Text>)
  if (d.rate) line2.push(...rateSegment(Text, d.rate))

  return [
    <Box key="line1" flexDirection="row">{line1}</Box>,
    <Box key="line2" flexDirection="row">{line2}</Box>,
  ]
}

// `#482 ✓ CI 7/7 · approved · ready to merge`, `#482 ✗ CI 1 failed (lint)
// ⚠ conflicts with main · review pending`, `#482 merged`. Dim when stale.
function prSegment(Text: any, Link: any, pr: Pr, isStale: boolean) {
  const T = (color: string, text: string) => <Text color={color} dimColor={isStale}>{text}</Text>
  const parts = [<Link href={pr.url} label={`#${pr.number}`} />]
  if (pr.state === 'MERGED') return [...parts, T('merged', ' merged')]
  if (pr.state === 'CLOSED') return [...parts, T('subtle', ' closed')]
  if (pr.isDraft) parts.push(T('subtle', ' draft'))
  const c = pr.checks
  if (c.failed.length > 0) {
    parts.push(T('error', ` ✗ CI ${c.failed.length} failed`), T('subtle', ` (${checkNames(c.failed)})`))
  } else if (c.pending > 0) {
    parts.push(T('warning', ` ◐ CI ${c.passed}/${c.total}`))
  } else if (c.total > 0) {
    parts.push(T('success', ` ✓ CI ${c.passed}/${c.total}`))
  }
  if (pr.hasConflicts) parts.push(T('error', ` ⚠ conflicts with ${pr.base}`))
  else if (pr.isBehind) parts.push(T('warning', ` ↓ behind ${pr.base}`))
  if (pr.review === 'approved') parts.push(T('success', ' · approved'))
  else if (pr.review === 'changes') parts.push(T('error', ' · changes requested'))
  else if (pr.review === 'pending') parts.push(T('subtle', ' · review pending'))
  if (pr.isReady) parts.push(T('subtle', ' · ready to merge'))
  return parts
}

// ` @84/s` once a request ended, ` @~84/s` while one streams (the estimate
// in the warning color), ` waiting 3s` before its first token.
function rateSegment(Text: any, r: Rate) {
  if (r.kind === 'waiting') return [<Text color="subtle"> waiting {Math.floor(r.ms / 1_000)}s</Text>]
  const n = Math.round(r.perSec)
  if (r.kind === 'live') return [<Text color="subtle"> @</Text>, <Text color="warning">~{n}</Text>, <Text color="subtle">/s</Text>]
  return [<Text color="subtle"> @{n}/s</Text>]
}

// `██████········│·`: the window in BAR_CELLS cells, the used part in the
// color of how full it is, and a tick (the theme's text color: white on a
// dark theme) where auto-compact fires. No tick when auto-compact is off.
function ctxBar(Text: any, d: Data) {
  const { filled, mark } = barCells(d.ctxTokens, d.ctxWindow, d.compactAt)
  const look = { used: { color: ctxLevel(d.ctxPercent), glyph: '█' }, mark: { color: 'text', glyph: '│' }, free: { color: 'subtle', glyph: '·' } }
  // One Text per run of like cells.
  const runs: { kind: keyof typeof look; length: number }[] = []
  for (let i = 0; i < BAR_CELLS; i++) {
    const kind = i === mark ? 'mark' : i < filled ? 'used' : 'free'
    const last = runs[runs.length - 1]
    if (last?.kind === kind) last.length++
    else runs.push({ kind, length: 1 })
  }
  return runs.map(r => <Text color={look[r.kind].color}>{look[r.kind].glyph.repeat(r.length)}</Text>)
}

const BAR_CELLS = 14

// How many of the bar's cells the used tokens fill, and which cell holds the
// auto-compact tick (null when there is none).
export function barCells(tokens: number, window: number, compactAt: number | null) {
  if (window <= 0) return { filled: 0, mark: null }
  const at = (n: number) => Math.min(BAR_CELLS - 1, Math.max(0, Math.round((n / window) * BAR_CELLS)))
  const filled = Math.min(BAR_CELLS, Math.round((tokens / window) * BAR_CELLS))
  return { filled, mark: compactAt === null ? null : at(compactAt) }
}

// Under 30% green, then yellow to 50%, orange to 70%, red past it.
export function ctxLevel(percent: number) {
  if (percent >= 70) return 'error'
  if (percent >= 50) return ORANGE
  if (percent >= 30) return 'warning'
  return 'success'
}

// The theme has no orange key; a raw color draws the same on every theme.
const ORANGE = '#ff8700'

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
