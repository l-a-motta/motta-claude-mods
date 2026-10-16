import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolSpec } from 'claude-code'

import type { AgentRun, Flow, Panel, Phase, PlannedTask, SavvyProgressOpened, Tick, ToolFamily, ToolReach, TouchedFile, TrailEntry } from '../types'
import { classify, COLORS as TOOL_COLORS, judgeCommand, reachOfPath } from './tool-kinds.ts'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const rows = atom({ plugin: 'savvy-progress', key: 'rows' } as const, {})
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  isFailedCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)

const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
const PANE = 'savvy-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
// Work in progress is a neutral gray: purple read as Opus. A stopped agent is
// gray too, with its own square mark.
const RUNNING = '#8a8a86'
const STOPPED = '#8a8a86'
// One green for done and a call that worked, one red for failed: everywhere.
const OK = '#3B9C5F'
const FAIL = '#E24B4A'
const DONE = OK

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

// Hover-card text: a line is a string or a list of pieces; a piece is a string
// (plain) or text with a style. The first line is bold; a plain string line
// after it is dim. Labels dim, values plain, separators fainter still.
type TipStyle = 'b' | 'd' | 'f' | 'i' | 'good' | 'bad' | 'warn' | 'accent' | 'key' | 'tag' | 'tag-good' | 'tag-bad' | 'tag-warn'
type TipPiece = string | { t: string; s: TipStyle }
type Tone = 'action' | 'info' | 'warn' | 'danger' | 'good'
const TIP_FG = '#e9e7e2'
const TIP_DIM = '#9c9a94'
const TIP_FAINT = '#6f6d68'
const TIP_GOOD = '#7fc97f'
const TIP_BAD = '#ef8a80'
const TIP_WARN = '#e7c06b'
const TIP_ACCENT = '#8db4f0'
const TIP_CHIP = '#ffffff1f'
const TONES: Record<Tone, string> = { action: TIP_ACCENT, info: TIP_FAINT, warn: TIP_WARN, danger: TIP_BAD, good: TIP_GOOD }
const TINT: Record<string, [string, string]> = { 'tag-good': [TIP_GOOD, '#7fc97f26'], 'tag-bad': [TIP_BAD, '#ef8a8026'], 'tag-warn': [TIP_WARN, '#e7c06b26'], tag: [TIP_FG, TIP_CHIP], key: [TIP_FG, TIP_CHIP] }
const SEP = { t: ' · ', s: 'f' } as const
const dim = (t: string): TipPiece => ({ t, s: 'd' })
const pathPieces = (path: string): TipPiece[] => {
  const i = path.lastIndexOf('/')
  return i < 0 ? [{ t: path, s: 'b' }] : [{ t: path.slice(0, i + 1), s: 'd' }, { t: path.slice(i + 1), s: 'b' }]
}

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Russian.

type Lang = 'en' | 'ru'

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    tokens: 'Processed',
    time: 'Time',
    collapse: 'Compact view',
    expand: 'Full view',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens processed',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    autoTitle: 'Subagents',
    workflow: 'Workflow',
    steps: 'Steps',
    toolCalls: (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`,
    quiet: 'quiet',
    waiting: 'waiting on',
    agentCall: 'Agents together',
    failedGroup: 'Failed',
    overdue: 'overdue',
    stopped: 'stopped',
    kinds: { read: 'read', change: 'change', run: 'run', delegate: 'delegate', bookkeeping: 'bookkeeping' },
    costumes: { fable: 'astronaut crab', heavy: 'detective crab', careful: 'engineer crab', medium: 'chef crab', light: 'racer crab', explore: 'pirate crab', other: 'plain crab' },
    byTier: 'savvy tier',
    byWord: (w: string): TipPiece[] => [`“${w}”`, dim(' in its type')],
    byModel: (m: string, effort?: string): TipPiece[] => [dim('from '), m, ...(effort ? [dim(` ${effort}`)] : [])],
    noRole: 'no role in its type',
    thresholds: (idle: string, overdue: string): TipPiece[] => [dim('idle at '), idle, dim(', overdue at '), overdue],
    priced: (tokens: string, i: number, o: number): TipPiece[] => [dim('≈ '), tokens, dim(' tokens at '), `$${i}/$${o}`, dim(' per M')],
    context: (used: string, max: string): TipPiece[] => [used, dim(' of '), max, dim(' context')],
    shows: (what: string) => `Shows ${what}`,
    hides: (what: string) => `Hides ${what}`,
    failedAgents: 'the failed agents',
    finishedAgents: 'the finished agents',
    olderFinished: (n: number) => `${n} older finished ${n === 1 ? 'agent' : 'agents'}`,
    olderAgents: 'the older finished agents',
    show: 'Show',
    hide: 'Hide',
    foldedToFit: 'folded to fit',
    toFull: "Shows every agent's card",
    toCompact: 'Folds the pane to one strip of crabs',
    costNote: 'Cost ≈: tokens × the price table, per model',
    timeNote: (sum: string): TipPiece[] => [dim('Time: first start to last end'), SEP, sum, dim(' summed')],
    lanes: (running: number, total: number) => `agents · ${running} running · ${total} total`,
    earlierLanes: (n: number) => `+${n} earlier`,
    batch: 'Batch',
    at: 'at',
    units: { s: 's', m: 'm', h: 'h' },
    turn: 'Turn',
    started: 'started',
    ended: 'ended',
    ran: 'ran',
    runningNow: 'running',
    idleBefore: (d: string) => `${d} idle before`,
    now: 'now',
    agentsN: (n: number) => `${n} ${n === 1 ? 'agent' : 'agents'}`,
    runningN: (n: number) => `${n} running`,
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    tokens: 'Обработано',
    time: 'Время',
    collapse: 'Компактно',
    expand: 'Подробно',
    running: 'Работают',
    finished: 'Завершены',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов обработано',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    opened: 'Панель агентов открыта.',
    closed: 'Панель агентов закрыта.',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
    autoTitle: 'Субагенты',
    workflow: 'Воркфлоу',
    steps: 'Шаги',
    toolCalls: (n: number) => {
      const d = n % 10
      const dd = n % 100
      return `${n} ${d === 1 && dd !== 11 ? 'вызов' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'вызова' : 'вызовов'}`
    },
    quiet: 'тишина',
    waiting: 'ждёт',
    agentCall: 'Агенты вместе',
    failedGroup: 'С ошибкой',
    overdue: 'просрочен',
    stopped: 'остановлен',
    kinds: { read: 'чтение', change: 'правки', run: 'запуск', delegate: 'делегирование', bookkeeping: 'служебное' },
    costumes: { fable: 'краб-астронавт', heavy: 'краб-детектив', careful: 'краб-инженер', medium: 'краб-повар', light: 'краб-гонщик', explore: 'краб-пират', other: 'простой краб' },
    byTier: 'уровень savvy',
    byWord: (w: string): TipPiece[] => [`«${w}»`, dim(' в типе')],
    byModel: (m: string, effort?: string): TipPiece[] => [dim('по модели '), m, ...(effort ? [dim(` ${effort}`)] : [])],
    noRole: 'роль не найдена',
    thresholds: (idle: string, overdue: string): TipPiece[] => [dim('тишина с '), idle, dim(', просрочен с '), overdue],
    priced: (tokens: string, i: number, o: number): TipPiece[] => [dim('≈ '), tokens, dim(' токенов по '), `$${i}/$${o}`, dim(' за 1M')],
    context: (used: string, max: string): TipPiece[] => [used, dim(' из '), max, dim(' контекста')],
    shows: (what: string) => `Показывает ${what}`,
    hides: (what: string) => `Скрывает ${what}`,
    failedAgents: 'агентов с ошибкой',
    finishedAgents: 'завершённых агентов',
    olderFinished: (n: number) => `Ранее завершённые: ${n}`,
    olderAgents: 'ранее завершённых агентов',
    show: 'Показать',
    hide: 'Скрыть',
    foldedToFit: 'свёрнуты, чтобы поместиться',
    toFull: 'Показывает карточку каждого агента',
    toCompact: 'Сворачивает панель в полосу крабов',
    costNote: 'Стоимость ≈: токены × таблица цен моделей',
    timeNote: (sum: string): TipPiece[] => [dim('Время: от первого старта до конца'), SEP, dim('всего '), sum],
    lanes: (running: number, total: number) => `агенты · работают ${running} · всего ${total}`,
    earlierLanes: (n: number) => `+${n} ранее`,
    batch: 'Пакет',
    at: 'в',
    units: { s: 'с', m: 'м', h: 'ч' },
    turn: 'Ход',
    started: 'начат',
    ended: 'завершён',
    ran: 'шёл',
    runningNow: 'идёт',
    idleBefore: (d: string) => `${d} простоя до него`,
    now: 'сейчас',
    agentsN: (n: number) => `агентов: ${n}`,
    runningN: (n: number) => `работают: ${n}`,
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
const tr = () => STRINGS[lang]

const isRussian = (v: unknown): boolean => typeof v === 'string' && /^(ru|russian|рус)/i.test(v.trim())

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ru') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return isRussian(settings.language) ? 'ru' : 'en'
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return isRussian(locale) ? 'ru' : 'en'
}

const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && input.title.trim() !== prev.title)

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: (t.tier ?? '').replace(/^savvy-/, '').trim().toLowerCase(),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total)))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: input.title?.trim() || base.title,
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  if (f.kind === 'agents') return `${s.pane} ${f.done}/${f.total}`
  if (f.kind === 'steps') return f.total ? `${s.steps} ${f.done}/${f.total}` : s.busy
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// The bar of one Agent or Workflow call: its agents, done once none of them runs.
export const tally = (anchor: string, list: AgentRun[], title: string): Flow => {
  const mine = list.filter(a => a.anchor === anchor)
  const running = mine.filter(a => a.status === 'running').length
  const isFinished = mine.length > 0 && running === 0
  return {
    ...blank(),
    title,
    total: mine.length,
    done: mine.length - running,
    running,
    isFinished,
    phase: isFinished ? 'close' : 'delegate',
    anchor,
    kind: 'agents',
  }
}

// How many call rows keep their bar; older ones draw the engine's row alone.
const ROWS_KEPT = 100

const keepRows = (m: Record<string, Flow>): Record<string, Flow> =>
  Object.fromEntries(Object.entries(m).slice(-ROWS_KEPT))

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count is a
// Button beside it.
const H = 22
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// Advance of system UI text (Segoe UI, SF), in em, letter by letter: a pill
// sized by an average letter came out too wide for names of narrow ones
// (`register.tsx`), and titles cut early.
export const charEm = (ch: string): number => {
  if (/[ijl.,:;'|!()[\]]/.test(ch)) return 0.27
  if (ch === ' ') return 0.27
  if (/[frtI1\-]/.test(ch)) return 0.36
  if (/[szcJ"]/.test(ch)) return 0.47
  if (/[mw]/.test(ch)) return 0.83
  if (/[MW@%]/.test(ch)) return 0.9
  if (/[A-Z]/.test(ch)) return 0.64
  if (/[А-ЯЁмшщжюМШЩЖЮ]/.test(ch)) return 0.72
  return 0.54
}

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : RUNNING
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(ratio(f) * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// One bar, as a call's row and the band draw it: off the terminal one SVG with
// the crew count beside it, in the terminal text, `columns` wide.
function barRow(ui: any, surface: string, columns: number, f: Flow, isWorking: boolean, crewButton: unknown, key: string) {
  const { Box, Text } = ui
  const percent = `${Math.round(ratio(f) * 100)}%`
  if (surface !== 'terminal' && 'Svg' in ui) {
    const { Svg } = ui
    // About 8 CSS px per column the surface measured, less the count beside it
    // and the row's indent; capped so a wide window keeps a bar, not a banner.
    const width = Math.max(180, Math.min(720, columns * 8 - 140))
    return (
      <Box key={key} flexDirection="row" alignItems="center" gap={1}>
        <Svg source={rowSvg(f, width, isWorking)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
        {crewButton}
      </Box>
    )
  }
  const cols = Math.max(30, columns - 4)
  const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
  const width = Math.max(6, Math.min(40, cols - titleW - 32))
  return (
    <Box key={key} flexDirection="row" gap={2} paddingLeft={2}>
      <Box width={titleW} flexShrink={0}>
        <Text color={f.isFinished ? DONE : RUNNING}>● </Text>
        <Text wrap="truncate-end">{f.title}</Text>
      </Box>
      <Text color={f.isFinished ? DONE : RUNNING}>{barText(f, width)}</Text>
      <Text bold>{label(f)}</Text>
      <Text dimColor>{percent}</Text>
      <Text color={CLAY}>▣</Text>
      {crewButton}
    </Box>
  )
}

// The agents working together now: from the earliest that still runs, back
// through every run that overlapped it, and all started since. Empty once
// none runs, so the next agent starts a new batch.
export const batchOf = (list: AgentRun[]): AgentRun[] => {
  const running = list.filter(a => a.status === 'running')
  if (running.length === 0) return []
  let start = Math.min(...running.map(a => a.startedAt))
  for (let isMoved = true; isMoved; ) {
    isMoved = false
    for (const a of list) {
      if (a.startedAt < start && (a.endedAt ?? a.startedAt) >= start) {
        start = a.startedAt
        isMoved = true
      }
    }
  }
  return list.filter(a => a.startedAt >= start)
}

// One agent's bar: the steps it reported, or that it runs.
export const agentBar = (a: AgentRun): Flow => {
  const isFinished = a.status !== 'running'
  return {
    ...blank(),
    title: a.description || a.type,
    total: a.stepTotal ?? 0,
    done: a.stepDone ?? 0,
    running: isFinished ? 0 : 1,
    isFinished,
    phase: isFinished ? 'close' : 'delegate',
    kind: 'steps',
  }
}

// The band's one bar and the key its dismiss holds: the agent whose
// transcript is open, else a live savvy flow, else the batch of agents
// working now, titled by its agent when it has one. The agent and the batch
// carry their crew, which the band draws as a roll call. Null leaves the band.
export const bandBar = (f: Flow | null, list: AgentRun[], viewed: string | undefined, since: number | undefined): { key: string; bar: Flow; crew?: AgentRun[] } | null => {
  if (viewed !== undefined) {
    const a = list.find(x => x.agentId === viewed)
    return a ? { key: `agent:${viewed}`, bar: agentBar(a), crew: [a] } : null
  }
  if (f !== null && !f.isFinished) return { key: `flow:${since ?? 0}`, bar: f }
  const batch = batchOf(list)
  if (batch.length === 0) return null
  const running = batch.filter(a => a.status === 'running').length
  const only = batch.length === 1 ? batch[0] : undefined
  const bar: Flow = {
    ...blank(),
    title: only?.description || tr().autoTitle,
    total: batch.length,
    done: batch.length - running,
    running,
    phase: 'delegate',
    kind: 'agents',
  }
  return { key: `batch:${Math.min(...batch.map(a => a.startedAt))}`, bar, crew: batch }
}

// What `next(e)` hands back when no plugin beneath drew in the band: the
// engine's own band as an opaque reference, or nothing.
function isFree(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === '') return true
  return typeof node === 'object' && (node as { type?: unknown }).type === 'engine'
}

// The band is shared, so what the plugins beneath drew stays: a chip column
// (`band-beside:`) at the right of the card, anything else over it. The whole
// is keyed `band-under:`, so a status line above draws its lines over it and
// a chip above finds its column inside.
export function shareBand(Box: any, below: unknown, card: unknown) {
  if (isFree(below)) {
    return (
      <Box key="band-under:savvy-progress" flexDirection="column">
        {card}
      </Box>
    )
  }
  const belowKey = (below as { props?: { key?: unknown } }).props?.key
  if (typeof belowKey === 'string' && belowKey.startsWith('band-beside:')) {
    return (
      <Box key="band-under:savvy-progress" flexDirection="row" alignItems="flex-start">
        {card}
        {below}
      </Box>
    )
  }
  return (
    <Box key="band-under:savvy-progress" flexDirection="column">
      {below}
      {card}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

// An agent's color is its model's; its crab's costume tells its role. Hues
// kept off the tool families' (gray, blue, yellow, clay, magenta) and off the
// ✓, ✗ and idle colors, so a tick and an agent never read alike.
export const MODEL_COLOR = {
  opus: '#7F77DD',
  sonnet: '#1D9E75',
  haiku: '#7FAF2E',
  fable: '#D4537E',
  other: '#888780',
}

export const modelColor = (model: string): string => {
  const m = model.toLowerCase()
  if (/fable|mythos/.test(m)) return MODEL_COLOR.fable
  if (/opus/.test(m)) return MODEL_COLOR.opus
  if (/sonnet/.test(m)) return MODEL_COLOR.sonnet
  if (/haiku/.test(m)) return MODEL_COLOR.haiku
  return MODEL_COLOR.other
}

// A savvy tier's color is the model it runs on (TIER_MODEL): Fable, else Opus.
const TIER_COLOR: Record<string, string> = {
  fable: MODEL_COLOR.fable,
  heavy: MODEL_COLOR.opus,
  careful: MODEL_COLOR.opus,
  medium: MODEL_COLOR.opus,
  light: MODEL_COLOR.opus,
  other: MODEL_COLOR.other,
}

// What each savvy tier runs on, for planned tasks that have no run yet.
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780'

const TIER_MODEL: Record<string, string> = {
  fable: 'Fable · high',
  heavy: 'Opus · xhigh',
  careful: 'Opus · high',
  medium: 'Opus · medium',
  light: 'Opus · low',
}

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money, so the panel's cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string): [number, number, number, number] =>
  PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

const costOf = (model: string, u: Usage): number => {
  const [i, o, r, w] = priceOf(model)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return t in TIER_COLOR && bare.startsWith('savvy-') ? t : 'other'
}

// A role read off the agent's name, word by word: `hd-auditor` is `audit`.
// The first rule a word matches wins, so review outranks build.
const ROLE_WORDS: [RegExp, string][] = [
  [/^(scout|explor|search|research|recon)/, 'explore'],
  [/^(audit|review|critic|critique|inspect)/, 'heavy'],
  [/^(architect|plan|design)/, 'fable'],
  [/^(develop|implement|engineer|build|fix)/, 'careful'],
  [/^(compar|judge|rank)/, 'medium'],
  [/^(qa|test|verif)/, 'light'],
]

// The tier a model and effort run at, as TIER_MODEL spells the savvy ones.
const tierOfModel = (model: string, effort?: string): string | null => {
  const m = model.toLowerCase()
  if (/fable|mythos/.test(m)) return 'fable'
  if (/haiku/.test(m)) return 'light'
  if (/sonnet/.test(m)) return 'medium'
  if (!/opus/.test(m)) return null
  if (effort === 'xhigh' || effort === 'max') return 'heavy'
  if (effort === 'high') return 'careful'
  if (effort === 'medium') return 'medium'
  if (effort === 'low') return 'light'
  return null
}

type Role = { costume: string; color: string; label: string }

// Costume of any agent: a savvy tier by its name, else a role its name spells
// out, else the tier its model and effort run at, else the plain crab. Its
// color is its model's.
export const roleOf = (a: Pick<AgentRun, 'type' | 'model' | 'effort'>): Role => {
  const savvy = tierOf(a.type)
  if (savvy !== 'other') return { costume: savvy, color: modelColor(a.model), label: savvy }
  const words = a.type.replace(/^[^:]*:/, '').toLowerCase().split(/[^a-z0-9]+/)
  const named = ROLE_WORDS.find(([re]) => words.some(w => re.test(w)))?.[1]
  const costume = named ?? tierOfModel(a.model, a.effort) ?? 'other'
  return { costume, color: modelColor(a.model), label: a.type }
}

// The costume and the rule of roleOf's that picked it, for the pane's hover card.
const costumeWhy = (a: AgentRun): TipPiece[] => {
  const s = tr()
  const { costume } = roleOf(a)
  const crab = s.costumes[costume as keyof typeof s.costumes] ?? s.costumes.other
  if (tierOf(a.type) !== 'other') return [crab, SEP, dim(s.byTier)]
  const words = a.type.replace(/^[^:]*:/, '').toLowerCase().split(/[^a-z0-9]+/)
  const rule = ROLE_WORDS.find(([re]) => words.some(w => re.test(w)))
  const word = rule && words.find(w => rule[0].test(w))
  if (word) return [crab, SEP, ...s.byWord(word)]
  if (costume !== 'other') return [crab, SEP, ...s.byModel(modelName(a.model), a.effort)]
  return [crab, SEP, dim(s.noRole)]
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

// A length of time with its units, `29s`, `2m52s`, `1h04m`: a colon is
// left to clock times alone.
const fmtTime = (ms: number): string => {
  const u = tr().units
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${u.s}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}${u.m}${String(s % 60).padStart(2, '0')}${u.s}`
  return `${Math.floor(m / 60)}${u.h}${String(m % 60).padStart(2, '0')}${u.m}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the bar under a call is.

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
.bub{animation:bb 1s ease-in-out infinite}@keyframes bb{50%{transform:translateY(-1px)}}
@media (prefers-reduced-motion: reduce){.live,.bub{animation:none}}
</style>`

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// Drawn in the brand clay; an agent's crab wears its model's color as the body
// and the clay moves to the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK, 'eye')
  f(19, 12, 2, 2, INK, 'eye')
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own. `body` repaints the clay; an
// asleep crab (an agent gone quiet) shuts its eyes under an amber z.
const crab = (
  x: number,
  y: number,
  costume: string,
  dim = false,
  isWalking = false,
  scale = CRAB_SCALE,
  accent = colorOf(costume),
  look: { body?: string; isAsleep?: boolean } = {},
): string => {
  // Each part's cells as one path per color, a run of cells along a row as one
  // rect of it: a rect per cell made a pane of a few agents too heavy for the
  // desktop.
  const groups = new Map<string, Map<string, number[][]>>([['bd', new Map()]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (cls === 'eye') return f(cx, look.isAsleep ? cy + 1 : cy, w, look.isAsleep ? 1 : h, c)
    if (!groups.has(cls)) groups.set(cls, new Map())
    const fill = c === CLAY && look.body ? look.body : c
    const paths = groups.get(cls)!
    const rects = paths.get(fill) ?? []
    const last = rects.at(-1)
    if (last && last[1] === cy && last[3] === h && last[0]! + last[2]! === cx) last[2]! += w
    else rects.push([cx, cy, w, h])
    paths.set(fill, rects)
  }
  const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f, accent)
  const cells = (cls: string) =>
    [...(groups.get(cls) ?? new Map<string, number[][]>()).entries()].map(([fill, rects]) => `<path fill="${fill}" d="${rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w!}z`).join('')}"/>`).join('')
  const group = (cls: string) => `<g class="${cls}">${cells(cls)}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${cells('bd')}${props.map(group).join('')}</g>`
  const zs = look.isAsleep ? `<text x="24" y="7" font-family="${FONT}" font-size="7" font-weight="700" fill="${WARN}">z</text><text x="27" y="3" font-family="${FONT}" font-size="5" font-weight="700" fill="${WARN}">z</text>` : ''
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g>${zs}</g>`
}

// An agent's crab: its model's color as the body, its role's costume; walks
// while it works, sleeps once it is overdue.
const agentCrab = (a: AgentRun, x: number, y: number, at: number, dim: boolean, scale = CRAB_SCALE): string => {
  const { costume, color } = roleOf(a)
  const isAsleep = isOverdue(a, at)
  return crab(x, y, costume, dim, a.status === 'running' && !isAsleep, scale, CLAY, { body: color, isAsleep })
}

// A stopped agent's bar ends where it stopped: a cap, then the rest hatched.
const cutBar = (x: number, y: number, w: number, h: number, share: number): string => {
  const fw = Math.max(2, Math.round(w * share))
  const rest = w - fw - 3
  return `<rect x="${x}" y="${y}" width="${fw}" height="${h}" rx="${h / 2}" fill="${STOPPED}"/><rect x="${x + fw}" y="${y - 3}" width="1.5" height="${h + 6}" fill="${STOPPED}"/>${rest > 0 ? `<rect x="${x + fw + 3}" y="${y}" width="${rest}" height="${h}" rx="${h / 2}" fill="url(#sv-hatch)"/>` : ''}`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="${OK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'overdue') return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${WARN}" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="${WARN}" stroke-width="1.4" stroke-linecap="round"/>`
  if (status === 'stopped') return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" fill="${STOPPED}"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="${FAIL}" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

const HATCH = `<defs><pattern id="sv-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.5" height="4" fill="${STOPPED}" opacity=".6"/></pattern></defs>`

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${HATCH}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, '≈' + fmtCost(t.cost))}${tile(1, s.tokens, fmtTokens(t.tokens))}${tile(2, s.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the worker reports steps, else null: the bar
// then shows its context. A finished run keeps the fill it had.
const progressOf = (a: AgentRun): number | null => (a.stepTotal ? Math.min(1, (a.stepDone ?? 0) / a.stepTotal) : null)

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

// --- one agent's card, the same parts on every surface: its tool calls by kind,
// what it did last (running), the files it touched, and its answer (finished).
// `cardParts` decides which show; both drawings and the height follow it.

// A tool call's color is tool-borders': the hue its family, the brightness how
// far it reaches (tool-kinds.ts, a copy of tool-borders' classifier).
export const FAMILY_ORDER: ToolFamily[] = ['read', 'change', 'run', 'delegate', 'bookkeeping']

// Read defensively: a record written before a reload may hold other names.
export const toolColor = (family: string | undefined, reach: string | undefined): string => {
  const hues = TOOL_COLORS[(family ?? '') as ToolFamily] ?? TOOL_COLORS.bookkeeping
  return hues[(reach ?? '') as ToolReach] ?? hues.machine
}
const WARN = '#BA7517'

// Quiet for this long, a running agent says so: waiting on its tool, or just quiet.
const IDLE_MS = 45_000
// Quiet for this long, it is overdue: a flag, not a state; its next sign of
// life clears it. The safety net for agents the engine's list never names (a
// workflow's), whose stop savvy cannot see.
const OVERDUE_MS = 5 * 60_000

export const isOverdue = (a: AgentRun, at: number): boolean => a.status === 'running' && a.activeAt !== undefined && at - a.activeAt >= OVERDUE_MS

export const idleNote = (a: AgentRun, at: number): string => {
  if (a.status !== 'running' || a.activeAt === undefined || at - a.activeAt < IDLE_MS) return ''
  const s = tr()
  const last = a.trail?.at(-1)
  const quiet = fmtTime(at - a.activeAt)
  return last?.kind === 'tool' && last.state === 'running' ? `${s.waiting} ${last.text.split(' ')[1] ?? ''} · ${quiet}` : `${s.quiet} ${quiet}`
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

type CardParts = { mix: boolean; trail: TrailEntry[]; idle: string; files: boolean; result: string }

// Newest action first; a finished agent shows its answer instead.
export const cardParts = (a: AgentRun, at: number): CardParts => ({
  mix: (a.toolCalls ?? 0) > 0,
  trail: a.status === 'running' ? [...(a.trail ?? [])].reverse() : [],
  idle: idleNote(a, at),
  files: (a.files?.length ?? 0) > 0,
  result: a.status === 'running' ? '' : (a.result ?? ''),
})

const CARD_BASE = 62
const LINE = 15
const CHIP_ROW = 20

// Without reported steps, the file chips ride the stats line's empty left side.
const chipsOnStats = (a: AgentRun): boolean => !a.stepTotal

export const agentHeight = (a: AgentRun, at: number): number => {
  const p = cardParts(a, at)
  return CARD_BASE + (p.mix ? LINE : 0) + p.trail.length * LINE + (p.idle ? LINE : 0) + (p.files && !chipsOnStats(a) ? CHIP_ROW : 0) + (p.result ? LINE : 0) + 6
}

// A trail entry as words, and a tool call's outcome beside it.
export const entryText = (t: TrailEntry): string => (t.kind === 'think' ? `✻ ${t.text}` : t.text)
export const entryMark = (t: TrailEntry): { glyph: string; color: string } | null =>
  t.kind !== 'tool' ? null : t.state === 'ok' ? { glyph: '✓', color: OK } : t.state === 'failed' ? { glyph: '✗', color: FAIL } : { glyph: '…', color: '#9a9a96' }

// The crab acts out what it does now: a bubble over it with the running tool's
// sign, a speech bubble while it writes, a thought bubble while it thinks.
const ACT_GLYPH: Record<string, (c: string) => string> = {
  read: c => `<rect x="2" y="1.5" width="7" height="8" rx="1" fill="none" stroke="${c}" stroke-width="1.2"/><path d="M3.8 4h3.4M3.8 6h3.4M3.8 8h2" stroke="${c}" stroke-width="1"/>`,
  change: c => `<path d="M2.5 9.5l1-3 5-5 2 2-5 5z" fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/>`,
  run: c => `<path d="M2 3l3 2.5L2 8" fill="none" stroke="${c}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 9h4" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`,
  web: c => `<circle cx="5.5" cy="5.5" r="3.8" fill="none" stroke="${c}" stroke-width="1.1"/><ellipse cx="5.5" cy="5.5" rx="1.6" ry="3.8" fill="none" stroke="${c}" stroke-width="1"/><path d="M1.7 5.5h7.6" stroke="${c}" stroke-width="1"/>`,
  delegate: c => `<rect x="2.5" y="3.5" width="6" height="4" fill="${c}"/><rect x="1" y="5" width="1.5" height="1.5" fill="${c}"/><rect x="8.5" y="5" width="1.5" height="1.5" fill="${c}"/><rect x="3" y="7.5" width="1" height="1.5" fill="${c}"/><rect x="7" y="7.5" width="1" height="1.5" fill="${c}"/>`,
  bookkeeping: c => `<circle cx="3" cy="5.5" r="1" fill="${c}"/><circle cx="5.5" cy="5.5" r="1" fill="${c}"/><circle cx="8" cy="5.5" r="1" fill="${c}"/>`,
  say: c => `<path d="M2 3.5h7M2 5.8h7M2 8.1h4.5" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/>`,
  think: c => `<circle cx="3" cy="5.5" r="1" fill="${c}"/><circle cx="5.5" cy="5.5" r="1" fill="${c}"/><circle cx="8" cy="5.5" r="1" fill="${c}"/>`,
}

export const actOf = (last: TrailEntry | undefined): string => {
  if (!last) return ''
  if (last.kind !== 'tool') return last.kind
  if (last.state !== 'running') return ''
  if (last.tool === 'read' && last.reach === 'internet') return 'web'
  return last.tool && last.tool in TOOL_COLORS ? last.tool : 'bookkeeping'
}

const actBubble = (x: number, y: number, last: TrailEntry | undefined): string => {
  const act = actOf(last)
  if (!act) return ''
  const color = last?.kind === 'tool' ? toolColor(last.tool, last.reach) : '#8a8a86'
  const shape =
    act === 'think'
      ? `<rect class="tile" x="0" y="0" width="15" height="12" rx="6"/><circle class="tile" cx="2" cy="14.5" r="1.6"/><circle class="tile" cx="0" cy="17" r="1"/>`
      : `<rect class="tile" x="0" y="0" width="15" height="12" rx="3"/><path class="tile" d="M2 11.5l-1 4 4-4z"/>`
  return `<g class="bub" transform="translate(${x},${y})">${shape}<g transform="translate(2,0.5)">${ACT_GLYPH[act]?.(color) ?? ''}</g></g>`
}

// --- the pane's order: failed agents pinned on top, then the agents of each
// call (an Agent call, or a workflow's run), running groups first, newest first.

export type AgentGroup = { key: string; title: string; agents: AgentRun[]; span: number }

export const groupsOf = (list: AgentRun[], at: number): { failed: AgentRun[]; running: AgentGroup[]; finished: AgentGroup[] } => {
  const failed = list.filter(a => a.status === 'failed').reverse()
  const byKey = new Map<string, AgentRun[]>()
  for (const a of list) {
    if (a.status === 'failed') continue
    const key = a.anchor ?? a.id
    byKey.set(key, [...(byKey.get(key) ?? []), a])
  }
  const groups = [...byKey].map(([key, mine]): AgentGroup & { last: number; isRunning: boolean } => {
    const start = Math.min(...mine.map(a => a.startedAt))
    const end = Math.max(...mine.map(a => a.endedAt ?? at))
    return {
      key,
      title: mine.some(a => a.isWorkflow) ? tr().workflow : tr().agentCall,
      // Running ones first, each part newest first.
      agents: [...mine.filter(a => a.status === 'running').reverse(), ...mine.filter(a => a.status !== 'running').reverse()],
      span: Math.max(0, end - start),
      last: Math.max(...mine.map(a => a.startedAt)),
      isRunning: mine.some(a => a.status === 'running'),
    }
  })
  groups.sort((x, y) => y.last - x.last)
  const strip = ({ key, title, agents, span }: AgentGroup): AgentGroup => ({ key, title, agents, span })
  return {
    failed,
    running: groups.filter(g => g.isRunning).map(strip),
    finished: groups.filter(g => !g.isRunning).map(strip),
  }
}

const agentSvg = (W: number, a: AgentRun, at: number, n?: number): string => {
  const s = tr()
  const { costume, color, label: role } = roleOf(a)
  const parts = cardParts(a, at)
  const H = agentHeight(a, at)
  const ctx = ctxOf(a)
  const overdue = isOverdue(a, at)
  const textW = W - 42 - 22
  const meta: string[] = []
  if (a.toolCalls) meta.push(s.toolCalls(a.toolCalls))
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  if (a.status === 'stopped') meta.push(s.stopped)
  const barW = textW
  const progress = progressOf(a)
  const stats = `ctx ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Gray either way: its reported steps (darker) or, without them, its context.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  // A red count of failed calls, left of the status mark.
  const failed = a.failed ?? 0
  const badgeW = failed ? Math.round(textWidth(`✗ ${failed}`, 10) + 10) : 0
  const badge = failed
    ? `<rect x="${W - 22 - badgeW}" y="7" width="${badgeW}" height="15" rx="7.5" fill="${FAIL}" opacity=".16"/><text x="${W - 22 - badgeW / 2}" y="18" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="${FAIL}">✗ ${failed}</text>`
    : ''
  const titleW = textW - (badgeW ? badgeW + 6 : 0)

  const rows: string[] = []
  let y = CARD_BASE
  if (parts.mix) {
    let x = 42
    for (const k of FAMILY_ORDER.filter(k => a.kinds?.[k])) {
      const text = `${s.kinds[k]} ${a.kinds?.[k]}`
      if (x + 11 + textWidth(text, 11) > 42 + barW) break
      rows.push(`<rect x="${x}" y="${y + 4}" width="7" height="7" rx="1.5" fill="${toolColor(k, 'machine')}"/><text class="s" x="${x + 11}" y="${y + 11}" font-family="${FONT}" font-size="11">${xml(text)}</text>`)
      x += 11 + textWidth(text, 11) + 12
    }
    y += LINE
  }
  parts.trail.forEach((t, i) => {
    const mark = entryMark(t)
    const text = fitText(entryText(t), 11, barW - (mark ? 14 : 0))
    rows.push(
      `<g opacity="${i === 0 ? 1 : i === 1 ? 0.7 : 0.45}"><text class="${i === 0 ? 't' : 's'}" x="42" y="${y + 11}" font-family="${FONT}" font-size="11"${t.kind === 'tool' ? '' : ' font-style="italic"'}>${xml(text)}</text>` +
        (mark ? `<text x="${42 + textWidth(text, 11) + 5}" y="${y + 11}" font-family="${FONT}" font-size="11" fill="${mark.color}">${mark.glyph}</text>` : '') +
        `</g>`,
    )
    y += LINE
  })
  if (parts.idle) {
    rows.push(`<text x="42" y="${y + 11}" font-family="${FONT}" font-size="11" fill="${WARN}">◷ ${xml(fitText(parts.idle, 11, barW - 14))}</text>`)
    y += LINE
  }
  // The changed and read files as chips from x 42, as many as fit in `room`, then +N.
  const chips = (top: number, room: number): string => {
    const out: string[] = []
    const files = a.files ?? []
    let x = 42
    let shown = 0
    for (const f of files) {
      const name = fitText(baseName(f.path), 10.5, 160)
      const w = Math.round(textWidth(name, 10.5) + 12)
      if (x + w > 42 + room - 30) break
      const c = toolColor(fileFamily(f), f.reach ?? 'machine')
      out.push(
        `<rect x="${x}" y="${top}" width="${w}" height="15" rx="4" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="1"/><text class="t" x="${x + 6}" y="${top + 11}" font-family="${FONT}" font-size="10.5">${xml(name)}</text>`,
      )
      x += w + 4
      shown++
    }
    if (files.length > shown) out.push(`<text class="m" x="${x + 2}" y="${top + 11}" font-family="${FONT}" font-size="10.5">+${files.length - shown}</text>`)
    return out.join('')
  }
  const isChipsUp = parts.files && chipsOnStats(a)
  if (parts.files && !isChipsUp) {
    rows.push(chips(y + 3, barW))
    y += CHIP_ROW
  }
  if (parts.result) {
    rows.push(`<text class="s" x="42" y="${y + 11}" font-family="${FONT}" font-size="11">${xml(fitText(`“${parts.result}”`, 11, barW))}</text>`)
    y += LINE
  }

  return svg(
    W,
    H,
    `${a.status === 'running' ? actBubble(22, 1, a.trail?.at(-1)) : ''}${agentCrab(a, 0, 14, at, a.status === 'stopped')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${n ? `<tspan class="s" font-weight="400">#${n}</tspan><tspan dx="${NUM_GAP}">` : ''}${xml(fitText(a.description || a.type, 13, titleW - (n ? textWidth(`#${n}`, 13) + NUM_GAP : 0)))}${n ? '</tspan>' : ''}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan class="t" font-weight="600">${xml(role)}</tspan><tspan fill="${color}">  ${xml(modelName(a.model))}</tspan>${a.effort ? `<tspan class="s"> ${xml(a.effort)}</tspan>` : ''}${meta.length ? `<tspan class="s">  ·  ${xml(meta.join('  ·  '))}</tspan>` : ''}${overdue ? `<tspan fill="${WARN}">  ·  ${s.overdue}</tspan>` : ''}</text>
${isChipsUp ? chips(38, stepsW + 30) : ''}${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + barW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
${a.status === 'stopped' ? cutBar(42, 55, barW, 4, fillW / barW) : `<rect class="k" x="42" y="55" width="${barW}" height="4" rx="2"/><rect class="${progress === null ? 'm' : 's'}" x="42" y="55" width="${fillW}" height="4" rx="2"/>`}
${rows.join('\n')}
${badge}${statusMark(W - 8, 16, overdue ? 'overdue' : a.status, color)}
<line class="ln" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>`,
  )
}

// --- an Agent or Workflow call's row: each of its agents' tool calls as a strip
// of ticks, one per call, colored by kind, red where it failed.

const STRIP_MAX_AGENTS = 8
const TICK_W = 4
const TICK_GAP = 1.5

const tickRects = (a: AgentRun, x: number, y: number, w: number, h: number): string => {
  const ticks = a.ticks ?? []
  const fit = Math.max(1, Math.floor((w + TICK_GAP) / (TICK_W + TICK_GAP)))
  const shown = ticks.slice(-fit)
  return shown
    .map((t, i) => {
      const fill = t.state === 'failed' ? FAIL : toolColor(t.family, t.reach)
      return `<rect${t.state === 'running' ? ' class="live"' : ''} x="${x + i * (TICK_W + TICK_GAP)}" y="${y}" width="${TICK_W}" height="${h}" rx="1" fill="${fill}"/>`
    })
    .join('')
}

// The strip's dot: running in the one agent's model color (gray for several),
// then red if any failed, green if any finished, else gray: all stopped.
export const stripColor = (mine: AgentRun[], at = 0): string => {
  if (at && mine.some(a => isOverdue(a, at))) return WARN
  if (mine.some(a => a.status === 'running')) return mine.length === 1 ? roleOf(mine[0]!).color : RUNNING
  if (mine.some(a => a.status === 'failed')) return FAIL
  return mine.some(a => a.status === 'done') ? DONE : STOPPED
}

// `N tools · ✗k · 0:30`: what the strip's line says on the right.
export const stripStats = (mine: AgentRun[], at: number): string => {
  const s = tr()
  const calls = mine.reduce((n, a) => n + (a.toolCalls ?? 0), 0)
  const failed = mine.reduce((n, a) => n + (a.failed ?? 0), 0)
  const start = Math.min(...mine.map(a => a.startedAt))
  const end = Math.max(...mine.map(a => a.endedAt ?? at))
  const done = mine.filter(a => a.status !== 'running').length
  return [mine.length > 1 ? `${done}/${mine.length}` : '', calls ? s.toolCalls(calls) : '', failed ? `✗ ${failed}` : '', fmtTime(Math.max(0, end - start))].filter(Boolean).join(' · ')
}

export const stripHeight = (mine: AgentRun[]): number =>
  mine.length === 1 ? 38 : 22 + Math.min(mine.length, STRIP_MAX_AGENTS) * 16 + (mine.length > STRIP_MAX_AGENTS ? 14 : 0)

const stripSvg = (W: number, title: string, mine: AgentRun[], at: number): string => {
  const H = stripHeight(mine)
  const isRunning = mine.some(a => a.status === 'running')
  const color = stripColor(mine, at)
  const stats = stripStats(mine, at)
  const statsW = textWidth(stats, 11.5)
  const head = `<circle${isRunning ? ' class="live"' : ''} cx="5" cy="11" r="4" fill="${color}"/>
<text class="t" x="16" y="15.5" font-family="${FONT}" font-size="13" font-weight="500">${xml(fitText(title, 13, W - 16 - statsW - 16))}</text>
<text class="s" x="${W}" y="15.5" text-anchor="end" font-family="${FONT}" font-size="11.5" font-variant-numeric="tabular-nums">${xml(stats)}</text>`
  let body = ''
  if (mine.length === 1) {
    body = tickRects(mine[0]!, 16, 24, W - 16, 11)
  } else {
    const nameW = Math.min(180, Math.round(W * 0.3))
    body = mine
      .slice(0, STRIP_MAX_AGENTS)
      .map((a, i) => {
        const y = 22 + i * 16
        const mark =
          a.status === 'running' ? '' : a.status === 'failed' ? ` <tspan fill="${FAIL}">✗</tspan>` : a.status === 'stopped' ? ` <tspan fill="${STOPPED}">■</tspan>` : ` <tspan fill="${OK}">✓</tspan>`
        const count = `${a.toolCalls ?? 0}`
        return `<text class="s" x="16" y="${y + 11}" font-family="${FONT}" font-size="11">${xml(fitText(a.description || a.type, 11, nameW - 14))}${mark}</text>
${tickRects(a, 16 + nameW, y + 2, W - 16 - nameW - 28, 10)}
<text class="m" x="${W}" y="${y + 11}" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${count}</text>`
      })
      .join('\n')
    if (mine.length > STRIP_MAX_AGENTS) body += `<text class="m" x="16" y="${H - 3}" font-family="${FONT}" font-size="11">+${mine.length - STRIP_MAX_AGENTS}</text>`
  }
  return svg(W, H, `${head}\n${body}`)
}

// The call's row: off the terminal one SVG with the crew count beside it, in the
// terminal a line per agent with its ticks as colored blocks.
function stripRow(ui: any, surface: string, columns: number, title: string, mine: AgentRun[], at: number, crewButton: unknown, key: string) {
  const { Box, Text } = ui
  const stats = stripStats(mine, at)
  if (surface !== 'terminal' && 'Svg' in ui) {
    const { Svg } = ui
    const width = Math.max(180, Math.min(720, columns * 8 - 140))
    const latest = mine.find(a => a.status === 'running')?.trail?.at(-1)
    return (
      <Box key={key} flexDirection="row" alignItems="flex-start" gap={1}>
        <Svg source={stripSvg(width, title, mine, at)} alt={`${title}: ${stats}${latest ? `, ${entryText(latest)}` : ''}`} width={width} height={stripHeight(mine)} />
        {crewButton}
      </Box>
    )
  }
  const cols = Math.max(30, columns - 4)
  const ticksOf = (a: AgentRun, width: number) =>
    (a.ticks ?? []).slice(-Math.max(1, width)).map(t => (
      <Text key={t.id} color={t.state === 'failed' ? FAIL : toolColor(t.family, t.reach)}>
        ▮
      </Text>
    ))
  return (
    <Box key={key} flexDirection="column" paddingLeft={2}>
      <Box flexDirection="row" gap={1}>
        <Text color={stripColor(mine, at)}>●</Text>
        <Text wrap="truncate-end">{title}</Text>
        <Text dimColor>{stats}</Text>
        {crewButton}
      </Box>
      {mine.length === 1 ? (
        <Text wrap="truncate-end">
          {'  '}
          {ticksOf(mine[0]!, cols - 4)}
        </Text>
      ) : (
        mine.slice(0, STRIP_MAX_AGENTS).map(a => (
          <Box key={a.id} flexDirection="row" gap={1}>
            <Box width={Math.min(24, Math.floor(cols / 3))} flexShrink={0}>
              <Text dimColor wrap="truncate-end">
                {'  '}
                {a.description || a.type}
              </Text>
            </Box>
            <Text wrap="truncate-end">{ticksOf(a, cols - 30)}</Text>
          </Box>
        ))
      )}
    </Box>
  )
}

// --- the band's roll call: a crab per agent at work together, dim once done,
// and their totals. Smaller than a card: the band is shared and busy.

const ROLL_MAX = 10

// The band's look, as motta-statusline draws its lines (the band's model):
// gaps in character cells between a segment's items (`inner`) and between
// segments (`outer`), never spaces in text; a desktop cell is wider than a
// space in its proportional font. A pressable word is drawn dim, full
// strength under the pointer: a desktop draws a Button as a native button of
// its plain label, padded about 0.75 cell each side, which a negative margin
// takes back so the word sits where text would.
const BAND_SPACE = { desktop: { inner: 0.5, outer: 2 }, terminal: { inner: 1, outer: 3 } }
const BAND_BUTTON_PAD = 0.75
// On the desktop the status line draws each segment as a tile, a faint wash of
// the band's text color with its border in the same wash (only its rounded
// corners show). The band's row is one tile the width of the band, its own
// thing under the status line's, divided into sections by thin rules. The
// wash, padding and line gap are copied from motta-statusline (`TILE`,
// `TILE_PAD`, `DESKTOP_LINE_GAP`): change the two together.
export type Scheme = 'dark' | 'light'
export const BAND_TILE: Record<Scheme, string> = { dark: '#ffffff0d', light: '#0000000a' }
// A rule between two sections: the wash a step stronger, about a pixel wide.
const BAND_RULE: Record<Scheme, string> = { dark: '#ffffff1f', light: '#0000001a' }
const BAND_RULE_W = 0.125
const BAND_TILE_PAD = { x: 1, y: 0.3 }
const BAND_LINE_GAP = 0.35
// The name's section takes this share of the row's spare room against 1 for
// the others, as the status line's bars do; the ✕'s takes none, as its ✦ does.
const BAND_NAME_GROW = 3

// The app's theme, read as the status line reads it: from the `theme` setting.
// An image has no theme keys, nor a Box's ground, so the tiles follow it.
let bandScheme: Scheme = 'dark'
let bandSchemeFor = ''
async function readScheme($: EngineInterface): Promise<Scheme> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'theme')
    return String(row?.value ?? '').includes('light') ? 'light' : 'dark'
  } catch {
    return bandScheme
  }
}

const bandSpace = (surface: string) => (surface === 'terminal' ? BAND_SPACE.terminal : BAND_SPACE.desktop)

// A plain segment, as the terminal draws the status line's.
function bandSeg(ui: any, surface: string, parts: unknown[], k: string) {
  const { Box } = ui
  return (
    <Box key={k} flexDirection="row" flexWrap="wrap" flexShrink={1} alignItems="center" columnGap={bandSpace(surface).inner}>
      {parts}
    </Box>
  )
}

// One section of the desktop's tile: its parts centered in what it takes of
// the row (`grow`), `gap` cells apart.
export type BandSection = { key: string; parts: unknown[]; grow: number; gap?: number }

// The desktop's row: one tile the width of the band, its sections side by
// side, a rule between each two, stretched (the tile's `alignItems`) to its
// height inside its padding.
function bandTile(ui: any, sections: BandSection[], key: string) {
  const { Box } = ui
  const ground = BAND_TILE[bandScheme]
  const items = sections.flatMap((s, i) => [
    ...(i === 0 ? [] : [<Box key={`${key}-rule-${i}`} width={BAND_RULE_W} flexShrink={0} backgroundColor={BAND_RULE[bandScheme]} />]),
    <Box key={s.key} flexDirection="row" flexWrap="wrap" flexGrow={s.grow} flexShrink={1} alignItems="center" justifyContent="center" columnGap={s.gap ?? BAND_SPACE.desktop.inner} paddingX={BAND_TILE_PAD.x}>
      {s.parts}
    </Box>,
  ])
  return (
    <Box key={key} flexDirection="row" alignItems="stretch" backgroundColor={ground} borderStyle="bold" borderColor={ground} paddingY={BAND_TILE_PAD.y}>
      {items}
    </Box>
  )
}

export function bandPress(ui: any, surface: string, key: string, label: string, onPress: () => void, role?: 'dismiss') {
  const { Box, Button } = ui
  const button = <Button plain dimColor key={key} label={label} onPress={onPress} {...(role ? { role } : {})} />
  return surface === 'desktop' ? <Box marginX={-BAND_BUTTON_PAD}>{button}</Box> : button
}

// `45s`, `4m10s`, `1h02m`: the status line's units, to the second while short.
export const bandTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// One piece of a segment: a figure at full strength, its word subtle, or a
// failure in the error color, as the status line draws `12 turns`.
export type RollPart = { text: string; tone: 'figure' | 'word' | 'error' }
// The tile a segment goes in on the desktop: the one agent's name and steps,
// the work (running, tools, failures), or the time and cost.
export type RollTile = 'name' | 'work' | 'time'
const ROLL_TILES: readonly RollTile[] = ['name', 'work', 'time']

// The roll call's segments: the one agent's name and steps, how many run, the
// tool calls, failures, the time since the first started, and the cost.
export const rollParts = (mine: AgentRun[], at: number): { tile: RollTile; parts: RollPart[] }[] => {
  const s = tr()
  const running = mine.filter(a => a.status === 'running').length
  const calls = mine.reduce((n, a) => n + (a.toolCalls ?? 0), 0)
  const failed = mine.reduce((n, a) => n + (a.failed ?? 0), 0)
  const cost = mine.reduce((n, a) => n + a.costUsd, 0)
  const start = Math.min(...mine.map(a => a.startedAt))
  const end = Math.max(...mine.map(a => a.endedAt ?? at))
  // One agent (its transcript open, or a batch of one) is named, with its steps.
  const only = mine.length === 1 ? mine[0] : undefined
  const segs: { tile: RollTile; parts: RollPart[] }[] = []
  const add = (tile: RollTile, ...parts: RollPart[]) => void segs.push({ tile, parts })
  if (only) add('name', { text: only.description || only.type, tone: 'figure' })
  if (only?.stepTotal) add('name', { text: `${only.stepDone ?? 0}/${only.stepTotal}`, tone: 'figure' }, { text: s.steps.toLowerCase(), tone: 'word' })
  if (running) add('work', { text: String(running), tone: 'figure' }, { text: s.busy, tone: 'word' })
  else add('work', { text: s.done.toLowerCase(), tone: 'word' })
  if (calls) add('work', { text: String(calls), tone: 'figure' }, { text: s.toolCalls(calls).replace(/^\d+ /, ''), tone: 'word' })
  if (failed) add('work', { text: `✗ ${failed}`, tone: 'error' })
  add('time', { text: bandTime(end - start), tone: 'figure' })
  add('time', { text: `$${cost.toFixed(2)}`, tone: 'figure' })
  return segs
}

export const rollStats = (mine: AgentRun[], at: number): string =>
  rollParts(mine, at)
    .map(seg => seg.parts.map(p => p.text).join(' '))
    .join(' · ')

// The crabs alone, a pitch of 25 apart, the figures being the band's own text.
const rollCrabsSvg = (shown: AgentRun[], at: number): string =>
  svg(
    rollCrabsWidth(shown.length),
    H,
    shown
      .map((a, i) => {
        const x = i * 25
        const fail = a.status === 'failed' ? `<path d="M${x + 17} 1l5 5M${x + 22} 1l-5 5" stroke="${FAIL}" stroke-width="1.6" stroke-linecap="round"/>` : ''
        return agentCrab(a, x, 1, at, a.status !== 'running', 0.72) + fail
      })
      .join(''),
  )

// The last crab's failure cross ends 23 past its start.
const rollCrabsWidth = (n: number): number => Math.max(1, n * 25 - 2)

// The roll call as the status line lays out a line: `agents` (pressed, it
// opens the panel) and the crabs, then the figures, wrapping between segments;
// the dismiss at the band's right edge, under the chips. On the desktop it is
// one tile divided into sections: the crabs, the one agent's name and steps,
// the work, the time and cost, and the ✕.
function rollRow(ui: any, surface: string, mine: AgentRun[], at: number, onAgents: () => void, onDismiss: () => void, key: string) {
  const { Box, Text } = ui
  const space = bandSpace(surface)
  const shown = mine.slice(0, ROLL_MAX)
  const crabs =
    surface !== 'terminal' && 'Svg' in ui ? (
      <ui.Svg source={rollCrabsSvg(shown, at)} alt={rollStats(mine, at)} width={rollCrabsWidth(shown.length)} height={H} />
    ) : (
      <Text>
        {shown.map((a, i) => (
          <Text key={a.id} color={a.status === 'failed' ? FAIL : roleOf(a).color} dimColor={a.status !== 'running'}>
            {i === 0 ? '▣' : ' ▣'}
          </Text>
        ))}
      </Text>
    )
  const lead = [bandPress(ui, surface, 'savvy-band-agents', tr().agentsCount, onAgents), crabs]
  if (mine.length > ROLL_MAX) lead.push(<Text color="subtle">+{mine.length - ROLL_MAX}</Text>)
  const draw = (parts: RollPart[]) =>
    parts.map(p => (p.tone === 'word' ? <Text color="subtle">{p.text}</Text> : p.tone === 'error' ? <Text color={FAIL}>{p.text}</Text> : <Text>{p.text}</Text>))
  const segs = rollParts(mine, at)
  if (surface !== 'terminal') {
    // A section holds its segments as the status line's branch tile holds its
    // groups: a segment's items together, a segment's width between them.
    const sections = ROLL_TILES.flatMap((tile): BandSection[] => {
      const here = segs.filter(x => x.tile === tile)
      if (here.length === 0) return []
      const groups = here.map((x, i) => (
        <Box key={`${tile}-${i}`} flexDirection="row" alignItems="center" columnGap={space.inner}>
          {draw(x.parts)}
        </Box>
      ))
      return [{ key: `roll-${tile}`, parts: groups, grow: tile === 'name' ? BAND_NAME_GROW : 1, gap: space.outer }]
    })
    return bandTile(
      ui,
      [
        { key: 'roll-lead', parts: lead, grow: 1 },
        ...sections,
        { key: 'roll-dismiss', parts: [bandPress(ui, surface, 'savvy-band-dismiss', '✕', onDismiss, 'dismiss')], grow: 0 },
      ],
      key,
    )
  }
  const figures = segs.map((x, i) => bandSeg(ui, surface, draw(x.parts), `roll-${i}`))
  return (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={space.outer}>
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} alignItems="center" columnGap={space.outer}>
        {bandSeg(ui, surface, lead, 'roll-lead')}
        {figures}
      </Box>
      {bandPress(ui, surface, 'savvy-band-dismiss', '✕', onDismiss, 'dismiss')}
    </Box>
  )
}

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [TIER_MODEL[tier] ?? '']
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${crab(0, 6, tier, true, false, CRAB_SCALE, CLAY, { body: color })}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier)}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

// --- the pane's hover cards: a hidden Box shown while its host is hovered. In
// the column a card opens upward from its keyed host (a row drawn later would
// paint over one hanging below); the top rows have no room above, so theirs
// are drawn last in the pane, below the host, and named by its hover scope.

// A path line keeps `text` a string: the desktop cuts it to its tail, then
// draws it as folder (dim) and file (bold).
type TipLine = { text: string | TipPiece[]; isPath?: boolean }
type TipAt = { bottom?: number; top?: number; scope?: string; side?: 'left' | 'right' }

const TIP_BG = '#34332f'
const TIP_LINES = 5
const TIP_W = 48
// A desktop text row, in px: what one cell of offset moves.
const ROW_PX = 19
// A desktop button's height in rows, rounded up: a card clears it by this much.
const BUTTON_ROWS = 2

// The desktop app stops drawing a pane past about 1,100 elements (1,006 drew,
// 1,204 did not) or about 300,000 characters (257k drew, 355k did not). The Agents pane
// draws at the richest level that fits: 0 every card, 1 action and status
// cards only, 2 no cards, 3 Finished folds after FOLD_TIGHT agents (even if
// shown), 4 Finished folded whole. A running agent is never folded.
export const BUDGET = 1000
// Characters of the serialized tree: an agent block's SVG alone is ~20k.
export const CHAR_BUDGET = 200_000
// The level with no cards: the terminal's (see fit).
export const NO_CARDS = 2
const LEVEL_TOP = 4
// Finished shows its newest FOLD_AFTER agents; the rest wait under one line.
const FOLD_AFTER = 20
const FOLD_TIGHT = 10
// Elements in a tree, counted as the live measure counted them.
export function countNodes(tree: unknown): number {
  let nodes = 0
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    nodes += 1
    walk(n.children)
    walk(n.props?.children)
  }
  walk(tree)
  return nodes
}
// Draws at level 0, then 1, 2, ... until the tree fits or `top` is reached.
// Only the desktop (and VS Code) has the limit. The terminal draws no hover
// cards at all, its folds left out: level NO_CARDS.
export function fit<T>(surface: string, top: number, draw: (level: number) => T): T {
  if (surface === 'terminal') return draw(NO_CARDS)
  if (surface !== 'desktop' && surface !== 'vscode') return draw(0)
  let tree = draw(0)
  for (let level = 1; level <= top && (countNodes(tree) > BUDGET || JSON.stringify(tree).length > CHAR_BUDGET); level += 1) tree = draw(level)
  return tree
}
// The level being drawn, set by the pane's draw before it builds: tip() reads it.
let cardLevel = 0
const hasCard = (tone: Tone): boolean => cardLevel === 0 || (cardLevel === 1 && tone !== 'info')
// A card's host lights up on hover only while it has a card to reveal.
const lit = (hasTip: unknown, scope?: string) => (hasTip ? { hover: scope ? { scope, backgroundColor: '#ffffff10' } : { backgroundColor: '#ffffff10' } } : {})
// The fold line's Show: the older finished agents drawn past FOLD_AFTER.
let isOlderShown = false
// Finished, newest first, cut to the agents the level leaves: the groups to
// draw and how many agents wait under the fold line.
export const foldFinished = (groups: AgentGroup[], level: number, isShown: boolean): { shown: AgentGroup[]; hidden: number } => {
  let left = level >= 4 ? 0 : level >= 3 ? FOLD_TIGHT : isShown ? Infinity : FOLD_AFTER
  let hidden = 0
  const shown: AgentGroup[] = []
  for (const g of groups) {
    const agents = g.agents.slice(0, Math.max(0, left))
    hidden += g.agents.length - agents.length
    left -= agents.length
    if (agents.length) shown.push({ ...g, agents })
  }
  return { shown, hidden }
}

// How a card fits over a host `h` rows tall with `room` plain rows above it,
// back to the nearest button: as many lines as fit, raised as far as they may,
// sliding down over the host itself rather than onto the button. `pad` is the
// card's own rows besides its lines.
const tipFit = (h: number, room: number, pad: number, want = TIP_LINES): { lines: number; bottom: number } => {
  const lines = Math.max(0, Math.min(want, Math.floor(h + room - pad)))
  return { lines, bottom: Math.max(0, Math.min(Math.ceil(h), Math.floor(h + room - lines - pad))) }
}

// None on mobile, which has no pointer. One row clear of its host: a pointer
// leaving the host crosses that row, so the card closes instead of holding the
// pointer over what it covers.
function tip(ui: any, surface: string, lines: TipLine[], at: TipAt, width: number, tone: Tone = 'info') {
  const { Box, Text } = ui
  if (surface === 'mobile' || lines.length === 0 || !hasCard(tone)) return null
  const term = surface === 'terminal'
  const place = { ...(at.top !== undefined ? { top: at.top + 1 } : { bottom: (at.bottom ?? 1) + 1 }), ...(at.side === 'left' ? { left: 0 } : { right: 0 }) }
  const drawn = lines.slice(0, TIP_LINES).map((l, i) => {
    let pieces: TipPiece[]
    if (l.isPath && typeof l.text === 'string') {
      // The desktop cuts a path's end whatever the wrap: keep its tail by hand.
      pieces = pathPieces(!term && l.text.length > width - 6 ? `…${l.text.slice(-(width - 7))}` : l.text)
    } else pieces = typeof l.text === 'string' ? [{ t: l.text, s: i === 0 ? 'b' : 'd' }] : l.text
    return (
      <Text key={`l${i}`} wrap={l.isPath ? 'truncate-start' : 'truncate-end'} bold={i === 0} color={TIP_FG}>
        {pieces.map((p, j) => {
          if (typeof p === 'string') return p
          const tint = TINT[p.s]
          if (tint)
            return (
              <Text key={j} color={tint[0]} backgroundColor={tint[1]} bold={p.s === 'key'}>
                {` ${p.t} `}
              </Text>
            )
          const color = { d: TIP_DIM, f: TIP_FAINT, good: TIP_GOOD, bad: TIP_BAD, warn: TIP_WARN, accent: TIP_ACCENT }[p.s as string]
          return (
            <Text key={j} bold={p.s === 'b'} italic={p.s === 'i'} color={color}>
              {p.t}
            </Text>
          )
        })}
      </Text>
    )
  })
  const hover = at.scope ? { scope: at.scope, display: 'flex' } : { display: 'flex' }
  if (term)
    return (
      <Box position="absolute" {...place} display="none" hover={hover} flexDirection="column" paddingX={0.75} paddingY={0} width={width} borderStyle="round" borderColor={TONES[tone]}>
        {drawn}
      </Box>
    )
  // The desktop: a thin bar down the left edge in the card's tone.
  return (
    <Box position="absolute" {...place} display="none" hover={hover} flexDirection="row" backgroundColor={TIP_BG} paddingX={0} paddingY={0.3} width={width}>
      <Box width={0.25} backgroundColor={TONES[tone]} />
      <Box flexDirection="column" paddingX={0.75} flexShrink={1} minWidth={0}>
        {drawn}
      </Box>
    </Box>
  )
}

// A crab's name tag: the title's first word, past a `Prefix:` the titles share
// ("Demo: stopped midway" is "stopped"), cut to the crab's width.
export const shortName = (title: string): string => {
  const rest = title.includes(': ') ? title.slice(title.indexOf(': ') + 2) : title
  return fitText((rest.trim().split(/\s+/)[0] ?? '').replace(/[.,:;]+$/, ''), 9.5, 34)
}

// The strip groups the crabs by status, failed first, each group led by its
// mark and count; over each crab its name, under it a mini bar: its steps,
// else its context. On top of the full view it drops the stats the tiles show.
const COMPACT_H = 54
// Room between the strip and the tiles under it in the full view.
const STRIP_GAP = 12
const COMPACT_ORDER = ['failed', 'running', 'stopped', 'done'] as const
const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>, at: number, hasStats = true, padBottom = 0): string => {
  const stats = hasStats ? `≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}` : ''
  const name = (x: number, title: string) => `<text class="s" x="${x + 16.5}" y="9" text-anchor="middle" font-family="${FONT}" font-size="9.5">${xml(shortName(title))}</text>`
  const groups = [
    ...COMPACT_ORDER.map(st => ({ st, agents: list.filter(a => a.status === st), planned: [] as Planned[] })),
    { st: 'planned', agents: [] as AgentRun[], planned },
  ].filter(g => g.agents.length + g.planned.length > 0)
  // Past the room left of the stats a group shows fewer crabs; its count stays true.
  const room = hasStats ? W - textWidth(stats, 12) - 12 : W
  const parts: string[] = []
  let x = 0
  for (const [i, g] of groups.entries()) {
    if (i) {
      parts.push(`<line class="ln" x1="${x + 5.5}" y1="18" x2="${x + 5.5}" y2="46"/>`)
      x += 12
    }
    const count = String(g.agents.length + g.planned.length)
    parts.push(`${statusMark(x + 6, 29, g.st, RUNNING)}<text class="s" x="${x + 14}" y="33" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${count}</text>`)
    x += 14 + textWidth(count, 12) + 6
    for (const a of g.agents) {
      if (x + 34 > room) break
      const progress = progressOf(a)
      const share = a.status === 'done' ? 1 : progress ?? ctxOf(a) / 100
      const fill = a.status === 'failed' ? `fill="${FAIL}"` : a.status === 'done' ? `fill="${OK}"` : `class="${progress === null ? 'm' : 's'}"`
      const bar =
        a.status === 'stopped'
          ? cutBar(x + 2, 48, 28, 3, share)
          : `<rect class="k" x="${x + 2}" y="48" width="28" height="3" rx="1.5"/><rect ${fill} x="${x + 2}" y="48" width="${Math.max(2, Math.round(28 * share))}" height="3" rx="1.5"/>`
      parts.push(name(x, a.description || a.type) + agentCrab(a, x, 12, at, a.status === 'stopped') + bar)
      x += 36
    }
    for (const p of g.planned) {
      if (x + 34 > room) break
      parts.push(name(x, p.title) + crab(x, 12, p.tier in TIER_COLOR ? p.tier : 'other', true, false, CRAB_SCALE, CLAY, { body: colorOf(p.tier) }))
      x += 36
    }
  }
  return svg(
    W,
    COMPACT_H + padBottom,
    `${parts.join('')}
${stats && `<text class="s" x="${W}" y="33" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${stats}</text>`}`,
  )
}

// --- the timeline, on top of the pane: a ruler of the session, then the
// agents in batches. A batch is the agents started together: by one call, or
// within BATCH_WINDOW of the batch's first start. The ruler puts every batch on
// one axis of clock time, where a stretch with no agent at work longer than
// IDLE_MIN folds into a small dashed box, so batches far apart stay readable.
// Under it each batch has a header with its clock range and run time; the
// newest is open as lanes (each agent's run on the batch's own axis, its ticks
// spread evenly over it: a tick keeps no time of its own, so their spacing
// says nothing), the older ones folded to one strip of their runs overlaid.

export const LANES_MAX = 20
export const BATCH_WINDOW = 10_000
export const IDLE_MIN = 10_000
const LANE_H = 22
// Room over the first lane, and under the last one.
const LANES_TOP = 4
const LANES_FOOT = 4
// One size for every word and figure in a lane; the number column starts
// after the status mark, the name a fixed gap after the number.
const LANE_FONT = 12.5
const NUM_X = 16
const NUM_GAP = 7
// The ruler: a dashed box where idle time folds, a least width per stretch of
// work, and its height (batch numbers over the track, clock times under it).
const GAP_W = 22
const SPAN_MIN = 36
const RULER_H = 50
// A folded batch's strip, and the rule that ends the timeline.
const STRIP_H = 12
const RULE_H = 12
const BATCH_DONE = '#5b8fcc'

export type Lane = { n: number; agent: AgentRun; from: number; to: number }

// Each listed agent's number: its place in order of start, from 1. The lanes
// and the cards both show it, so a lane and its card read as one agent.
export const agentNumbers = (list: AgentRun[]): Map<string, number> =>
  new Map([...list].sort((x, y) => x.startedAt - y.startedAt).map((a, i) => [a.id, i + 1]))

const endOf = (a: AgentRun, at: number): number => a.endedAt ?? Math.max(at, a.startedAt)

// The lanes in order of start, the latest LANES_MAX of them, numbered as the
// pane numbers them; `from` and `to` are shares of the span, first start to
// last end (or now).
export const lanesOf = (list: AgentRun[], at: number, numbers?: Map<string, number>): { lanes: Lane[]; span: number; hidden: number } => {
  const byStart = [...list].sort((x, y) => x.startedAt - y.startedAt)
  if (byStart.length === 0) return { lanes: [], span: 0, hidden: 0 }
  const start = byStart[0]!.startedAt
  const span = Math.max(1, ...byStart.map(a => endOf(a, at) - start))
  const share = (t: number) => Math.min(1, Math.max(0, (t - start) / span))
  const all = byStart.map((a, i) => ({ n: numbers?.get(a.id) ?? i + 1, agent: a, from: share(a.startedAt), to: share(endOf(a, at)) }))
  const lanes = all.slice(-LANES_MAX)
  return { lanes, span, hidden: all.length - lanes.length }
}

export type Batch = { key: string; n: number; label: string; prompt?: string; agents: AgentRun[]; start: number; end: number; running: number; failed: number }

// The agents in batches, in order of start: one per turn of yours, the agents
// your message set going (its own turn's and those of the turns its agents'
// reports start). An agent recorded before turns were kept joins the batch its
// call started, or the latest such batch when it starts within BATCH_WINDOW of
// its first start. A turn's batch is keyed by the turn, any other by its first
// agent's id, so one folded or opened stays so as it grows.
export const batchesOf = (list: AgentRun[], at: number): Batch[] => {
  const groups: { turn?: number; anchors: Set<string>; agents: AgentRun[] }[] = []
  for (const a of [...list].sort((x, y) => x.startedAt - y.startedAt)) {
    const anchor = a.anchor ?? a.id
    const last = groups.filter(g => g.turn === undefined).at(-1)
    const home =
      a.turn !== undefined
        ? groups.find(g => g.turn === a.turn)
        : (groups.find(g => g.turn === undefined && g.anchors.has(anchor)) ?? (last && a.startedAt - last.agents[0]!.startedAt <= BATCH_WINDOW ? last : undefined))
    if (home) {
      home.anchors.add(anchor)
      home.agents.push(a)
    } else groups.push({ turn: a.turn, anchors: new Set([anchor]), agents: [a] })
  }
  return groups.map((g, i) => ({
    key: g.turn !== undefined ? `turn-${g.turn}` : g.agents[0]!.id,
    n: i + 1,
    label: g.turn !== undefined ? `${tr().turn} ${g.turn}` : `${tr().batch} ${i + 1}`,
    prompt: g.agents[0]!.prompt,
    agents: g.agents,
    start: g.agents[0]!.startedAt,
    end: Math.max(...g.agents.map(a => endOf(a, at))),
    running: g.agents.filter(a => a.status === 'running').length,
    failed: g.agents.filter(a => a.status === 'failed').length,
  }))
}

export type Span = { start: number; end: number }

// The stretches of work: the batches' runs merged where less than IDLE_MIN
// of idle time lies between them.
export const busySpans = (batches: Batch[]): Span[] => {
  const spans: Span[] = []
  for (const b of [...batches].sort((x, y) => x.start - y.start)) {
    const last = spans.at(-1)
    if (last && b.start - last.end <= IDLE_MIN) last.end = Math.max(last.end, b.end)
    else spans.push({ start: b.start, end: b.end })
  }
  return spans
}

// Where the ruler draws each stretch across `width`: a gap of `gap` between
// stretches (the folded idle time), each at least `least` wide, the rest of the
// width shared by how long each ran; `x(t)` places a moment of work on it.
export const rulerScale = (spans: Span[], width: number, gap = GAP_W, least = SPAN_MIN) => {
  const k = Math.max(1, spans.length)
  const room = Math.max(k, width - gap * (k - 1))
  const floor = Math.min(least, room / k)
  const busy = spans.reduce((t, s) => t + Math.max(1, s.end - s.start), 0) || 1
  let x = 0
  const boxes = spans.map(s => {
    const w = floor + ((room - floor * k) * Math.max(1, s.end - s.start)) / busy
    const box = { ...s, x, w }
    x += w + gap
    return box
  })
  const at = (t: number): number => {
    const box = boxes.find(b => t <= b.end) ?? boxes.at(-1)
    if (!box) return 0
    return box.x + Math.min(1, Math.max(0, (t - box.start) / Math.max(1, box.end - box.start))) * box.w
  }
  return { boxes, at }
}

const two = (n: number) => String(n).padStart(2, '0')

// A moment as the clock read it, `14:02`, with seconds when asked.
export const clockOf = (ms: number, seconds = false): string => {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? `:${two(d.getSeconds())}` : ''}`
}

// When something ran, `14:02–14:05`; `14:33–now` while it runs.
export const rangeOf = (start: number, end: number, isRunning: boolean): string => `${clockOf(start)}–${isRunning ? tr().now : clockOf(end)}`

// A stretch of idle time, by the minute: `<1m`, `10m`, `1h05m`.
export const idleOf = (ms: number): string => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// A batch's second line: when it started and ended, how long it ran, and the
// idle time since the batch before it ended.
export const batchTimes = (b: Batch, before: Batch | undefined): string => {
  const s = tr()
  const isOneMinute = !b.running && clockOf(b.start) === clockOf(b.end)
  return [
    ...(isOneMinute ? [`${s.at} ${clockOf(b.start)}`] : [`${s.started} ${clockOf(b.start)}`, b.running ? s.runningNow : `${s.ended} ${clockOf(b.end)}`]),
    `${s.ran} ${fmtTime(b.end - b.start)}`,
    ...(before && b.start > before.end ? [s.idleBefore(idleOf(b.start - before.end))] : []),
  ].join(' · ')
}

// A lane's mark, as the agent's card draws it: ✓ ✗ ■, ● in its model's color
// while it runs, an amber ◷ once overdue.
export const laneMark = (a: AgentRun, at: number): { glyph: string; color: string } => {
  if (a.status === 'running' && isOverdue(a, at)) return { glyph: '◷', color: WARN }
  const color = a.status === 'failed' ? FAIL : a.status === 'done' ? OK : a.status === 'stopped' ? STOPPED : roleOf(a).color
  return { glyph: STATUS_GLYPH[a.status] ?? '●', color }
}

// A batch on the ruler and in its strip: clay while it runs, red with a
// failure, blue once done.
const batchColor = (b: Batch): string => (b.running ? CLAY : b.failed ? FAIL : BATCH_DONE)

const tickFill = (t: Tick): string => (t.state === 'failed' ? FAIL : toolColor(t.family, t.reach))

export const lanesHeight = (lanes: Lane[], hidden: number): number => LANES_TOP + (lanes.length + (hidden ? 1 : 0)) * LANE_H + LANES_FOOT

const lanesSvg = (W: number, lanes: Lane[], hidden: number, at: number): string => {
  const nameW = Math.min(240, Math.round(W * 0.36))
  // Numbers in a column of their own, as wide as the widest, then the names
  // all starting at one edge.
  const nameX = NUM_X + textWidth(`#${Math.max(...lanes.map(l => l.n), 1)}`, LANE_FONT) + NUM_GAP
  const timeW = 42
  const x0 = nameW + 8
  const x1 = W - timeW
  const top = LANES_TOP
  const more = hidden ? `<text class="m" x="${NUM_X}" y="${top + lanes.length * LANE_H + 14}" font-family="${FONT}" font-size="11">${xml(tr().earlierLanes(hidden))}</text>` : ''
  const rows = [...lanes].reverse().map((l, i) => {
    const a = l.agent
    const y = top + i * LANE_H
    const m = laneMark(a, at)
    const left = x0 + l.from * (x1 - x0)
    const width = Math.max(3, (l.to - l.from) * (x1 - x0))
    // As many of its latest ticks as fit a pixel apart, spread over its run.
    const ticks = (a.ticks ?? []).slice(-Math.max(1, Math.floor((width + 1) / 2.5)))
    const step = ticks.length ? width / ticks.length : width
    const run = ticks.length
      ? ticks.map((t, k) => `<rect x="${(left + k * step).toFixed(1)}" y="${y + 7}" width="${Math.max(1, step - 1).toFixed(1)}" height="8" rx="1" fill="${tickFill(t)}"/>`).join('')
      : `<rect class="m" x="${left.toFixed(1)}" y="${y + 7}" width="${width.toFixed(1)}" height="8" rx="1"/>`
    return `<text x="0" y="${y + 14.5}" font-family="${FONT}" font-size="${LANE_FONT}" fill="${m.color}">${m.glyph}</text>
<text class="s" x="${NUM_X}" y="${y + 14.5}" font-family="${FONT}" font-size="${LANE_FONT}" font-variant-numeric="tabular-nums">#${l.n}</text>
<text class="t" x="${nameX}" y="${y + 14.5}" font-family="${FONT}" font-size="${LANE_FONT}">${xml(fitText(a.description || a.type, LANE_FONT, nameW - nameX))}</text>
<line class="ln" x1="${x0}" y1="${y + 11}" x2="${x1}" y2="${y + 11}" stroke-width="1" stroke-dasharray="1 4"/>
<g${a.status === 'running' ? ' class="live"' : ''}>${run}</g>
<text class="s" x="${W}" y="${y + 14.5}" text-anchor="end" font-family="${FONT}" font-size="${LANE_FONT}" font-variant-numeric="tabular-nums">${fmtTime(elapsed(a, at))}</text>`
  })
  return svg(W, lanesHeight(lanes, hidden), more + rows.join('\n'))
}

// The session's ruler: each batch a bar on the axis of clock time, its number
// over it while there is room, the folded idle time a dashed box, and the clock
// time each stretch of work began and ended under it.
const rulerSvg = (W: number, batches: Batch[], at: number): string => {
  const spans = busySpans(batches)
  const { boxes, at: xOf } = rulerScale(spans, W)
  const TRACK = 20
  const parts: string[] = []
  for (const [i, b] of batches.entries()) {
    const x0 = xOf(b.start)
    const x1 = Math.max(x0 + 3, xOf(b.end))
    parts.push(`<rect${b.running ? ' class="live"' : ''} x="${x0.toFixed(1)}" y="${TRACK}" width="${(x1 - x0).toFixed(1)}" height="10" rx="2" fill="${batchColor(b)}" opacity=".85"/>`)
    // Its name while it fits before the next batch, else its number alone.
    const room = (i + 1 < batches.length ? xOf(batches[i + 1]!.start) : W) - x0 - 4
    const name = b.label
    const short = name.split(' ').at(-1) ?? ''
    const label = textWidth(name, 11) <= room ? name : textWidth(short, 11) <= room ? short : ''
    if (label) parts.push(`<text class="s" x="${x0.toFixed(1)}" y="${TRACK - 6}" font-family="${FONT}" font-size="11">${xml(label)}</text>`)
  }
  const isRunning = batches.some(b => b.running)
  for (const [i, box] of boxes.entries()) {
    if (i > 0) parts.push(`<rect class="gap" x="${(box.x - GAP_W + 3).toFixed(1)}" y="${TRACK - 4}" width="${GAP_W - 6}" height="18" rx="3" fill="none" stroke-width="1" stroke-dasharray="3 2"/>`)
    const isLast = i === boxes.length - 1
    const from = clockOf(box.start)
    const to = isLast && isRunning ? tr().now : clockOf(box.end)
    const both = textWidth(from, 11) + textWidth(to, 11) + 8 <= box.w
    const y = TRACK + 25
    if (textWidth(from, 11) <= box.w + GAP_W - 4) parts.push(`<text class="s" x="${box.x.toFixed(1)}" y="${y}" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${from}</text>`)
    if (both) parts.push(`<text class="s" x="${(box.x + box.w).toFixed(1)}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${to}</text>`)
  }
  const css = '<style>.gap{stroke:#9a9a96}@media (prefers-color-scheme: dark){.gap{stroke:#5f5f5b}}</style>'
  return svg(W, RULER_H, css + parts.join(''))
}

// A folded batch: its agents' runs on the batch's own axis, one over another.
const stripOfSvg = (W: number, b: Batch, at: number): string => {
  const span = Math.max(1, b.end - b.start)
  const x0 = NUM_X
  const w = W - x0
  const runs = b.agents
    .map(a => {
      const from = x0 + ((a.startedAt - b.start) / span) * w
      const to = x0 + ((endOf(a, at) - b.start) / span) * w
      const fill = a.status === 'failed' ? FAIL : a.status === 'running' ? roleOf(a).color : BATCH_DONE
      return `<rect x="${from.toFixed(1)}" y="2" width="${Math.max(2, to - from).toFixed(1)}" height="7" rx="1" fill="${fill}" opacity=".45"/>`
    })
    .join('')
  return svg(W, STRIP_H, `<line class="ln" x1="${x0}" y1="5.5" x2="${W}" y2="5.5" stroke-width="1" stroke-dasharray="1 4"/>${runs}`)
}

const ruleSvg = (W: number): string => svg(W, RULE_H, `<line class="ln" x1="0" y1="${RULE_H / 2}" x2="${W}" y2="${RULE_H / 2}" stroke-width="1"/>`)

// The terminal's lane track: `·` outside the run, inside it the ticks as `▮`
// spread over its cells, gray where it made no call.
export const laneCells = (l: Lane, width: number): { ch: string; color?: string }[] => {
  const a = l.agent
  const from = Math.min(width - 1, Math.floor(l.from * width))
  const to = Math.max(from + 1, Math.min(width, Math.ceil(l.to * width)))
  const shown = (a.ticks ?? []).slice(-(to - from))
  return Array.from({ length: width }, (_, i) => {
    if (i < from || i >= to) return { ch: '·' }
    if (shown.length === 0) return { ch: '▮', color: RUNNING }
    return { ch: '▮', color: tickFill(shown[Math.floor(((i - from) * shown.length) / (to - from))]!) }
  })
}

// The terminal's ruler, `width` cells: each batch `━` in its color, the folded
// idle time ` ┆ `, `·` where a stretch has no batch at that moment.
export const rulerCells = (batches: Batch[], width: number): { ch: string; color?: string }[] => {
  const { boxes, at: xOf } = rulerScale(busySpans(batches), width, 3, 4)
  const cells: { ch: string; color?: string }[] = Array.from({ length: width }, () => ({ ch: ' ' }))
  for (const box of boxes) for (let i = Math.floor(box.x); i < Math.min(width, Math.ceil(box.x + box.w)); i++) cells[i] = { ch: '·' }
  for (const box of boxes.slice(1)) {
    const mid = Math.round(box.x - 2)
    if (mid >= 0 && mid < width) cells[mid] = { ch: '┆' }
  }
  for (const b of batches) {
    const from = Math.min(width - 1, Math.floor(xOf(b.start)))
    const to = Math.max(from + 1, Math.min(width, Math.ceil(xOf(b.end))))
    for (let i = from; i < to; i++) cells[i] = { ch: '━', color: batchColor(b) }
  }
  return cells
}

// A folded batch's strip in text: `▮` where any of its agents ran, in the
// color of the latest that did.
export const stripCells = (b: Batch, width: number, at: number): { ch: string; color?: string }[] => {
  const span = Math.max(1, b.end - b.start)
  return Array.from({ length: width }, (_, i) => {
    const t = b.start + ((i + 0.5) / width) * span
    const on = b.agents.filter(a => a.startedAt <= t && endOf(a, at) >= t).at(-1)
    if (!on) return { ch: '·' }
    return { ch: '▮', color: on.status === 'failed' ? FAIL : on.status === 'running' ? roleOf(on).color : BATCH_DONE }
  })
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', stopped: '■', planned: '◷' }

// --- what each agent is doing now: its streamed text and tool calls, gathered
// here as they come and written to `agents` once a second by the clock.

const LIVE_MAX = 200

// The sentence being written, or the last one finished while the next is still a few words.
export const lastPhrase = (text: string): string => {
  const pieces = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map(p => p.replace(/^\s*(?:[-*+>#]+|\d+\.)\s*/, '').replace(/[`*_]/g, '').trim())
    .filter(Boolean)
  const last = pieces.at(-1) ?? ''
  const phrase = last.length < 12 && pieces.length > 1 ? `${pieces.at(-2)} ${last}` : last
  return phrase.length > LIVE_MAX ? '…' + phrase.slice(-(LIVE_MAX - 1)) : phrase
}

const ARG_KEYS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'skill', 'prompt']

// `→ Read register.tsx`: the tool, short, and the one argument that says what it touches.
export const toolLine = (tool: string, input: Record<string, unknown>): string => {
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool
  const key = ARG_KEYS.find(k => typeof input[k] === 'string' && (input[k] as string).trim())
  let arg = key ? ((input[key] as string).trim().split('\n')[0] ?? '') : ''
  if (key && /path$/.test(key)) arg = arg.split(/[\\/]/).filter(Boolean).at(-1) ?? arg
  const line = arg ? `→ ${name} ${arg}` : `→ ${name}`
  return line.length > LIVE_MAX ? line.slice(0, LIVE_MAX - 1) + '…' : line
}

// --- the agent's record of its tool calls: written as each call starts and ends
// (a few a second at most), so what a hook rewrote reaches the panel at once.

const TICKS_MAX = 80
const TRAIL_MAX = 3
const FILES_MAX = 20

// The session's folder, which a call's reach is measured from; read once.
let root = ''

// The files a call touches and what it does to each: the path its input names
// (a file, not a folder: it has an extension), and in a shell command each
// piece's files, judged piece by piece (`node x.js && cat y.md`: x.js runs, y.md
// is read), a redirect's target changed.
const PIECES = /&&|\|\||[;|\n]/
const looksLikeFile = (t: string): boolean => !/^-|^[a-z]+:\/\//i.test(t) && /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(t.split(/[\\/]/).at(-1) ?? '')
const unquote = (t: string): string => t.replace(/^["']|["']$/g, '')

export const filesOf = (tool: string, input: Record<string, unknown>, family: ToolFamily, folder: string): TouchedFile[] => {
  const named = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string' && looksLikeFile(v.trim()))
  if (named) return [{ path: named.trim(), family, reach: reachOfPath(named.trim(), folder) }]
  const command = tool === 'Bash' || tool === 'PowerShell' ? input.command : undefined
  if (typeof command !== 'string') return []
  const out: TouchedFile[] = []
  for (const piece of command.split(PIECES)) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean).map(unquote)
    if (!tokens.length) continue
    const of = judgeCommand(tokens, folder).family
    for (const t of tokens) if (looksLikeFile(t)) out.push({ path: t, family: of, reach: reachOfPath(t, folder) })
  }
  for (const m of command.matchAll(/(?:^|[^0-9&>])>{1,2}\s*([^\s&|;]+)/g)) {
    const t = unquote(m[1]!)
    if (looksLikeFile(t)) out.push({ path: t, family: 'change', reach: reachOfPath(t, folder) })
  }
  return out
}

// tool-borders' order of risk: what happened to a file is the riskiest thing
// done to it, whenever it happened.
const FAMILY_RANK: Record<ToolFamily, number> = { bookkeeping: 0, read: 1, change: 2, delegate: 3, run: 4 }
export const riskiest = (a: ToolFamily | undefined, b: ToolFamily): ToolFamily => (a && FAMILY_RANK[a] >= FAMILY_RANK[b] ? a : b)
// A record written before files had a family: an edit was a change, else a read.
export const fileFamily = (f: TouchedFile): ToolFamily => f.family ?? (f.isEdited ? 'change' : 'read')

// Touched now: newest first, its family the riskiest so far.
const touch = (files: TouchedFile[], now: TouchedFile[]): TouchedFile[] => {
  let out = files
  for (const f of now) {
    const was = out.find(x => x.path === f.path)
    out = [{ path: f.path, family: riskiest(was ? fileFamily(was) : undefined, f.family ?? 'read'), reach: f.reach }, ...out.filter(x => x.path !== f.path)]
  }
  return out.slice(0, FILES_MAX)
}

// A call starts: counted, a tick, a trail entry, and the files it touches.
export const startCall = (a: AgentRun, id: string, tool: string, input: Record<string, unknown>, at: number, folder = root): AgentRun => {
  const { family, reach } = classify(tool, input, folder)
  const now = filesOf(tool, input, family, folder)
  return {
    ...a,
    toolCalls: (a.toolCalls ?? 0) + 1,
    kinds: { ...a.kinds, [family]: (a.kinds?.[family] ?? 0) + 1 },
    ticks: [...(a.ticks ?? []), { id, family, reach, state: 'running' as const }].slice(-TICKS_MAX),
    trail: [...(a.trail ?? []), { id, kind: 'tool' as const, text: toolLine(tool, input), tool: family, reach, state: 'running' as const }].slice(-TRAIL_MAX),
    files: now.length ? touch(a.files ?? [], now) : a.files,
    activeAt: at,
  }
}

// A call ends: its tick and its trail entry take the outcome, wherever they are now.
export const endCall = (a: AgentRun, id: string, isOk: boolean, at: number): AgentRun => {
  const state = isOk ? ('ok' as const) : ('failed' as const)
  return {
    ...a,
    failed: (a.failed ?? 0) + (isOk ? 0 : 1),
    ticks: a.ticks?.map(t => (t.id === id ? { ...t, state } : t)),
    trail: a.trail?.map(t => (t.id === id ? { ...t, state } : t)),
    activeAt: at,
  }
}

// A phrase of the request `slot`: its entry is replaced as the phrase grows,
// thinking giving way to text, so one request keeps one entry.
export const saySlot = (a: AgentRun, slot: string, kind: 'say' | 'think', text: string, at: number): AgentRun => {
  const trail = a.trail ?? []
  const entry = { id: slot, kind, text }
  const has = trail.some(t => t.id === slot)
  return {
    ...a,
    trail: has ? trail.map(t => (t.id === slot ? entry : t)) : [...trail, entry].slice(-TRAIL_MAX),
    activeAt: at,
  }
}

// How an agent's turn ended: an answer is done, an interruption stopped, a
// refusal or an error failed.
export const endStatus = (reason: string): AgentRun['status'] => (reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed')

// What the engine says of an agent savvy still has running: killed is stopped,
// failed failed, completed done; anything else (running, waiting, idle) leaves it.
export const ENGINE_END: Record<string, AgentRun['status'] | undefined> = { killed: 'stopped', failed: 'failed', completed: 'done' }

// Runs savvy still has running that the engine has ended, finished as the
// engine says: a stop from the tasks list or TaskStop ends no turn savvy sees.
// An agent the list does not name is left alone: a workflow's never are.
export const reconcile = (list: AgentRun[], engine: { id: string; status: string }[], at: number): AgentRun[] => {
  const ended = new Map(engine.map(x => [x.id, ENGINE_END[x.status]]))
  return list.map(a => {
    const status = a.status === 'running' && a.agentId ? ended.get(a.agentId) : undefined
    if (!status) return a
    return {
      ...a,
      status,
      endedAt: at,
      // Its calls still open ended with it.
      ticks: a.ticks?.map(t => (t.state === 'running' ? { ...t, state: 'failed' as const } : t)),
      trail: a.trail?.map(t => (t.state === 'running' ? { ...t, state: 'failed' as const } : t)),
    }
  })
}

// The first line of a final answer, its markdown dropped.
export const firstLine = (answer: string): string => {
  const line = answer.split('\n').map(l => l.replace(/^\s*(?:[-*+>#]+|\d+\.)\s*/, '').replace(/[`*_]/g, '').trim()).find(Boolean) ?? ''
  return line.length > LIVE_MAX ? line.slice(0, LIVE_MAX - 1) + '…' : line
}

// Its text and thinking stream far faster than anyone reads: gathered here and
// written once a second by the clock. `slot` names the request the phrase is of.
type Pending = { text: string; thinking: string; slot: string; say?: { kind: 'say' | 'think'; text: string }; isActive: boolean; seen: number }
// Module scope on purpose: a reload loses at most a second of it.
const pending = new Map<string, Pending>()
// Whether a message you typed came in since the last turn started.
let isFreshPrompt = false

// Writes the phrases that came in since the last tick to the agents they belong
// to, and that they were active: any chunk counts, a tool call's arguments too. An agent not in the list yet keeps its phrase for a later tick; one never
// listed (a compaction fork) is dropped after a while.
async function flushLive($: EngineInterface, at: number): Promise<void> {
  if (!pending.size) return
  const list = await read($, agents)
  const known = new Set(list.map(a => a.agentId).filter(Boolean))
  const running = new Set(list.filter(a => a.status === 'running').map(a => a.agentId))
  const due = new Map<string, Pending>()
  for (const [id, p] of pending) {
    if (known.has(id) && (p.say || p.isActive)) due.set(id, p)
    else if (known.has(id) ? !running.has(id) : at - p.seen > 30_000) pending.delete(id)
  }
  if (!due.size) return
  const says = new Map([...due].map(([id, p]) => [id, p.say ? { slot: p.slot, ...p.say } : null]))
  for (const p of due.values()) {
    p.say = undefined
    p.isActive = false
  }
  await update($, agents, l =>
    l.map(a => {
      if (!a.agentId || !says.has(a.agentId)) return a
      const d = says.get(a.agentId)
      return d ? saySlot(a, d.slot, d.kind, d.text, at) : { ...a, activeAt: at }
    }),
  )
}

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

// Opens the agents pane for another mod (turn-receipt's `agents`), or leaves it open.
async function openPane($: EngineInterface): Promise<SavvyProgressOpened> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) return { isPlaced: true }
  const at = await $.clock.now()
  await update($, now, () => at)
  const opened = await $.ui.open({ id: PANE, title: tr().pane })
  return { isPlaced: opened.isPlaced, reason: opened.isPlaced ? undefined : opened.reason }
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

// The crew a bar's count shows, and whether any of it works: a call's own
// agents, or for a flow the panel's crew, its agents and the tasks still planned.
async function crewOf($: EngineInterface, f: Flow): Promise<{ crew: number; isWorking: boolean }> {
  if (f.kind === 'agents') return { crew: f.total, isWorking: f.running > 0 }
  if (f.kind === 'steps') return { crew: 1, isWorking: f.running > 0 }
  const p = await read($, panel)
  const list = (await read($, agents)).filter(a => a.status === 'running' || a.startedAt >= (p.since ?? 0))
  return { crew: list.length + plannedOf(f, list).length, isWorking: list.some(a => a.status === 'running') }
}

// Counts one call's agents again into its row's bar.
async function retally($: EngineInterface, anchor: string | undefined, title: string): Promise<void> {
  if (!anchor) return
  const list = await read($, agents)
  await update($, rows, m => keepRows({ ...m, [anchor]: tally(anchor, list, m[anchor]?.title ?? title) }))
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
    total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
    note: { type: 'string', description: 'The step in progress, a few words.' },
  },
  required: ['done'],
}

// With `stepReports` on (the default) the tool sits in every subagent's tool
// list and its description asks them all to report; off, it waits behind tool
// search as upstream has it, for savvy-flow workers told to call it.
export const stepTool = (isAsked: boolean): ToolSpec =>
  isAsked
    ? {
        name: 'step',
        description:
          'Subagents only: never call this from the main conversation. ' +
          'Reports progress on your own task to the agents panel; it only draws a bar and answers ok. ' +
          'Skip it for a task of only a few tool calls. Otherwise, with your first real tool call, ' +
          'call it with `total` (your plan in 3-8 steps) and `done: 0`, then again as each step finishes. ' +
          'Always send it in the same response as your next real tool call, never in a response of its own.',
        inputSchema: STEP_SCHEMA,
        isDeferred: false,
      }
    : {
        name: 'step',
        description:
          'For savvy-flow workers: report progress on your own task to the agents panel. ' +
          'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
          'call it again as each step finishes. Cheap and silent: it only draws a bar.',
        inputSchema: STEP_SCHEMA,
      }

export const register: Register = (on, options) => {
  // A mod opens only its own panes: others ask through this noun. Its own
  // answer is the bottom of the event; the hook below answers first.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, savvyProgress: { open: async (): Promise<SavvyProgressOpened> => ({ isPlaced: false, reason: 'savvy-progress did not answer the call' }) } }
  })

  on('savvyProgress.open', async $ => ({ value: await openPane($) }))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    isOlderShown = false
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: ['fable', 'heavy', 'careful', 'medium', 'light'] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register(stepTool(options.stepReports !== false))
    // A /config change reloads the module: drop the cached description so the switch lands now.
    $.ui.invalidate('tool.describe')
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    // Ticks the running agents' clocks and writes what they said and called; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        await flushLive($, await $.clock.now())
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        const engine = await $.agent.list().catch(() => [])
        if (engine.some(x => ENGINE_END[x.status])) {
          const before = list.filter(a => a.status === 'running').map(a => a.id).join()
          const after = await update($, agents, l => reconcile(l, engine, at))
          const moved = after.filter(a => a.status !== 'running' && before.split(',').includes(a.id))
          for (const a of moved) await retally($, a.anchor, tr().autoTitle)
        }
        await update($, now, () => at)
      })()
    })
    return started
  })

  on('command.run', { command: 'agents-info' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (prev?.anchor && isNewFlow(prev, input)) {
      // The flow it replaces keeps its last state on the row it was drawn on.
      const done = prev
      await update($, rows, m => keepRows({ ...m, [done.anchor ?? '']: done }))
    }
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts the panel on a clean list; agents still running stay.
      const at = await $.clock.now()
      await update($, panel, p => ({ ...p, since: at }))
    }
    // The bar moves to this call's row: the latest progress call draws it.
    const next = await update($, flow, p => ({ ...merge(p, input), anchor: e.tool_use_id }))
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: 'ok' }
  })

  // Every subagent's tool calls: counted, ticked, put on its trail, and marked
  // ✓ or ✗ when they end. Bookkeeping only: the start is written beside the
  // call, never before it, and nothing here can stop or change a call.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (!agentId || e.tool === STEP_TOOL) return next(e)
    const id = e.tool_use_id || `call:${Math.random().toString(36).slice(2)}`
    const input = e as unknown as Record<string, unknown>
    // What it said before the call goes on the trail ahead of it.
    const p = pending.get(agentId)
    const said = p?.say ? { slot: p.slot, ...p.say } : undefined
    if (p) p.say = undefined
    const started = (async () => {
      root ||= await $.session.root().catch(() => '')
      const at = await $.clock.now()
      await update($, agents, l =>
        l.map(a => (a.agentId === agentId ? startCall(said ? saySlot(a, said.slot, said.kind, said.text, at) : a, id, e.tool, input, at) : a)),
      )
    })().catch(() => undefined)
    let isOk = false
    try {
      const result = await next(e)
      isOk = result.deny === undefined && !(result as { isError?: boolean }).isError
      return result
    } finally {
      try {
        await started
        const end = await $.clock.now()
        await update($, agents, l => l.map(a => (a.agentId === agentId ? endCall(a, id, isOk, end) : a)))
      } catch {}
    }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    await update($, flow, prev =>
      prev && !prev.isFinished
        ? { ...prev, running: prev.running + 1, phase: prev.phase === 'plan' ? 'delegate' : prev.phase }
        : prev,
    )
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  // A message you typed starts your next turn: new agents belong to it, and to
  // it still when your message's agents' reports start turns of their own.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'user' && e.door === 'prompt' && e.origin.kind === 'composer') isFreshPrompt = true
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (isFreshPrompt) {
      isFreshPrompt = false
      const text = e.text.replace(/\s+/g, ' ').trim().slice(0, 120)
      await update($, panel, prev => ({ ...prev, turnSeq: (prev.turnSeq ?? 0) + 1, turnText: text }))
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    const p = await read($, panel)
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        anchor: e.tool_use_id || undefined,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
        activeAt: at,
        ...(e.workflow ? { isWorkflow: true } : {}),
        ...(p.turnSeq ? { turn: p.turnSeq, prompt: p.turnText } : {}),
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-300)
    })
    await update($, now, () => at)
    // The call that started it draws its bar: one Agent call, or a whole workflow run.
    await retally($, e.tool_use_id || undefined, e.workflow ? tr().workflow : tr().autoTitle)
    if (e.subagentType.startsWith('savvy-')) {
      const f = await read($, flow)
      await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    } else {
      await autoOpen($, `row:${e.tool_use_id || at}`)
    }
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (!agentId) return yield* next(e)
    // Its text as it streams: each request starts a new phrase, the chunks pass on untouched.
    // Its text, or its thinking while it has written none, as one phrase per request.
    const at = await $.clock.now().catch(() => 0)
    let live = pending.get(agentId)
    if (!live) pending.set(agentId, (live = { text: '', thinking: '', slot: '', isActive: true, seen: at }))
    Object.assign(live, { text: '', thinking: '', slot: `say:${at}:${Math.random().toString(36).slice(2)}`, isActive: true, seen: at })
    const stream = next(e)
    for await (const chunk of stream) {
      live.isActive = true
      if (chunk.kind === 'text' && chunk.text) {
        live.text = (live.text + chunk.text).slice(-2000)
        const phrase = lastPhrase(live.text)
        if (phrase) live.say = { kind: 'say', text: phrase }
      } else if (chunk.kind === 'thinking' && chunk.text && !live.text) {
        live.thinking = (live.thinking + chunk.text).slice(-2000)
        const phrase = lastPhrase(live.thinking)
        if (phrase) live.say = { kind: 'think', text: phrase }
      }
      yield chunk
    }
    const result = await stream.result
    const usage = result.usage
    if (!usage) return result

    const model = usage.model || e.model
    // A finished agent resumed (SendMessage) runs again: its row's bar goes back to work.
    const resumed = (await read($, agents)).find(a => a.agentId === agentId && a.status !== 'running')
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage),
              steps: a.steps + 1,
            },
      ),
    )
    if (resumed) await retally($, resumed.anchor, tr().autoTitle)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: endStatus(e.reason),
            endedAt: at,
            ...(e.reason === 'answer' && typeof e.answer === 'string' && firstLine(e.answer) ? { result: firstLine(e.answer) } : {}),
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
      const run = (await read($, agents)).find(a => a.agentId === agentId)
      await retally($, run?.anchor, tr().autoTitle)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const p: Panel = await read($, panel)
    const list = (await read($, agents)).filter(a => a.status === 'running' || a.startedAt >= (p.since ?? 0))
    const f = await read($, flow)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const { failed, running, finished } = groupsOf(list, at)
    const runningCount = running.reduce((n, g) => n + g.agents.length, 0)
    const finishedCount = finished.reduce((n, g) => n + g.agents.length, 0)
    const all = [...list].reverse()
    const planned = plannedOf(f, list)
    const t = totals(list, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    // Drawn at the richest level that fits the desktop's budget (see fit).
    const draw = (level: number) => {
      cardLevel = level
      const isDoneFolded = p.isDoneCollapsed || level >= 4
      const { shown: shownFinished, hidden } = foldFinished(finished, level, isOlderShown)

      // A real button, apart from the section toggles below it: it changes the
      // whole pane, not one section. Near the top, its card hangs below it.
      const toggleCompact = (
        <Box {...lit(hasCard('action'), 'tip:compact')}>
          <Button
            key="compact"
            label={p.isCompact ? s.expand : s.collapse}
            onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
          />
        </Box>
      )
      // Down the column, its card rises over the cards above.
      const toggleDone = (card: ReturnType<typeof tip>) => (
        <Box key="tip:done">
          <Button
            key="done"
            label={`${isDoneFolded ? '▸' : '▾'} ${s.finished} · ${finishedCount}`}
            plain
            onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
          />
          {card}
        </Box>
      )
      // Past the fold, one line: how many older finished agents wait there. Its
      // press shows them, unless the pane is folding them to fit.
      const olderCount = Math.max(0, finishedCount - FOLD_AFTER)
      const hasOlderLine = !isDoneFolded && (hidden > 0 || (isOlderShown && olderCount > 0))
      const olderTip: TipLine[] = [{ text: (isOlderShown ? s.hides : s.shows)(s.olderAgents) }]
      const olderLine = (card: ReturnType<typeof tip>) =>
        level >= 3 ? (
          <Text key="older" dimColor>{`${s.olderFinished(hidden)} · ${s.foldedToFit}`}</Text>
        ) : (
          <Box key="tip:older">
            <Button
              key="older"
              label={hidden > 0 ? `${s.olderFinished(hidden)} · ${s.show}` : `${s.olderFinished(olderCount)} · ${s.hide}`}
              plain
              onPress={() => {
                isOlderShown = !isOlderShown
                $.ui.invalidate('ui.render')
              }}
            />
            {card}
          </Box>
        )
      // Failed folds as Finished does; its label stays red.
      const toggleFailed = (
        <Box {...lit(hasCard('action'), 'tip:failed')}>
          <Button
            key="failed"
            label={`${s.failedGroup} · ${failed.length}`}
            plain
            onPress={() => update($, panel, prev => ({ ...prev, isFailedCollapsed: !prev.isFailedCollapsed }))}
          >
            <Text color={FAIL}>{`${p.isFailedCollapsed ? '▸' : '▾'} ${s.failedGroup} · ${failed.length}`}</Text>
          </Button>
        </Box>
      )
      const isEmpty = list.length === 0 && planned.length === 0
      // The timeline's toggle, on top of the pane once an agent is listed; open,
      // the axis's span on its right.
      const isLanesOpen = p.isLanesOpen !== false && list.length > 0
      const numbers = agentNumbers(list)
      const batches = batchesOf(list, at)
      // The newest batch opens by itself, the older ones fold, until pressed.
      const isBatchOpen = (b: Batch) => p.batchesOpen?.[b.key] ?? b.n === batches.length
      const lanesToggle =
        list.length > 0 ? (
          <Box key="lanes-head" flexDirection="row" justifyContent="space-between" alignItems="center">
            <Button
              key="lanes"
              label={`${isLanesOpen ? '▾' : '▸'} ${s.lanes(runningCount, list.length)}`}
              plain
              onPress={() => update($, panel, prev => ({ ...prev, isLanesOpen: prev.isLanesOpen === false }))}
            />
            {batches.length > 0 && <Text dimColor>{rangeOf(batches[0]!.start, Math.max(...batches.map(b => b.end)), batches.some(b => b.running > 0))}</Text>}
          </Box>
        ) : null
      // A batch's header: its toggle, how many agents and how they stand, then
      // when it ran and for how long, with the prompt last. The counts never
      // shrink, so they don't wrap; the prompt gives way first, one line at most.
      const batchHead = (b: Batch) => (
        <Box key={`bh-${b.key}`} flexDirection="column">
          <Box flexDirection="row" alignItems="center" columnGap={0.5}>
            <Box flexShrink={0}>
              <Button
                key={`batch-${b.key}`}
                label={`${isBatchOpen(b) ? '▾' : '▸'} ${b.label}`}
                plain
                onPress={() => update($, panel, prev => ({ ...prev, batchesOpen: { ...(prev.batchesOpen ?? {}), [b.key]: !isBatchOpen(b) } }))}
              />
            </Box>
            <Box flexShrink={0}>
              <Text wrap="truncate-end">
                <Text dimColor>{`· ${s.agentsN(b.agents.length)}`}</Text>
                {b.failed > 0 && <Text color={FAIL}>{` · ✗ ${b.failed}`}</Text>}
                {b.running > 0 && <Text color={CLAY}>{` · ${s.runningN(b.running)}`}</Text>}
              </Text>
            </Box>
          </Box>
          <Box paddingLeft={2} flexDirection="row">
            <Box flexShrink={0}>
              <Text dimColor wrap="truncate-end">{batchTimes(b, batches[b.n - 2])}</Text>
            </Box>
            {b.prompt ? (
              <Box flexShrink={1} flexGrow={1}>
                <Text dimColor italic wrap="truncate-end">{` · “${b.prompt.replace(/\s+/g, ' ')}”`}</Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      )
      const summary =`≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`
      // A group of two or more gets a header line; a lone agent is its own card.
      const groupHead = (g: AgentGroup) => (g.agents.length > 1 ? <Text key={`g-${g.key}`} dimColor>{`${g.title} · ${g.agents.length} · ${fmtTime(g.span)}`}</Text> : null)

      // --- hover cards: what each part adds to what it draws.
      const tipW = Math.min(TIP_W, Math.max(24, e.props.bodyColumns || 40))
      // A card that opens downward hangs from the right, 60% wide and at most 4
      // lines: the pointer going down the left side doesn't land on it and keep it open.
      const downW = Math.min(TIP_W, Math.max(24, Math.round((e.props.bodyColumns || 40) * 0.6)))
      const DOWN_LINES = 4
      const capped = (lines: TipLine[], want = TIP_LINES): TipLine[] => (lines.length > want ? [...lines.slice(0, want - 1), { text: `+${lines.length - want + 1}` }] : lines)
      // A status mark: ✓ good, ✗ bad, stopped and planned dim, running plain.
      const mark = (st: string): TipPiece => {
        const g = STATUS_GLYPH[st] ?? ''
        return st === 'done' ? { t: g, s: 'good' } : st === 'failed' ? { t: g, s: 'bad' } : st === 'running' ? g : dim(g)
      }
      const named = (as: AgentRun[]): TipLine[] =>
        as.map(a => ({ text: [mark(a.status), ` ${a.description || a.type}`, ...(a.failed ? [SEP, { t: `✗${a.failed}`, s: 'bad' } as const] : [])] }))
      // An agent's, most useful first: the files' full paths, when it counts as
      // idle, what its ≈cost is reckoned from, its model's exact name and window,
      // why its crab wears what it does.
      const agentTip = (a: AgentRun, hasCrab: boolean): TipLine[] => {
        const [i, o] = priceOf(a.model)
        return [
          ...(a.files ?? []).slice(0, 2).map(fl => ({ text: fl.path, isPath: true })),
          ...(idleNote(a, at) ? [{ text: s.thresholds(fmtTime(IDLE_MS), fmtTime(OVERDUE_MS)) }] : []),
          { text: s.priced(fmtTokens(a.tokens), i, o) },
          { text: [a.model, SEP, ...s.context(fmtTokens(a.contextTokens), fmtTokens(a.contextMax))] },
          ...(hasCrab ? [{ text: costumeWhy(a) }] : []),
        ]
      }
      // An agent card's tone: red for a failed agent, amber for an overdue one.
      const agentTone = (a: AgentRun): Tone => (a.status === 'failed' ? 'danger' : isOverdue(a, at) ? 'warn' : 'info')
      // A planned task's: the tasks it waits for, each with how it stands.
      const planTip = (pl: Planned): TipLine[] =>
        capped(
          pl.after.flatMap(n => {
            const task = f?.tasks[n - 1]
            if (!task) return []
            const run = list.find(a => norm(a.description) === norm(task.title))
            return [{ text: [mark(run?.status ?? 'planned'), ` ${n}. ${task.title}`] }]
          }),
        )
      const counts = (
        [
          [s.running, runningCount],
          [s.finished, finishedCount],
          [s.failedGroup, failed.length],
          [s.planned, planned.length],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .flatMap(([w, n], k): TipPiece[] => [...(k ? [SEP] : []), dim(`${w} `), w === s.failedGroup ? { t: `${n}`, s: 'bad' } : `${n}`])
      const compactTip: TipLine[] = [{ text: p.isCompact ? s.toFull : s.toCompact }, ...(counts.length ? [{ text: counts }] : [])]
      const failedTip = capped([{ text: (p.isFailedCollapsed ? s.shows : s.hides)(s.failedAgents) }, ...named(failed)], DOWN_LINES)
      const doneTip = capped([{ text: (isDoneFolded ? s.shows : s.hides)(s.finishedAgents) }, ...named(finished.flatMap(g => g.agents))])
      // The tiles': what ≈cost is, the agents that cost most, what the time spans.
      const tilesTip: TipLine[] = list.length
        ? [
            { text: s.costNote },
            ...[...list]
              .sort((x, y) => y.costUsd - x.costUsd)
              .slice(0, DOWN_LINES - 2)
              .map(a => ({ text: [`≈${fmtCost(a.costUsd)}`, SEP, fmtTokens(a.tokens), SEP, dim(a.description || a.type)] })),
            { text: s.timeNote(fmtTime(list.reduce((n, a) => n + elapsed(a, at), 0))) },
          ]
        : []
      // The strip's: the full titles behind its name tags, in its order.
      const stripTip = capped([...named(COMPACT_ORDER.flatMap(st => all.filter(a => a.status === st))), ...planned.map(pl => ({ text: [mark('planned'), ` ${pl.n}. ${pl.title}`] }))], DOWN_LINES)
      // The plain rows above each card, back to the nearest button, in the
      // column's order: a card rises that far and no further. `top` counts on
      // past buttons to the pane's top: how far the Finished toggle's may rise.
      const roomOf = (start: number, top: number, gap: number, button: number, rowsOf: (a: AgentRun) => number, planRows: number) => {
        const room = new Map<string, number>()
        let r = start
        let total = top
        const add = (rows: number) => {
          r += rows
          total += rows
        }
        const pass = (key: string, rows: number) => {
          room.set(key, r)
          add(rows + gap)
        }
        const groups = (gs: AgentGroup[]) =>
          gs.forEach(g => {
            if (g.agents.length > 1) add(1)
            g.agents.forEach(a => pass(a.id, rowsOf(a)))
          })
        if (failed.length > 0) [r, total] = [0, total + button]
        if (!p.isFailedCollapsed) failed.forEach(a => pass(a.id, rowsOf(a)))
        if (runningCount > 0) add(1)
        groups(running)
        const doneAbove = total
        if (finishedCount > 0) [r, total] = [0, total + button]
        if (!isDoneFolded) groups(shownFinished)
        if (hasOlderLine) [r, total] = [0, total + button]
        if (planned.length > 0) add(1)
        planned.forEach(pl => pass(`plan-${pl.n}`, planRows))
        return { room, doneAbove, total }
      }

      if (e.surface === 'desktop' && 'Svg' in ui) {
        const { Svg } = ui
        const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
        const section = (key: string, text: string) => (
          <Text key={key} dimColor>
            {text}
          </Text>
        )
        // Heights in rows: the cards' Svgs are px tall. The timeline's toggle and
        // lanes sit over everything, so every card's room counts them.
        const rowsOf = (a: AgentRun) => agentHeight(a, at) / ROW_PX
        const batchLanes = (b: Batch) => lanesOf(b.agents, at, numbers)
        const batchPx = (b: Batch) => {
          const { lanes, hidden } = batchLanes(b)
          return isBatchOpen(b) ? lanesHeight(lanes, hidden) : STRIP_H
        }
        const lanesRows =
          list.length === 0
            ? 0
            : BUTTON_ROWS + 1.5 + (isLanesOpen ? (RULER_H + RULE_H + batches.reduce((n, b) => n + batchPx(b), 0)) / ROW_PX + batches.length * (BUTTON_ROWS + 1) : 0)
        const batchBody = (b: Batch) => {
          if (!isBatchOpen(b)) return <Svg key={`strip-${b.key}`} source={stripOfSvg(W, b, at)} alt={`${b.label}: ${s.agentsN(b.agents.length)}`} width={W} height={STRIP_H} />
          const { lanes, hidden } = batchLanes(b)
          return (
            <Svg
              key={`lanes-${b.key}`}
              source={lanesSvg(W, lanes, hidden, at)}
              alt={lanes.map(l => `#${l.n} ${l.agent.description || l.agent.type}: ${fmtTime(elapsed(l.agent, at))}`).join(', ')}
              width={W}
              height={lanesHeight(lanes, hidden)}
            />
          )
        }
        const timeline = list.length > 0 && (
          <Box key="timeline" flexDirection="column" paddingTop={0.5} marginBottom={1}>
            {lanesToggle}
            {isLanesOpen && (
              <Svg
                key="ruler"
                source={rulerSvg(W, batches, at)}
                alt={batches.map(b => `${b.label} ${rangeOf(b.start, b.end, b.running > 0)}`).join(', ')}
                width={W}
                height={RULER_H}
              />
            )}
            {isLanesOpen && [...batches].reverse().flatMap(b => [batchHead(b), batchBody(b)])}
            {isLanesOpen && <Svg key="timeline-rule" source={ruleSvg(W)} alt="" width={W} height={RULE_H} />}
          </Box>
        )
        const stripRows = lanesRows + (isEmpty ? 0 : (COMPACT_H + STRIP_GAP) / ROW_PX)
        const headRows = Math.ceil(stripRows + headerHeight(title) / ROW_PX)
        const { room, doneAbove, total } = roomOf(1, headRows + BUTTON_ROWS + 1, 0, BUTTON_ROWS, rowsOf, 46 / ROW_PX)
        // A desktop pane is only as tall as its tree: room under the last row for
        // a card that opens down past it, or the card is cut off into a scroll.
        const spacer = (rows: number) => (rows > 0 ? <Box key="tip-room" height={Math.ceil(rows)} flexShrink={0} /> : null)
        const failedTop = headRows + 2 * BUTTON_ROWS + 1
        const hover = (key: string, h: number, lines: TipLine[], tone: Tone = 'info') => {
          const fit = tipFit(h, room.get(key) ?? 0, 0.6)
          // Seen on the desktop: a card sat a row low, over its own card's title.
          return tip(ui, e.surface, lines.slice(0, fit.lines), { bottom: fit.bottom + ((room.get(key) ?? 0) > 0 ? 1 : 0) }, tipW, tone)
        }
        const card = (a: AgentRun) => (
          <Box key={a.id} flexDirection="column" {...lit(hasCard(agentTone(a)))}>
            <Svg
              source={agentSvg(W, a, at, numbers.get(a.id))}
              alt={`${a.description}: ${modelName(a.model)}, ${a.status === 'running' ? s.isRunning : s.isFinished}${a.trail?.length ? `: ${entryText(a.trail[a.trail.length - 1]!)}` : ''}`}
              width={W}
              height={agentHeight(a, at)}
            />
            {hover(a.id, rowsOf(a), agentTip(a, true), agentTone(a))}
          </Box>
        )
        const group = (g: AgentGroup) => [groupHead(g), ...g.agents.map(card)]

        if (p.isCompact) {
          return (
            <Box flexDirection="column" gap={1}>
              {timeline}
              <Box {...lit(hasCard('info'), 'tip:strip')}>
                <Svg source={compactSvg(W, all, planned, t, at)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={COMPACT_H} />
              </Box>
              {toggleCompact}
              {tip(ui, e.surface, stripTip, { top: Math.ceil(lanesRows + (lanesRows ? 1 : 0) + COMPACT_H / ROW_PX), scope: 'tip:strip' }, downW)}
              {tip(ui, e.surface, compactTip, { top: Math.ceil(lanesRows + (lanesRows ? 1 : 0) + COMPACT_H / ROW_PX) + 1 + BUTTON_ROWS, scope: 'tip:compact' }, downW, 'action')}
              {/* Past the button: the strip's card overhangs it by its lines less the button, the button's by all of its own and a row of padding. */}
              {spacer(Math.max(hasCard('info') ? stripTip.length - BUTTON_ROWS : 0, hasCard('action') ? compactTip.length + 1 : 0))}
            </Box>
          )
        }
        return (
          <Box flexDirection="column">
            {timeline}
            {!isEmpty && (
              <Box {...lit(hasCard('info'), 'tip:strip')}>
                <Svg key="strip" source={compactSvg(W, all, planned, t, at, false, STRIP_GAP)} alt={`${list.length} ${s.agentsCount}`} width={W} height={COMPACT_H + STRIP_GAP} />
              </Box>
            )}
            <Box {...lit(hasCard('info'), 'tip:tiles')}>
              <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            </Box>
            <Box flexDirection="row" justifyContent="flex-end" marginBottom={1}>
              {toggleCompact}
            </Box>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {failed.length > 0 && toggleFailed}
            {!p.isFailedCollapsed && failed.map(card)}
            {runningCount > 0 && section('h-run', `${s.running} · ${runningCount}`)}
            {running.flatMap(group)}
            {finishedCount > 0 && toggleDone(tip(ui, e.surface, doneTip.slice(0, Math.floor(doneAbove - 1.6)), { bottom: BUTTON_ROWS, side: 'left' }, tipW, 'action'))}
            {!isDoneFolded && shownFinished.flatMap(group)}
            {hasOlderLine && olderLine(tip(ui, e.surface, olderTip, { bottom: BUTTON_ROWS, side: 'left' }, tipW, 'action'))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Box key={`plan-${pl.n}`} flexDirection="column" {...lit(hasCard('info') && planTip(pl).length > 0)}>
                <Svg source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
                {hover(`plan-${pl.n}`, 46 / ROW_PX, planTip(pl))}
              </Box>
            ))}
            {!isEmpty && tip(ui, e.surface, stripTip, { top: Math.ceil(stripRows), scope: 'tip:strip' }, downW)}            {tip(ui, e.surface, tilesTip, { top: headRows, scope: 'tip:tiles' }, downW)}
            {tip(ui, e.surface, compactTip, { top: headRows + BUTTON_ROWS, scope: 'tip:compact' }, downW, 'action')}
            {failed.length > 0 && tip(ui, e.surface, failedTip, { top: failedTop, scope: 'tip:failed' }, downW, 'action')}
            {failed.length > 0 && hasCard('action') && spacer(failedTop + failedTip.length + 1 - total)}
          </Box>
        )
      }

      // Terminal: the same content in text rows.
      const cols = Math.max(24, e.props.bodyColumns || 40)
      const barW = Math.max(6, Math.min(20, cols - 34))
      // A row's lines, as drawn below: name, role, bar, then its card's parts.
      const rowsOf = (a: AgentRun) => {
        const parts = cardParts(a, at)
        return 3 + (parts.mix ? 1 : 0) + parts.trail.length + (parts.idle ? 1 : 0) + (parts.files ? 1 : 0) + (parts.result ? 1 : 0)
      }
      // Title and summary over the column, which starts a row down.
      const { room, doneAbove } = roomOf(2, 3, 1, 1, rowsOf, 2)
      const hover = (key: string, h: number, lines: TipLine[], tone: Tone = 'info') => {
        const fit = tipFit(h, room.get(key) ?? 0, 2)
        return tip(ui, e.surface, lines.slice(0, fit.lines), { bottom: fit.bottom }, tipW, tone)
      }
      const row = (a: AgentRun) => {
        const { color, label: role } = roleOf(a)
        const ctx = ctxOf(a)
        const progress = progressOf(a)
        const parts = cardParts(a, at)
        const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
        return (
          <Box key={a.id} flexDirection="column" marginBottom={1} {...lit(hasCard(agentTone(a)))}>
            <Box flexDirection="row" gap={1}>
              <Text color={color}>▣</Text>
              <Text bold wrap="truncate-end">
                {numbers.has(a.id) ? <Text dimColor>{`#${numbers.get(a.id)} `}</Text> : null}
                {a.description || a.type}
              </Text>
              <Text color={a.status === 'failed' ? FAIL : a.status === 'done' ? OK : a.status === 'stopped' ? STOPPED : isOverdue(a, at) ? WARN : color}>{isOverdue(a, at) ? '◷' : STATUS_GLYPH[a.status]}</Text>
              {(a.failed ?? 0) > 0 && <Text color={FAIL}>✗{a.failed}</Text>}
            </Box>
            <Text wrap="truncate-end">
              {'  '}
              <Text bold>{role}</Text>
              {' '}
              <Text color={color}>{modelName(a.model)}</Text>
              <Text dimColor>
                {a.effort ? ` ${a.effort}` : ''}
                {a.toolCalls ? ` · ${s.toolCalls(a.toolCalls)}` : ''}
                {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
                {a.status === 'failed' ? ` · ${s.failed}` : a.status === 'stopped' ? ` · ${s.stopped}` : ''}
              </Text>
              {isOverdue(a, at) && <Text color={WARN}>{` · ${s.overdue}`}</Text>}
            </Text>
            <Text wrap="truncate-end">
              {'  '}
              <Text dimColor>{ctxBar(progress === null ? ctx : progress * 100, barW)}</Text>
              <Text dimColor>
                {' '}
                {steps}ctx {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
              </Text>
            </Text>
            {parts.mix && (
              <Text wrap="truncate-end">
                {'  '}
                {FAMILY_ORDER.filter(k => a.kinds?.[k]).map(k => (
                  <Text key={k}>
                    <Text color={toolColor(k, 'machine')}>■</Text>
                    <Text dimColor>{` ${s.kinds[k]} ${a.kinds?.[k]}  `}</Text>
                  </Text>
                ))}
              </Text>
            )}
            {parts.trail.map((en, i) => {
              const mark = entryMark(en)
              return (
                <Text key={en.id} wrap="truncate-end" dimColor={i > 0} italic={en.kind !== 'tool'}>
                  {'  '}
                  {entryText(en)}
                  {mark && <Text color={mark.color}>{` ${mark.glyph}`}</Text>}
                </Text>
              )
            })}
            {parts.idle && (
              <Text color={WARN} wrap="truncate-end">
                {'  ◷ '}
                {parts.idle}
              </Text>
            )}
            {parts.files && (
              <Text wrap="truncate-end">
                {'  '}
                {(a.files ?? []).slice(0, 6).map((fl, i) => (
                  <Text key={fl.path} color={toolColor(fileFamily(fl), fl.reach ?? 'machine')}>
                    {i ? ', ' : ''}
                    {baseName(fl.path)}
                  </Text>
                ))}
                {(a.files?.length ?? 0) > 6 && <Text dimColor>{` +${(a.files?.length ?? 0) - 6}`}</Text>}
              </Text>
            )}
            {parts.result && (
              <Text dimColor wrap="truncate-end">
                {'  “'}
                {parts.result}
                {'”'}
              </Text>
            )}
            {hover(a.id, rowsOf(a), agentTip(a, false), agentTone(a))}
          </Box>
        )
      }
      const group = (g: AgentGroup) => [groupHead(g), ...g.agents.map(row)]
      // A lane in text: mark, number and name, the track (a run of same-colored
      // cells is one Text), its time.
      const nameW = Math.min(26, Math.floor(cols / 3))
      const trackW = Math.max(8, cols - nameW - 9)
      // Cells as Text runs, one per stretch of one color.
      const cellRuns = (cells: { ch: string; color?: string }[], key: string) => {
        const runs: { ch: string; color?: string }[] = []
        for (const c of cells) {
          const last = runs.at(-1)
          if (last && last.color === c.color) last.ch += c.ch
          else runs.push({ ...c })
        }
        return runs.map((r, i) => (
          <Text key={`${key}-${i}`} color={r.color} dimColor={!r.color}>
            {r.ch}
          </Text>
        ))
      }
      const lane = (l: Lane) => {
        const m = laneMark(l.agent, at)
        const runs: { ch: string; color?: string }[] = []
        for (const c of laneCells(l, trackW)) {
          const last = runs.at(-1)
          if (last && last.color === c.color) last.ch += c.ch
          else runs.push({ ...c })
        }
        return (
          <Box key={`lane-${l.agent.id}`} flexDirection="row" gap={1}>
            <Box width={nameW} flexShrink={0}>
              <Text wrap="truncate-end">
                <Text color={m.color}>{m.glyph}</Text>
                <Text dimColor>{` #${l.n}`}</Text>
                {` ${l.agent.description || l.agent.type}`}
              </Text>
            </Box>
            <Text wrap="truncate-end">
              {runs.map((r, i) => (
                <Text key={`r${i}`} color={r.color} dimColor={!r.color}>
                  {r.ch}
                </Text>
              ))}
            </Text>
            <Text dimColor>{fmtTime(elapsed(l.agent, at))}</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {list.length > 0 && (
            <Box key="timeline" flexDirection="column" marginBottom={1}>
              {lanesToggle}
              {isLanesOpen && <Text wrap="truncate-end">{cellRuns(rulerCells(batches, cols), 'ruler')}</Text>}
              {isLanesOpen &&
                [...batches].reverse().flatMap(b => {
                  if (!isBatchOpen(b)) return [batchHead(b), <Text key={`strip-${b.key}`} wrap="truncate-end">{cellRuns(stripCells(b, cols, at), b.key)}</Text>]
                  const { lanes, hidden } = lanesOf(b.agents, at, numbers)
                  return [batchHead(b), ...[...lanes].reverse().map(lane), ...(hidden > 0 ? [<Text key={`more-${b.key}`} dimColor>{s.earlierLanes(hidden)}</Text>] : [])]
                })}
              <Text dimColor wrap="truncate-end">{'─'.repeat(cols)}</Text>
            </Box>
          )}
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold wrap="truncate-end">
              {title}
            </Text>
            {toggleCompact}
          </Box>
          <Box {...lit(hasCard('info'), 'tip:tiles')}>
            <Text dimColor>
              ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
            </Text>
          </Box>
          {p.isCompact ? (
            <Box {...lit(hasCard('info'), 'tip:strip')}>
              <Text wrap="truncate-end">
                {all.map(a => (
                  <Text key={a.id} color={roleOf(a).color}>
                    {STATUS_GLYPH[a.status]}{' '}
                  </Text>
                ))}
                {planned.map(pl => (
                  <Text key={`plan-${pl.n}`} dimColor>
                    ◷{' '}
                  </Text>
                ))}
              </Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {isEmpty && <Text dimColor>{s.empty}</Text>}
              {failed.length > 0 && toggleFailed}
              {!p.isFailedCollapsed && failed.map(row)}
              {runningCount > 0 && <Text dimColor>{`${s.running} · ${runningCount}`}</Text>}
              {running.flatMap(group)}
              {finishedCount > 0 && toggleDone(tip(ui, e.surface, doneTip.slice(0, doneAbove - 2), { bottom: 1, side: 'left' }, tipW, 'action'))}
              {!isDoneFolded && shownFinished.flatMap(group)}
              {hasOlderLine && olderLine(tip(ui, e.surface, olderTip, { bottom: 1, side: 'left' }, tipW, 'action'))}
              {planned.length > 0 && <Text dimColor>{`${s.planned} · ${planned.length}`}</Text>}
              {planned.map(pl => {
                const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
                return (
                  <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1} {...lit(hasCard('info') && planTip(pl).length > 0)}>
                    <Text dimColor wrap="truncate-end">
                      <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                    </Text>
                    <Text dimColor wrap="truncate-end">
                      {'  '}
                      {tier} · {TIER_MODEL[tier] ?? ''}
                      {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                    </Text>
                    {hover(`plan-${pl.n}`, 2, planTip(pl))}
                  </Box>
                )
              })}
            </Box>
          )}
          {tip(ui, e.surface, compactTip, { top: 1, scope: 'tip:compact' }, downW, 'action')}
          {tip(ui, e.surface, tilesTip, { top: 2, scope: 'tip:tiles' }, downW)}
          {p.isCompact && tip(ui, e.surface, stripTip, { top: 3, scope: 'tip:strip' }, downW)}
          {!p.isCompact && failed.length > 0 && tip(ui, e.surface, failedTip, { top: 4, scope: 'tip:failed' }, downW, 'action')}
        </Box>
      )
    }
    return fit(e.surface, LEVEL_TOP, draw)
  })

  // The bar lives in the transcript, under the row of the call that started the
  // work: an Agent call, a Workflow call (its whole run), and the latest
  // savvy-flow `progress` call (the flow). Each row redraws as its agents run.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const tool = e.props.tool
    if (tool !== 'Agent' && tool !== 'Workflow' && tool !== TOOL) return next(e)
    const engineRow = await next(e)

    const live = tool === TOOL ? await read($, flow) : null
    const f = live?.anchor === e.requestId ? live : (await read($, rows))[e.requestId]
    if (!f) return engineRow

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    // A workflow's row names the run, as its meta says, once the call has answered.
    const output = e.props.output as { workflowName?: unknown } | undefined
    const title = tool === 'Workflow' && typeof output?.workflowName === 'string' && output.workflowName ? output.workflowName : f.title
    const { crew, isWorking } = await crewOf($, f)
    const crewButton = <Button key="savvy-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    const columns = e.viewport?.columns || 100
    // An Agent or Workflow call's own agents draw their activity strip; a flow keeps its bar.
    const mine = f.kind === 'agents' ? (await read($, agents)).filter(a => a.anchor === e.requestId) : []
    const at = Math.max(await read($, now), ...mine.map(a => a.startedAt), 0)
    const title1 = mine.length === 1 && tool === 'Agent' ? mine[0]!.description || title : title
    return (
      <Box key="savvy-row" flexDirection="column">
        {engineRow}
        {mine.length > 0
          ? stripRow(ui, e.surface, columns, title1, mine, at, crewButton, 'savvy-bar')
          : barRow(ui, e.surface, columns, { ...f, title }, isWorking, crewButton, 'savvy-bar')}
      </Box>
    )
  })

  // The band above the prompt carries one bar, under the status line
  // (shareBand): the open agent's, a live flow's or the batch working now
  // (bandBar). The rows above keep every call's bar. Its ✕ hides that bar
  // until the next one; with none, the band is left alone.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const p = await read($, panel)
    const shown = bandBar(await read($, flow), await read($, agents), e.props.view.agentId, p.since)
    if (shown === null || shown.key === p.bandDismissed) return next(e)
    const below = await next(e)

    const ui = $.ui.resolve(e)
    const { Box } = ui
    const { key, bar } = shown
    const { crew, isWorking } = await crewOf($, bar)
    const onAgents = () => void togglePane($)
    const onDismiss = () => void update($, panel, q => ({ ...q, bandDismissed: key }))
    const columns = e.props.bodyColumns || e.viewport?.columns || 100
    const crewAt = shown.crew ? Math.max(await read($, now), ...shown.crew.map(a => a.startedAt), 0) : 0
    const isTerminal = e.surface === 'terminal'
    // The theme is read once a bar, not on every redraw: the band redraws
    // twice a second while a response streams.
    if (!isTerminal && bandSchemeFor !== key) {
      bandScheme = await readScheme($)
      bandSchemeFor = key
    }
    const crewPress = bandPress(ui, e.surface, 'savvy-band-agents', `×${crew}`, onAgents)
    const dismiss = bandPress(ui, e.surface, 'savvy-band-dismiss', '✕', onDismiss, 'dismiss')
    // A flow's bar on the desktop: one tile, the bar's section growing, the
    // crew's and the ✕'s not, as the roll call's.
    const flowRow = isTerminal
      ? barRow(ui, e.surface, columns, bar, isWorking, [crewPress, dismiss], 'savvy-band-bar')
      : bandTile(
          ui,
          [
            { key: 'flow-bar', parts: [barRow(ui, e.surface, columns, bar, isWorking, null, 'flow-bar-row')], grow: 1 },
            { key: 'flow-crew', parts: [crewPress], grow: 0 },
            { key: 'flow-dismiss', parts: [dismiss], grow: 0 },
          ],
          'savvy-band-bar',
        )
    // Inset a cell, as the status line's lines and the chips are; on the
    // desktop a line's gap under them, as between its own two.
    const card = (
      <Box key="savvy-card" flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1} marginTop={isTerminal ? 0 : BAND_LINE_GAP}>
        {shown.crew ? rollRow(ui, e.surface, shown.crew, crewAt, onAgents, onDismiss, 'savvy-band-bar') : flowRow}
      </Box>
    )
    return shareBand(Box, below, card)
  })
}
