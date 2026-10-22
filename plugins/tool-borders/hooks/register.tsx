import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Verdict } from '../types'

// Each tool call's row in the transcript is marked with a color that says
// what the call does (its family: the hue) and how far it reaches (the
// project folder, elsewhere on this machine, or the internet: muted, medium,
// bright). All of it is read from the tool's name and input; it is a guess
// from text, never from what the call actually touched.

export type Family = 'bookkeeping' | 'read' | 'change' | 'delegate' | 'run'
export type Reach = 'project' | 'machine' | 'internet'

// filetree copies the read and change colors for its shimmer
// (plugins/filetree/hooks/colors.ts): change them together.
export const COLORS: Record<Family, Record<Reach, string>> = {
  bookkeeping: { project: '#6f6f6f', machine: '#6f6f6f', internet: '#6f6f6f' }, // gray
  read: { project: '#3f5670', machine: '#5b8fcc', internet: '#7dd3fc' }, // blue
  change: { project: '#6b6233', machine: '#b8a531', internet: '#fde047' }, // yellow: create, update, delete
  delegate: { project: '#6f4636', machine: '#c0674a', internet: '#f09a76' }, // Anthropic clay
  run: { project: '#6b456b', machine: '#b14fb8', internet: '#f0abfc' }, // magenta
}

export type Kind = { family: Family; reach: Reach }

// Shell commands rank by risk: of several (`a && b`), the riskiest decides.
const RANK: Record<Family, number> = { bookkeeping: 0, read: 1, change: 2, delegate: 3, run: 4 }
const REACH_RANK: Record<Reach, number> = { project: 0, machine: 1, internet: 2 }
const riskier = (a: Family, b: Family) => (RANK[b] > RANK[a] ? b : a)
const farther = (a: Reach, b: Reach) => (REACH_RANK[b] > REACH_RANK[a] ? b : a)

// --- Built-in tools ---------------------------------------------------------

const BUILTIN: Record<string, Family> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  LS: 'read',
  NotebookRead: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  Edit: 'change',
  MultiEdit: 'change',
  Write: 'change',
  NotebookEdit: 'change',
  BashOutput: 'run',
  Monitor: 'run',
  KillShell: 'run',
  Agent: 'delegate',
  Task: 'delegate',
  Workflow: 'delegate',
  SendMessage: 'delegate',
  RemoteTrigger: 'delegate',
  TodoWrite: 'bookkeeping',
  AskUserQuestion: 'bookkeeping',
  Skill: 'bookkeeping',
  ToolSearch: 'bookkeeping',
  EnterPlanMode: 'bookkeeping',
  ExitPlanMode: 'bookkeeping',
  EnterWorktree: 'bookkeeping',
  ExitWorktree: 'bookkeeping',
  ScheduleWakeup: 'bookkeeping',
  CronCreate: 'bookkeeping',
  CronDelete: 'bookkeeping',
  CronList: 'bookkeeping',
  TaskStop: 'bookkeeping',
  ListAgents: 'bookkeeping',
  PushNotification: 'bookkeeping',
  advisor: 'bookkeeping',
}

// Built-ins that always reach the same place, whatever their input says.
const BUILTIN_REACH: Record<string, Reach> = {
  WebFetch: 'internet',
  WebSearch: 'internet',
  SendMessage: 'machine',
  RemoteTrigger: 'internet',
}

// --- Words in a tool's name (MCP tools, and tools this list does not know) --

const WORDS: Record<Exclude<Family, 'bookkeeping'>, string[]> = {
  read: [
    'get', 'list', 'read', 'search', 'find', 'fetch', 'query', 'lookup', 'look', 'describe', 'show', 'view',
    'browse', 'retrieve', 'download', 'export', 'inspect', 'check', 'status', 'count', 'preview', 'scan', 'poll',
    'explore', 'discover', 'resolve', 'info', 'details', 'history', 'diff', 'compare', 'validate', 'verify',
    'analyze', 'peek', 'select', 'filter', 'load', 'extract', 'parse', 'screenshot', 'capture', 'summarize',
    'explain', 'recent', 'stats', 'usage', 'metadata', 'permissions',
  ],
  change: [
    // create
    'create', 'add', 'new', 'insert', 'post', 'send', 'publish', 'upload', 'make', 'generate', 'compose', 'draft',
    'reply', 'forward', 'comment', 'share', 'invite', 'schedule', 'book', 'register', 'submit', 'fork', 'copy',
    'duplicate', 'clone', 'import', 'attach', 'append', 'notify', 'emit', 'open', 'request',
    // update
    'update', 'edit', 'modify', 'change', 'set', 'put', 'patch', 'write', 'rename', 'move', 'replace', 'apply',
    'merge', 'assign', 'unassign', 'label', 'unlabel', 'tag', 'untag', 'mark', 'unmark', 'star', 'pin', 'unpin',
    'enable', 'disable', 'toggle', 'configure', 'approve', 'reject', 'accept', 'decline', 'respond', 'transition',
    'close', 'reopen', 'lock', 'unlock', 'archive', 'unarchive', 'restore', 'untrash', 'sync', 'refresh',
    'reorder', 'sort', 'format', 'convert', 'transform', 'save', 'commit', 'sign', 'fill', 'annotate', 'link',
    'unlink', 'connect', 'disconnect', 'subscribe', 'unsubscribe', 'follow', 'unfollow', 'react', 'vote', 'grant',
    // delete
    'delete', 'remove', 'destroy', 'drop', 'purge', 'erase', 'wipe', 'clear', 'trash', 'discard', 'kill',
    'terminate', 'cancel', 'abort', 'revoke', 'uninstall', 'detach', 'prune', 'truncate', 'empty', 'stop',
  ],
  run: [
    'run', 'execute', 'exec', 'invoke', 'call', 'trigger', 'launch', 'spawn', 'eval', 'evaluate', 'deploy', 'build',
    'test', 'install', 'compile', 'interact', 'start', 'process', 'click', 'type', 'press', 'scroll', 'drag',
    'hover', 'navigate', 'key', 'batch',
  ],
  delegate: ['delegate', 'dispatch', 'handoff'],
}

const WORD_FAMILY = new Map<string, Family>()
for (const [family, words] of Object.entries(WORDS)) for (const w of words) WORD_FAMILY.set(w, family as Family)

// `slack_send_message`, `ListMcpResources`, `read-file` → its words, lowercase.
export const wordsOf = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())

// The first word of a name that is on a list decides.
export const familyOfWords = (words: string[]): Family | undefined => {
  for (const w of words) {
    const f = WORD_FAMILY.get(w)
    if (f) return f
  }
  return undefined
}

// MCP servers that act on this machine rather than a service on the internet.
const LOCAL_SERVERS = ['desktop-commander', 'terminal', 'pdf-viewer', 'pdf', 'ccd_', 'savvy-progress', 'visualize']

// `mcp__plugin_x_server__action` → its server and action.
export const mcpParts = (tool: string) => {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? { server: m[1]!, action: m[2]! } : undefined
}

// --- Where a path or URL points ---------------------------------------------

const URL_RE = /^(https?|ftp|ssh|git):\/\//i

const normPath = (p: string, caseless: boolean) => {
  let s = p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '')
  if (caseless) s = s.toLowerCase()
  return s
}

// A path's reach: under the project root, elsewhere on the machine, or a URL.
export const reachOfPath = (p: string, root: string): Reach => {
  const s = p.trim().replace(/^["']|["']$/g, '')
  if (URL_RE.test(s)) return 'internet'
  if (s === '' || s === '/dev/null' || /^\$null$|^nul$/i.test(s)) return 'project'
  if (/^(~|\$HOME|\$env:USERPROFILE|%USERPROFILE%)/i.test(s)) return 'machine'
  const isAbsolute = /^([a-z]:)?[\\/]/i.test(s)
  if (!isAbsolute) return s.startsWith('..') ? 'machine' : 'project'
  const caseless = /^[a-z]:/i.test(root) || /^\/[a-z]\//i.test(root)
  const r = normPath(root, caseless)
  const q = normPath(s, caseless)
  return q === r || q.startsWith(`${r}/`) ? 'project' : 'machine'
}

const PATH_KEY = /path|file|dir|folder|cwd|source|destination|target/i
const URL_KEY = /url|uri|link|href|endpoint/i

// The farthest reach of the paths and URLs in a tool's input.
export const reachOfInput = (input: unknown, root: string): Reach => {
  let reach: Reach = 'project'
  if (!input || typeof input !== 'object') return reach
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v !== 'string') continue
      if (URL_RE.test(v)) reach = 'internet'
      else if (PATH_KEY.test(key)) reach = farther(reach, reachOfPath(v, root))
    }
  }
  return reach
}

// --- Shell commands -----------------------------------------------------------

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const SHELL_READ = set(`
  ls dir cat type head tail less more grep egrep fgrep rg ag find tree pwd which where whoami echo printf wc stat
  file du df env printenv ps top cd pushd popd sort uniq cut awk jq yq diff cmp date uname hostname realpath
  basename dirname true false test
  get-childitem gci get-content gc get-item gi get-itemproperty gp get-process gps get-location gl get-command gcm
  select-string sls test-path resolve-path write-output write-host measure-object select-object where-object
  format-table format-list get-date get-help get-service
`)
const SHELL_CHANGE = set(`
  mkdir md touch cp copy mv move ren rename chmod chown chgrp ln tee install patch
  new-item ni copy-item cpi move-item mi rename-item rni set-content add-content ac out-file set-item
  set-itemproperty sp new-itemproperty
`)
const SHELL_DELETE = set(`
  rm rmdir rd del erase unlink shred remove-item ri clear-content clc remove-itemproperty rp
`)
const NET_READ = set(`ping nslookup dig host traceroute tracert whois`)
const NET_RUN = set(`
  ssh scp sftp rsync ftp telnet nc ncat kubectl aws gcloud az terraform vercel netlify fly flyctl heroku
`)
const WEB_CLIENTS = set(`curl wget invoke-webrequest iwr invoke-restmethod irm`)
const PACKAGE_MANAGERS = set(`npm pnpm yarn bun pip pip3 pipx uv poetry cargo gem go composer brew winget choco scoop apt apt-get dnf yum docker podman`)
const PACKAGE_NET = set(`install i add publish push pull update upgrade fetch login search download get`)

const GIT_READ = set(`status log diff show blame rev-parse ls-files describe shortlog reflog cat-file grep config remote help version`)
const GIT_CHANGE = set(`add commit checkout switch merge rebase restore tag init cherry-pick revert am apply mv stash worktree reset notes submodule`)
const GIT_NET_READ = set(`fetch ls-remote`)
const GIT_NET_CHANGE = set(`push pull clone`)

type Verdict = { family: Family; reach: Reach }

// One command (no `&&`, `|` or `;`): its family and reach.
export const judgeCommand = (tokens: string[], root: string): Verdict => {
  // Skip what only prefixes the command: sudo, env assignments, timers.
  let i = 0
  while (i < tokens.length && (/^\w+=/.test(tokens[i]!) || /^(sudo|nohup|time|command|env|exec|&)$/.test(tokens[i]!))) i++
  const words = tokens.slice(i)
  const head = (words[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
  const args = words.slice(1)
  const lower = args.map(a => a.toLowerCase())

  let reach: Reach = 'project'
  for (const a of args) if (!a.startsWith('-')) reach = farther(reach, reachOfPath(a, root))

  if (head === '') return { family: 'read', reach }
  if (head === 'git') {
    const sub = lower.find(a => !a.startsWith('-')) ?? ''
    if (GIT_NET_CHANGE.has(sub)) return { family: 'change', reach: 'internet' }
    if (GIT_NET_READ.has(sub)) return { family: 'read', reach: 'internet' }
    if (sub === 'rm' || sub === 'clean') return { family: 'change', reach }
    if (sub === 'reset' && lower.includes('--hard')) return { family: 'change', reach }
    if (sub === 'stash' && (lower.includes('drop') || lower.includes('clear'))) return { family: 'change', reach }
    if (sub === 'worktree' && lower.includes('remove')) return { family: 'change', reach }
    if (sub === 'branch') {
      if (lower.some(a => a === '-d' || a === '--delete')) return { family: 'change', reach }
      return { family: lower.some(a => !a.startsWith('-') && a !== 'branch') ? 'change' : 'read', reach }
    }
    if (GIT_READ.has(sub)) return { family: 'read', reach }
    if (GIT_CHANGE.has(sub)) return { family: 'change', reach }
    return { family: 'run', reach }
  }
  if (head === 'gh') return { family: familyOfWords(lower) ?? 'run', reach: 'internet' }
  if (WEB_CLIENTS.has(head)) {
    const at = lower.findIndex(a => a === '-x' || a === '--request' || a === '-method')
    const method = at >= 0 ? lower[at + 1] : undefined
    if (method === 'delete') return { family: 'change', reach: 'internet' }
    const sends = lower.some(a => /^(-d|--data.*|-f|--form|-t|--upload-file|-body|-infile)$/.test(a))
    if (sends || (method && method !== 'get' && method !== 'head')) return { family: 'change', reach: 'internet' }
    return { family: 'read', reach: 'internet' }
  }
  if (NET_READ.has(head)) return { family: 'read', reach: 'internet' }
  if (NET_RUN.has(head)) return { family: 'run', reach: 'internet' }
  if (PACKAGE_MANAGERS.has(head)) {
    const sub = lower.find(a => !a.startsWith('-')) ?? ''
    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') return { family: 'change', reach }
    if (PACKAGE_NET.has(sub)) return { family: 'change', reach: 'internet' }
    return { family: 'run', reach }
  }
  if (head === 'find') {
    if (lower.includes('-delete') || lower.some((a, k) => a === '-exec' && /^rm$/.test(lower[k + 1] ?? ''))) {
      return { family: 'change', reach }
    }
    return { family: 'read', reach }
  }
  if (head === 'sed') return { family: lower.some(a => /^-i/.test(a) || a === '--in-place') ? 'change' : 'read', reach }
  if (SHELL_DELETE.has(head)) return { family: 'change', reach }
  if (SHELL_CHANGE.has(head)) return { family: 'change', reach }
  if (SHELL_READ.has(head)) return { family: 'read', reach }
  return { family: 'run', reach }
}

// A whole command line: each piece judged, the riskiest family and the
// farthest reach win. A redirect into a file (`> out.txt`) is a change.
export const judgeShell = (command: string, root: string): Verdict => {
  let family: Family = 'read'
  let reach: Reach = 'project'
  for (const piece of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const v = judgeCommand(tokens, root)
    family = riskier(family, v.family)
    reach = farther(reach, v.reach)
  }
  for (const m of command.matchAll(/(?:^|[^0-9&>])>{1,2}\s*([^\s&|;]+)/g)) {
    const target = m[1]!
    if (/^(\/dev\/null|\$null|nul)$/i.test(target)) continue
    family = riskier(family, 'change')
    reach = farther(reach, reachOfPath(target, root))
  }
  if (/\b(https?|ftp):\/\//i.test(command)) reach = 'internet'
  return { family, reach }
}

// --- Putting it together ------------------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export const classify = (tool: string, input: unknown, root: string): Kind => {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pathReach = () => reachOfInput(obj, root)

  // 1. Shells: read the command itself.
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = str(obj.command)
    return command ? judgeShell(command, root) : { family: 'run', reach: 'project' }
  }

  // 2. Built-in tools by name.
  const builtin = BUILTIN[tool]
  if (builtin) {
    return { family: builtin, reach: BUILTIN_REACH[tool] ?? (builtin === 'bookkeeping' ? 'project' : pathReach()) }
  }

  // 3. MCP tools and tools not listed: the words of their name.
  const mcp = mcpParts(tool)
  const fromWords = familyOfWords(wordsOf(mcp ? mcp.action : tool))
  const local = mcp ? LOCAL_SERVERS.some(s => mcp.server.includes(s)) : true
  const reachOf = (): Reach => {
    const r = pathReach()
    if (!mcp || r === 'internet') return r
    if (!local) return 'internet'
    return r === 'project' && !Object.keys(obj).some(k => PATH_KEY.test(k)) ? 'machine' : r
  }
  if (fromWords) return { family: fromWords, reach: reachOf() }
  // Tools that take the verb as an argument (`computer` with `action: "click"`).
  const verb = str(obj.action) ?? str(obj.operation) ?? str(obj.method)
  const fromVerb = verb ? familyOfWords(wordsOf(verb)) : undefined
  if (fromVerb) return { family: fromVerb, reach: reachOf() }

  // 4. The shape of the input.
  if (Object.keys(obj).some(k => URL_KEY.test(k)) || Object.values(obj).some(v => typeof v === 'string' && URL_RE.test(v))) {
    return { family: 'read', reach: 'internet' }
  }
  const command = str(obj.command)
  if (command) {
    const v = judgeShell(command, root)
    return { family: v.family, reach: farther(v.reach, reachOf()) }
  }
  if (str(obj.prompt) && str(obj.subagent_type)) return { family: 'delegate', reach: 'project' }
  const hasPath = Object.keys(obj).some(k => PATH_KEY.test(k))
  if (hasPath && (str(obj.content) !== undefined || str(obj.new_string) !== undefined)) {
    return { family: 'change', reach: reachOf() }
  }
  if (hasPath) return { family: 'read', reach: reachOf() }
  if (str(obj.query)) return { family: 'read', reach: reachOf() }
  // An MCP tool does something to its service even when nothing says what.
  if (mcp) return { family: 'run', reach: reachOf() }
  return { family: 'bookkeeping', reach: 'project' }
}

export const colorOf = (tool: string, input: unknown, root: string) => {
  const { family, reach } = classify(tool, input, root)
  return COLORS[family][reach]
}

// --- How each call got past the permission check: the stroke of its mark.
//
// tool.check answers allow (a rule or the mode), deny, or ask. An ask goes to
// the mode's decider: the auto-mode classifier while the footer says auto
// mode, else the person at the dialog. The call's tool.call settles it: it
// ran, or it was refused, and the refusal's text says by whom.
//
// No classic.* hook is used: Claude Code's security plugin (seated for Team
// and Enterprise organizations) passes every classic event on past the user's
// plugins, so PermissionRequest and PermissionDenied never reach this one.

const verdicts = atom({ plugin: 'tool-borders', key: 'verdicts' } as const, {})
const KEPT = 300
const FAIL = '#ef5350'

type Pending = { isAuto: boolean }
// Calls whose check answered ask, by tool_use_id, until their tool.call ends.
const pending = new Map<string, Pending>()

// Whether the footer shows auto mode, from its last SessionMode draw; unset
// until the first, when the settings' default mode stands in.
let isAutoMode: boolean | undefined

export const isAutoLabel = (modes: readonly string[]) => modes.some(m => /\bauto mode\b/i.test(m))

const keep = (all: Record<string, Verdict>, id: string, v: Verdict): Record<string, Verdict> => {
  const next = { ...all, [id]: v }
  const ids = Object.keys(next)
  return ids.length > KEPT ? Object.fromEntries(ids.slice(-KEPT).map(k => [k, next[k]!])) : next
}

// Who a refusal's text names: the model-facing words Claude Code answers a
// declined dialog and a classifier block with. They are the engine's own and
// may change in a release: an unmatched refusal falls back to the decider.
export const refuserOf = (text: string | undefined): 'you' | 'classifier' | undefined => {
  if (!text) return undefined
  if (text.includes("The user doesn't want to proceed with this tool use")) return 'you'
  if (/auto mode classifier/i.test(text)) return 'classifier'
  return undefined
}

type Ran = { deny?: string; isError?: true; text?: string }

// The verdict once the call ends: whoever decided the ask, or who refused it.
// An errored call whose text names no refuser ran and failed on its own; an
// ask dismissed some other way (Esc at the dialog) reads the same.
export const settle = (p: Pending, ran: Ran): Verdict => {
  const decider = p.isAuto ? 'classifier' : 'you'
  const refuser = refuserOf(ran.deny ?? (ran.isError ? ran.text : undefined))
  if (refuser) return { by: 'denied', deniedBy: refuser }
  return ran.deny === undefined ? { by: decider } : { by: 'denied', deniedBy: decider }
}

// The few words under a row that the stroke cannot say: who allowed it when
// that was you, who refused it.
export const verdictNote = (v: Verdict | undefined): string | null => {
  if (v?.by === 'you') return 'you allowed it'
  if (v?.by === 'denied') return v.deniedBy === 'you' ? '✗ you denied it' : `✗ denied by ${v.deniedBy ?? 'rule'}`
  return null
}

// The terminal's border for a verdict: round by a rule, double by the
// classifier, bold when you were asked.
export const borderOf = (v: Verdict | undefined): string => (v?.by === 'classifier' ? 'double' : v?.by === 'you' ? 'bold' : 'round')

// Before the footer has drawn: whether the settings start sessions in auto mode.
const defaultIsAuto = async ($: EngineInterface): Promise<boolean> => {
  try {
    const permissions = (await $.settings.read({ key: 'permissions' })) as { defaultMode?: unknown } | undefined
    return permissions?.defaultMode === 'auto'
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    const id = e.tool_use_id
    if (!id) return v
    if (v.decision === 'ask') {
      isAutoMode ??= await defaultIsAuto($)
      pending.set(id, { isAuto: isAutoMode })
    }
    const now: Verdict = v.decision === 'allow' ? { by: 'rule' } : v.decision === 'deny' ? { by: 'denied', deniedBy: 'rule' } : { by: 'pending' }
    await update($, verdicts, all => keep(all, id, now))
    return v
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    isAutoMode = isAutoLabel(e.props.modes)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const p = pending.get(e.tool_use_id)
    if (p) {
      pending.delete(e.tool_use_id)
      const v = settle(p, ran)
      await update($, verdicts, all => keep(all, e.tool_use_id, v))
    }
    return ran
  })

  let root: Promise<string> | undefined

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    root ??= $.session.root().catch(() => '')
    const v: Verdict | undefined = (await read($, verdicts))[e.props.tool_use_id]
    const color = v?.by === 'denied' ? FAIL : colorOf(e.props.tool, e.props.input, await root)
    const note = verdictNote(v)
    const noteText = note ? (
      <Text color={v?.by === 'denied' ? FAIL : undefined} dimColor={v?.by !== 'denied'}>
        {note}
      </Text>
    ) : null
    const row = await next(e)
    // The desktop folds some calls into a line of its own ("Ran a command")
    // and draws their row empty, so a border there would be an empty pill.
    // A thin bar beside the row (a quarter cell) is as tall as the row: nothing
    // when it is empty. Two thinner bars when the classifier decided it.
    if (e.surface === 'desktop') {
      const bars =
        v?.by === 'classifier' ? (
          <Box flexDirection="row" gap={0.12}>
            <Box width={0.12} backgroundColor={color} />
            <Box width={0.12} backgroundColor={color} />
          </Box>
        ) : (
          <Box width={0.25} backgroundColor={color} />
        )
      return (
        <Box flexDirection="row" gap={1}>
          {bars}
          <Box flexDirection="column" flexGrow={1}>
            {row}
            {noteText}
          </Box>
        </Box>
      )
    }
    return (
      <Box borderStyle={borderOf(v)} borderColor={color} flexDirection="column">
        {row}
        {noteText}
      </Box>
    )
  })
}
