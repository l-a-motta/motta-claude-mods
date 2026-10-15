import { describe, expect, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

import { askedOf, borderOf, classify, COLORS, settle, verdictNote } from '../hooks/register'

const ROOT = 'C:\\Users\\me\\repo'
const k = (tool: string, input: Record<string, unknown> = {}) => {
  const { family, reach } = classify(tool, input, ROOT)
  return `${family}/${reach}`
}
const sh = (command: string) => k('Bash', { command })

describe('built-in tools', () => {
  test('reading: in the project, elsewhere, on the web', () => {
    expect(k('Read', { file_path: 'C:\\Users\\me\\repo\\src\\a.ts' })).toBe('read/project')
    expect(k('Read', { file_path: 'C:/Users/me/.claude/settings.json' })).toBe('read/machine')
    expect(k('Grep', { pattern: 'x', path: 'src' })).toBe('read/project')
    expect(k('Glob', { pattern: '**/*.ts' })).toBe('read/project')
    expect(k('WebFetch', { url: 'https://example.com', prompt: 'read' })).toBe('read/internet')
    expect(k('WebSearch', { query: 'mods' })).toBe('read/internet')
  })

  test('creating and updating files are one family: change', () => {
    expect(k('Write', { file_path: 'C:\\Users\\me\\repo\\new.md', content: 'x' })).toBe('change/project')
    expect(k('Edit', { file_path: '/c/Users/me/repo/a.ts', old_string: 'a', new_string: 'b' })).toBe('change/project')
    expect(k('Edit', { file_path: 'C:\\Users\\me\\.bashrc', old_string: 'a', new_string: 'b' })).toBe('change/machine')
    expect(k('NotebookEdit', { notebook_path: 'n.ipynb', edit_mode: 'delete' })).toBe('change/project')
  })

  test('delegating, bookkeeping', () => {
    expect(k('Agent', { prompt: 'p', subagent_type: 'Explore', description: 'd' })).toBe('delegate/project')
    expect(k('SendMessage', { to: 'x', message: 'hi' })).toBe('delegate/machine')
    expect(k('RemoteTrigger', {})).toBe('delegate/internet')
    expect(k('TodoWrite', { todos: [] })).toBe('bookkeeping/project')
    expect(k('AskUserQuestion', { questions: [] })).toBe('bookkeeping/project')
  })
})

describe('shell commands', () => {
  test('looking is read, not run', () => {
    expect(sh('ls -la')).toBe('read/project')
    expect(sh('git status && git log --oneline -5')).toBe('read/project')
    expect(sh('cat ~/.gitconfig')).toBe('read/machine')
  })

  test('changing, deleting, running', () => {
    expect(sh('mkdir -p plugins/x')).toBe('change/project')
    expect(sh('git add -A && git commit -m "feat: x"')).toBe('change/project')
    expect(sh('echo hi > notes.txt')).toBe('change/project')
    expect(sh('ls 2>/dev/null')).toBe('read/project')
    expect(sh('rm -rf dist')).toBe('change/project')
    expect(sh('rm C:/Users/me/Downloads/x.zip')).toBe('change/machine')
    expect(sh('git reset --hard HEAD~1')).toBe('change/project')
    expect(sh('git branch -D old')).toBe('change/project')
    expect(sh('find . -name "*.tmp" -delete')).toBe('change/project')
    expect(sh('npm test')).toBe('run/project')
    // The riskiest piece decides.
    expect(sh('ls && rm a.txt')).toBe('change/project')
  })

  test('reaching the internet', () => {
    expect(sh('curl -s https://api.github.com')).toBe('read/internet')
    expect(sh('curl -X POST -d x https://example.com')).toBe('change/internet')
    expect(sh('git push -u origin main')).toBe('change/internet')
    expect(sh('git fetch')).toBe('read/internet')
    expect(sh('gh pr view 12')).toBe('read/internet')
    expect(sh('gh pr create --title x')).toBe('change/internet')
    expect(sh('gh repo delete x')).toBe('change/internet')
    expect(sh('npm install left-pad')).toBe('change/internet')
    expect(sh('ssh host uptime')).toBe('run/internet')
    expect(k('PowerShell', { command: 'Invoke-WebRequest https://x.dev -OutFile a.zip' })).toBe('read/internet')
    expect(k('PowerShell', { command: 'Remove-Item -Recurse C:\\Users\\me\\repo\\tmp' })).toBe('change/project')
  })
})

describe('MCP tools and tools no list knows', () => {
  test('the words of the name decide the family; a service is the internet', () => {
    expect(k('mcp__slack__slack_send_message', { channel: 'x', text: 'hi' })).toBe('change/internet')
    expect(k('mcp__slack__slack_read_channel', { channel: 'x' })).toBe('read/internet')
    expect(k('mcp__gmail__trash_message', { id: '1' })).toBe('change/internet')
    expect(k('mcp__jira__transitionJiraIssue', {})).toBe('change/internet')
    expect(k('mcp__Claude_Browser__computer', { action: 'click' })).toBe('run/internet')
    expect(k('mcp__acme__widget', {})).toBe('run/internet')
    expect(k('mcp__Claude_Browser__navigate', { url: 'https://x.dev' })).toBe('run/internet')
  })

  test('a local server acts on this machine, or the project when its path says so', () => {
    const dc = 'mcp__plugin_desktop-commander_desktop-commander__'
    expect(k(`${dc}read_file`, { path: 'C:\\Users\\me\\repo\\a.md' })).toBe('read/project')
    expect(k(`${dc}write_file`, { path: 'D:\\notes.md', content: 'x' })).toBe('change/machine')
    expect(k(`${dc}list_processes`, {})).toBe('read/machine')
    expect(k(`${dc}kill_process`, { pid: 1 })).toBe('change/machine')
  })

  test('nothing in the name: the shape of the input, gray last', () => {
    expect(k('Fetcher9', { url: 'https://x.dev' })).toBe('read/internet')
    expect(k('Thing', { file_path: 'a.md', content: 'x' })).toBe('change/project')
    expect(k('Thing', { file_path: 'a.md' })).toBe('read/project')
    expect(k('Thing', { command: 'rm x' })).toBe('change/project')
    expect(k('Thing', { n: 1 })).toBe('bookkeeping/project')
  })
})

const ROW = (surface: 'terminal' | 'desktop', tool: string, input: unknown) =>
  ({
    plugin: 'tool-borders',
    surface,
    component: 'ToolUse',
    props: { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false } as RenderPropsOf['ToolUse'],
  }) as const

test("the terminal draws the row inside a border of its color", async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 1 }) as never)
  const ui = await $.ui.mount(ROW('terminal', 'Bash', { command: 'rm -rf dist' }))
  const [box] = await ui.findAll({ type: 'Box' })
  expect(box?.props).toEqual(expect.objectContaining({ borderStyle: 'round', borderColor: COLORS.change.project }))
  await ui.unmount()
})

test('the desktop draws a thin bar of its color beside the row, no border', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 1 }) as never)
  const ui = await $.ui.mount(ROW('desktop', 'WebFetch', { url: 'https://x.dev', prompt: 'p' }))
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.backgroundColor === COLORS.read.internet && b.props.width === 0.25)).toBe(true)
  expect(boxes.some(b => b.props.borderStyle !== undefined)).toBe(false)
  await ui.unmount()
})

describe("how a call got past the permission check", () => {
  const ask = (tool: string, input: unknown, isAsked = false) => ({ tool, input: JSON.stringify(input), isAsked })

  test("an ask that ran: you, when the dialog was shown; else the classifier", () => {
    expect(settle(ask("Bash", { command: "npm test" }, true), true)).toEqual({ by: "you" })
    expect(settle(ask("Bash", { command: "npm test" }), true)).toEqual({ by: "classifier" })
  })

  test("an ask that was refused names who refused it", () => {
    expect(settle(ask("Bash", { command: "rm -rf /" }), false)).toEqual({ by: "denied", deniedBy: "classifier" })
    expect(settle(ask("Bash", { command: "rm -rf /" }, true), false)).toEqual({ by: "denied", deniedBy: "you" })
  })

  test("a dialog is matched to its ask by tool and input, or to the one open ask of that tool", () => {
    const open = new Map([["t1", ask("Bash", { command: "ls" })], ["t2", ask("Bash", { command: "git push" })], ["t3", ask("Edit", { file_path: "a" })]])
    expect(askedOf(open, "Bash", { command: "git push" })).toBe("t2")
    expect(askedOf(open, "Bash", { command: "other" })).toBeUndefined()
    expect(askedOf(open, "Edit", { file_path: "a", old_string: "x" })).toBe("t3")
  })

  test("the stroke: round by a rule, double by the classifier, bold when you were asked", () => {
    expect([borderOf(undefined), borderOf({ by: "rule" }), borderOf({ by: "classifier" }), borderOf({ by: "you" })]).toEqual(["round", "round", "double", "bold"])
    expect(verdictNote({ by: "rule" })).toBeNull()
    expect(verdictNote({ by: "you" })).toBe("you allowed it")
    expect(verdictNote({ by: "denied", deniedBy: "rule" })).toBe("✗ denied by rule")
  })
})
