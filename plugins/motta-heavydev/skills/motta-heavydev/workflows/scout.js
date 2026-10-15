export const meta = {
  name: 'motta-heavydev-scout',
  description: 'Read the target repo once and write the shared brief; check the playbook against reality',
  whenToUse: 'Launched only by the /motta-heavydev skill, once per architecture run',
  phases: [{ title: 'Scout' }],
}

// args: { run: { storeClone, runDir, storeWrite, rolesDir, targetRepo, playbookPath, intentPath, briefPath },
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role

const RESULT = {
  type: 'object',
  properties: {
    briefPath: { type: 'string' },
    playbookIssues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, problem: { type: 'string' }, suggestedFix: { type: 'string' } },
        required: ['item', 'problem', 'suggestedFix'],
      },
    },
  },
  required: ['briefPath', 'playbookIssues'],
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

phase('Scout')
return run(
  [
    'You are the Scout in the /motta-heavydev flow.',
    `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/scout.md.`,
    `Author stamp: ${role.stamp}`,
    'Step id: scout',
    `Store clone: ${R.storeClone} — run directory: ${R.runDir} (paths below are relative to the store clone)`,
    `Store writer: ${R.storeWrite}`,
    `Target repo (read-only): ${R.targetRepo}`,
    `Playbook: ${R.playbookPath}`,
    `Intent record: ${R.intentPath}`,
    `Write the brief to: ${R.briefPath}`,
  ].join('\n'),
  { label: 'scout', phase: 'Scout', schema: RESULT, model: role.model, effort: role.effort, agentType: role.agentType },
)
