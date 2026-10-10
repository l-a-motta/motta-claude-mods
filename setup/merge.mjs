// Merges a settings fragment from this folder into a Claude Code config file,
// keeping every key the fragment does not name.
//
//   node setup/merge.mjs <fragment> <target>          merge, after a backup
//   node setup/merge.mjs <fragment> <target> --check  report, change nothing
//
// Objects merge key by key; anything else (a string, a number, a list) is
// replaced by the fragment's value. The target is backed up beside itself as
// <target>.bak-setup before it is written. A missing target starts empty.
// --check exits 1 when a fragment value differs from the target's, or when
// the target carries a key the fragment says must not be there (statusLine,
// which motta-statusline replaces).

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const MUST_NOT_HAVE = ['statusLine']

const [fragmentPath, targetPath, flag] = process.argv.slice(2)
if (!fragmentPath || !targetPath) {
  console.error('usage: node setup/merge.mjs <fragment> <target> [--check]')
  process.exit(2)
}
const isCheck = flag === '--check'

const fragment = JSON.parse(readFileSync(fragmentPath, 'utf8'))
const target = existsSync(targetPath) ? JSON.parse(readFileSync(targetPath, 'utf8')) : {}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// The dotted paths whose value the target lacks or holds differently.
function differences(want, have, path = '') {
  const out = []
  for (const [key, value] of Object.entries(want)) {
    const at = path ? `${path}.${key}` : key
    if (isObject(value) && isObject(have?.[key])) out.push(...differences(value, have[key], at))
    else if (JSON.stringify(value) !== JSON.stringify(have?.[key])) out.push(at)
  }
  return out
}

function merge(want, have) {
  const out = { ...have }
  for (const [key, value] of Object.entries(want)) {
    out[key] = isObject(value) && isObject(have[key]) ? merge(value, have[key]) : value
  }
  return out
}

const changed = differences(fragment, target)
const unwanted = MUST_NOT_HAVE.filter(key => key in target && targetPath.endsWith('settings.json'))

if (isCheck) {
  for (const at of changed) console.log(`differs: ${at}`)
  for (const key of unwanted) console.log(`remove by hand: ${key}`)
  const isClean = changed.length === 0 && unwanted.length === 0
  console.log(isClean ? `ok: ${targetPath} has every setting in ${fragmentPath}` : `not yet: ${targetPath}`)
  process.exit(isClean ? 0 : 1)
}

if (changed.length === 0) {
  console.log(`nothing to change in ${targetPath}`)
} else {
  if (existsSync(targetPath)) copyFileSync(targetPath, `${targetPath}.bak-setup`)
  writeFileSync(targetPath, JSON.stringify(merge(fragment, target), null, 2) + '\n')
  for (const at of changed) console.log(`set: ${at}`)
  console.log(`merged into ${targetPath}${existsSync(`${targetPath}.bak-setup`) ? ` (backup: ${targetPath}.bak-setup)` : ''}`)
}
for (const key of unwanted) console.log(`remove by hand: ${key} (motta-statusline replaces it)`)
