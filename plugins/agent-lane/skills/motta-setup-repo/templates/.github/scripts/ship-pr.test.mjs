import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addAfterReleaseItems,
  addReleaseRow,
  approvalIsCurrent,
  checksVerdict,
  closingIssues,
  humanSteps,
  openFeedbackLabels,
  releaseSummary,
} from './ship-pr.mjs';

const prBody = (humanSection) => `## Product summary

<!-- "Closes #123" links the PR to its issue. -->

Closes #744, closes #746

### What changes for users

- Before: the owner merges by hand.
- After: the label merges the PR | once CI is green.

### What a human must do

<!-- One item each. -->

${humanSection}

### Deviations from the issue

None

---

## Technical details
`;

test('closingIssues reads every keyword and ignores template comments', () => {
  assert.deepEqual(closingIssues(prBody('Nothing')), [744, 746]);
  assert.deepEqual(closingIssues('Closes #\n\nRefs #12'), []);
});

test('humanSteps: "Nothing" and ticked items leave nothing open', () => {
  assert.deepEqual(humanSteps(prBody('Nothing')).openBeforeMerge, []);
  assert.deepEqual(humanSteps(prBody('- [x] (before merge) seeded the SSM value')).openBeforeMerge, []);
});

test('humanSteps: open before-merge, untagged and plain lines block; after-release does not', () => {
  const steps = humanSteps(
    prBody(
      [
        '- [ ] (before merge) seed the SSM value',
        '- [ ] probe the sign-in page',
        '- run the Studio smoke test',
        '- [ ] (after release) check the alarm stays OK',
      ].join('\n'),
    ),
  );
  assert.deepEqual(steps.openBeforeMerge, [
    '(before merge) seed the SSM value',
    'probe the sign-in page',
    'run the Studio smoke test',
  ]);
  assert.deepEqual(steps.afterRelease, ['check the alarm stays OK']);
});

test('humanSteps reports a missing section', () => {
  assert.equal(humanSteps('## Product summary\n\nCloses #1').missing, true);
});

test('openFeedbackLabels flags an open review or question', () => {
  assert.deepEqual(openFeedbackLabels(['agent: human-approved', 'type: feature']), []);
  assert.deepEqual(openFeedbackLabels(['agent: human-approved', 'agent: review', 'agent: needs-human']), [
    'agent: review',
    'agent: needs-human',
  ]);
});

test('approvalIsCurrent needs a label newer than the head commit', () => {
  assert.equal(approvalIsCurrent('2026-10-15T10:00:00Z', '2026-10-15T09:00:00Z'), true);
  assert.equal(approvalIsCurrent('2026-10-15T08:00:00Z', '2026-10-15T09:00:00Z'), false);
  assert.equal(approvalIsCurrent(undefined, '2026-10-15T09:00:00Z'), false);
});

test('checksVerdict ignores the lane jobs and waits for every CI check', () => {
  const lane = { name: 'agent-lane · ship', status: 'in_progress', conclusion: null };
  assert.equal(checksVerdict([lane]).state, 'pending');
  assert.equal(
    checksVerdict([lane, { name: 'build', status: 'completed', conclusion: 'success' }, { name: 'test', status: 'queued', conclusion: null }]).state,
    'pending',
  );
  assert.equal(
    checksVerdict([{ name: 'build', status: 'completed', conclusion: 'success' }, { name: 'quality', status: 'completed', conclusion: 'skipped' }]).state,
    'passed',
  );
  assert.equal(
    checksVerdict([
      { name: 'build', status: 'completed', conclusion: 'success' },
      { name: 'quality · advisory (coverage · dead-code · audit)', status: 'completed', conclusion: 'failure' },
    ]).state,
    'passed',
  );
  const failed = checksVerdict([{ name: 'test', status: 'completed', conclusion: 'failure' }, { name: 'build', status: 'queued', conclusion: null }]);
  assert.equal(failed.state, 'failed');
  assert.match(failed.detail, /test: failure/);
});

test('releaseSummary takes the After line, escaping pipes, and falls back to the title', () => {
  assert.equal(releaseSummary(prBody('Nothing'), 'x'), 'the label merges the PR \\| once CI is green.');
  assert.equal(releaseSummary('no summary', 'feat(channels): add a code page'), 'add a code page');
});

const release = `## What ships

| PR | Issue | Change |
|---|---|---|
| #700 | #603 | Something shipped. |

## Before \`cdk deploy\`

- [ ] seed

## After \`cdk deploy\`

- [ ] alarms OK

**Rollback:** revert.
`;

test('addReleaseRow appends to the table once', () => {
  const once = addReleaseRow(release, '| #745 | #744 | The lane. |', 745);
  assert.match(once, /\| #700 \| #603 \| Something shipped\. \|\n\| #745 \| #744 \| The lane\. \|\n\n## Before/);
  assert.equal(addReleaseRow(once, '| #745 | #744 | The lane. |', 745), once);
});

test('addReleaseRow creates the section when absent', () => {
  assert.match(addReleaseRow('Intro', '| #1 | #2 | X |', 1), /## What ships\n\n\| PR \| Issue \| Change \|\n\|---\|---\|---\|\n\| #1 \| #2 \| X \|/);
});

test('addAfterReleaseItems lands in the After section, once', () => {
  const once = addAfterReleaseItems(release, ['probe the page'], 745);
  assert.match(once, /- \[ \] alarms OK\n- \[ \] probe the page \(#745\)\n\n\*\*Rollback/);
  assert.equal(addAfterReleaseItems(once, ['probe the page'], 745), once);
  assert.equal(addAfterReleaseItems(release, [], 745), release);
  assert.match(addAfterReleaseItems('Intro', ['x'], 9), /## After release\n\n- \[ \] x \(#9\)/);
});
