// prompt-enhancer: rewrites the draft in your prompt box into a better prompt.
//
//                                                         ✦ enhance
//   ✦ A few questions first  1 of 3 · Enter with nothing skips one
//   How often does it fail, and is there a link to a failing run?
//   › ____                                   [ Skip the rest ] [ Discard ]
//   ✦ Enhanced  session model · in 14.2k (13.9k cached) · out 610
//   Tight  [Balanced]  Thorough
//   <context> ... </context> <task> ... </task> ...
//   [ Use it ] [ Send ] [ Copy ] [ Retry ] [ Discard ]
//
// Press the chip above the prompt, or run /enhance <text>. Two model calls:
// the first asks 2–4 questions about what the draft leaves out (none when it
// is clear), the second writes three versions under fixed markers, following
// Anthropic's and OpenAI's prompting guidance (task first, XML sections,
// checkable success criteria, placeholders in [brackets] for facts it lacks).
// Paths, @mentions, /commands and code in backticks must come back verbatim:
// the card names any the shown version changed or dropped.
//
// The `model` option picks the model. `session`, the default, forks this
// conversation ($.model.fork): the session's own model, reading the
// transcript from the prompt cache, so it knows what "that" and "again" mean.
// Before the first reply there is nothing to fork, and it falls back to
// Sonnet with no conversation. Any other value (haiku, sonnet, opus, a full
// id) runs $.model.complete with the last messages sent as an excerpt.
//
// The chip reads the box with $.prompt.read and "Use it" writes it with
// $.prompt.fill. A surface that draws its own composer refuses with
// `no_composer`: from then on the chip shows as a hint for /enhance, and the
// card offers Send and Copy without "Use it".
//
// Cancel drops the result: a completion is aborted; a fork cannot be, so its
// late answer is ignored.
//
// The band is shared, and the hooks on it run in an order no mod picks, so
// each tree says how it shares: the chip's root Box is keyed
// `band-beside:prompt-enhancer`, the cards' `band-under:prompt-enhancer`.
// Beneath motta-statusline, the status line reads the key and draws the chip
// at the right of its lines, a card under them. Above it, this hook does the
// same with what the plugins beneath drew. Nothing is drawn while idle during
// a turn or under a survey.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, ModelUsage, Register, RenderSurface } from 'claude-code'

import type { BoxAccess, Failure, Job, Phase, Usage, Variant } from '../types'

const TIMEOUT_MS = 120_000
const MAX_TOKENS = 4_000
// Used when the session model has no conversation to fork yet.
const FALLBACK_MODEL = 'sonnet'
const EXCERPT_MESSAGES = 12
const EXCERPT_MESSAGE_CHARS = 1_200
const EXCERPT_CHARS = 10_000
const NO_BOX_TIP = 'This app does not let mods read your prompt box. Run /enhance followed by your prompt instead.'

const phase = atom({ plugin: 'prompt-enhancer', key: 'phase' } as const, 'idle' as Phase)
const job = atom({ plugin: 'prompt-enhancer', key: 'job' } as const, null as Job | null)
const questions = atom({ plugin: 'prompt-enhancer', key: 'questions' } as const, [] as string[])
const answers = atom({ plugin: 'prompt-enhancer', key: 'answers' } as const, [] as string[])
const variants = atom({ plugin: 'prompt-enhancer', key: 'variants' } as const, [] as Variant[])
const shown = atom({ plugin: 'prompt-enhancer', key: 'shown' } as const, 0)
const usage = atom({ plugin: 'prompt-enhancer', key: 'usage' } as const, null as Usage | null)
const modelLabel = atom({ plugin: 'prompt-enhancer', key: 'modelLabel' } as const, '')
const failure = atom({ plugin: 'prompt-enhancer', key: 'failure' } as const, null as Failure | null)
const boxAccess = atom({ plugin: 'prompt-enhancer', key: 'boxAccess' } as const, 'unknown' as BoxAccess)

const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Set from the options each time the module loads.
let settings = { model: 'session', effort: undefined as ModelEffort | undefined }
// Bumped by every start, retry and cancel: a call whose ticket is stale when
// it answers is dropped.
let ticket = 0
let stop: AbortController | null = null

// What the model is told about the conversation: it sits above (a fork), it
// comes as an excerpt, or there is none.
export type Convo = { kind: 'fork' } | { kind: 'excerpt'; text: string } | { kind: 'none' }

type Reply = { isOk: true; text: string; usage: ModelUsage; label: string } | { isOk: false; reason: string }

function convoNote(convo: Convo): string {
  if (convo.kind === 'fork') return ' Our conversation so far is above: use it to understand what the draft refers to. Do not use tools and do not carry on with the work; only answer this message.'
  if (convo.kind === 'excerpt') return ' The last messages of our conversation are in <conversation>: use them to understand what the draft refers to.'
  return ''
}

function convoBlock(convo: Convo): string[] {
  return convo.kind === 'excerpt' ? ['', '<conversation>', convo.text, '</conversation>'] : []
}

export function askPrompt(draft: string, convo: Convo): string {
  return [
    `I am about to send a prompt to Claude Code, the AI coding agent working in my repository, and I want to improve it first.${convoNote(convo)}`,
    '',
    'First, find what is missing. If my draft leaves out something that would change how the agent does the work (the goal, the scope, constraints, how to check the result, the output I expect), write 2 to 4 short questions that would fill those gaps. Ask only what the draft and the conversation do not already answer, and only what I would know. If nothing important is missing, ask nothing.',
    '',
    'Reply with the questions alone, one per line, each starting with "Q: ", in the language of my draft. If you have none, reply with exactly: NO QUESTIONS',
    ...convoBlock(convo),
    '',
    '<draft>',
    draft,
    '</draft>',
  ].join('\n')
}

export function writePrompt(draft: string, qa: readonly [string, string][], convo: Convo): string {
  const answered = qa.filter(([, a]) => a.trim() !== '')
  return [
    `Rewrite the draft prompt below, which I am about to send to Claude Code, the AI coding agent working in my repository.${convoNote(convo)}`,
    '',
    "Follow Anthropic's and OpenAI's prompting guidance:",
    '- Be clear and direct. Lead with the task, then the context it needs and why it matters.',
    '- Put the parts of a longer prompt in XML tags: <context>, <task>, <constraints>, <output_format>.',
    '- Say what to do rather than what not to do.',
    '- Give success criteria the agent can check, and how to verify the work.',
    "- Use only facts from my draft, my answers and the conversation. Where the agent needs a fact you don't have, leave a placeholder in square brackets, like [link to the failing run]. Never invent file names, numbers or requirements.",
    '- Copy file paths, @mentions, /commands, code and anything in backticks exactly as I wrote them.',
    "- Write in the language of my draft, as me speaking to the agent. Don't address me and don't explain your changes.",
    '',
    'Write three versions:',
    '- TIGHT: the shortest prompt that keeps everything that matters, a few lines, no tags.',
    '- BALANCED: the structure above, with nothing padded.',
    '- THOROUGH: BALANCED plus a role for the agent, the edge cases to check, and when to stop and ask me.',
    '',
    'Reply in exactly this form, with nothing before or after it:',
    '=== TIGHT ===',
    '(the tight version)',
    '=== BALANCED ===',
    '(the balanced version)',
    '=== THOROUGH ===',
    '(the thorough version)',
    ...convoBlock(convo),
    '',
    '<draft>',
    draft,
    '</draft>',
    ...(answered.length > 0 ? ['', '<answers>', ...answered.map(([q, a]) => `Q: ${q}\nA: ${a.trim()}`), '</answers>'] : []),
  ].join('\n')
}

export function parseQuestions(reply: string): string[] {
  return reply
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^Q\s*[:：]/i.test(line))
    .map(line => line.replace(/^Q\s*[:：]\s*/i, '').trim())
    .filter(q => q !== '')
    .slice(0, 4)
}

const NAMES: Record<string, string> = { TIGHT: 'Tight', BALANCED: 'Balanced', THOROUGH: 'Thorough' }

// The three versions by their markers; a reply without markers is one
// Balanced version.
export function parseVariants(reply: string): Variant[] {
  const parts = reply.split(/^[ \t]*===[ \t]*(TIGHT|BALANCED|THOROUGH)[ \t]*===[ \t]*$/im)
  const found: Variant[] = []
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const text = (parts[i + 1] ?? '').trim()
    if (text !== '') found.push({ name: NAMES[(parts[i] ?? '').toUpperCase()] ?? 'Balanced', text })
  }
  if (found.length > 0) return found
  const whole = reply.trim()
  return whole === '' ? [] : [{ name: 'Balanced', text: whole }]
}

// Code in backticks, @mentions and /commands in the draft, each once.
export function protectedTokens(draft: string): string[] {
  const found = draft.match(/`[^`\n]+`|(?<![\w@])@[\w./\\-]*[\w/]|(?<![\w/.\\-])\/[a-z][\w-]*(?![\w/.\\])/gi) ?? []
  return [...new Set(found)]
}

export function missingTokens(draft: string, text: string): string[] {
  return protectedTokens(draft).filter(t => !text.includes(t.startsWith('`') ? t.slice(1, -1) : t))
}

type Message = { role: string; content: readonly unknown[] }

// The text of the last messages, tool calls and reminders left out.
export function excerpt(messages: readonly Message[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const text = m.content
      .map(block => {
        const b = block as { type?: unknown; text?: unknown } | null
        return b !== null && typeof b === 'object' && b.type === 'text' ? String(b.text ?? '') : ''
      })
      .join('\n')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim()
    if (text === '') continue
    const cut = text.length > EXCERPT_MESSAGE_CHARS ? `${text.slice(0, EXCERPT_MESSAGE_CHARS - 1)}…` : text
    lines.push(`${m.role === 'user' ? 'Me' : 'Claude'}: ${cut}`)
  }
  const kept = lines.slice(-EXCERPT_MESSAGES)
  while (kept.length > 1 && kept.join('\n\n').length > EXCERPT_CHARS) kept.shift()
  return kept.join('\n\n')
}

function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function formatUsage(u: Usage): string {
  return `in ${kilo(u.input)}${u.cached > 0 ? ` (${kilo(u.cached)} cached)` : ''} · out ${kilo(u.output)}`
}

function why(r: { reason: string; status?: number | null; error?: string }): string {
  if (r.reason === 'api-error') return `the API answered ${r.status ?? 'nothing'} (${r.error ?? 'unknown'})`
  if (r.reason === 'empty-reply') return 'the model replied with no text'
  if (r.reason === 'aborted') return `no answer within ${TIMEOUT_MS / 1000} s`
  return r.reason
}

async function complete($: EngineInterface, model: string, prompt: string, label: string): Promise<Reply> {
  stop = new AbortController()
  const r = await $.model.complete(
    { model, prompt, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, ...(settings.effort ? { effort: settings.effort } : {}) },
    { signal: stop.signal },
  )
  stop = null
  return r.isAnswered ? { isOk: true, text: r.text, usage: r.usage, label } : { isOk: false, reason: why(r) }
}

async function callModel($: EngineInterface, prompt: (convo: Convo) => string): Promise<Reply> {
  if (settings.model === 'session') {
    const forked = await Promise.race([$.model.fork({ prompt: prompt({ kind: 'fork' }) }), $.clock.sleep(TIMEOUT_MS).then(() => null)])
    if (forked === null) return { isOk: false, reason: `no answer within ${TIMEOUT_MS / 1000} s` }
    if (forked.isAnswered) return { isOk: true, text: forked.text, usage: forked.usage, label: 'session model' }
    if (forked.reason !== 'nothing-to-fork') return { isOk: false, reason: why(forked) }
    return complete($, FALLBACK_MODEL, prompt({ kind: 'none' }), `${FALLBACK_MODEL} (no conversation yet)`)
  }
  const messages = await $.session.messages({ as: 'api' }).catch(() => [])
  const text = excerpt(messages)
  return complete($, settings.model, prompt(text === '' ? { kind: 'none' } : { kind: 'excerpt', text }), settings.model)
}

async function addUsage($: EngineInterface, u: ModelUsage) {
  const cached = u.cache_read_input_tokens
  const input = u.input_tokens + u.cache_creation_input_tokens + cached
  await update($, usage, was => ({ input: (was?.input ?? 0) + input, output: (was?.output ?? 0) + u.output_tokens, cached: (was?.cached ?? 0) + cached }))
}

async function reset($: EngineInterface) {
  await update($, phase, () => 'idle')
  await update($, job, () => null)
  await update($, questions, () => [])
  await update($, answers, () => [])
  await update($, variants, () => [])
  await update($, shown, () => 0)
  await update($, usage, () => null)
  await update($, failure, () => null)
}

async function fail($: EngineInterface, reason: string, step: 'ask' | 'write') {
  await update($, failure, () => ({ reason, step }))
  await update($, phase, () => 'error')
}

async function start($: EngineInterface, original: string, via: Job['via']) {
  const mine = ++ticket
  await reset($)
  await update($, job, () => ({ original, via }))
  await update($, modelLabel, () => (settings.model === 'session' ? 'session model' : settings.model))
  await ask($, mine)
}

async function ask($: EngineInterface, mine: number) {
  const current = await read($, job)
  if (current === null) return
  await update($, failure, () => null)
  await update($, phase, () => 'asking')
  const r = await callModel($, convo => askPrompt(current.original, convo))
  if (mine !== ticket) return
  if (!r.isOk) return fail($, r.reason, 'ask')
  await addUsage($, r.usage)
  await update($, modelLabel, () => r.label)
  const asked = parseQuestions(r.text)
  if (asked.length === 0) return write($, mine)
  await update($, questions, () => asked)
  await update($, answers, () => [])
  await update($, phase, () => 'questions')
}

async function write($: EngineInterface, mine: number) {
  const current = await read($, job)
  if (current === null) return
  const asked = await read($, questions)
  const given = await read($, answers)
  const qa = asked.map((q, i) => [q, given[i] ?? ''] as [string, string])
  await update($, failure, () => null)
  await update($, phase, () => 'writing')
  const r = await callModel($, convo => writePrompt(current.original, qa, convo))
  if (mine !== ticket) return
  if (!r.isOk) return fail($, r.reason, 'write')
  await addUsage($, r.usage)
  await update($, modelLabel, () => r.label)
  const versions = parseVariants(r.text)
  if (versions.length === 0) return fail($, 'the model replied with no prompt', 'write')
  await update($, variants, () => versions)
  await update($, shown, () => Math.max(0, versions.findIndex(v => v.name === 'Balanced')))
  await update($, phase, () => 'result')
}

async function answer($: EngineInterface, index: number, value: string) {
  const given = await read($, answers)
  if (given.length !== index) return
  const asked = await read($, questions)
  await update($, answers, () => [...given, value.trim()])
  if (index + 1 >= asked.length) await write($, ++ticket)
}

async function cancel($: EngineInterface) {
  ticket++
  stop?.abort()
  stop = null
  await reset($)
}

async function retry($: EngineInterface) {
  const step = (await read($, failure))?.step ?? 'write'
  const mine = ++ticket
  await (step === 'ask' ? ask($, mine) : write($, mine))
}

// The chip: enhance what the box holds. An empty read is either an empty box
// or a surface that binds none; one empty fill tells them apart, once.
async function chip($: EngineInterface) {
  const { text } = await $.prompt.read()
  if (text.trim() !== '') {
    await update($, boxAccess, () => 'yes')
    return start($, text, 'box')
  }
  if ((await read($, boxAccess)) === 'unknown') {
    const probe = await $.prompt.fill({ text: '', mode: 'append' })
    if (probe.refusal === 'no_composer') await update($, boxAccess, () => 'no')
    else if (probe.isFilled) await update($, boxAccess, () => 'yes')
  }
  $.ui.toast((await read($, boxAccess)) === 'no' ? NO_BOX_TIP : 'Write a prompt in the box first, then press ✦ enhance.')
}

async function useIt($: EngineInterface, text: string) {
  const r = await $.prompt.fill({ text, mode: 'replace' })
  if (r.isFilled) {
    await update($, boxAccess, () => 'yes')
    ticket++
    return reset($)
  }
  if (r.refusal === 'no_composer') {
    await update($, boxAccess, () => 'no')
    $.ui.toast('This app does not let mods write your prompt box. Use Send or Copy.')
    return
  }
  $.ui.toast(r.refusal === 'dialog' ? 'Close the open dialog first, then press Use it.' : 'The box did not take the text. Use Send or Copy.')
}

async function send($: EngineInterface, text: string) {
  const current = await read($, job)
  ticket++
  await reset($)
  // The draft the chip read is still in the box: clear it.
  if (current?.via === 'box' && (await read($, boxAccess)) === 'yes') await $.prompt.fill({ text: '', mode: 'replace' })
  void $.prompt.submit({ text })
}

async function copy($: EngineInterface, text: string, surface: RenderSurface) {
  const r = await $.ui.copy({ text, surface })
  $.ui.toast(r.isCopied ? 'Enhanced prompt copied.' : `Could not copy (${r.reason}).`)
}

// What `next(e)` hands back when no plugin beneath drew in the band.
function isFree(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === '') return true
  return typeof node === 'object' && (node as { type?: unknown }).type === 'engine'
}

export const register: Register = (on, options) => {
  const effort = String(options.effort ?? 'default')
  settings = {
    model: String(options.model ?? 'session').trim() || 'session',
    effort: EFFORTS.includes(effort as ModelEffort) ? (effort as ModelEffort) : undefined,
  }
  const showChip = options.chip !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'enhance',
      description: 'Enhance a prompt: asks what it leaves out, then writes it three ways',
      argumentHint: '<your prompt>',
    })
    // A call that was running when the session or the mod restarted is gone.
    const now = await read($, phase)
    if (now === 'asking' || now === 'writing') await reset($)
    return next(e)
  })

  on('command.run', { command: 'enhance' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') return { text: 'Put your prompt after the command: /enhance fix the flaky checkout test. Or write it in the box and press ✦ enhance above it.' }
    const now = await read($, phase)
    if (now === 'asking' || now === 'writing') return { text: 'An enhance is already running. Cancel it above the prompt first.' }
    void start($, text, 'command')
    return { text: '✦ Enhancing. The result shows above the prompt.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await read($, phase)
    if (now === 'idle' && (e.props.isWorking || !showChip)) return next(e)
    const below = await next(e)

    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Mobile draws no Input: there the questions can only be skipped.
    const Input = 'Input' in elements ? elements.Input : undefined
    const access = await read($, boxAccess)
    const hasBox = e.surface === 'terminal' || access !== 'no'
    const label = await read($, modelLabel)

    let ours
    if (now === 'idle') {
      ours = (
        <Box key="band-beside:prompt-enhancer" flexDirection="row" justifyContent="flex-end" paddingX={1}>
          {hasBox ? <Button key="enhance" plain label="✦ enhance" onPress={() => void chip($)} /> : <Text dimColor>{'✦ /enhance <your prompt>'}</Text>}
        </Box>
      )
    } else if (now === 'asking' || now === 'writing') {
      ours = (
        <Box key="band-under:prompt-enhancer" flexDirection="row" gap={1} paddingX={1}>
          <Text color="suggestion">✦</Text>
          <Text>{now === 'asking' ? 'Reading your draft…' : 'Writing three versions…'}</Text>
          <Text dimColor>{label}</Text>
          <Button key="cancel" label="Cancel" onPress={() => void cancel($)} />
        </Box>
      )
    } else if (now === 'questions') {
      const asked = await read($, questions)
      const index = (await read($, answers)).length
      const isLast = index + 1 >= asked.length
      ours = (
        <Box key="band-under:prompt-enhancer" flexDirection="column" paddingX={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color="suggestion" bold>✦ A few questions first</Text>
            <Text dimColor>
              {index + 1} of {asked.length}
              {Input !== undefined ? ' · Enter with nothing skips one' : ''}
            </Text>
          </Box>
          <Text>{asked[index] ?? ''}</Text>
          {Input !== undefined && (
            <Input
              key={`answer-${index}`}
              label="›"
              placeholder="your answer"
              submitLabel={isLast ? 'write it' : 'next'}
              autoFocus
              onSubmit={(value: string) => void answer($, index, value)}
            />
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="skip" label={Input !== undefined ? 'Skip the rest' : 'Write it without answers'} onPress={() => void write($, ++ticket)} />
            <Button key="discard" label="Discard" onPress={() => void cancel($)} />
          </Box>
        </Box>
      )
    } else if (now === 'result') {
      const versions = await read($, variants)
      const at = Math.min(await read($, shown), versions.length - 1)
      const picked = versions[at] ?? { name: 'Balanced', text: '' }
      const spent = await read($, usage)
      const current = await read($, job)
      const missing = current === null ? [] : missingTokens(current.original, picked.text)
      ours = (
        <Box key="band-under:prompt-enhancer" flexDirection="column" paddingX={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color="suggestion" bold>✦ Enhanced</Text>
            <Text dimColor>
              {label}
              {spent !== null ? ` · ${formatUsage(spent)}` : ''}
            </Text>
          </Box>
          {versions.length > 1 && (
            <Box flexDirection="row" gap={2}>
              {versions.map((v, i) => (
                <Button key={`variant-${i}`} plain onPress={() => void update($, shown, () => i)}>
                  {i === at ? <Text bold color="suggestion">[{v.name}]</Text> : v.name}
                </Button>
              ))}
            </Box>
          )}
          <Text>{picked.text}</Text>
          {missing.length > 0 && <Text color="warning">Changed or dropped: {missing.join(', ')}</Text>}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {hasBox && <Button key="use" label="Use it" variant="primary" onPress={() => void useIt($, picked.text)} />}
            <Button key="send" label="Send" {...(hasBox ? {} : { variant: 'primary' as const })} onPress={() => void send($, picked.text)} />
            <Button key="copy" label="Copy" onPress={press => void copy($, picked.text, press.surface)} />
            <Button key="retry" label="Retry" onPress={() => void write($, ++ticket)} />
            <Button key="discard" label="Discard" onPress={() => void cancel($)} />
          </Box>
        </Box>
      )
    } else {
      const failed = await read($, failure)
      ours = (
        <Box key="band-under:prompt-enhancer" flexDirection="row" gap={1} flexWrap="wrap" paddingX={1}>
          <Text color="error">✦ Could not enhance: {failed?.reason ?? 'unknown error'}</Text>
          <Button key="retry-failed" label="Retry" onPress={() => void retry($)} />
          <Button key="dismiss" label="Dismiss" onPress={() => void cancel($)} />
        </Box>
      )
    }

    if (isFree(below)) return ours
    // Above the plugins that drew: the chip at the right of their tree, a card
    // under it.
    return now === 'idle' ? (
      <Box flexDirection="row" alignItems="flex-start">
        <Box flexDirection="column" flexGrow={1}>
          {below}
        </Box>
        {ours}
      </Box>
    ) : (
      <Box flexDirection="column">
        {below}
        {ours}
      </Box>
    )
  })
}
