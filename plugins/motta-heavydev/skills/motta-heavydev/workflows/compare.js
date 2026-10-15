export const meta = {
  name: 'motta-heavydev-compare',
  description: 'Build the side-by-side table the user picks a plan from, and flag converged plans',
  whenToUse: 'Launched only by the /motta-heavydev skill, after the audit',
  phases: [{ title: 'Compare' }],
}

// args: { run: {...}, plans: { <brief>: { planPath, verdictPath, score, reframingPath } }, auditPath,
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role

const RESULT = {
  type: 'object',
  properties: { comparisonPath: { type: 'string' }, converged: { type: 'boolean' }, convergenceReason: { type: 'string' } },
  required: ['comparisonPath', 'converged', 'convergenceReason'],
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
  'You are the Comparator in the /motta-heavydev flow.',
  `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/comparator.md.`,
  `Author stamp: ${role.stamp}`,
  'Step id: compare',
  `Store clone: ${R.storeClone} — run directory: ${R.runDir} (paths below are relative to the store clone)`,
  `Store writer: ${R.storeWrite}`,
]
for (const [brief, p] of Object.entries(args.plans)) {
  lines.push(`${brief}: plan ${p.planPath} · verdict ${p.verdictPath} · reframing ${p.reframingPath || 'none'}`)
  lines.push(`${brief} score (use verbatim): ${p.score}`)
}
lines.push(`Audit: ${args.auditPath || 'none'}`)
lines.push(`Write the table to: ${R.runDir}/comparison.md`)

phase('Compare')
return run(lines.join('\n'), {
  label: 'compare', phase: 'Compare', schema: RESULT, model: role.model, effort: role.effort, agentType: role.agentType,
})
