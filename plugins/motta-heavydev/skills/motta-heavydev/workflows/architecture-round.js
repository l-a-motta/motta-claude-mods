export const meta = {
  name: 'motta-heavydev-architecture-round',
  description: 'One architecture round: each architect revises its plan, then the critic judges it; the pass gate is computed here, not by a model',
  whenToUse: 'Launched only by the /motta-heavydev skill, once per architecture round',
  phases: [{ title: 'Architects' }, { title: 'Critic' }],
}

// args: {
//   run: { storeClone, runDir, storeWrite, rolesDir, targetRepo, playbookPath, intentPath, briefPath },
//   round, plans: ['conservative'|'bold'...],          // plans still needing work this round
//   roles: { architect: {model, effort, agentType, stamps: {conservative, bold}},
//            critic:    {model, effort, agentType, stamp} },
//   previous: { <brief>: { planPath, verdictPath, verdict } }, // the plan's latest round; verdict = its returned object
//   feedbackPath, auditPath,                             // optional, relative to storeClone
//   disputeLimit                                         // rounds a dispute may stay open before it goes to the user
// }
const A = args
const R = A.run
const n = A.round
const disputeLimit = A.disputeLimit || 2
const dir = `${R.runDir}/rounds/${n}`

const OBJECTION = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[OA]-[CB]-[0-9]+$' },
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
    plan: { type: 'string', enum: ['conservative', 'bold'] },
    round: { type: 'integer' },
    author: { type: 'string' },
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
    difficulty: { type: 'string', enum: ['normal', 'hard'] },
    summary: { type: 'string' },
  },
  required: ['plan', 'round', 'author', 'criteria', 'objections', 'difficulty', 'summary'],
}
const ARCHITECT_RESULT = {
  type: 'object',
  properties: {
    planPath: { type: 'string' },
    responsePath: { type: ['string', 'null'] },
    reframingPath: { type: ['string', 'null'] },
    difficulty: { type: 'string', enum: ['normal', 'hard'] },
    size: { type: 'string', enum: ['S', 'M', 'L'] },
  },
  required: ['planPath', 'responsePath', 'reframingPath', 'difficulty', 'size'],
}

// A custom agent type is only registered at session start; fall back to the default agent.
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

function header(role, roleFile, stamp, step) {
  return [
    `You are the ${role} in the /motta-heavydev flow.`,
    `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/${roleFile}.`,
    `Author stamp: ${stamp}`,
    `Step id: ${step}`,
    `Store clone: ${R.storeClone} — run directory: ${R.runDir} (paths below are relative to the store clone)`,
    `Store writer: ${R.storeWrite}`,
    `Target repo (read-only): ${R.targetRepo}`,
    `Playbook: ${R.playbookPath}`,
    `Intent record: ${R.intentPath}`,
    `Shared brief: ${R.briefPath}`,
    `Round: ${n}`,
  ].join('\n')
}

// The gate is computed here from the critic's evidence; the critic never decides it.
// Must stay identical to the gate in diff-review.js (test-gate.mjs checks it).
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

async function architect(brief) {
  const step = `r${n}-architect-${brief}`
  const prev = A.previous && A.previous[brief]
  const lines = [
    header(`Architect (${brief} brief)`, 'architect.md', A.roles.architect.stamps[brief], step),
    `Your brief: ${brief}`,
    `Write your plan to: ${dir}/plan-${brief}.md`,
    `Optional reframing note: ${dir}/reframing-${brief}.md`,
  ]
  if (prev) {
    lines.push(`Your previous plan: ${prev.planPath}`)
    lines.push(`The critic's verdict on it: ${prev.verdictPath}`)
    lines.push(`Write your responses to: ${dir}/response-${brief}.json`)
  }
  if (A.feedbackPath) lines.push(`The user's restart feedback: ${A.feedbackPath}`)
  if (A.auditPath) lines.push(`Auditor findings to respond to (ids A-${brief === 'bold' ? 'B' : 'C'}-*): ${A.auditPath}`)
  return run(lines.join('\n'), {
    label: step, phase: 'Architects', schema: ARCHITECT_RESULT,
    model: A.roles.architect.model, effort: A.roles.architect.effort, agentType: A.roles.architect.agentType,
  })
}

async function critic(arch, brief) {
  if (!arch) return null
  const step = `r${n}-critic-${brief}`
  const prev = A.previous && A.previous[brief] && A.previous[brief].verdict
  const lines = [
    header('Critic', 'critic.md', A.roles.critic.stamp, step),
    `Plan under review (${brief} brief): ${arch.planPath}`,
    `Objection id prefix: O-${brief === 'bold' ? 'B' : 'C'}-`,
    `Write your verdict to: ${dir}/verdict-${brief}.json`,
  ]
  if (prev) lines.push(`Previous verdict (the ledger to carry): ${A.previous[brief].verdictPath}`)
  if (arch.responsePath) lines.push(`The architect's responses: ${arch.responsePath}`)
  if (A.auditPath) lines.push(`Auditor findings to add to the ledger (ids A-${brief === 'bold' ? 'B' : 'C'}-*): ${A.auditPath}`)
  const opts = {
    label: step, phase: 'Critic', schema: VERDICT,
    model: A.roles.critic.model, effort: A.roles.critic.effort, agentType: A.roles.critic.agentType,
  }
  let v = await run(lines.join('\n'), opts)

  // Every objection already in the ledger must be carried; one retry, then it is reported.
  const carried = new Set(v ? v.objections.map((o) => o.id) : [])
  const dropped = prev ? prev.objections.map((o) => o.id).filter((id) => !carried.has(id)) : []
  if (v && dropped.length) {
    log(`${step}: verdict dropped ${dropped.join(', ')} — asking the critic to carry them`)
    v = await run(`${lines.join('\n')}\n\nYour previous attempt dropped ledger entries ${dropped.join(', ')}. Every objection from the previous verdict must appear in yours — closed, kept or disputed. Rewrite and republish the verdict.`, { ...opts, label: `${step}-retry` })
  }
  if (!v) return { brief, error: 'critic returned nothing' }
  const g = gate(v)
  log(`${brief}: ${g.pass ? 'PASS' : 'not yet'} — ${g.score.split('\n')[0]}`)
  return { brief, arch, verdict: v, ...g, droppedAfterRetry: dropped.filter((id) => !v.objections.some((o) => o.id === id)) }
}

phase('Architects')
const results = await pipeline(A.plans, architect, critic)
return { round: n, results: results.map((r, i) => r || { brief: A.plans[i], error: 'architect returned nothing' }) }
