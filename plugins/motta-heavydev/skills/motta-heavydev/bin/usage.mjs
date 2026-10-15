#!/usr/bin/env node
// Sums real token usage of a finished workflow from its agent transcripts, and
// counts advisor calls (subagents carry an advisor backed by Fable, which only
// the audit step may spend).
// Usage: node usage.mjs <workflow-transcript-dir> [defaults.json]
//   prices come from budget.prices: { "<model id>": { input, cacheWrite, cacheRead, output } } in USD per million tokens
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, pricesPath] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node usage.mjs <workflow-transcript-dir> [defaults.json]')
  process.exit(2)
}
const prices = pricesPath ? JSON.parse(readFileSync(pricesPath, 'utf8')).budget.prices : null

const agents = []
for (const f of readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f))) {
  const meta = JSON.parse(readFileSync(join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
  // A message is written once per content block with the same usage; count each message id once.
  const seen = new Map()
  let advisorCalls = 0
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line) continue
    const e = JSON.parse(line)
    const m = e.message
    if (e.type !== 'assistant' || !m || !m.usage) continue
    seen.set(m.id || e.uuid, { model: m.model, u: m.usage })
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if ((c.type === 'tool_use' || c.type === 'server_tool_use') && /advisor/i.test(c.name || '')) advisorCalls++
    }
  }
  const t = { label: meta.description, model: '', input: 0, cacheWrite: 0, cacheRead: 0, output: 0, advisorCalls }
  for (const { model, u } of seen.values()) {
    t.model = model
    t.input += u.input_tokens || 0
    t.cacheWrite += u.cache_creation_input_tokens || 0
    t.cacheRead += u.cache_read_input_tokens || 0
    t.output += u.output_tokens || 0
  }
  if (prices && prices[t.model]) {
    const p = prices[t.model]
    t.cost = (t.input * p.input + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6
  }
  if (seen.size) agents.push(t)
}

const total = agents.reduce(
  (s, a) => {
    for (const k of ['input', 'cacheWrite', 'cacheRead', 'output', 'advisorCalls']) s[k] += a[k]
    if (a.cost !== undefined) s.cost = (s.cost || 0) + a.cost
    return s
  },
  { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, advisorCalls: 0 },
)
console.log(JSON.stringify({ agents, total }, null, 1))
