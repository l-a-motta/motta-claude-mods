export const meta = {
  name: 'motta-heavydev-audit',
  description: 'The single auditor call: look for what the critic missed in both passing plans',
  whenToUse: 'Launched only by the /motta-heavydev skill, once per architecture run',
  phases: [{ title: 'Audit' }],
}

// args: { run: {...}, plans: { conservative: {planPath, verdictPath}, bold: {...} },
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^A-[CB]-[0-9]+$' },
    plan: { type: 'string', enum: ['conservative', 'bold'] },
    author: { type: 'string' },
    criterion: { type: 'integer', minimum: 1, maximum: 10 },
    title: { type: 'string', minLength: 3, maxLength: 80 },
    severity: { type: 'string', enum: ['blocking'] },
    claim: { type: 'string', minLength: 10 },
    evidence: { type: 'string', minLength: 5 },
    closesWhen: { type: 'string', minLength: 5 },
  },
  required: ['id', 'plan', 'author', 'criterion', 'title', 'severity', 'claim', 'evidence', 'closesWhen'],
}
const RESULT = {
  type: 'object',
  properties: { author: { type: 'string' }, findings: { type: 'array', items: FINDING }, summary: { type: 'string' } },
  required: ['author', 'findings', 'summary'],
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
  'You are the Auditor in the /motta-heavydev flow.',
  `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/auditor.md.`,
  `Author stamp: ${role.stamp}`,
  'Step id: audit',
  `Store clone: ${R.storeClone} — run directory: ${R.runDir} (paths below are relative to the store clone)`,
  `Store writer: ${R.storeWrite}`,
  `Target repo (read-only): ${R.targetRepo}`,
  `Playbook: ${R.playbookPath}`,
  `Intent record: ${R.intentPath}`,
  `Shared brief: ${R.briefPath}`,
]
for (const [brief, p] of Object.entries(args.plans)) lines.push(`${brief} plan: ${p.planPath} — final verdict: ${p.verdictPath}`)
lines.push(`Write the audit to: ${R.runDir}/audit.json`)

phase('Audit')
const audit = await run(lines.join('\n'), {
  label: 'audit', phase: 'Audit', schema: RESULT, model: role.model, effort: role.effort, agentType: role.agentType,
})
if (audit) log(`audit: ${audit.findings.length} blocking finding(s)`)
return audit
