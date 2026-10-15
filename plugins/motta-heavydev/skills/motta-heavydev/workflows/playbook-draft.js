export const meta = {
  name: 'motta-heavydev-playbook-draft',
  description: 'Draft (or refresh) a target repo playbook from the repo itself and list the questions only the user can answer',
  whenToUse: 'Launched only by the /motta-heavydev skill, when a repo has no playbook or the user asks to refresh it',
  phases: [{ title: 'Draft' }],
}

// args: { run: { storeClone, storeWrite, rolesDir, targetRepo },
//         draftDir,            // relative to storeClone, e.g. playbooks/drafts/<owner>__<repo>
//         templatePath,        // absolute
//         existingPlaybookPath, // absolute, optional — refresh mode
//         role: { model, effort, agentType, stamp } }
const R = args.run
const role = args.role

const RESULT = {
  type: 'object',
  properties: {
    draftPath: { type: 'string' },
    questionsPath: { type: 'string' },
    questionCount: { type: 'integer', minimum: 0 },
    filledFromRepo: { type: 'array', items: { type: 'string' } },
  },
  required: ['draftPath', 'questionsPath', 'questionCount', 'filledFromRepo'],
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

const lines = [
  'You are the Playbook drafter in the /motta-heavydev flow.',
  `Read and follow, in order: ${R.rolesDir}/_common.md, then ${R.rolesDir}/playbook-drafter.md.`,
  `Author stamp: ${role.stamp}`,
  'Step id: playbook-draft',
  `Store clone: ${R.storeClone} (paths below are relative to it)`,
  `Store writer: ${R.storeWrite}`,
  `Target repo (read-only): ${R.targetRepo}`,
  `Playbook template: ${args.templatePath}`,
  `Write the draft to: ${args.draftDir}/playbook-draft.md`,
  `Write the questions to: ${args.draftDir}/playbook-questions.md`,
  `Write the step record to: ${args.draftDir}/steps/playbook-draft.json`,
]
if (args.existingPlaybookPath) lines.push(`Existing playbook to refresh: ${args.existingPlaybookPath}`)

phase('Draft')
return run(lines.join('\n'), {
  label: 'playbook-draft', phase: 'Draft', schema: RESULT, model: role.model, effort: role.effort, agentType: role.agentType,
})
