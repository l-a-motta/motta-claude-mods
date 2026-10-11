// The session the tests run the mod in, shared by the test files. Each test
// file runs in a process of its own, so each starts the mod afresh.

import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// `gh pr view --json` as GitHub answers it: Actions check runs and one
// external commit status.
export const PR_JSON = JSON.stringify({
  number: 482,
  url: 'https://github.com/o/vtex-copilot-fse/pull/482',
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
  reviewDecision: 'REVIEW_REQUIRED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'StatusContext', context: 'ci/jenkins', state: 'PENDING' },
  ],
})

// Answers each call on $ the mod makes with one fixed session; hooks on a
// call answer `{ value }`. `gh pr view` answers `prJson` (a function is asked
// on each call), that the branch has no PR when it is null, or fails with the
// `stderr` given. The ui.render stand-ins are the engine beneath the plugin:
// its hint line, and the opaque reference it hands back for an empty band;
// with `beneath`, what a plugin beneath draws in the band instead:
// prompt-enhancer's chip or card, or a tree that takes the band, as
// replay-theater's does. With `worktree`, the session runs in a worktree of
// the repository, on its own branch, while the repository's root is the main
// checkout. Every process run is recorded in `runs`.
type GhAnswer = string | null | { stderr: string }

export type Beneath = 'nothing' | 'chip' | 'card' | 'taken'

export type Worktree = { cwd: string; status: string }

export const runs: { argv: string[]; cwd?: string }[] = []

export function answerSession(on: Parameters<TestBody>[1], prJson: GhAnswer | (() => GhAnswer) = null, beneath: Beneath = 'nothing', worktree: Worktree | null = null) {
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: worktree?.cwd ?? 'C:/code/vtex-copilot-fse' }))
  on('session.repo', () => ({
    value: { root: 'C:/code/vtex-copilot-fse', remote: 'git@github.com:o/vtex-copilot-fse.git', internal: false, name: null },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  // Asked for the breakdown, it says auto-compact fires at 835k.
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 360_000,
        window: 1_000_000,
        percent: 36,
        ...(e?.breakdown ? { breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 835_000 } as never } : {}),
      },
      rateLimits: [{ kind: 'five_hour', percentUsed: 5 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, cwd: e.init?.cwd })
    const json = typeof prJson === 'function' ? prJson() : prJson
    const run =
      e.argv[0] !== 'gh'
        ? { exitCode: 0, stdout: worktree && e.init?.cwd === worktree.cwd ? worktree.status : '## dev\n', stderr: '' }
        : json === null
          ? { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "dev"' }
          : typeof json === 'object'
            ? { exitCode: 1, stdout: '', stderr: json.stderr }
            : { exitCode: 0, stdout: json, stderr: '' }
    return { value: { ...run, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-hint">esc to interrupt</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    if (beneath === 'nothing') return { type: 'engine', ref: 1 } as never
    const { Box, Text, Button } = $.ui.resolve(e)
    if (beneath === 'chip') {
      return (
        <Box key="band-beside:prompt-enhancer" flexDirection="row" justifyContent="flex-end" paddingX={1}>
          <Button key="enhance" plain label="✦ enhance" onPress={() => undefined} />
        </Box>
      )
    }
    if (beneath === 'card') {
      return (
        <Box key="band-under:prompt-enhancer" flexDirection="column" paddingX={1}>
          <Text>✦ Enhanced</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text>Edit 1 of 3</Text>
      </Box>
    )
  })
  return clock
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
