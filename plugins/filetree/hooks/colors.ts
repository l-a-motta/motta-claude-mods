// The colors filetree shares with the other mods, copied since a mod can import
// only its own files: change them together.
//  - Reads and changes are tool-borders' (plugins/tool-borders/hooks/register.tsx
//    COLORS): its read and change families, at project reach for files inside the
//    tree's folder and machine reach for the files outside it, as its rows show them.
//  - Done green and failed red are savvy-progress' (OK and FAIL).
//  - Git status is VS Code's, as its Explorer and its `+N -N` show it (the git
//    extension's gitDecoration.* colors and chat.lines*Foreground, dark theme).

export const READ = { project: '#3f5670', machine: '#5b8fcc', internet: '#7dd3fc' }
export const CHANGE = { project: '#6b6233', machine: '#b8a531' }
export const OK = '#3B9C5F'
export const FAIL = '#E24B4A'

export const VSCODE = {
  added: '#81b88b',
  modified: '#E2C08D',
  deleted: '#c74e39',
  renamed: '#73C991',
  untracked: '#73C991',
  ignored: '#8C8C8C',
  conflicting: '#e4676b',
  linesAdded: '#54B054',
  linesRemoved: '#FC6A6A',
}

export type Tone = { bright: string[]; dim: string[]; solid: string }

const hex = (n: number) => n.toString(16).padStart(2, '0')
const mix = (a: string, b: string, t: number) =>
  '#' + [1, 3, 5].map(i => hex(Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t))).join('')

// A shimmer's shades from one color: `bright` from the color up to near white at
// the band's head, `dim` (a folder opened to show a lit file) darker throughout.
function ramp(base: string): Tone {
  const d0 = mix(base, '#000000', 0.45)
  const d3 = mix(mix(base, '#ffffff', 0.35), '#000000', 0.2)
  return {
    bright: [base, mix(base, '#ffffff', 0.2), mix(base, '#ffffff', 0.45), mix(base, '#ffffff', 0.82)],
    dim: [d0, mix(d0, d3, 1 / 3), mix(d0, d3, 2 / 3), d3],
    solid: base,
  }
}

const RED = ramp(FAIL)

// A tag's fill: its text color sunk most of the way into the pane's background,
// so the word stays readable on it.
export const tagFill = (color: string, bg = '#1e1e1e', sink = 0.78) => mix(color, bg || '#1e1e1e', sink)

// What a lit row means, by name. Reads and changes come at project reach here;
// FAR_TONES has them at machine reach for the files outside the folder. Undoing
// git verbs share failed's red, and stash and mv are changes.
export const TONES: Record<string, Tone> = {
  read: ramp(READ.project),
  change: ramp(CHANGE.project),
  commit: ramp(OK),
  push: { bright: ['#14b8a6', '#2dd4bf', '#5eead4', '#ccfbf1'], dim: ['#0f5e57', '#16786f', '#2a9488', '#4fb3a8'], solid: '#2dd4bf' },
  pull: ramp(READ.internet),
  merge: { bright: ['#a855f7', '#c084fc', '#d8b4fe', '#f3e8ff'], dim: ['#581c87', '#6b21a8', '#8b47c4', '#a874d6'], solid: '#c084fc' },
  undo: RED,
  failed: RED,
}

export const FAR_TONES: Record<string, Tone> = { ...TONES, read: ramp(READ.machine), change: ramp(CHANGE.machine) }
