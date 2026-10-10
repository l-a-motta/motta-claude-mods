// assumption-check: a side pane of the assumptions Claude makes.
//
//   ● capture on  [ turn off ]  [ pinned 2 ]  [ export ]
//   ▾ P4 add retry to fetch · 1 to check     [ reinforce all ]
//     ○ A7 retries = 3, exponential backoff
//     ✓ A8 only 5xx are retryable
//     ✎ A9 use axios → native fetch
//   ▸ P3 fix the CI badge · 2 confirmed
//
// Off until switched on. While off the mod adds nothing Claude reads: no
// instruction, no tool, no note. `/assumption-check on` (or the startOn
// option) registers the note_assumption tool and adds a short section to the
// system prompt asking Claude to log, through that tool, the assumptions that
// shape its work. Each call lands as a card under the prompt it was logged in.
// Only the main session's: a subagent's or a teammate's call is answered
// without a card, and a teammate's prompt gets no instruction. Their
// assumptions are theirs to show in their own session.
//
// A card left unmarked changes nothing. Every mark reaches the session as
// something the transcript keeps:
// - reinforce: a user-role note Claude reads ("the user confirmed A3"), no
//   turn started. Confirmed cards are the pinned list, appended again after a
//   compaction so the summary cannot drop them.
// - wrong: a prompt of its own, typed with the right assumption in the card's
//   field or empty, in which case Claude asks what is right. Either way
//   Claude first lists what it did that relied on the assumption.
// - why?, save to memory: a prompt each.
// - undo: a note taking the mark back.
// The pinned list stays out of the system prompt on purpose: a change there
// spends the prompt cache on every click.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, Category, Confidence, Group, Status, View } from '../types'

const PANE = 'assumption-check'
const TITLE = 'Assumptions'
const TOOL = 'note_assumption'
const TOOL_ID = `mcp__assumption-check__${TOOL}`
const TAG = '[assumption-check]'

const isOn = atom({ plugin: 'assumption-check', key: 'isOn' } as const, false)
const groups = atom({ plugin: 'assumption-check', key: 'groups' } as const, [] as Group[])
const cards = atom({ plugin: 'assumption-check', key: 'cards' } as const, [] as Card[])
const expanded = atom({ plugin: 'assumption-check', key: 'expanded' } as const, [] as string[])
const selected = atom({ plugin: 'assumption-check', key: 'selected' } as const, null as string | null)
const fixing = atom({ plugin: 'assumption-check', key: 'fixing' } as const, null as string | null)
const view = atom({ plugin: 'assumption-check', key: 'view' } as const, 'prompts' as View)
const hasAutoOpened = atom({ plugin: 'assumption-check', key: 'hasAutoOpened' } as const, false)

const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high']
const CATEGORIES: readonly Category[] = ['scope', 'intent', 'tech', 'environment', 'data', 'style', 'other']

export const INSTRUCTION = `# Assumption check

The user turned on assumption-check, a side pane where they review the assumptions you make. When something you act on was neither stated by the user nor verified by you (what they meant, the scope, a technology or library, the environment, the data, a style), log it with ${TOOL_ID}. Log only assumptions that shape what you do, not trivia, and log each once.

- Send the call in the same response as your other tool calls. In a reply with no other tool use, make the one call before you answer.
- Logging must not change your plan: do not stop to ask about what you logged, and do not repeat it in your reply.
- Only the main session logs. If you are a subagent or a teammate, never call ${TOOL_ID}.
- Notes and prompts marked ${TAG} are the user's own feedback from that pane. A confirmed assumption is settled; a corrected one replaces what you assumed.`

const TOOL_DESCRIPTION =
  'Log assumptions you are acting on, for the user to confirm or correct in their assumption-check pane. Main session only: a subagent or teammate never calls it. Batch several in one call. Returns their ids (A1, A2, ...).'

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    assumptions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'The assumption, one short sentence.' },
          why: { type: 'string', description: 'What led you to it.' },
          confidence: { type: 'string', enum: CONFIDENCES },
          category: { type: 'string', enum: CATEGORIES },
          source: { type: 'string', description: 'Where it comes from, as path:line, when a file does.' },
          impact: { type: 'string', description: 'What goes wrong if it is false.' },
        },
        required: ['statement', 'why', 'confidence', 'category', 'impact'],
      },
    },
  },
  required: ['assumptions'],
}

type Logged = Omit<Card, 'id' | 'group' | 'status'>

// The tool's input, kept to what a card holds; anything else is dropped.
export function parseAssumptions(input: unknown): Logged[] {
  const list = (input as { assumptions?: unknown } | null)?.assumptions
  if (!Array.isArray(list)) return []
  return list.flatMap(raw => {
    const one = raw as Record<string, unknown>
    const statement = text(one.statement)
    if (statement === '') return []
    const confidence = CONFIDENCES.includes(one.confidence as Confidence) ? (one.confidence as Confidence) : 'medium'
    const category = CATEGORIES.includes(one.category as Category) ? (one.category as Category) : 'other'
    const source = text(one.source)
    return [{ statement, why: text(one.why), confidence, category, impact: text(one.impact), ...(source ? { source } : {}) }]
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function quote(card: Card): string {
  return `${card.id} "${card.statement}"`
}

// What each mark tells Claude. Notes are appended; prompts start a turn.
export const say = {
  reinforced: ([first, ...rest]: [Card, ...Card[]]) =>
    rest.length === 0
      ? `${TAG} The user confirmed assumption ${quote(first)}. Treat it as settled and keep relying on it.`
      : `${TAG} The user confirmed these assumptions. Treat them as settled and keep relying on them:\n${[first, ...rest].map(c => `- ${quote(c)}`).join('\n')}`,
  unreinforced: (card: Card) =>
    `${TAG} The user withdrew their confirmation of assumption ${quote(card)}. It is unverified again.`,
  unwrong: (card: Card) =>
    `${TAG} The user withdrew their "wrong" mark on assumption ${quote(card)}. Disregard that mark${card.correction ? ' and the correction that came with it' : ''}.`,
  wrong: (card: Card) =>
    `${TAG} I marked assumption ${quote(card)} as wrong. Ask me what is incorrect about it and what the right assumption is. Before you change anything, list what you did so far that relied on it.`,
  corrected: (card: Card, correction: string) =>
    `${TAG} I marked assumption ${quote(card)} as wrong. The right assumption: ${correction}\nList what you did so far that relied on it, then fix that work to fit the right one.`,
  why: (card: Card) =>
    `${TAG} Why did you assume ${quote(card)}? Say what led you to it and what else you considered. Don't change anything yet.`,
  remember: (card: Card) =>
    `${TAG} Save this assumption, which I confirmed, to your memory so later sessions keep it: "${card.statement}"`,
  pinned: (list: Card[]) =>
    `${TAG} Assumptions the user confirmed earlier in this session, kept across the compaction. Keep relying on them:\n${list.map(c => `- ${quote(c)}`).join('\n')}`,
}

export function groupLabel(prompt: string): string {
  const line = prompt.replace(/^\[assumption-check\]\s*/, '').split('\n')[0]?.trim() ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || '(empty prompt)'
}

const MARK: Record<Status, string> = { open: '○', reinforced: '✓', wrong: '✗', corrected: '✎' }

export function toMarkdown(list: Group[], all: Card[]): string {
  const lines = ['# Assumptions', '']
  for (const group of list) {
    const mine = all.filter(c => c.group === group.id)
    if (mine.length === 0) continue
    lines.push(`## ${group.id} · ${group.label}`, '')
    for (const c of mine) {
      lines.push(`- ${MARK[c.status]} **${c.id}** ${c.statement} _(${c.status}, ${c.confidence} confidence, ${c.category})_`)
      if (c.why) lines.push(`  - why: ${c.why}`)
      if (c.source) lines.push(`  - source: ${c.source}`)
      if (c.impact) lines.push(`  - if wrong: ${c.impact}`)
      if (c.correction) lines.push(`  - correction: ${c.correction}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// A user-role row Claude reads, kept in the transcript, no turn started,
// and a notice the person sees there, which Claude never reads.
async function note($: EngineInterface, words: string, shown: string) {
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: words }] } })
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `assumption-check: ${shown}` }] } })
}

async function setCard($: EngineInterface, id: string, change: (card: Card) => Card) {
  await update($, cards, list => list.map(c => (c.id === id ? change(c) : c)))
}

async function turnOn($: EngineInterface) {
  await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
  await update($, isOn, () => true)
  $.ui.invalidate('tool.describe')
}

async function turnOff($: EngineInterface) {
  await update($, isOn, () => false)
  $.ui.invalidate('tool.describe')
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

async function exportMarkdown($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const id = (await $.session.id()).slice(0, 8)
  const path = `${home.replace(/\\/g, '/')}/.claude/assumption-check/${day}-${id}.md`
  await $.fs.write(path, toMarkdown(await read($, groups), await read($, cards)))
  return path
}

async function reinforce($: EngineInterface, list: Card[]) {
  const [first, ...rest] = list
  if (first === undefined) return
  const ids = new Set(list.map(c => c.id))
  await update($, cards, all => all.map(c => (ids.has(c.id) ? { ...c, status: 'reinforced' as const } : c)))
  await note($, say.reinforced([first, ...rest]), `you confirmed ${list.map(c => c.id).join(', ')}`)
}

async function undo($: EngineInterface, card: Card) {
  await setCard($, card.id, c => ({ ...c, status: 'open', correction: undefined, isSavedToMemory: undefined }))
  await update($, fixing, () => null)
  await note($, card.status === 'reinforced' ? say.unreinforced(card) : say.unwrong(card), `you took back your mark on ${card.id}`)
}

async function markWrong($: EngineInterface, card: Card, typed: string) {
  const correction = typed.trim()
  await setCard($, card.id, c => ({ ...c, status: correction ? 'corrected' : 'wrong', ...(correction ? { correction } : {}) }))
  await update($, fixing, () => null)
  void $.prompt.submit({ text: correction ? say.corrected(card, correction) : say.wrong(card) })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'assumption-check',
      description: 'Open the assumptions pane; `on` or `off` switches capture, `export` writes the cards to a file',
      argumentHint: '[on|off|export]',
    })
    if (options.startOn === true) await turnOn($)
    else if (await read($, isOn)) await turnOn($)

    return next(e)
  })

  on('command.run', { command: 'assumption-check' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on') {
      await turnOn($)
      return { text: 'Assumption capture is on for this session. The pane opens with the first card.' }
    }
    if (arg === 'off') {
      await turnOff($)
      return { text: 'Assumption capture is off. Your cards and marks stay in the pane.' }
    }
    if (arg === 'export') return { text: `Assumptions written to ${await exportMarkdown($)}` }
    await openPane($)
    return { text: (await read($, isOn)) ? 'Assumptions pane opened.' : 'Assumptions pane opened. Capture is off: `/assumption-check on` starts it.' }
  })

  // The capture instruction, only while on. Added after the engine's
  // sections, on the session side of the cache boundary.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOn)) || e.traits.includes('teammate')) return composed
    return { sections: [...composed.sections, { id: 'assumption-check:capture', text: INSTRUCTION, scope: 'session' as const }] }
  })

  // A tool cannot be unregistered: once capture is off its description
  // tells Claude to leave it alone.
  on('tool.describe', { tool: 'mcp__assumption-check__note_assumption' }, async ($, e, next) =>
    (await read($, isOn)) ? next(e) : { description: 'Inactive: assumption-check is off. Do not call this tool.' },
  )

  // A new dropdown per prompt, while capture is on.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'task-notification' && (await read($, isOn))) {
      const list = await update($, groups, all => [...all, { id: `P${all.length + 1}`, label: groupLabel(e.text) }])
      await update($, expanded, () => [list.at(-1)?.id ?? 'P1'])
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__assumption-check__note_assumption' }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'Not logged: assumption-check shows the main session only. Do not call this tool again.' }
    if (!(await read($, isOn))) return { result: 'assumption-check is off; nothing was logged. Stop logging assumptions.' }
    const logged = parseAssumptions(e)
    if (logged.length === 0) return { deny: 'No assumption to log: pass `assumptions`, each with at least a `statement`.' }

    let group = (await read($, groups)).at(-1)?.id
    if (group === undefined) {
      group = 'P1'
      await update($, groups, () => [{ id: group, label: '(before capture was on)' }])
      await update($, expanded, () => [group])
    }
    let added: Card[] = []
    await update($, cards, list => {
      added = logged.map((one, i) => ({ ...one, id: `A${list.length + 1 + i}`, group, status: 'open' as const }))
      return [...list, ...added]
    })

    if (!(await read($, hasAutoOpened))) {
      await update($, hasAutoOpened, () => true)
      void openPane($)
    }
    return { result: `Logged ${added.map(c => c.id).join(', ')}. Carry on; the user reviews them in their pane.` }
  }).catch(() => ({ result: 'assumption-check could not log that; carry on without it.' }))

  // A compaction may summarize the confirmations away; say them again.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && 'messages' in done) {
      const pinned = (await read($, cards)).filter(c => c.status === 'reinforced')
      if (pinned.length > 0) await note($, say.pinned(pinned), `confirmed assumptions said again after the compaction (${pinned.map(c => c.id).join(', ')})`)
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Mobile draws no Input: there "wrong" always lets Claude ask.
    const Input = 'Input' in elements ? elements.Input : undefined
    const on_ = await read($, isOn)
    const allGroups = await read($, groups)
    const all = await read($, cards)
    const open = new Set(await read($, expanded))
    const picked = await read($, selected)
    const fix = await read($, fixing)
    const shown = await read($, view)
    const width = Math.max(20, e.props.bodyColumns - 6)
    const cut = (s: string) => (s.length > width ? `${s.slice(0, width - 1)}…` : s)
    const pinned = all.filter(c => c.status === 'reinforced')

    const header = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text color={on_ ? 'success' : undefined} dimColor={!on_}>
          {on_ ? '● capture on' : '○ capture off'}
        </Text>
        <Button key="toggle" label={on_ ? 'turn off' : 'turn on'} onPress={() => void (on_ ? turnOff($) : turnOn($))} />
        <Button
          key="view"
          label={shown === 'pinned' ? 'back to prompts' : `pinned ${pinned.length}`}
          onPress={() => void update($, view, () => shown === 'pinned' ? 'prompts' : 'pinned')}
        />
        <Button key="export" label="export" onPress={() => void exportMarkdown($).then(path => $.ui.toast(`Assumptions written to ${path}`))} />
      </Box>
    )

    const details = (card: Card) => (
      <Box flexDirection="column" paddingLeft={4}>
        <Text>{card.statement}</Text>
        <Text>
          <Text color={card.confidence === 'low' ? 'warning' : card.confidence === 'high' ? 'success' : undefined}>
            {card.confidence} confidence
          </Text>
          <Text dimColor> · {card.category}</Text>
        </Text>
        {card.why !== '' && <Text dimColor>why: {card.why}</Text>}
        {card.source !== undefined && <Text dimColor>source: {card.source}</Text>}
        {card.impact !== '' && <Text dimColor>if wrong: {card.impact}</Text>}
        {card.correction !== undefined && <Text color="suggestion">→ {card.correction}</Text>}
        {card.status === 'wrong' && <Text color="error">marked wrong · Claude asks you what's right</Text>}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {card.status === 'open' && (
            <Button key={`reinforce-${card.id}`} label="reinforce" hotkey="r" variant="primary" onPress={() => void reinforce($, [card])} />
          )}
          {card.status === 'open' && (
            <Button
              key={`wrong-${card.id}`}
              label="wrong"
              hotkey="w"
              onPress={() => void (Input === undefined ? markWrong($, card, '') : update($, fixing, () => fix === card.id ? null : card.id))}
            />
          )}
          {card.status === 'open' && (
            <Button key={`why-${card.id}`} label="why?" hotkey="y" onPress={() => void $.prompt.submit({ text: say.why(card) })} />
          )}
          {card.status === 'reinforced' && !card.isSavedToMemory && (
            <Button
              key={`remember-${card.id}`}
              label="save to memory"
              hotkey="m"
              onPress={() => void setCard($, card.id, c => ({ ...c, isSavedToMemory: true })).then(() => $.prompt.submit({ text: say.remember(card) }))}
            />
          )}
          {card.status !== 'open' && <Button key={`undo-${card.id}`} label="undo" hotkey="u" onPress={() => void undo($, card)} />}
        </Box>
        {fix === card.id && card.status === 'open' && Input !== undefined && (
          <Input
            key={`fix-${card.id}`}
            label="right assumption:"
            placeholder="leave empty and Claude asks you"
            submitLabel="send"
            autoFocus
            onSubmit={(value: string) => void markWrong($, card, value)}
          />
        )}
      </Box>
    )

    const row = (card: Card) => (
      <Box key={`row-${card.id}`} flexDirection="column">
        <Button
          key={`card-${card.id}`}
          plain
          onPress={() => void update($, selected, () => picked === card.id ? null : card.id)}
        >
          <Text color={card.status === 'reinforced' ? 'success' : card.status === 'open' ? undefined : 'error'}>{MARK[card.status]}</Text>{' '}
          <Text dimColor>{card.id}</Text> <Text strikethrough={card.status === 'wrong' || card.status === 'corrected'}>{cut(card.statement)}</Text>
          {card.confidence === 'low' && card.status === 'open' && <Text color="warning"> !</Text>}
        </Button>
        {picked === card.id && details(card)}
      </Box>
    )

    if (shown === 'pinned') {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text bold>Confirmed by you</Text>
          {pinned.length === 0 && <Text dimColor>Nothing confirmed yet. Reinforce a card and it shows here.</Text>}
          {pinned.map(row)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {all.length === 0 && (
          <Text dimColor>
            {on_ ? 'No assumptions yet. They show here as Claude logs them.' : 'Capture is off, so Claude works as without this mod. Turn it on to see its assumptions.'}
          </Text>
        )}
        {[...allGroups].reverse().map(group => {
          const mine = all.filter(c => c.group === group.id)
          if (mine.length === 0) return null
          const toCheck = mine.filter(c => c.status === 'open')
          const isOpen = open.has(group.id)
          return (
            <Box key={`group-${group.id}`} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`toggle-${group.id}`}
                  plain
                  onPress={() => void update($, expanded, list => (list.includes(group.id) ? list.filter(id => id !== group.id) : [...list, group.id]))}
                >
                  {isOpen ? '▾' : '▸'} <Text bold>{group.id}</Text> {cut(group.label)}{' '}
                  <Text dimColor>· {toCheck.length > 0 ? `${toCheck.length} to check` : `${mine.length} marked`}</Text>
                </Button>
                {isOpen && toCheck.length > 1 && (
                  <Button key={`all-${group.id}`} label="reinforce all" onPress={() => void reinforce($, toCheck)} />
                )}
              </Box>
              {isOpen && <Box flexDirection="column" paddingLeft={2}>{mine.map(row)}</Box>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
