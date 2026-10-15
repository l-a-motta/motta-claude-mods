export const meta = {
  name: 'motta-heavydev-implement',
  description: 'The Developer implements one milestone of the approved plan, or fixes a diff-review verdict or QA findings, in the issue worktree',
  whenToUse: 'Launched only by the /motta-heavydev skill, once per milestone or fix',
  phases: [{ title: 'Develop' }],
}

// args: { run: { storeClone, runDir, storeWrite, rolesDir, targetRepo, playbookPath, intentPath },
//         worktree, branch, step,            // step id, e.g. "m2" or "fix-review-1" / "fix-qa-1"
//         mode: 'milestone' | 'fix',
//         milestone: { id, title, final },  // milestone mode
//         fixPath,                           // fix mode: verdict or QA batch, relative to storeClone
//         approvedPlanPath, notesPaths: [],  // relative to storeClone
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role

const RESULT = {
  type: 'object',
  properties: {
    step: { type: 'string' },
    status: { type: 'string', enum: ['done', 'deviation-major', 'blocked'] },
    commits: {
      type: 'array',
      items: { type: 'object', properties: { sha: { type: 'string' }, subject: { type: 'string' } }, required: ['sha', 'subject'] },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          command: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
          note: { type: 'string' },
        },
        required: ['name', 'command', 'result', 'note'],
      },
    },
    deviations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['minor', 'major'] }, description: { type: 'string' }, planRef: { type: 'string' } },
        required: ['kind', 'description', 'planRef'],
      },
    },
    notePath: { type: 'string' },
    responsePath: { type: ['string', 'null'] },
    summary: { type: 'string' },
  },
  required: ['step', 'status', 'commits', 'checks', 'deviations', 'notePath', 'responsePath', 'summary'],
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

const lines = [
  'You are the Developer in the /motta-heavydev flow.',
  `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/developer.md.`,
  `Author stamp: ${role.stamp}`,
  `Step id: ${args.step}`,
  `Store clone: ${R.storeClone} — run directory: ${R.runDir} (store paths below are relative to the store clone)`,
  `Store writer: ${R.storeWrite}`,
  `Playbook: ${R.playbookPath}`,
  `Intent record: ${R.intentPath}`,
  `Approved plan: ${args.approvedPlanPath}`,
  `Worktree (yours to change): ${args.worktree} — branch ${args.branch}`,
  `Write your notes to: ${R.runDir}/impl/${args.step}.md`,
]
if (args.notesPaths && args.notesPaths.length) lines.push(`Earlier progress notes: ${args.notesPaths.join(', ')}`)
if (args.mode === 'fix') {
  lines.push('Mode: fix')
  lines.push(`Resolve every objection or finding in: ${args.fixPath}`)
  lines.push(`Write your responses to: ${R.runDir}/impl/${args.step}-response.json`)
} else {
  lines.push(`Mode: milestone — ${args.milestone.id}: ${args.milestone.title}`)
  if (args.milestone.final) lines.push('This is the final milestone: run every check the playbook lists before your last commit.')
}

phase('Develop')
const r = await run(lines.join('\n'), {
  label: args.step, phase: 'Develop', schema: RESULT, model: role.model, effort: role.effort, agentType: role.agentType,
})
if (r) log(`${args.step}: ${r.status} — ${r.commits.length} commit(s), checks ${r.checks.map((c) => `${c.name}:${c.result}`).join(' ')}`)
return r
