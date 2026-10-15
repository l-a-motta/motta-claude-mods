#!/usr/bin/env node
// Ship one human-approved PR into dev (.github/BOARD.md, "Agent lane"): check the gates, squash-merge,
// close the linked issues, update the board and the open release PR.
//
//   node .github/scripts/ship-pr.mjs <pr> [--wait-minutes 25] [--dry-run]
//
// Runs the same from the agent-lane Action (GITHUB_TOKEN) and from a desktop session (`gh` login).
// Board writes go through board.sh with BOARD_TOKEN when set, because GITHUB_TOKEN cannot write org
// Projects, and they are best-effort: a board hiccup must never undo or block a merge.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = '{{OWNER}}/{{REPO}}';
export const APPROVAL_LABEL = 'agent: human-approved';
// The agent-lane workflow's own jobs report as checks on the PR; the CI gate must not wait on them.
export const LANE_CHECK_PREFIX = 'agent-lane';
// CI names its non-blocking jobs "… advisory …" (docs/ci-rules.md); they never block a merge.
const ADVISORY = /\badvisory\b/i;

const BOARD_SH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'board.sh');

// ── Pure helpers (unit-tested in ship-pr.test.mjs) ─────────────────────────────────────────────

export function stripComments(text) {
  return (text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

/** The body of a `##`–`####` section, up to the next heading or `---`; null when absent. */
export function section(body, heading) {
  const lines = stripComments(body).split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex(
    (l) => /^#{2,4}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want,
  );
  if (start < 0) return null;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(l) || /^---\s*$/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

/** Issue numbers named by closing keywords, outside HTML comments. */
export function closingIssues(body) {
  const nums = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
  for (const m of stripComments(body).matchAll(re)) nums.add(Number(m[1]));
  return [...nums];
}

/**
 * The "What a human must do" items. Fails closed: an open checkbox without `(after release)`, or
 * any other line that is not "Nothing"/"None", counts as an open before-merge item.
 */
export function humanSteps(body) {
  const text = section(body, 'What a human must do');
  if (text === null) return { missing: true, openBeforeMerge: [], afterRelease: [] };
  const openBeforeMerge = [];
  const afterRelease = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-*]?\s*(nothing|none)\.?$/i.test(line)) continue;
    const box = line.match(/^[-*]\s*\[( |x|X)\]\s*(.*)$/);
    if (box && box[1] !== ' ') continue;
    const item = (box ? box[2] : line.replace(/^[-*]\s*/, '')).trim();
    if (/^\(after release\)/i.test(item)) {
      afterRelease.push(item.replace(/^\(after release\)\s*/i, ''));
    } else {
      openBeforeMerge.push(item);
    }
  }
  return { missing: false, openBeforeMerge, afterRelease };
}

/** Labels saying a review or a question is still open on the PR: approving past them skips it. */
export function openFeedbackLabels(labelNames) {
  return labelNames.filter((name) => name === 'agent: review' || name === 'agent: needs-human');
}

export function approvalIsCurrent(labeledAt, headCommittedAt) {
  return Boolean(labeledAt) && Date.parse(labeledAt) > Date.parse(headCommittedAt);
}

/** passed | failed | pending, over the PR head's check runs minus the lane's and advisory jobs. */
export function checksVerdict(checkRuns) {
  const runs = checkRuns.filter((r) => !r.name.startsWith(LANE_CHECK_PREFIX) && !ADVISORY.test(r.name));
  if (runs.length === 0) return { state: 'pending', detail: 'no CI checks reported yet' };
  const ok = ['success', 'skipped', 'neutral'];
  const failed = runs.filter((r) => r.status === 'completed' && !ok.includes(r.conclusion));
  if (failed.length) {
    return { state: 'failed', detail: failed.map((r) => `${r.name}: ${r.conclusion}`).join(', ') };
  }
  const pending = runs.filter((r) => r.status !== 'completed');
  if (pending.length) return { state: 'pending', detail: pending.map((r) => r.name).join(', ') };
  return { state: 'passed', detail: `${runs.length} checks passed` };
}

/** One sentence for the release PR: the "After:" line of the product summary, else the title. */
export function releaseSummary(prBody, prTitle) {
  const users = section(prBody, 'What changes for users');
  const after = users?.match(/^\s*[-*]\s*After:\s*(.+)$/m)?.[1]?.trim();
  const text = after || prTitle.replace(/^\w+(\([^)]*\))?!?:\s*/, '');
  return text.replace(/\|/g, '\\|');
}

/** Appends `row` to the "## What ships" table; idempotent per PR number. */
export function addReleaseRow(releaseBody, row, prNumber) {
  const body = releaseBody ?? '';
  if (body.includes(`| #${prNumber} |`)) return body;
  const lines = body.split(/\r?\n/);
  const head = lines.findIndex((l) => /^##\s+What ships\s*$/i.test(l));
  if (head < 0) {
    return `${body.trimEnd()}\n\n## What ships\n\n| PR | Issue | Change |\n|---|---|---|\n${row}\n`;
  }
  let last = -1;
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].startsWith('|')) last = i;
    else if (last >= 0 || /^#{1,2}\s/.test(lines[i])) break;
  }
  if (last < 0) {
    lines.splice(head + 1, 0, '', '| PR | Issue | Change |', '|---|---|---|', row);
  } else {
    lines.splice(last + 1, 0, row);
  }
  return lines.join('\n');
}

/** Adds `- [ ] item (#pr)` lines to the release PR's "## After …" checklist; idempotent. */
export function addAfterReleaseItems(releaseBody, items, prNumber) {
  const body = releaseBody ?? '';
  const fresh = items
    .map((i) => `- [ ] ${i} (#${prNumber})`)
    .filter((line) => !body.includes(line));
  if (!fresh.length) return body;
  const lines = body.split(/\r?\n/);
  const head = lines.findIndex((l) => /^##\s+After\b/i.test(l));
  if (head < 0) return `${body.trimEnd()}\n\n## After release\n\n${fresh.join('\n')}\n`;
  let end = lines.findIndex((l, i) => i > head && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  // After the section's last checklist line, so prose that follows the list stays below it.
  let at = -1;
  for (let i = head + 1; i < end; i++) if (/^\s*[-*]\s*\[[ xX]\]/.test(lines[i])) at = i + 1;
  if (at < 0) {
    at = end;
    while (at > head + 1 && lines[at - 1].trim() === '') at--;
  }
  lines.splice(at, 0, ...fresh);
  return lines.join('\n');
}

// ── GitHub (REST through gh) ───────────────────────────────────────────────────────────────────

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

const api = (route, ...args) => JSON.parse(gh(['api', route, ...args]));
const apiLines = (route, jq) =>
  gh(['api', route, '--paginate', '--jq', jq])
    .split('\n')
    .filter(Boolean);
const send = (method, route, payload) =>
  JSON.parse(gh(['api', '-X', method, route, '--input', '-'], JSON.stringify(payload)) || 'null');

const comment = (number, body) => send('POST', `repos/${REPO}/issues/${number}/comments`, { body });

function board(issue, status) {
  const env = { ...process.env };
  if (process.env.BOARD_TOKEN) env.GH_TOKEN = process.env.BOARD_TOKEN;
  try {
    execFileSync('bash', [BOARD_SH, 'set', String(issue), 'Status', status], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`board: #${issue} Status = ${status}`);
  } catch (err) {
    console.warn(`::warning::board: could not set #${issue} to ${status}: ${String(err.stderr || err.message).trim()}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── The ship step ──────────────────────────────────────────────────────────────────────────────

async function ship(number, { waitMinutes, dryRun }) {
  let pr = api(`repos/${REPO}/pulls/${number}`);
  const stop = (gate, why, fix) => {
    console.error(`::error::gate "${gate}": ${why}`);
    if (!dryRun) {
      comment(number, `**Ship step stopped** at the _${gate}_ gate: ${why}${fix ? `\n\n${fix}` : ''}`);
    }
    process.exitCode = 1;
  };

  if (pr.state !== 'open') return console.log(`#${number} is ${pr.merged ? 'merged' : pr.state}; nothing to do.`);
  if (pr.base.ref !== 'dev' || pr.head.ref === 'dev') {
    return stop('base', `the PR goes from \`${pr.head.ref}\` into \`${pr.base.ref}\`.`, 'Only feature PRs into `dev` ship here; the release PR is merged by the tech lead.');
  }
  if (pr.draft) return stop('draft', 'the PR is a draft.', 'Mark it ready for review, then apply the label again.');
  if (!pr.labels.some((l) => l.name === APPROVAL_LABEL)) return console.log(`#${number} has no ${APPROVAL_LABEL} label; nothing to do.`);
  const feedback = openFeedbackLabels(pr.labels.map((l) => l.name));
  if (feedback.length) {
    return stop('open feedback', `the PR still carries ${feedback.map((l) => `\`${l}\``).join(' and ')}.`, 'Let the review finish or answer its question, remove the label, then re-apply the approval.');
  }

  const labeledAt = apiLines(
    `repos/${REPO}/issues/${number}/events`,
    `.[] | select(.event == "labeled" and .label.name == "${APPROVAL_LABEL}") | .created_at`,
  ).at(-1);
  const headAt = api(`repos/${REPO}/commits/${pr.head.sha}`).commit.committer.date;
  if (!approvalIsCurrent(labeledAt, headAt)) {
    return stop('approval', 'commits landed after the approval.', `Read the new commits, then remove and re-apply \`${APPROVAL_LABEL}\`.`);
  }

  const steps = humanSteps(pr.body);
  if (steps.missing) {
    return stop('human steps', 'the description has no "What a human must do" section.', 'Add it from the PR template ("Nothing" when none), then re-apply the label.');
  }
  if (steps.openBeforeMerge.length) {
    return stop('human steps', `open before-merge items:\n${steps.openBeforeMerge.map((i) => `- ${i}`).join('\n')}`, 'Tick each item once done (tag post-deploy work `(after release)`), then re-apply the label.');
  }

  const issues = closingIssues(pr.body);
  if (!issues.length) return stop('linked issue', 'the description has no `Closes #<n>` line.', 'Add it, then re-apply the label.');

  const deadline = Date.now() + waitMinutes * 60_000;
  for (;;) {
    const runs = apiLines(`repos/${REPO}/commits/${pr.head.sha}/check-runs`, '.check_runs[] | {name, status, conclusion}').map((l) => JSON.parse(l));
    const verdict = checksVerdict(runs);
    console.log(`CI: ${verdict.state} — ${verdict.detail}`);
    if (verdict.state === 'passed') break;
    if (verdict.state === 'failed') return stop('CI', `failing checks: ${verdict.detail}.`, 'Fix and push; the push clears the approval, so re-apply the label after.');
    if (Date.now() > deadline) return stop('CI', `checks still running after ${waitMinutes} minutes: ${verdict.detail}.`, 'Re-apply the label once CI finishes.');
    await sleep(30_000);
  }

  for (let i = 0; pr.mergeable === null && i < 12; i++) {
    await sleep(5_000);
    pr = api(`repos/${REPO}/pulls/${number}`);
  }
  if (pr.mergeable !== true) return stop('conflicts', `GitHub reports the PR as not mergeable (${pr.mergeable_state}).`, 'Rebase or merge `dev` into the branch; the push clears the approval.');

  if (dryRun) return console.log(`dry run: all gates pass; would merge #${number} and close ${issues.map((i) => `#${i}`).join(', ')}.`);

  for (const issue of issues) board(issue, 'Approved');

  // Pinned to the approved head: GitHub refuses the merge if anything was pushed since.
  const merged = send('PUT', `repos/${REPO}/pulls/${number}/merge`, {
    merge_method: 'squash',
    sha: pr.head.sha,
    commit_title: `${pr.title} (#${number})`,
  });
  console.log(`merged #${number} as ${merged.sha}`);
  try {
    gh(['api', '-X', 'DELETE', `repos/${REPO}/git/refs/heads/${pr.head.ref}`]);
  } catch {
    console.warn(`::warning::branch ${pr.head.ref} was not deleted (already gone or protected).`);
  }

  for (const issue of issues) {
    const it = api(`repos/${REPO}/issues/${issue}`);
    if (it.state === 'open') {
      comment(issue, `Merged into dev by #${number}.`);
      send('PATCH', `repos/${REPO}/issues/${issue}`, { state: 'closed', state_reason: 'completed' });
    }
    board(issue, 'Done');
    closeFinishedParent(issue);
  }

  const notes = [`Shipped: squash-merged into \`dev\` as ${merged.sha.slice(0, 7)}; closed ${issues.map((i) => `#${i}`).join(', ')}.`];
  const release = api(`repos/${REPO}/pulls?base=main&head=${REPO.split('/')[0]}:dev&state=open`)[0];
  if (release) {
    const row = `| #${number} | ${issues.map((i) => `#${i}`).join(', ')} | ${releaseSummary(pr.body, pr.title)} |`;
    const body = addAfterReleaseItems(addReleaseRow(release.body, row, number), steps.afterRelease, number);
    if (body !== release.body) send('PATCH', `repos/${REPO}/pulls/${release.number}`, { body });
    notes.push(`Added to release PR #${release.number}${steps.afterRelease.length ? ', with its after-release items' : ''}.`);
  } else {
    notes.push(`No release PR is open: the next one lists this PR${steps.afterRelease.length ? ' and must carry its after-release items' : ''}.`);
  }
  if (pr.labels.some((l) => l.name === 'breaking-change')) {
    notes.push('`breaking-change`: the release PR needs an entry in its IMPORTANT block (BOARD.md, Releasing).');
  }
  comment(number, notes.join('\n\n'));
}

function closeFinishedParent(issue) {
  let parent;
  try {
    parent = api(`repos/${REPO}/issues/${issue}/parent`);
  } catch {
    return; // not a sub-issue
  }
  if (parent.state !== 'open') return;
  const children = api(`repos/${REPO}/issues/${parent.number}/sub_issues?per_page=100`);
  if (children.some((c) => c.state === 'open')) return;
  comment(parent.number, `Every sub-issue is closed (the last one, #${issue}, by its merge into dev).`);
  send('PATCH', `repos/${REPO}/issues/${parent.number}`, { state: 'closed', state_reason: 'completed' });
  const isSpike = parent.labels.some((l) => l.name === 'type: spike');
  board(parent.number, isSpike ? 'Closed' : 'Done');
}

function parseArgs(argv) {
  const opts = { waitMinutes: 25, dryRun: false };
  let number;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--wait-minutes') opts.waitMinutes = Number(argv[++i]);
    else number = Number(argv[i].replace(/^#/, ''));
  }
  if (!Number.isInteger(number) || number <= 0 || !(opts.waitMinutes >= 0)) {
    console.error('usage: node .github/scripts/ship-pr.mjs <pr> [--wait-minutes 25] [--dry-run]');
    process.exit(2);
  }
  return { number, opts };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { number, opts } = parseArgs(process.argv.slice(2));
  ship(number, opts).catch((err) => {
    console.error(`::error::${String(err.stderr || err.message).trim()}`);
    process.exitCode = 1;
  });
}
