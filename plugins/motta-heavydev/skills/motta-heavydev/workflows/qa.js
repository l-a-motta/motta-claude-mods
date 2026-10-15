export const meta = {
  name: 'motta-heavydev-qa',
  description: 'QA plays the approved scenarios against the running system (and an exploratory pass at full level); results are classified here',
  whenToUse: 'Launched only by the /motta-heavydev skill, once per QA batch, with the system already running',
  phases: [{ title: 'Scenarios' }, { title: 'Exploratory' }],
}

// args: { run: { storeClone, runDir, storeWrite, rolesDir, playbookPath },
//         batch,                              // e.g. "b1", "b2-rerun", "final"
//         level: 'basic' | 'full',
//         approvedPlanPath,
//         scenarios: [{ id, title }],         // already filtered to this level
//         instance: { baseUrl, logFile },
//         secrets: [{ name, envVar }],        // sources only, never values
//         interactionCap, reruns, parallel,
//         exploratory: { enabled, steps },
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role
const dir = `${R.runDir}/qa/${args.batch}`

const SCENARIO = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    result: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
    expected: { type: 'string' },
    observed: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    suspectedArea: { type: 'string' },
    interactions: { type: 'integer', minimum: 0 },
    systemDown: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['id', 'result', 'expected', 'observed', 'evidence', 'suspectedArea', 'interactions', 'systemDown', 'notes'],
}
const EXPLORATORY = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['crash', 'data-loss', 'security', 'observation'] },
          title: { type: 'string' },
          observed: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'title', 'observed', 'evidence'],
      },
    },
    steps: { type: 'integer' },
  },
  required: ['findings', 'steps'],
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

function header(step) {
  return [
    'You are QA in the /motta-heavydev flow.',
    `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/qa.md.`,
    `Author stamp: ${role.stamp}`,
    `Step id: ${step}`,
    `Store clone: ${R.storeClone} — run directory: ${R.runDir} (store paths below are relative to the store clone)`,
    `Store writer: ${R.storeWrite}`,
    `Playbook: ${R.playbookPath} — use its "Driving it as a client" section for level ${args.level}`,
    `Approved plan: ${args.approvedPlanPath}`,
    `Running instance: ${args.instance.baseUrl} — runtime log: ${args.instance.logFile}`,
    `Secrets (read from these environment variables, never write their values): ${args.secrets.map((s) => `${s.name} = $${s.envVar}`).join(', ') || 'none'}`,
    `Interaction cap: ${args.interactionCap}`,
  ].join('\n')
}

async function attempt(sc, k) {
  const step = `qa-${args.batch}-${sc.id}${k ? `-retry${k}` : ''}`
  return run(
    `${header(step)}\nScenario: ${sc.id} — ${sc.title} (its full text is in the approved plan)\nEvidence directory: ${dir}/${sc.id}${k ? `-retry${k}` : ''}/\nWrite your result to: ${dir}/${sc.id}${k ? `-retry${k}` : ''}.json`,
    { label: step, phase: 'Scenarios', schema: SCENARIO, model: role.model, effort: role.effort, agentType: role.agentType },
  )
}

// A failure is re-run; failing every time is "fail", passing on a re-run is "flaky" — both escalate.
async function scenario(sc) {
  const first = await attempt(sc, 0)
  if (!first) return { id: sc.id, result: 'blocked', notes: 'QA agent returned nothing', attempts: [] }
  if (first.result !== 'fail' || first.systemDown) return { ...first, attempts: [first.result] }
  const results = [first.result]
  for (let k = 1; k <= (args.reruns || 0); k++) {
    const again = await attempt(sc, k)
    results.push(again ? again.result : 'blocked')
    if (again && again.result === 'pass') return { ...first, result: 'flaky', attempts: results }
  }
  return { ...first, attempts: results }
}

phase('Scenarios')
let results = []
let haltedBy = null
if (args.parallel) {
  results = (await parallel(args.scenarios.map((sc) => () => scenario(sc)))).filter(Boolean)
} else {
  for (const sc of args.scenarios) {
    const r = await scenario(sc)
    results.push(r)
    log(`${sc.id}: ${r.result}${r.attempts && r.attempts.length > 1 ? ` (${r.attempts.join('→')})` : ''}`)
    // A crash that takes the system down escalates at once; the rest can't run.
    if (r.systemDown) {
      haltedBy = sc.id
      break
    }
  }
}

let exploratory = null
if (args.level === 'full' && args.exploratory && args.exploratory.enabled && !haltedBy) {
  phase('Exploratory')
  const step = `qa-${args.batch}-exploratory`
  exploratory = await run(
    `${header(step)}\nTask: the exploratory pass, at most ${args.exploratory.steps} steps.\nEvidence directory: ${dir}/exploratory/\nWrite your result to: ${dir}/exploratory.json`,
    { label: step, phase: 'Exploratory', schema: EXPLORATORY, model: role.model, effort: role.effort, agentType: role.agentType },
  )
}

const escalate = [
  ...results.filter((r) => r.result === 'fail' || r.result === 'flaky' || r.result === 'blocked'),
  ...(exploratory ? exploratory.findings.filter((f) => f.severity !== 'observation').map((f) => ({ exploratory: true, ...f })) : []),
]
const notRun = haltedBy ? args.scenarios.slice(args.scenarios.findIndex((s) => s.id === haltedBy) + 1).map((s) => s.id) : []
log(`QA ${args.batch}: ${results.filter((r) => r.result === 'pass').length}/${args.scenarios.length} pass · ${escalate.length} to escalate${haltedBy ? ` · halted by ${haltedBy}` : ''}`)
return { batch: args.batch, level: args.level, results, exploratory, escalate, haltedBy, notRun }
