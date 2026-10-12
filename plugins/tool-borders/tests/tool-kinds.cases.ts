// The calls tool-borders and savvy-progress must classify alike. This file is
// the same in both mods (tests/tool-kinds.cases.ts): savvy-progress keeps a
// copy of tool-borders' classifier, and a change to either that moves one of
// these fails its own tests. Change both mods, and this file in both.

export const ROOT = 'C:/repo'

export const CASES: [string, Record<string, unknown>, string][] = [
  ['Read', { file_path: 'C:/repo/a.ts' }, 'read/project'],
  ['Read', { file_path: 'C:/other/a.ts' }, 'read/machine'],
  ['Grep', { pattern: 'x', path: 'C:/repo' }, 'read/project'],
  ['Glob', { pattern: '*.ts' }, 'read/project'],
  ['Edit', { file_path: 'C:/repo/a.ts', old_string: 'a', new_string: 'b' }, 'change/project'],
  ['Write', { file_path: 'C:/Users/me/notes.md', content: 'x' }, 'change/machine'],
  ['Bash', { command: 'ls -la' }, 'read/project'],
  ['Bash', { command: 'git status && git commit -m x' }, 'change/project'],
  ['Bash', { command: 'npm install left-pad' }, 'change/internet'],
  ['Bash', { command: 'rm -rf build' }, 'change/project'],
  ['PowerShell', { command: 'Get-ChildItem' }, 'read/project'],
  ['WebFetch', { url: 'https://example.com' }, 'read/internet'],
  ['WebSearch', { query: 'x' }, 'read/internet'],
  ['Agent', { prompt: 'look', subagent_type: 'Explore' }, 'delegate/project'],
  ['Skill', { skill: 'x' }, 'bookkeeping/project'],
  ['ToolSearch', { query: 'select:x' }, 'bookkeeping/project'],
  ['mcp__github__get_issue', { number: 1 }, 'read/internet'],
  ['mcp__plugin_desktop-commander_desktop-commander__write_file', { path: 'C:/repo/x', content: 'y' }, 'change/project'],
  ['mcp__slack__send_message', { text: 'hi' }, 'change/internet'],
  ['SomethingNew', {}, 'change/project'],
]

export const COLORS_PINNED = {
  bookkeeping: { project: '#6f6f6f', machine: '#6f6f6f', internet: '#6f6f6f' },
  read: { project: '#3f5670', machine: '#5b8fcc', internet: '#7dd3fc' },
  change: { project: '#6b6233', machine: '#b8a531', internet: '#fde047' },
  delegate: { project: '#6f4636', machine: '#c0674a', internet: '#f09a76' },
  run: { project: '#6b456b', machine: '#b14fb8', internet: '#f0abfc' },
}
