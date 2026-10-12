// cache-warmer: keeps the prompt cache warm while you are away.
//
//   above the prompt, under ✦ enhance:   [ 🔥 42m ↻2 ]
//
// One button: 🔥 while keep-warm is on, ❄ while it is off, then how long the
// main conversation's prompt cache stays warm: the cache's TTL from the last
// request that read or wrote it, a main-session step or any mod's fork, since
// each read restarts the TTL. `cold` once it ran out, after a model switch, a
// compaction or a /clear; `--` before the first reply. `↻n` counts the pings
// since your last turn, `↻…` while one is out.
//
// Pressing it turns keep-warm on or off for the session. While on, and no turn
// runs, once the cache has `leadMinutes` left a ping re-reads it: one fork of
// the conversation ($.model.fork) asking for a one-word reply. The fork sends
// the main thread's last request again with the ping after it, so the API
// serves the whole prefix from the cache and restarts its TTL; it is never
// added to the conversation, and its tools are denied. Each ping costs a
// cache read of the context (a tenth of the input price; on a subscription,
// a little of the rate-limit windows) and a few output tokens, where letting
// the cache lapse bills the whole context again as a cache write on your
// next prompt. A cold cache is never pinged: that would be the full write
// for nothing. Pinging stops `maxIdleHours` after your last turn, and starts
// again with the next.
//
// The engine says the TTL only when the model switches (PostModelSwitch's
// `cache_ttl`). `cacheTtl` sets it; under `auto` the engine's word wins, then
// a fork that found the cache already lapsed (it read nothing and wrote the
// prefix afresh) reads it as 5 minutes, and before either a subscription
// (rate limits reported) is read as 1 hour and anything else as 5 minutes.
//
// The band's chips stack in one column at its right, ✦ enhance on top and
// this one under it, whatever order the hooks on the band run in (withChip).
// Under a survey nothing is drawn, so its number keys are the only ones.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Hit } from '../types'

const TICK_MS = 15_000
const HOUR_MS = 3_600_000
const MAX_IDLE_HOURS = 4
const PING =
  'Automated cache keep-alive, not a task: do not think, use tools or continue any work. Reply with exactly one word: ok'

const isOn = atom({ plugin: 'cache-warmer', key: 'isOn' } as const, false)
const hit = atom({ plugin: 'cache-warmer', key: 'hit' } as const, null as Hit | null)
const pings = atom({ plugin: 'cache-warmer', key: 'pings' } as const, 0)
const isPinging = atom({ plugin: 'cache-warmer', key: 'isPinging' } as const, false)

let settings = { leadMs: 3 * 60_000, maxIdleMs: MAX_IDLE_HOURS * HOUR_MS, ttl: 'auto' as 'auto' | '5m' | '1h' }
// Whether a main-session turn runs, and when the last one ended: the
// module's own, so a reload reads the session as idle from then.
let isBusy = false
// The TTL the engine said, or a lapsed fork showed; null before either.
let learnedTtl: '5m' | '1h' | null = null
let idleSince = 0
let isTicking = false

export const register: Register = (on, options) => {
  const lead = Number(options.leadMinutes ?? 3)
  const idle = Number(options.maxIdleHours ?? MAX_IDLE_HOURS)
  settings = {
    leadMs: (Number.isFinite(lead) && lead > 0 ? lead : 3) * 60_000,
    maxIdleMs: (Number.isFinite(idle) && idle > 0 ? idle : MAX_IDLE_HOURS) * HOUR_MS,
    ttl: options.cacheTtl === '5m' || options.cacheTtl === '1h' ? options.cacheTtl : 'auto',
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startTicking($)
    // A ping that was out when the session or the mod restarted is gone.
    await update($, isPinging, () => false)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isBusy = false
      idleSince = await $.clock.now()
      await update($, pings, () => 0)
    }
    return result
  })

  // Main-session requests share the conversation's prefix; a subagent's
  // has a prefix of its own.
  // Busy from a main step's start to the turn's end, tool calls between.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) isBusy = true
    const result = yield* next(e)
    if (e.agentId === undefined && isCacheHit(result.usage)) await markHit($)
    return result
  })

  // Any fork re-sends the main thread's last request: one that read the
  // cache restarted its TTL (prompt-enhancer's Expanded, these pings).
  on('model.fork', async ($, e, next) => {
    const forked = await next(e)
    const reply = 'value' in forked ? forked.value : null
    if (reply?.isAnswered) await afterFork($, reply.usage)
    return forked
  }).catch(($, e, next) => next(e))

  // The one place the engine says the TTL. A switch forfeits the cache.
  on('classic.PostModelSwitch', async ($, e, next) => {
    learnedTtl = e.cache_ttl
    await markCold($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A compaction rewrites the conversation and a /clear starts a new one:
  // nothing of the old prefix is read again. A precompute installs nothing.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.messages !== undefined) await markCold($)
    return compacted
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await markCold($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The chip, in the band's chip column: the one button, its label plain
  // text, as a desktop draws a Button as a native button of its label.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await startTicking($)
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const warmth = warmthOf(await read($, hit), await $.clock.now(), settings.leadMs)
    const label = chipLabel(await read($, isOn), warmth, await read($, pings), await read($, isPinging))
    const chip = (
      <Box flexDirection="row" justifyContent="flex-end" paddingX={1}>
        <Button key="keep-warm" plain label={label} onPress={() => void toggle($)} />
      </Box>
    )
    return withChip(Box, below, chip, 'cache-warmer', false)
  })
}

// `🔥 42m ↻2` while on, `❄ 42m` while off: the time left, `cold` or `--`,
// then the pings since your last turn, `↻…` while one is out.
export function chipLabel(isOn: boolean, warmth: ReturnType<typeof warmthOf>, pings: number, isPinging: boolean) {
  const left = warmth.kind === 'warm' ? warmth.label : warmth.kind === 'cold' ? 'cold' : '--'
  const count = isPinging ? ' ↻…' : pings > 0 ? ` ↻${pings}` : ''
  return `${isOn ? '🔥' : '❄'} ${left}${count}`
}

// How warm the cache is at `now`: unknown before the first reply, cold, or
// the time left, `isLow` within the ping lead.
export function warmthOf(h: Hit | null, now: number, leadMs: number) {
  if (h === null) return { kind: 'none' } as const
  const left = h.at === null ? 0 : h.at + h.ttlMs - now
  if (left <= 0) return { kind: 'cold' } as const
  return { kind: 'warm', left, isLow: left <= leadMs, label: left < 60_000 ? '<1m' : duration(left) } as const
}

// Whether a ping is due: keep-warm on, no turn running, none out, the cache
// warm and within the lead, and your last turn recent enough.
export function isPingDue(s: { isOn: boolean; isBusy: boolean; isPinging: boolean; hit: Hit | null; idleSince: number }, now: number, leadMs: number, maxIdleMs: number) {
  if (!s.isOn || s.isBusy || s.isPinging) return false
  const w = warmthOf(s.hit, now, leadMs)
  return w.kind === 'warm' && w.isLow && now - s.idleSince < maxIdleMs
}

// A request that read the cache, or wrote it, holds the prefix warm; one
// with both zero cached nothing (caching off, a prompt under the minimum).
export function isCacheHit(usage: Pick<ModelUsage, 'cache_read_input_tokens' | 'cache_creation_input_tokens'> | null | undefined) {
  return usage != null && usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0
}

// The cache's TTL: as set; under `auto` as the engine said or a lapsed fork
// showed, else an hour on a subscription (the one session that reports rate
// limits) and five minutes on anything else.
export function ttlMs(setting: 'auto' | '5m' | '1h', learned: '5m' | '1h' | null, isSubscription: boolean) {
  const ttl = setting !== 'auto' ? setting : (learned ?? (isSubscription ? '1h' : '5m'))
  return ttl === '1h' ? HOUR_MS : 5 * 60_000
}

// A fork re-sends the main thread's last request: one that read the cache
// restarted its TTL. One that read nothing and wrote the prefix afresh while
// the countdown said warm found it lapsed early: the TTL is read as 5 minutes
// from then, unless `cacheTtl` sets it.
async function afterFork($: EngineInterface, usage: ModelUsage) {
  const h = await read($, hit)
  const isLapsed = usage.cache_read_input_tokens === 0 && usage.cache_creation_input_tokens > 0
  if (isLapsed && settings.ttl === 'auto' && learnedTtl !== '5m' && warmthOf(h, await $.clock.now(), 0).kind === 'warm' && h?.ttlMs === HOUR_MS) {
    learnedTtl = '5m'
    $.ui.toast('cache-warmer: the cache had lapsed before the hour; reading its TTL as 5 minutes from now (the cacheTtl option sets it).')
  }
  if (isCacheHit(usage)) await markHit($)
}

async function markHit($: EngineInterface) {
  const usage = await $.session.usage()
  const value: Hit = { at: await $.clock.now(), model: await $.session.model(), ttlMs: ttlMs(settings.ttl, learnedTtl, usage.rateLimits.length > 0) }
  await update($, hit, () => value)
}

// Known cold: drawn `cold` until a request reads or writes the cache again.
async function markCold($: EngineInterface) {
  const h = await read($, hit)
  if (h === null) return
  const model = await $.session.model()
  await update($, hit, () => ({ ...h, at: null, model }))
}

async function startTicking($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  idleSince = await $.clock.now()
  $.clock.every(TICK_MS, () => void tick($))
}

// Each tick redraws the countdown, leaves the cache cold after a model
// switch, and pings when one is due.
async function tick($: EngineInterface) {
  const h = await read($, hit)
  if (h === null) return
  const model = await $.session.model()
  if (h.at !== null && h.model !== model) await update($, hit, () => ({ ...h, at: null, model }))
  $.ui.invalidate('ui.render')
  const state = { isOn: await read($, isOn), isBusy, isPinging: await read($, isPinging), hit: await read($, hit), idleSince }
  if (isPingDue(state, await $.clock.now(), settings.leadMs, settings.maxIdleMs)) await ping($)
}

async function ping($: EngineInterface) {
  await update($, isPinging, () => true)
  try {
    const reply = await $.model.fork({ prompt: PING })
    if (reply.isAnswered) {
      // This mod's own model.fork hook may not run for its own call.
      await afterFork($, reply.usage)
      await update($, pings, n => (n ?? 0) + 1)
      const u = reply.usage
      $.ui.log(`ping: ${u.cache_read_input_tokens} read from the cache, ${u.cache_creation_input_tokens} written, ${u.input_tokens} uncached, ${u.output_tokens} out`, { to: 'debug' })
    } else if (reply.reason === 'nothing-to-fork') {
      await markCold($)
    } else {
      $.ui.toast(`cache-warmer: the ping failed (${reply.reason === 'api-error' ? `API error ${reply.status ?? ''}`.trim() : reply.reason}); it tries again on the next tick.`)
    }
  } finally {
    await update($, isPinging, () => false)
  }
}

async function toggle($: EngineInterface) {
  const next = !(await read($, isOn))
  await update($, isOn, () => next)
  if (!next) return
  const lead = Math.round(settings.leadMs / 60_000)
  const hours = Math.round((settings.maxIdleMs / HOUR_MS) * 10) / 10
  const w = warmthOf(await read($, hit), await $.clock.now(), settings.leadMs)
  const when = w.kind === 'warm' ? '' : ' It starts once a reply has warmed the cache.'
  $.ui.toast(`Keeping the cache warm: a one-word ping ${lead} min before it expires, while idle, for up to ${hours}h after your last turn. Press again to stop.${when}`)
}

// The band's chips stack in one column at its right. The hooks on the band
// run in an order no mod picks, so each chip mod finds the column wherever it
// is: the root of what the plugins beneath drew when that is keyed
// `band-beside:`, else a `band-beside:` Box inside it (motta-statusline draws
// one at the right of its lines). The column is rebuilt keyed for this mod
// with the chip first (`isFirst`) or last. With no column yet, the chip
// starts one, beside their tree; a tree that shares the band from under the
// status line (`band-under:`) keeps sharing it.
export function withChip(Box: any, below: unknown, chip: unknown, mod: string, isFirst: boolean) {
  const column = (inner: unknown[]) => (
    <Box key={`band-beside:${mod}`} flexDirection="column" alignItems="flex-end">
      {isFirst ? [chip, ...inner] : [...inner, chip]}
    </Box>
  )
  if (isFree(below)) return column([])
  const swapped = swapBeside(below, beside => column([beside]))
  if (swapped !== undefined) return swapped
  const belowKey = (below as { props?: { key?: unknown } }).props?.key
  const isUnder = typeof belowKey === 'string' && belowKey.startsWith('band-under:')
  return (
    <Box {...(isUnder ? { key: `band-under:${mod}` } : {})} flexDirection="row" alignItems="flex-start">
      <Box flexDirection="column" flexGrow={1}>
        {below}
      </Box>
      {column([])}
    </Box>
  )
}

type Node = { type?: unknown; props?: { key?: unknown }; children?: unknown[] }

// The tree with its outermost `band-beside:` Box swapped for `swap`'s, or
// undefined when it holds none.
function swapBeside(node: unknown, swap: (beside: unknown) => unknown, depth = 0): unknown {
  if (node === null || typeof node !== 'object' || depth > 8) return undefined
  const el = node as Node
  if (el.type !== 'Box') return undefined
  if (typeof el.props?.key === 'string' && el.props.key.startsWith('band-beside:')) return swap(node)
  const children = el.children ?? []
  for (let i = 0; i < children.length; i++) {
    const swapped = swapBeside(children[i], swap, depth + 1)
    if (swapped !== undefined) return { ...el, children: children.map((c, j) => (j === i ? swapped : c)) }
  }
  return undefined
}

// What `next(e)` hands back when no plugin beneath drew in the band: the
// engine's own band as an opaque reference, or nothing.
function isFree(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === '') return true
  return typeof node === 'object' && (node as { type?: unknown }).type === 'engine'
}

function duration(ms: number) {
  const h = Math.floor(ms / HOUR_MS)
  const m = Math.floor((ms % HOUR_MS) / 60_000)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}
