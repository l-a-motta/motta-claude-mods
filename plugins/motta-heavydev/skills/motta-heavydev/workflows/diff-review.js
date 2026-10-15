export const meta = {
  name: 'motta-heavydev-diff-review',
  description: 'The critic judges the implementation diff against the approved plan; the pass gate is computed here, not by a model',
  whenToUse: 'Launched only by the /motta-heavydev skill, after implementation and after each review fix',
  phases: [{ title: 'Review' }],
}

// args: { run: { storeClone, runDir, storeWrite, rolesDir, targetRepo, playbookPath, intentPath },
//         worktree, base, head, round, approvedPlanPath,
//         previous: { verdictPath, verdict } | null, responsePath | null,
//         disputeLimit, role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role
const n = args.round
const disputeLimit = args.disputeLimit || 2

const OBJECTION = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^D-[0-9]+$' },
    author: { type: 'string' },
    criterion: { type: 'integer', minimum: 1, maximum: 10 },
    title: { type: 'string', minLength: 3, maxLength: 80 },
    severity: { type: 'string', enum: ['blocking', 'advisory'] },
    claim: { type: 'string', minLength: 10 },
    evidence: { type: 'string', minLength: 5 },
    closesWhen: { type: 'string', minLength: 5 },
    status: { type: 'string', enum: ['open', 'closed', 'disputed'] },
    openedRound: { type: 'integer', minimum: 1 },
    closedRound: { type: ['integer', 'null'] },
    closingEvidence: { type: ['string', 'null'] },
    architectResponse: { type: ['string', 'null'] },
    disputeRounds: { type: 'integer', minimum: 0 },
  },
  required: ['id', 'author', 'criterion', 'title', 'severity', 'claim', 'evidence', 'closesWhen', 'status', 'openedRound', 'disputeRounds'],
}
const VERDICT = {
  type: 'object',
  properties: {
    round: { type: 'integer' },
    author: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
    criteria: {
      type: 'array', minItems: 10, maxItems: 10,
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, maximum: 10 },
          applies: { type: 'boolean' },
          pass: { type: 'boolean' },
          title: { type: 'string' },
          reason: { type: 'string', minLength: 5 },
        },
        required: ['n', 'applies', 'pass', 'title', 'reason'],
      },
    },
    objections: { type: 'array', items: OBJECTION },
    summary: { type: 'string' },
  },
  required: ['round', 'author', 'base', 'head', 'criteria', 'objections', 'summary'],
}

async function run(prompt, opts) {
  if (!opts.agentType) {
    const { agentType, ...rest } = opts
    opts = rest
  }
  try {
    return await agent(prompt, opts)
  } catch (e) {
    if (opts.agentType && /not found/.test(String(e))) {
      const { agentType, ...rest } = opts
      log(`agent type ${agentType} not installed — using the default agent`)
      return await agent(prompt, rest)
    }
    throw e
  }
}

// Must stay identical to the gate in architecture-round.js (test-gate.mjs checks it).
function gate(v) {
  const applicable = v.criteria.filter((c) => c.applies)
  const failing = applicable.filter((c) => !c.pass)
  const live = v.objections.filter((o) => o.status !== 'closed')
  const blocking = live.filter((o) => o.severity === 'blocking' && !(o.status === 'disputed' && o.disputeRounds >= disputeLimit))
  const disputedToUser = live.filter((o) => o.status === 'disputed' && o.disputeRounds >= disputeLimit)
  const advisory = live.filter((o) => o.severity === 'advisory')
  const score =
    `${applicable.length - failing.length}/${applicable.length} pass · ${blocking.length} blocking · ` +
    `${advisory.length} advisory · ${disputedToUser.length} disputed` +
    failing.map((c) => `\n✗ ${c.n} ${c.title}`).join('')
  return { pass: failing.length === 0 && blocking.length === 0, score, disputedToUser: disputedToUser.map((o) => o.id) }
}

const step = `review-r${n}`
const lines = [
  'You are the Critic in the /motta-heavydev flow, reviewing a diff.',
  `Read and follow, in order: ${R.rolesDir}/_common.md, ${R.rolesDir}/critic.md, then ${R.rolesDir}/diff-review.md.`,
  `Author stamp: ${role.stamp}`,
  `Step id: ${step}`,
  `Store clone: ${R.storeClone} — run directory: ${R.runDir} (store paths below are relative to the store clone)`,
  `Store writer: ${R.storeWrite}`,
  `Playbook: ${R.playbookPath}`,
  `Intent record: ${R.intentPath}`,
  `Approved plan: ${args.approvedPlanPath}`,
  `Worktree (read-only): ${args.worktree} — review git diff ${args.base}...${args.head}`,
  `Objection id prefix: D-`,
  `Round: ${n}`,
  `Write your verdict to: ${R.runDir}/review/verdict-r${n}.json`,
]
if (args.previous) lines.push(`Previous verdict (the ledger to carry): ${args.previous.verdictPath}`)
if (args.responsePath) lines.push(`The Developer's responses: ${args.responsePath}`)

phase('Review')
const opts = { label: step, phase: 'Review', schema: VERDICT, model: role.model, effort: role.effort, agentType: role.agentType }
let v = await run(lines.join('\n'), opts)
const prevIds = args.previous ? args.previous.verdict.objections.map((o) => o.id) : []
let dropped = v ? prevIds.filter((id) => !v.objections.some((o) => o.id === id)) : []
if (v && dropped.length) {
  log(`${step}: verdict dropped ${dropped.join(', ')} — asking the critic to carry them`)
  v = await run(`${lines.join('\n')}\n\nYour previous attempt dropped ledger entries ${dropped.join(', ')}. Every objection from the previous verdict must appear in yours — closed, kept or disputed. Rewrite and republish the verdict.`, { ...opts, label: `${step}-retry` })
  dropped = v ? prevIds.filter((id) => !v.objections.some((o) => o.id === id)) : dropped
}
if (!v) return { round: n, error: 'critic returned nothing' }
const g = gate(v)
log(`diff review r${n}: ${g.pass ? 'PASS' : 'not yet'} — ${g.score.split('\n')[0]}`)
return { round: n, verdict: v, ...g, droppedAfterRetry: dropped }
