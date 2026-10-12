import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepChunk } from 'claude-code'

import type { Shown } from '../types'

// The spinner line says what Claude is doing, in plain words and a symbol,
// from what the engine already reports: the tool calls (classified by the
// shape of their input, so a tool added later still reads right), the
// response as it streams (thinking, the answer, a tool call's arguments) and
// the spinner's own mode as the last resort. No model calls; anything it does
// not understand leaves the engine's line as it was.

const shown = atom({ plugin: 'emotive-spinner', key: 'shown' } as const, {} as Record<string, Shown>)

// One thing a loop is doing: drawn `<icon> <verb> <object>`, with `detail`
// after the ellipsis. `noun` names it when several of a kind are grouped.
export type Activity = { icon: string; verb: string; object: string; noun: string; detail?: string }

// One emoji per kind of work. An emoji is two columns wide in a terminal;
// the ones that need a variation selector (✏️) carry it.
export const ICONS = {
  waiting: '⏳',
  thinking: '💭',
  answer: '💬',
  read: '📖',
  write: '📝',
  edit: '✏️',
  search: '🔍',
  shell: '💻',
  git: '🌿',
  web: '🌐',
  agent: '🤖',
  service: '🔌',
  plan: '📋',
  skill: '🧩',
  ask: '❓',
  other: '🔧',
} as const

const WAITING: Activity = { icon: ICONS.waiting, verb: 'Waiting for', object: 'the model', noun: 'wait' }
const THINKING: Activity = { icon: ICONS.thinking, verb: '', object: 'Thinking', noun: 'thinking' }
const ANSWERING: Activity = { icon: ICONS.answer, verb: 'Writing', object: 'the answer', noun: 'answer' }

// What the spinner's mode alone says, when no event has said more.
const BY_MODE: Record<string, Activity> = {
  requesting: WAITING,
  thinking: THINKING,
  responding: ANSWERING,
  'tool-input': { icon: ICONS.other, verb: 'Preparing', object: 'a tool call', noun: 'step' },
  'tool-use': { icon: ICONS.other, verb: 'Running', object: 'a tool', noun: 'step' },
}

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const lineCount = (s: string) => (s === '' ? 0 : s.split('\n').length)

export const textOf = (a: Activity) => (a.verb ? `${a.verb} ${a.object}` : a.object)

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return bytes < 10 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes / 1024)} KB`
}

// The last two parts of a path: enough to tell the file, short enough to fit.
export function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return clip(parts.slice(-2).join('/') || p)
}

// `WebFetch` → `Web fetch`, `send_message` → `Send message`.
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// `mcp__<server>__<tool>`: the server as a person would name it (a plugin's
// server by its own name, a connector's id left out) and the tool in words.
export function mcpParts(tool: string): { server?: string; action: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!m?.[1] || !m[2]) return null
  let server: string | undefined = m[1]
  if (server.startsWith('plugin_')) server = server.split('_').pop()
  if (server === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(server)) server = undefined
  let action = m[2]
  if (server !== undefined) {
    const prefix = `${server.replace(/-/g, '_')}_`
    if (action.toLowerCase().startsWith(prefix.toLowerCase())) action = action.slice(prefix.length)
  }
  return { server, action: humanize(action).toLowerCase() }
}

// A string argument still arriving: how many lines and bytes of it so far.
export type Live = { key: string; lines: number; bytes: number }

// One tool call in words, by what its input holds rather than by its name:
// a path is file work, a command a shell, a URL the web, a pattern a search.
export function describeCall(tool: string, input: Readonly<Record<string, unknown>>, live?: Live): Activity {
  const a = byShape(tool, input, live)
  const mcp = mcpParts(tool)
  if (mcp?.server && a.noun !== 'call' && a.detail === undefined) a.detail = mcp.server
  return a
}

function byShape(tool: string, input: Readonly<Record<string, unknown>>, live?: Live): Activity {
  const has = (k: string) => input[k] !== undefined
  const description = str(input.description)

  if (has('questions')) return { icon: ICONS.ask, verb: 'Waiting for', object: 'your answer', noun: 'question' }

  if (has('todos')) {
    const todos = Array.isArray(input.todos) ? (input.todos as { status?: unknown }[]) : []
    const done = todos.filter(t => t?.status === 'completed').length
    return {
      icon: ICONS.plan,
      verb: 'Updating',
      object: 'the plan',
      noun: 'plan',
      detail: todos.length > 0 ? `${done}/${todos.length} done` : undefined,
    }
  }
  if (has('taskId') || has('activeForm')) return { icon: ICONS.plan, verb: 'Updating', object: 'the task list', noun: 'task' }

  const command = str(input.command)
  if (command) {
    const isGit = /^\s*(git|gh)\b/.test(command)
    return { icon: isGit ? ICONS.git : ICONS.shell, verb: '', object: clip(oneLine(description ?? command)), noun: 'command' }
  }

  const agentType = str(input.subagent_type)
  if (agentType || (has('prompt') && description)) {
    return { icon: ICONS.agent, verb: '', object: clip(oneLine(description ?? humanize(agentType!))), noun: 'agent', detail: agentType }
  }

  const url = str(input.url)
  if (url) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(url)
    const where = m?.[1] ? m[1] + (m[2] === '/' ? '' : (m[2] ?? '')) : url
    return { icon: ICONS.web, verb: 'Fetching', object: clip(where), noun: 'page' }
  }

  const pattern = str(input.pattern)
  const query = str(input.query)
  if (pattern || query) {
    const where = str(input.path) ?? str(input.glob)
    const inWhere = where ? ` in ${shortPath(where)}` : ''
    const isGlob =
      pattern !== undefined && (/glob|find/i.test(tool) || (!/grep|search/i.test(tool) && /\*\*|^\*\.|\//.test(pattern)))
    if (isGlob) return { icon: ICONS.search, verb: 'Finding', object: clip(pattern) + inWhere, noun: 'search' }
    const what = `"${clip(oneLine((pattern ?? query)!), 32)}"`
    return {
      icon: ICONS.search,
      verb: 'Searching',
      object: (/web/i.test(tool) ? `the web for ${what}` : what) + inWhere,
      noun: 'search',
    }
  }

  const path = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path)
  if (path) {
    const name = shortPath(path)
    const so = live ? ' so far' : ''
    const content = input.content ?? input.new_source
    if (typeof content === 'string' || live?.key === 'content' || live?.key === 'new_source') {
      const lines = live ? live.lines : lineCount(content as string)
      const bytes = live ? live.bytes : (content as string).length
      const kb = bytes >= 1024 ? `, ${size(bytes)}` : ''
      return { icon: ICONS.write, verb: 'Writing', object: name, noun: 'file', detail: `${plural(lines, 'line')}${kb}${so}` }
    }
    if (has('old_string') || has('new_string') || has('edits') || /edit|replace|patch/i.test(tool)) {
      const edits = Array.isArray(input.edits) ? input.edits.length : 0
      const before = typeof input.old_string === 'string' ? lineCount(input.old_string) : undefined
      const after = typeof input.new_string === 'string' ? lineCount(input.new_string) : undefined
      const detail =
        edits > 1
          ? `${edits} edits`
          : live
            ? `${plural(live.lines, 'line')}${so}`
            : before !== undefined && after !== undefined
              ? `−${before} +${after} lines`
              : undefined
      return { icon: ICONS.edit, verb: 'Editing', object: name, noun: 'file', detail }
    }
    const offset = num(input.offset)
    const limit = num(input.limit)
    const pages = str(input.pages)
    const from = offset ?? 1
    const detail = limit ? `lines ${from}–${from + limit - 1}` : offset ? `from line ${offset}` : pages ? `pages ${pages}` : undefined
    return { icon: ICONS.read, verb: 'Reading', object: name, noun: 'file', detail }
  }

  const skill = str(input.skill)
  if (skill) return { icon: ICONS.skill, verb: 'Using', object: `the ${clip(skill, 32)} skill`, noun: 'skill' }

  const mcp = mcpParts(tool)
  if (mcp) return { icon: ICONS.service, verb: '', object: clip(mcp.server ? `${mcp.server}: ${mcp.action}` : humanize(mcp.action)), noun: 'call' }

  return { icon: ICONS.other, verb: '', object: clip(humanize(tool)), noun: 'step' }
}

// Calls in flight at once: one as itself, several of a kind as a count with
// their names, a mix as the newest, the one the model wrote last (the one
// the desktop's own words follow; the others wait their turn or run on).
export function summarize(list: readonly Activity[]): Activity | undefined {
  const [first] = list
  const newest = list[list.length - 1]
  if (first === undefined || newest === undefined || list.length === 1) return first
  if (list.every(a => a.noun === first.noun && a.icon === first.icon && a.verb === first.verb)) {
    return {
      icon: first.icon,
      verb: first.verb || 'Running',
      object: plural(list.length, first.noun),
      noun: first.noun,
      detail: clip(list.map(a => a.object).join(', '), 60),
    }
  }
  return newest
}

// Reads a tool call's JSON arguments as they stream, one piece at a time:
// the top-level fields once complete (strings cut at 300 characters, numbers,
// `true` for an object or array), and the string still arriving as a count.
export class Scanner {
  fields: Record<string, unknown> = {}
  private depth = 0
  private inString = false
  private escape = false
  private isKey = false
  private afterColon = false
  private key: string | null = null
  private buf = ''
  private scalar = ''
  private last: Live | null = null

  feed(piece: string): void {
    for (const ch of piece) this.step(ch)
  }

  live(): Live | undefined {
    return this.last !== null && this.last.bytes > 0 ? { ...this.last } : undefined
  }

  private step(ch: string): void {
    const top = this.depth === 1
    if (this.inString) {
      if (this.escape) {
        this.escape = false
        if (top) this.char(ch === 'n' ? '\n' : ch === 't' ? '\t' : ch)
      } else if (ch === '\\') this.escape = true
      else if (ch === '"') {
        this.inString = false
        if (top) this.closeString()
      } else if (top) this.char(ch)
      return
    }
    switch (ch) {
      case '"':
        this.inString = true
        if (top) {
          this.isKey = !this.afterColon
          this.buf = ''
          if (!this.isKey && this.key !== null) {
            this.fields[this.key] = true
            this.last = { key: this.key, lines: 1, bytes: 0 }
          }
        }
        return
      case ':':
        if (top) this.afterColon = true
        return
      case ',':
        if (top) this.endValue()
        return
      case '{':
      case '[':
        if (top && this.afterColon && this.key !== null) this.fields[this.key] = true
        this.depth += 1
        return
      case '}':
      case ']':
        if (top) this.endValue()
        this.depth -= 1
        return
      default:
        if (top && this.afterColon && !/\s/.test(ch)) this.scalar += ch
    }
  }

  private char(c: string): void {
    if (this.isKey) {
      this.buf += c
      return
    }
    if (this.last !== null) {
      this.last.bytes += 1
      if (c === '\n') this.last.lines += 1
    }
    if (this.buf.length < 300) this.buf += c
  }

  private closeString(): void {
    if (this.isKey) this.key = this.buf
    else if (this.key !== null) this.fields[this.key] = this.buf
  }

  private endValue(): void {
    if (this.key !== null && this.scalar !== '') {
      const n = Number(this.scalar)
      this.fields[this.key] =
        this.scalar === 'true' ? true : this.scalar === 'false' ? false : Number.isFinite(n) ? n : undefined
    }
    this.scalar = ''
    this.afterColon = false
    this.key = null
  }
}

// What the line shows for one loop, from its calls in flight, else its phase.
export function shownFor(
  calls: readonly Activity[],
  phase: Activity | null,
  plan: string | null,
  inside?: string,
): Shown | undefined {
  const call = summarize(calls)
  const a = call ?? phase
  if (!a) return undefined
  let detail = a.detail
  // Agents running: what the latest of them is doing says more than its type.
  if (a.noun === 'agent' && inside) detail = inside
  if (plan) detail = detail ? `${detail} · ${ICONS.plan} ${plan}` : `${ICONS.plan} ${plan}`
  const s: Shown = { icon: a.icon, text: textOf(a), isCall: call !== undefined }
  return detail ? { ...s, detail } : s
}

// The props the engine's spinner is drawn with: the words (animated) carry
// the symbol, held to the line's room. The terminal draws the detail after
// the ellipsis; the desktop draws no suffix, so there it joins the words.
export function spinnerWords(
  s: Shown,
  suffix: string,
  columns?: number,
  isInline = false,
): { word: string; suffix: string } {
  const room = columns !== undefined ? Math.max(24, columns - 40) : 120
  const word = clip(`${s.icon} ${s.text}`, room)
  const left = room - word.length - 3
  const detail = s.detail && left >= 8 ? ` · ${clip(s.detail, left)}` : ''
  if (isInline) return { word: word + detail, suffix }
  return { word, suffix: (word.endsWith('…') ? '' : suffix) + detail }
}

type Stream = { id: string; name: string; scanner: Scanner }
type Loop = { calls: Map<string, Activity>; streams: Map<number, Stream>; started: Set<string>; phase: Activity | null }

// The module's own memory of each loop; a reload starts it over, and the
// line follows from the next event.
const loops = new Map<string, Loop>()
const published = new Map<string, string>()
let plan: string | null = null
let planTask: string | null = null
const tasks = new Map<string, string>()
let inside: string | undefined
let seq = 0

function loopOf(agentId: string | undefined): [string, Loop] {
  const key = agentId ?? 'main'
  let loop = loops.get(key)
  if (!loop) {
    loop = { calls: new Map(), streams: new Map(), started: new Set(), phase: null }
    loops.set(key, loop)
  }
  return [key, loop]
}

async function publish($: EngineInterface, key: string): Promise<void> {
  const loop = loops.get(key)
  const isMain = key === 'main'
  const next = loop
    ? shownFor([...loop.calls.values()], loop.phase, isMain ? plan : null, isMain ? inside : undefined)
    : undefined
  const json = JSON.stringify(next ?? null)
  if (published.get(key) !== json) {
    published.set(key, json)
    await update($, shown, all => {
      const copy = { ...all }
      if (next) copy[key] = next
      else delete copy[key]
      return copy
    })
  }
  // A subagent's step shows on the main line while its agent runs.
  if (!isMain) {
    inside = next ? `${next.icon} ${next.text}` : undefined
    await publish($, 'main')
  }
}

function clear(loop: Loop) {
  loop.calls.clear()
  loop.streams.clear()
  loop.started.clear()
}

async function reset($: EngineInterface, agentId: string | undefined, phase: Activity | null) {
  const [key, loop] = loopOf(agentId)
  clear(loop)
  loop.phase = phase
  if (phase === null && key !== 'main') loops.delete(key)
  await publish($, key)
}

// The plan's current step, from a todo list or a task marked in progress.
function notePlan(input: Readonly<Record<string, unknown>>) {
  if (Array.isArray(input.todos)) {
    const current = (input.todos as { status?: unknown; activeForm?: unknown; content?: unknown }[]).find(
      t => t?.status === 'in_progress',
    )
    plan = current ? (str(current.activeForm) ?? str(current.content) ?? null) : null
    planTask = null
    return
  }
  const id = str(input.taskId)
  if (id === undefined) return
  if (input.status === 'in_progress') {
    plan = str(input.activeForm) ?? str(input.subject) ?? tasks.get(id) ?? plan
    planTask = id
  } else if ((input.status === 'completed' || input.status === 'deleted') && planTask === id) {
    plan = null
    planTask = null
  }
}

async function onChunk($: EngineInterface, key: string, loop: Loop, chunk: TurnStepChunk) {
  if (chunk.kind === 'thinking') loop.phase = THINKING
  else if (chunk.kind === 'text') loop.phase = ANSWERING
  else if (chunk.kind === 'tool') {
    loop.streams.set(chunk.index, { id: chunk.id, name: chunk.name, scanner: new Scanner() })
    loop.calls.set(chunk.id, { icon: ICONS.other, verb: 'Preparing', object: humanize(chunk.name), noun: 'step' })
  } else if (chunk.kind === 'input') {
    const s = loop.streams.get(chunk.index)
    // A call the engine already started keeps the words its real input gave.
    if (!s || loop.started.has(s.id)) return
    s.scanner.feed(chunk.json)
    if (Object.keys(s.scanner.fields).length === 0) return
    loop.calls.set(s.id, describeCall(s.name, s.scanner.fields, s.scanner.live()))
  } else return
  await publish($, key)
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await reset($, undefined, WAITING)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const [key, loop] = loopOf(e.agentId)
    try {
      clear(loop)
      loop.phase = e.index > 0 ? { ...WAITING, detail: `step ${e.index + 1}` } : WAITING
      await publish($, key)
    } catch {
      // The line is a nicety: the stream goes on whatever happens to it.
    }
    const stream = next(e)
    for await (const chunk of stream) {
      try {
        await onChunk($, key, loop, chunk)
      } catch {
        // As above.
      }
      yield chunk
    }
    return await stream.result
  })

  // Never a guard: a failure here lets the call through, run or replayed.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Readonly<Record<string, unknown>>
    const [key, loop] = loopOf(e.agentId)
    const id = e.tool_use_id ?? `call-${++seq}`
    try {
      if (e.agentId === undefined) notePlan(input)
      loop.started.add(id)
      loop.calls.set(id, describeCall(e.tool, input))
      await publish($, key)
    } catch {
      // As above.
    }
    try {
      const ran = await next(e)
      // A task made with its spinner words, kept for when it is started by id.
      const made = str(input.activeForm) ?? str(input.subject)
      if (made && input.taskId === undefined && 'text' in ran && typeof ran.text === 'string') {
        const m = /#(\d+)|\btask\s+(\d+)/i.exec(ran.text)
        const id = m?.[1] ?? m?.[2]
        if (id !== undefined) tasks.set(id, made)
      }
      return ran
    } finally {
      try {
        loop.calls.delete(id)
        loop.started.delete(id)
        if (loop.calls.size === 0) loop.phase = WAITING
        await publish($, key)
      } catch {
        // As above.
      }
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await reset($, e.agentId, null)
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // A state's own message (compacting, retrying) says more than we would.
    if (e.props.message !== null) return next(e)
    const all = await read($, shown)
    const byMode = BY_MODE[e.props.mode]
    const fallback = byMode && { ...shownFor([], byMode, null)!, isCall: e.props.mode.startsWith('tool') }
    const found = all[e.requestId] ?? all.main ?? fallback
    if (!found) return next(e)
    // The desktop's row names a tool call itself. Its words stay when they say
    // at least as much as ours (by length: "Waiting five seconds…" over our
    // "Wait five seconds…"); a shorter one ("Creating", "Running a command")
    // gives way to ours, which name the file or the command. Between calls the
    // row still holds the last call's words, so waiting, thinking and the
    // answer always say ours.
    // NOTE: this replaces the desktop app's own text. If that is unwanted,
    // drop the length test, `ownWords.length >= found.text.length`, so the
    // app's words always win while a call runs.
    const ownWords = e.props.word.trim()
    const keepsOwnWords =
      e.surface === 'desktop' &&
      found.isCall === true &&
      ownWords !== '' &&
      ownWords !== 'Working' &&
      ownWords.length >= found.text.length
    const s = keepsOwnWords ? { ...found, text: ownWords } : found
    const words = spinnerWords(s, e.props.suffix, e.viewport?.columns, e.surface === 'desktop')
    return next({ ...e, props: { ...e.props, ...words } })
  }).catch(($, e, next) => next(e))
}
