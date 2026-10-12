// motta-statusline: a two-line status line.
//
//   📁 folder  ⧉ repo  ⎇ branch  +staged ~modified ?untracked | clean  ↑ahead ↓behind  last 12m ago  #pr ✓ CI 7/7
//   [model | effort]  ctx ⣿⣿⣿⣄⣀⣀⣀⣀|⣀⣀ n% used/window   5h ⣿⣀⣀⣀|⣀⣀⣀⣀⣀⣀ n% reset   7d ⣿⣿⣿⣿⣦⣀⣀|⣀⣀⣀ n% reset   out n @n/s
//
// The desktop app leaves out [model | effort], which its model picker shows,
// and the PR, which its PR bar shows. A narrow band wraps between segments.
// Labels are subtle and figures at full strength.
//
// Line 1 says where the session runs (its root: the checkout, the folder
// below it, and the repository a worktree belongs to; then `↳ folder` when
// a shell `cd` has taken the shell away from the root), the branch's files, how it stands
// against its upstream (`not pushed` when it has none) and its last commit.
// The branch's icon and color say where it stands, as the desktop's sidebar
// does (branchLook): its PR merged, closed, draft or open (red with failed CI,
// conflicts or changes requested, yellow while checks run), or with no PR,
// files changed, commits not pushed, or clean and in step.
// What can be pressed is a dim word, full strength under the pointer (a
// desktop button draws plain), or an underlined link: the root's name and
// the `↳` folder open in the file explorer, the branch opens GitHub (as
// a compare view against origin's default), the last commit its page once
// pushed, and `files`, `ctx`, `5h` and `7d` the panes of changes-drill,
// context-drill and usage-drill (a mod opens only its own panes, so each is
// asked through the noun its mod adds to `$`; without that mod, a toast says
// to install it), and the last slot cycles: output and rate, cost, the session's
// turns and time, the turns left before auto-compact (its word, `out`,
// `cost`, `session` or `compact`, is what is pressed). A toast says when a
// limit turns orange or red.
//
// Each bar is ten braille cells of ten points, a cell's dots rising from its
// bottom row as its points come. ctx is the context window, its dots green
// under 30%, yellow to 50%, orange to 70% and red past it, with a tick where
// auto-compact fires (from the local /context breakdown, no request sent),
// then the share used and the tokens used over the window.
//
// 5h and 7d are their rate-limit windows, with a tick where the window's
// time stands: dots past the tick mean the limit is going
// faster than the window. Red from 80%; short of that, orange once it is 10
// points ahead, else yellow from 60%. Then the time to reset (`2h45m`,
// `1d20h`).
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
//   keyed `band-under:<mod>` (a card) under them, a chip column inside the
//   card lifted back to the right of the lines (liftBeside), and any other
//   tree takes the band.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import type { EngineInterface, Register, RenderChildren, SessionContextUsage, SessionRateLimit, TurnStepChunk } from 'claude-code'

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

// The branch, its file counts, and how it stands against its upstream: null
// when it has none (never pushed), else the commits to push and to pull.
export type Git = {
  branch: string
  staged: number
  modified: number
  untracked: number
  upstream: string | null
  ahead: number
  behind: number
}

// The last commit: its hash, when it was made, and its subject.
export type Commit = { hash: string; at: number; subject: string }

// The session's project root (where it started, or where /cd or a worktree
// move took it): as shown (the checkout's name, and the subfolder when the
// root sits below it), its path, and the repository's name when that checkout
// is a worktree of it.
export type Where = { label: string; path: string; worktreeOf: string | null }

// What the last slot of line 2 shows; pressing it moves to the next.
export type Slot = 'rate' | 'cost' | 'session' | 'runway'
const SLOTS: Slot[] = ['rate', 'cost', 'session', 'runway']

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
  where: Where
  // The shell's folder, which a `cd` moves while the root stays.
  cwd: string
  repoUrl: string | null
  git: Git | null
  commit: Commit | null
  // The branch a compare link measures against: origin's default.
  base: string
  pr: Pr | null
  isPrStale: boolean
  model: string
  effort: string | null
  ctxPercent: number
  ctxTokens: number
  ctxWindow: number
  compactAt: number | null
  limits: { label: string; windowMs: number | null; percent: number; resetsAt: number | null }[]
  outTokens: number
  rate: Rate | null
  costUsd: number | null
  turns: number
  startedAt: number
  slot: Slot
}

// The main session's rate: the last finished request's (`exact`), the one
// streaming now (`live`), or how long it has waited for its first token.
export type Rate = { kind: 'exact' | 'live'; perSec: number } | { kind: 'waiting'; ms: number }

// One main-session request while it streams: when it was sent, when its
// first token came, the characters received, and whether it has ended.
type Step = { sentAt: number; firstAt: number | null; chars: number; isDone: boolean }

let data: Data | null = null
// The folder git and gh run in: the session's own, which in a worktree is the
// worktree, where the repository's root is the main checkout. Null outside a
// repository.
let gitDir: string | null = null
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
let slot: Slot = 'rate'
// Each limit's last color, so a toast says when one turns orange or red.
const limitColors = new Map<string, string>()

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

  // The engine's push when a rate-limit window moves a whole point or the
  // context fill moves, from any response: a subagent's too, and a background
  // one's after the turn ended, when no main-session step would re-read them.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (data !== null) {
      const limits = limitsOf(e.rateLimits)
      data = { ...data, ...contextFigures(e.context), limits }
      await noteLimits($, limits)
      await paint($)
    }
    return measured
  }).catch(($, e, next) => next(e))

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
    const table = $.ui.resolve(e)
    const { Box, Text, Link, Button } = table
    const Svg = e.surface === 'desktop' && 'Svg' in table ? table.Svg : null
    const ours = (
      <Box flexDirection="column" paddingX={1} flexGrow={1} flexShrink={1}>
        {lines($, { Box, Text, Link, Button }, data, await $.clock.now(), Svg)}
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
      // A card holds the chips when their hooks ran beneath it: they go back
      // to the right of the lines, and the card under them.
      const { beside, rest } = liftBeside(below)
      return (
        <Box flexDirection="column">
          {beside === undefined ? (
            ours
          ) : (
            <Box flexDirection="row" alignItems="flex-start">
              {ours}
              {beside}
            </Box>
          )}
          {rest}
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
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines($, { Box, Text, Link, Button }, data, await $.clock.now())}
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

type Node = { type?: unknown; props?: { key?: unknown }; children?: RenderChildren[] }

// The first `band-beside:` Box inside a card's tree, taken out of it, and the
// tree without it; `beside` undefined when it holds none.
export function liftBeside(node: RenderChildren, depth = 0): { beside?: RenderChildren; rest: RenderChildren } {
  if (node === null || typeof node !== 'object' || depth > 8) return { rest: node }
  const el = node as Node
  if (el.type !== 'Box') return { rest: node }
  const children = el.children ?? []
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Node | null
    const key = child?.type === 'Box' ? child.props?.key : undefined
    if (typeof key === 'string' && key.startsWith('band-beside:')) {
      return { beside: child as RenderChildren, rest: { ...el, children: children.filter((_, j) => j !== i) } as RenderChildren }
    }
    const lifted = liftBeside(children[i] ?? null, depth + 1)
    if (lifted.beside !== undefined) {
      return { beside: lifted.beside, rest: { ...el, children: children.map((c, j) => (j === i ? lifted.rest : c)) } as RenderChildren }
    }
  }
  return { rest: node }
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
    gitDir = repo ? cwd : null
    const repoUrl = repo?.remote ? httpsUrl(repo.remote) : null
    const usage = await readUsage($, withGit)
    const ctx = usage.context
    const breakdown = ctx.breakdown
    if (breakdown) compactAt = breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
    if (data === null) slot = await readSlot($)
    const limits = limitsOf(usage.rateLimits)
    data = {
      where: withGit || data === null ? await readWhere($, await $.session.root().catch(() => cwd), repo?.root ?? null) : data.where,
      cwd,
      repoUrl,
      git: data?.git ?? null,
      commit: data?.commit ?? null,
      base: withGit || data === null ? await readBase($) : data.base,
      pr: data?.pr ?? null,
      isPrStale: data?.isPrStale ?? false,
      model: modelLabel(await $.session.model()),
      effort: liveEffort ?? (await settingsEffort($)),
      ...contextFigures(ctx),
      compactAt,
      limits,
      outTokens,
      rate,
      costUsd: usage.cost?.usd ?? null,
      turns: await $.session.turns().catch(() => data?.turns ?? 0),
      startedAt: usage.startedAt,
      slot,
    }
    await noteLimits($, limits)
    if (withGit) await refreshGit($)
    else await paint($)
  } catch {
    // Keep the last reading; the next step, turn or timer tries again.
  }
}

function contextFigures(ctx: SessionContextUsage) {
  return {
    ctxPercent: Math.round(ctx.percent ?? (ctx.window ? ((ctx.tokens ?? 0) / ctx.window) * 100 : 0)),
    ctxTokens: ctx.tokens ?? 0,
    ctxWindow: ctx.window ?? 0,
  }
}

function limitsOf(rateLimits: SessionRateLimit[]): Data['limits'] {
  return rateLimits.map(l => ({
    label: LIMIT_LABELS[l.kind] ?? l.kind,
    windowMs: LIMIT_WINDOWS[l.kind] ?? null,
    percent: Math.round(l.percentUsed),
    resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : null,
  }))
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
  if (gitDir === null) {
    data = { ...data, git: null }
    await paint($)
    return
  }
  try {
    const run = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch'], {
      cwd: gitDir,
      timeoutMs: 5_000,
    })
    if (run.exitCode === 0) {
      const git = parseStatus(run.stdout)
      const log = await $.process.run(['git', '--no-optional-locks', 'log', '-1', '--format=%H%x1f%ct%x1f%s'], { cwd: gitDir, timeoutMs: 5_000 })
      const commit = log.exitCode === 0 ? parseCommit(log.stdout) : null
      const cwd = await $.session.cwd().catch(() => data?.cwd ?? '')
      if (data !== null) data = { ...data, git, commit, cwd: cwd || data.cwd }
    }
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
  if (data === null || gitDir === null || !branch || branch === 'HEAD' || isAskingPr) return
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
    const run = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { cwd: gitDir, timeoutMs: 15_000 })
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

// `## dev...origin/dev [ahead 1, behind 2]` then one `XY path` line per
// change. Untracked files are counted apart, as neither staged nor modified.
// No `...` means the branch has no upstream.
export function parseStatus(out: string): Git {
  const lines = out.split('\n').filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines[0].slice(3) : ''
  const name = head.startsWith('No commits yet on ') ? head.slice('No commits yet on '.length) : head
  const [local = '', rest = ''] = name.split('...')
  const branch = local.split(' ')[0] || 'HEAD'
  const upstream = rest ? rest.split(' ')[0] || null : null
  const ahead = Number(/ahead (\d+)/.exec(rest)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(rest)?.[1] ?? 0)
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines.slice(1)) {
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    if (line[0] !== ' ') staged++
    if (line[1] !== ' ') modified++
  }
  return { branch, staged, modified, untracked, upstream, ahead, behind }
}

// `git log -1 --format=%H%x1f%ct%x1f%s`, or null when it is not that.
export function parseCommit(out: string): Commit | null {
  const [hash, at, ...subject] = out.trim().split('\x1f')
  if (!hash || !/^[0-9a-f]{7,}$/.test(hash) || !at) return null
  return { hash, at: Number(at) * 1_000, subject: subject.join('\x1f') }
}

// The session's root as shown, from the checkout git finds for it and the
// repository's root, which for a worktree is the main checkout.
async function readWhere($: EngineInterface, root: string, repoRoot: string | null): Promise<Where> {
  const plain = { label: basename(root), path: root, worktreeOf: null }
  if (repoRoot === null) return plain
  try {
    const run = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 5_000 })
    const top = run.stdout.trim()
    if (run.exitCode !== 0 || !/^([a-zA-Z]:)?[\\/]/.test(top) || top.includes('\n')) return plain
    return whereOf(root, top, repoRoot)
  } catch {
    return plain
  }
}

// The checkout's name, then the root's folder below it; and the
// repository's name when the checkout is not its root (a worktree).
export function whereOf(root: string, top: string, repoRoot: string): Where {
  const rel = relativeTo(top, root)
  return {
    label: rel ? `${basename(top)}/${rel}` : basename(top),
    path: root,
    worktreeOf: normPath(top) === normPath(repoRoot) ? null : basename(repoRoot),
  }
}

// Where the shell has gone from the root: null while it is there, the path
// below the root when inside it (`plugins/x`), else the whole path.
export function driftOf(root: string, cwd: string): string | null {
  if (normPath(root) === normPath(cwd)) return null
  return relativeTo(root, cwd) || cwd.replace(/\\/g, '/')
}

function normPath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// `path` below `base`, with forward slashes; '' when it is not below it.
function relativeTo(base: string, path: string) {
  const b = normPath(base)
  const p = normPath(path)
  return p.startsWith(`${b}/`) ? path.replace(/\\/g, '/').replace(/\/+$/, '').slice(b.length + 1) : ''
}

// origin's default branch, which a compare link measures against; `main`
// when origin names none.
async function readBase($: EngineInterface): Promise<string> {
  if (gitDir === null) return 'main'
  try {
    const run = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: gitDir, timeoutMs: 5_000 })
    const m = /^origin\/(\S+)\s*$/.exec(run.stdout)
    return run.exitCode === 0 && m?.[1] ? m[1] : 'main'
  } catch {
    return 'main'
  }
}

const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const LIMIT_WINDOWS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

// The elements a drawing takes from the surface's table.
type Ui = { Box: any; Text: any; Link: any; Button: any }

// Each line is a row of segments that wraps between them, never inside one:
// a narrow band moves a whole segment to the next row instead of breaking
// `motta-claude-mods` over two. `Svg`, given on the desktop, leaves out what
// the desktop app draws itself: the model and effort (its picker) and the PR
// (its PR bar), and draws the bars as square grids (squaresSvg), not braille.
// What can be pressed is underlined: the folder (opens
// the file explorer there), the branch (GitHub, as a compare
// view against origin's default), the file counts (the Changes pane), the
// last commit once pushed (its page), the percentages (the Context and Usage
// panes) and the last slot (cycles what it shows).
function lines($: EngineInterface, ui: Ui, d: Data, now: number, Svg: any = null) {
  const { Box, Text, Link, Button } = ui
  const onDesktop = Svg !== null
  // Spacing comes from the layout alone, never from spaces in the text: a
  // gap between a segment's items and a wider one between segments, which
  // its label word (`ctx`, `5h`, `files`) opens, so no separator is drawn:
  // the band cannot tell where a row wraps, and a `·` would end up at the
  // start or end of one. A proportional font draws a space at no fixed
  // width. A narrow band moves a whole segment to the next row; only a
  // segment wider than a row of its own wraps its items. In character cells:
  // the desktop takes fractions, the terminal whole cells.
  const space = onDesktop ? DESKTOP_SPACE : TERMINAL_SPACE
  const seg = (parts: unknown[]) => (
    <Box flexDirection="row" flexWrap="wrap" flexShrink={1} alignItems="center" columnGap={space.inner}>
      {parts}
    </Box>
  )
  // Pieces that read as one token, `@84/s` or a bar's runs: no gap inside.
  const tight = (parts: unknown[]) => <Box flexDirection="row" alignItems="center">{parts}</Box>
  // A 0-100 bar: squares on the desktop, its tick exactly at `share` (0-1),
  // or braille cells elsewhere, its tick before cell `mark`, as near as text
  // can put it. An image, not an interactive frame: the desktop rebuilds a
  // frame on every redraw, and the band redraws twice a second while a
  // response streams, so a frame flickers (its tooltip is not worth that).
  const bar = (alt: string, points: number, color: string, share: number | null, mark: number | null) =>
    Svg !== null
      ? <Svg source={squaresSvg(points, color, share)} alt={alt} width={SQ_W} height={SQ_H} />
      : tight(meter(Text, cellDots(points), color, mark))

  // An icon before a name: drawn as an outline image on the desktop (iconSvg),
  // a glyph in its color elsewhere.
  const icon = (name: Icon, color: string) =>
    Svg !== null
      ? <Svg source={iconSvg(name, color)} alt={name} width={ICON_SIZE} height={ICON_SIZE} />
      : <Text color={color}>{ICON_GLYPHS[name]}</Text>
  // A pressable label: a desktop draws a Button as a native button of its
  // plain label, dropping any color or underline, so what can be pressed is a
  // word drawn dim, full strength under the pointer, and the colored figures
  // stay plain Text beside it. The desktop's button pads its label on both
  // sides; a negative margin of that padding takes it back, so the word sits
  // where plain text would and the gaps around it match the rest.
  const press = (key: string, label: string, onPress: () => void) => {
    const button = <Button plain dimColor key={key} label={label} onPress={onPress} />
    return onDesktop ? <Box marginX={-DESKTOP_BUTTON_PAD}>{button}</Box> : button
  }

  const w = d.where
  const drift = driftOf(w.path, d.cwd)
  // The root, then the shell's folder right after it when a `cd` has taken
  // the shell away from it, then whether the root is a worktree.
  const line1 = [
    seg([
      icon('folder', 'suggestion'),
      press('folder', w.label, () => void openFolder($, w.path)),
      ...(drift === null ? [] : [<Text color="suggestion">↳</Text>, press('cwd', drift, () => void openFolder($, d.cwd))]),
      ...(w.worktreeOf ? [icon('worktree', 'subtle'), <Text color="subtle">{w.worktreeOf}</Text>] : []),
    ]),
  ]
  if (d.git) {
    const g = d.git
    const look = branchLook(g, d.pr, d.base)
    const branch = <Text color={look.color} dimColor={d.pr !== null && d.isPrStale} underline={d.repoUrl !== null}>{g.branch}</Text>
    line1.push(seg([icon(look.icon, look.color), d.repoUrl ? <Link href={branchUrl(d.repoUrl, g.branch, d.base)}>{branch}</Link> : branch]))
    const files = fileCounts(Text, g)
    const state = files.length > 0 ? [press('changes', 'files', () => void openChanges($)), ...files] : [<Text color="subtle">clean</Text>]
    line1.push(seg([...state, ...syncParts(Text, g, d.base)]))
    if (d.commit) line1.push(seg(commitParts(Text, Link, d, d.commit, now)))
  }
  if (d.pr && !onDesktop) line1.push(seg([tight(prSegment(Text, Link, d.pr, d.isPrStale))]))

  // Labels subtle, figures at full strength: the figures are what is read.
  const model = d.effort ? `[${d.model} | ${d.effort}]` : `[${d.model}]`
  const ctxColor = ctxLevel(d.ctxPercent)
  const line2 = [
    ...(onDesktop ? [] : [seg([<Text color="subtle">{model}</Text>])]),
    seg([
      press('context', 'ctx', () => void openContext($)),
      bar(`context ${d.ctxPercent}%`, d.ctxPercent, ctxColor, compactShare(d.compactAt, d.ctxWindow), compactMark(d.compactAt, d.ctxWindow)),
      <Text color={ctxColor} bold>{d.ctxPercent}%</Text>,
      <Text color="subtle">{short(d.ctxTokens)}/{short(d.ctxWindow)}</Text>,
    ]),
  ]
  for (const l of d.limits) {
    const pace = l.resetsAt === null ? null : elapsedShare(l.resetsAt, l.windowMs, now)
    const color = limitLevel(l.percent, pace)
    const limit = [
      press(`usage-${l.label}`, l.label, () => void openUsage($)),
      bar(`${l.label} limit ${l.percent}%`, l.percent, color, pace, paceMark(pace)),
      <Text color={color} bold>{l.percent}%</Text>,
    ]
    const left = l.resetsAt === null ? '' : resetIn(l.resetsAt - now)
    if (left) limit.push(<Text color="subtle">{left}</Text>)
    line2.push(seg(limit))
  }
  line2.push(seg([press('slot', SLOT_LABELS[d.slot], () => void nextSlot($)), ...slotParts(Text, tight, d, now)]))

  return [
    <Box key="line1" flexDirection="row" flexWrap="wrap" columnGap={space.outer}>{line1}</Box>,
    <Box key="line2" flexDirection="row" flexWrap="wrap" columnGap={space.outer}>{line2}</Box>,
  ]
}

// The gaps, in character cells: between a segment's items (`inner`) and
// between segments (`outer`). A desktop cell is wider than a space in its
// proportional font, so its inner gap is half a cell.
const DESKTOP_SPACE = { inner: 0.5, outer: 2 }
const TERMINAL_SPACE = { inner: 1, outer: 3 }
// The padding a desktop button puts on each side of its label, in cells:
// measured from the band, about four fifths of a cell.
const DESKTOP_BUTTON_PAD = 0.75

// `+2 ~7 ?1`: staged, modified and untracked files, the ones there are.
function fileCounts(Text: any, g: Git) {
  const parts = []
  if (g.staged > 0) parts.push(<Text color="success">+{g.staged}</Text>)
  if (g.modified > 0) parts.push(<Text color="warning">~{g.modified}</Text>)
  if (g.untracked > 0) parts.push(<Text color="subtle">?{g.untracked}</Text>)
  return parts
}

// `↑2` commits to push, `↓1` to pull, or `not pushed` for a branch with no
// upstream (origin's default branch excepted, which has nothing to push to).
function syncParts(Text: any, g: Git, base: string) {
  if (g.upstream === null) return g.branch === base || g.branch === 'HEAD' ? [] : [<Text color="subtle">not pushed</Text>]
  const parts = []
  if (g.ahead > 0) parts.push(<Text>↑{g.ahead}</Text>)
  if (g.behind > 0) parts.push(<Text color="warning">↓{g.behind}</Text>)
  return parts
}

// `last 12m ago`: a link to the commit once it is on the remote, plain text
// while it is only local.
function commitParts(Text: any, Link: any, d: Data, c: Commit, now: number) {
  const isPushed = d.repoUrl !== null && d.git?.upstream != null && d.git.ahead === 0
  const label = `last ${ago(now - c.at)}`
  return isPushed ? [<Link href={`${d.repoUrl}/commit/${c.hash}`}><Text color="subtle" underline>{label}</Text></Link>] : [<Text color="subtle">{label}</Text>]
}

// The branch on GitHub: compared against origin's default, or the default
// branch's own tree.
export function branchUrl(repoUrl: string, branch: string, base: string) {
  return branch === base || branch === 'HEAD' ? `${repoUrl}/tree/${branch}` : `${repoUrl}/compare/${base}...${branch}`
}

// What the last slot shows: the output and its rate, the session's cost, its
// turns and time, or the turns left before auto-compact. Its label is
// underlined: pressing it moves to the next.
function slotParts(Text: any, tight: (parts: unknown[]) => unknown, d: Data, now: number) {
  if (d.slot === 'cost') return [<Text>{d.costUsd === null ? '–' : `$${d.costUsd.toFixed(2)}`}</Text>]
  if (d.slot === 'session') {
    return [<Text>{d.turns}</Text>, <Text color="subtle">turns</Text>, <Text color="subtle">·</Text>, <Text>{resetIn(now - d.startedAt)}</Text>]
  }
  if (d.slot === 'runway') {
    const left = turnsToCompact(d)
    return [<Text>{d.compactAt === null ? 'off' : left === null ? '–' : `in ~${left} turns`}</Text>]
  }
  const parts: unknown[] = [<Text>{short(d.outTokens)}</Text>]
  if (d.rate) parts.push(tight(rateSegment(Text, d.rate)))
  return parts
}

// The word each slot is pressed by.
const SLOT_LABELS: Record<Slot, string> = { rate: 'out', cost: 'cost', session: 'session', runway: 'compact' }

// The branch's icon and color: its PR's state when it has one (a stale
// reading keeps its look, drawn dim), else how the branch stands locally.
// The first that holds:
//   PR merged                                  merged icon, purple
//   PR closed                                  closed icon, red
//   PR draft                                   draft icon, subtle
//   PR open, CI failed, conflicts or changes   PR icon, red
//   PR open, checks running                    PR icon, yellow
//   PR open                                    PR icon, green
//   no PR, files changed                       branch icon, yellow
//   no PR, commits to push or never pushed     branch icon, blue
//   no PR, clean and in step                   branch icon, green
export type BranchLook = { icon: Icon; color: string }

export function branchLook(g: Git, pr: Pr | null, base: string): BranchLook {
  if (pr !== null) {
    if (pr.state === 'MERGED') return { icon: 'merged', color: 'merged' }
    if (pr.state === 'CLOSED') return { icon: 'closed', color: 'error' }
    if (pr.isDraft) return { icon: 'draft', color: 'subtle' }
    if (pr.checks.failed.length > 0 || pr.hasConflicts || pr.review === 'changes') return { icon: 'pr', color: 'error' }
    if (pr.checks.pending > 0) return { icon: 'pr', color: 'warning' }
    return { icon: 'pr', color: 'success' }
  }
  if (g.staged + g.modified + g.untracked > 0) return { icon: 'branch', color: 'warning' }
  const isUnpushed = g.upstream === null ? g.branch !== base && g.branch !== 'HEAD' : g.ahead > 0
  return { icon: 'branch', color: isUnpushed ? 'suggestion' : 'success' }
}

export type Icon = 'folder' | 'worktree' | 'branch' | 'pr' | 'draft' | 'merged' | 'closed'
const ICON_SIZE = 14
// The terminal's icons: glyphs that take the color, the folder excepted.
const ICON_GLYPHS: Record<Icon, string> = { folder: '📁', worktree: '⧉', branch: '⎇', pr: '⇄', draft: '◌', merged: '✔', closed: '✕' }
// GitHub's shapes, after Tabler's outlines, on a 14-unit grid: a pull
// request's two ends and its arrow, a draft's dots, a merge's bend, a closed
// one's cross.
const PR_ENDS = '<circle cx="3.5" cy="3.5" r="1.3"/><circle cx="3.5" cy="10.5" r="1.3"/><circle cx="10.5" cy="10.5" r="1.3"/><path d="M3.5 4.8v4.4"/>'
const ICON_PATHS: Record<Icon, string> = {
  folder: '<path d="M2 4.2a1 1 0 0 1 1-1h2.7l1.5 1.6H11a1 1 0 0 1 1 1v4.9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  branch: '<circle cx="4.5" cy="3.3" r="1.3"/><circle cx="4.5" cy="10.7" r="1.3"/><circle cx="9.5" cy="4.6" r="1.3"/><path d="M4.5 4.6v4.8"/><path d="M9.5 5.9c0 2.4-5 1.6-5 3.5"/>',
  pr: `${PR_ENDS}<path d="M6.4 3.5h2.9a1.2 1.2 0 0 1 1.2 1.2v4.5"/><path d="M8.2 5.3 6.4 3.5l1.8-1.8"/>`,
  draft: `${PR_ENDS}<path d="M10.5 3.5h.01M10.5 6.6h.01"/>`,
  merged: '<circle cx="4.1" cy="3.5" r="1.3"/><circle cx="4.1" cy="10.5" r="1.3"/><circle cx="9.9" cy="7" r="1.3"/><path d="M4.1 4.8v4.4"/><path d="M4.1 4.8a2.3 2.3 0 0 0 2.3 2.2h2.2"/>',
  closed: `${PR_ENDS}<path d="M10.5 6.4v2.8"/><path d="m9.3 1.8 2.4 2.4m0-2.4-2.4 2.4"/>`,
  // Two folders, one behind the other: another checkout of the repository.
  worktree: '<path d="M5.3 2.3h1.7l1.2 1.2h2.9a1.2 1.2 0 0 1 1.2 1.2v4.1a1.2 1.2 0 0 1-1.2 1.2H5.3a1.2 1.2 0 0 1-1.2-1.2V3.5a1.2 1.2 0 0 1 1.2-1.2z"/><path d="M9.9 9.9v1.2a1.2 1.2 0 0 1-1.2 1.2H2.9a1.2 1.2 0 0 1-1.2-1.2V5.8a1.2 1.2 0 0 1 1.2-1.2h1.2"/>',
}

// An outline icon, Tabler's look: strokes in the band's color, no fill.
export function iconSvg(name: Icon, color: string) {
  const stroke = SVG_COLORS[color] ?? color
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 14 14" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`
}

// About how many turns are left before auto-compact, at the context's
// average growth per turn so far; null when that cannot be told.
export function turnsToCompact(d: Pick<Data, 'compactAt' | 'ctxTokens' | 'turns'>): number | null {
  if (d.compactAt === null || d.turns <= 0 || d.ctxTokens <= 0) return null
  return Math.max(0, Math.round((d.compactAt - d.ctxTokens) / (d.ctxTokens / d.turns)))
}

// How the limit ends at the pace so far: its average rate since the window
// opened, run to the reset.
export function projection(percent: number, elapsed: number | null, windowMs: number | null) {
  if (elapsed === null || windowMs === null) return ''
  const gone = `${Math.round(elapsed * 100)}% of the window gone`
  if (elapsed < 0.02) return `${gone}, too early to project`
  if (percent <= 0) return `${gone} · nothing used yet`
  const end = percent / elapsed
  if (end <= 100) return `${gone} · at this pace about ${Math.round(end)}% by the reset`
  return `${gone} · at this pace 100% in about ${resetIn((elapsed * windowMs * (100 - percent)) / percent)}, before the reset`
}

// `just now`, `12m ago`, `3h ago`, `2d ago`.
export function ago(ms: number) {
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}


// Opens the folder in the system's file explorer, as the mod's own process,
// so nothing reaches the transcript. Says so when every way failed, with why.
async function openFolder($: EngineInterface, path: string) {
  let why = ''
  for (const argv of folderOpeners(path)) {
    try {
      const run = await $.process.run(argv, { timeoutMs: 15_000 })
      // explorer.exe exits 1 even when it opened the window.
      if (run.exitCode === 0 || argv[0] === 'explorer.exe') return
      why = run.stderr.trim() || `${argv[0]} exited ${run.exitCode}`
    } catch (err) {
      why = err instanceof Error ? err.message : String(err)
    }
  }
  $.ui.toast(`Could not open ${path}: ${why}`)
}

// The commands that open a folder, in the order to try them. On Windows (a
// drive letter or backslash) `start` first: it opens the folder the way a
// double-click does, in a window of its own, where explorer.exe started
// straight from a hidden helper process can open hidden or not at all; then
// explorer.exe. Elsewhere macOS's `open`, then Linux's `xdg-open`.
export function folderOpeners(path: string): string[][] {
  if (!/^[a-zA-Z]:|\\/.test(path)) return [['open', path], ['xdg-open', path]]
  const windowsPath = path.replace(/\//g, '\\')
  return [['cmd', '/c', 'start', '""', windowsPath], ['explorer.exe', windowsPath]]
}

// Opens changes-drill's Changes pane: a mod opens only its own panes, so it
// is asked through the noun it adds to `$`, missing when it is not loaded.
async function openChanges($: EngineInterface) {
  try {
    const opened = await $.changesDrill.open()
    if (!opened.isPlaced) $.ui.toast(`Changes pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Install changes-drill for the Changes pane')
  }
}

// Opens context-drill's Context pane: a mod opens only its own panes, so it
// is asked through the noun it adds to `$`, missing when it is not loaded.
async function openContext($: EngineInterface) {
  try {
    const opened = await $.contextDrill.open()
    if (!opened.isPlaced) $.ui.toast(`Context pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Install context-drill for the Context pane')
  }
}

// Opens usage-drill's Usage pane, as openContext does context-drill's.
async function openUsage($: EngineInterface) {
  try {
    const opened = await $.usageDrill.open()
    if (!opened.isPlaced) $.ui.toast(`Usage pane waits: ${opened.reason ?? 'not placed'}`)
  } catch {
    $.ui.toast('Install usage-drill for the Usage pane')
  }
}

async function nextSlot($: EngineInterface) {
  slot = SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length] ?? 'rate'
  try {
    await $.store.set('slot', slot)
  } catch {
    // Kept for this session only.
  }
  if (data !== null) data = { ...data, slot }
  await paint($)
}

async function readSlot($: EngineInterface): Promise<Slot> {
  try {
    const kept = await $.store.get('slot')
    return SLOTS.includes(kept as Slot) ? (kept as Slot) : 'rate'
  } catch {
    return 'rate'
  }
}

type Limit = Data['limits'][number]

// After each reading of the limits: toasts once when a limit turns orange
// (running ahead of its window) or red. The first reading after a load only sets the colors.
async function noteLimits($: EngineInterface, limits: Limit[]) {
  const now = await $.clock.now()
  for (const l of limits) {
    if (l.resetsAt === null) continue
    const pace = elapsedShare(l.resetsAt, l.windowMs, now)
    const color = limitLevel(l.percent, pace)
    const before = limitColors.get(l.label)
    limitColors.set(l.label, color)
    const rank = LEVEL_RANK[color] ?? 0
    if (before !== undefined && rank > (LEVEL_RANK[before] ?? 0) && rank >= 2) {
      $.ui.toast(limitToast(l, pace, color, now), { timeoutMs: 8_000 })
    }
  }
}

const LEVEL_RANK: Record<string, number> = { success: 0, warning: 1, '#ff8700': 2, error: 3 }

export function limitToast(l: Limit, pace: number | null, color: string, now: number) {
  if (color === 'error') return `${l.label} limit at ${l.percent}%${l.resetsAt === null ? '' : `, resets in ${resetIn(l.resetsAt - now)}`}`
  const ahead = pace === null ? 0 : Math.round(l.percent - pace * 100)
  return `${l.label} limit is ${ahead} points ahead of its window: ${projection(l.percent, pace, l.windowMs)}`
}

// The desktop's bar: ten blocks of ten small squares, SQ_COLS wide and
// SQ_ROWS tall, each block a tenth of the bar on a track of its own, one
// square a point, lit block by block from the left and each block from its
// bottom row up, left then right, each square a step brighter than the one
// lit before it (RAMP_FROM). A tick stands exactly where `share` (0-1)
// falls, measured along the blocks' tracks, the gaps left out. An image has no theme keys: the
// colors are the desktop's, the track and tick following its light or dark
// scheme.
export function squaresSvg(points: number, color: string, share: number | null): string {
  const lit = Math.min(100, Math.max(0, Math.round(points)))
  const fill = SVG_COLORS[color] ?? color
  const blockX = (block: number) => 1 + block * SQ_STRIDE
  const tracks: string[] = []
  const squares: string[] = []
  for (let block = 0; block < 10; block++) {
    tracks.push(`<rect x="${blockX(block) - 1}" y="0" width="${SQ_TRACK}" height="${SQ_H}" rx="1.5"/>`)
  }
  for (let i = 0; i < lit; i++) {
    const block = Math.floor(i / 10)
    const col = i % SQ_COLS
    const row = SQ_ROWS - 1 - Math.floor((i % 10) / SQ_COLS)
    const opacity = (RAMP_FROM + ((1 - RAMP_FROM) * (i + 1)) / lit).toFixed(3)
    squares.push(`<rect x="${blockX(block) + col * SQ_PITCH}" y="${1 + row * SQ_PITCH}" width="2" height="2" opacity="${opacity}"/>`)
  }
  let tick = ''
  if (share !== null) {
    // The share in points, placed along its block's track; 100 is the bar's end.
    const at = Math.min(100, Math.max(0, share * 100))
    const block = Math.min(9, Math.floor(at / 10))
    const center = blockX(block) - 1 + ((at - block * 10) / 10) * SQ_TRACK
    const x = Math.min(SQ_W - 1.5, Math.max(0, center - 0.75))
    tick = `<rect class="tk" x="${Math.round(x * 100) / 100}" y="0" width="1.5" height="${SQ_H}" rx="0.75"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SQ_W}" height="${SQ_H}" viewBox="0 0 ${SQ_W} ${SQ_H}">
<style>.k{fill:#e4e4e2}.tk{fill:#1f1f1f}@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.tk{fill:#ececec}}</style>
<g class="k">${tracks.join('')}</g>
<g fill="${fill}">${squares.join('')}</g>${tick}
</svg>`
}

const SQ_COLS = 2
const SQ_ROWS = 5
const SQ_PITCH = 3
// The space between two blocks' tracks, and from one block's start to the next.
const SQ_GAP = 2
// A block's track, from its left edge to its right.
const SQ_TRACK = SQ_COLS * SQ_PITCH + 1
const SQ_STRIDE = SQ_TRACK + SQ_GAP
const SQ_W = 10 * SQ_STRIDE - SQ_GAP
const SQ_H = SQ_ROWS * SQ_PITCH + 1
const SVG_COLORS: Record<string, string> = { success: '#4eba65', warning: '#e5b84b', error: '#ef5350', suggestion: '#6a9ef5', merged: '#a371f7', subtle: '#8a8a8a' }

// The strength of the bar's first square; each square after it, in the
// order they light, across the blocks, is a step brighter, the newest at full.
const RAMP_FROM = 0.45

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
  if (r.kind === 'waiting') return [<Text color="subtle">waiting {Math.floor(r.ms / 1_000)}s</Text>]
  const n = Math.round(r.perSec)
  if (r.kind === 'live') return [<Text color="subtle">@</Text>, <Text color="warning">~{n}</Text>, <Text color="subtle">/s</Text>]
  return [<Text color="subtle">@</Text>, <Text>{n}</Text>, <Text color="subtle">/s</Text>]
}

// A bar of braille cells, CELL_POINTS points to a cell: a cell's dots fill
// from the bottom row up in `color` as its points come, an empty cell is a
// subtle track of its bottom two dots, and a `|` tick (the theme's text
// color: white on a dark theme) stands before cell `mark`, or after the last
// when `mark` is the cell count. Braille, not blocks or box-drawing: a desktop
// draws the band in a proportional font, where spaces on a background come
// out as tall slabs and box-drawing lines join into one long rule. The tick
// sits between two cells, never on one, so the cells past it stay drawn. No
// tick when `mark` is null.
function meter(Text: any, dots: number[], color: string, mark: number | null) {
  // One Text per run of one color, the tick its own.
  const runs: { color: string; text: string }[] = []
  const add = (text: string, runColor: string) => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === runColor) last.text += text
    else runs.push({ color: runColor, text })
  }
  dots.forEach((n, i) => {
    if (i === mark) runs.push({ color: 'text', text: '|' })
    if (n === 0) add(TRACK, 'subtle')
    else add(braille(n), color)
  })
  if (mark === dots.length) runs.push({ color: 'text', text: '|' })
  return runs.map(r => (
    <Text color={r.color} bold={r.text === '|'}>
      {r.text}
    </Text>
  ))
}

const CELL_POINTS = 10
// A braille cell's dots in the order they fill: the bottom row left then
// right, then each row above.
const DOT_BITS = [0x40, 0x80, 0x04, 0x20, 0x02, 0x10, 0x01, 0x08]

// The braille character with a cell's first `n` dots raised.
export function braille(n: number) {
  return String.fromCharCode(0x2800 + DOT_BITS.slice(0, n).reduce((bits, bit) => bits | bit, 0))
}

const TRACK = braille(2)

// The dots each cell of a 0-100 bar holds, `cellPoints` points to a cell:
// its points spread over its 8 dots, and at least one for any point.
export function cellDots(points: number, cellPoints = CELL_POINTS): number[] {
  const p = Math.min(100, Math.max(0, Math.round(points)))
  return Array.from({ length: Math.ceil(100 / cellPoints) }, (_, i) => {
    const inCell = Math.min(cellPoints, Math.max(0, p - i * cellPoints))
    return inCell === 0 ? 0 : Math.max(1, Math.round((inCell * DOT_BITS.length) / cellPoints))
  })
}

const CELLS = 100 / CELL_POINTS

// Where auto-compact fires, as a share of the window; null when it is off.
export function compactShare(compactAt: number | null, window: number) {
  return compactAt === null || window <= 0 ? null : Math.min(1, compactAt / window)
}

// Before which cell the auto-compact tick goes, null when auto-compact is
// off: never after the last, so a threshold short of the window's end shows
// room past it.
export function compactMark(compactAt: number | null, window: number) {
  if (compactAt === null || window <= 0) return null
  return Math.min(CELLS - 1, Math.max(0, Math.round((compactAt / window) * CELLS)))
}

// Before which cell the tick where a limit's window stands goes, the end
// included: dots past it mean the limit is going faster than the window.
export function paceMark(elapsed: number | null) {
  return elapsed === null ? null : Math.min(CELLS, Math.max(0, Math.round(elapsed * CELLS)))
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

// The share of a rate-limit window gone by: 0 as it opens, 1 as it resets.
export function elapsedShare(resetsAt: number, windowMs: number | null, now: number): number | null {
  if (windowMs === null) return null
  return Math.min(1, Math.max(0, 1 - (resetsAt - now) / windowMs))
}

// Red from 80%. Short of that, orange when the limit runs PACE_MARGIN points
// or more ahead of the window's time, yellow from 60%, green below.
export function limitLevel(percent: number, elapsed: number | null) {
  if (percent >= 80) return 'error'
  if (elapsed !== null && percent - elapsed * 100 >= PACE_MARGIN) return ORANGE
  if (percent >= 60) return 'warning'
  return 'success'
}

const PACE_MARGIN = 10

// `2h45m`, `45m`, and from a day on `1d20h`.
export function resetIn(ms: number) {
  if (ms <= 0) return 'now'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d${h}h`
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
