// Tests the pass gate shared by architecture-round.js and diff-review.js — the
// one piece of each loop that decides, so it must not drift.
// Workflow scripts can't be imported, so the function is lifted from source.
// Usage: node workflows/test-gate.mjs   (exit 0 = every check passed)
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const lift = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').match(/function gate\(v\) \{[\s\S]*?\n\}/)[0]
const fn = lift('./architecture-round.js')
assert.equal(lift('./diff-review.js'), fn, 'the two copies of gate() have drifted apart')
console.log('ok   architecture-round.js and diff-review.js share one gate')
const gate = new Function('disputeLimit', `${fn}; return gate`)(2)

const criteria = (failing = []) =>
  Array.from({ length: 10 }, (_, i) => ({
    n: i + 1,
    applies: i < 8,
    pass: !failing.includes(i + 1),
    title: failing.includes(i + 1) ? `title ${i + 1}` : '',
    reason: 'reason',
  }))
const obj = (id, o) => ({ id, severity: 'blocking', status: 'open', disputeRounds: 0, ...o })

const cases = [
  ['all applicable pass, no objections', { criteria: criteria(), objections: [] }, true, /^8\/8 pass · 0 blocking · 0 advisory · 0 disputed$/],
  ['a failing criterion blocks', { criteria: criteria([5]), objections: [obj('O-C-1', {})] }, false, /^7\/8 pass · 1 blocking[\s\S]*\n✗ 5 title 5$/],
  ['an open blocking objection blocks even if criteria pass', { criteria: criteria(), objections: [obj('O-C-1', {})] }, false, /1 blocking/],
  ['closed objections do not count', { criteria: criteria(), objections: [obj('O-C-1', { status: 'closed' })] }, true, /0 blocking/],
  ['advisory never blocks', { criteria: criteria(), objections: [obj('O-C-1', { severity: 'advisory' })] }, true, /1 advisory/],
  ['a young dispute still blocks', { criteria: criteria(), objections: [obj('O-C-1', { status: 'disputed', disputeRounds: 1 })] }, false, /1 blocking · 0 advisory · 0 disputed/],
  ['a dispute at the limit goes to the user and stops blocking', { criteria: criteria(), objections: [obj('O-C-1', { status: 'disputed', disputeRounds: 2 })] }, true, /0 blocking · 0 advisory · 1 disputed/],
  ['non-applicable failures are ignored', { criteria: criteria([9, 10]), objections: [] }, true, /^8\/8 pass/],
]

for (const [name, verdict, pass, score] of cases) {
  const g = gate(verdict)
  assert.equal(g.pass, pass, name)
  assert.match(g.score, score, name)
  console.log(`ok   ${name}`)
}
console.log('PASS')
