// Checks the whole vault and reports counts: missing notes, broken wikilinks and heading anchors, structure
// against STYLE.md, footnotes, word counts, and (with --urls) every external link's HTTP status.
//
//   node .tools/check.mjs          structure and links
//   node .tools/check.mjs --urls   also fetch every external URL
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTopics } from './manifest.mjs';

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const problems = [];
const warn = (file, msg) => problems.push(`${path.relative(VAULT, file).replace(/\\/g, '/')}: ${msg}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(md|canvas)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(VAULT);
const byName = new Map(files.map(f => [path.basename(f).replace(/\.md$/, ''), f]));
const stripCode = s => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const headingsOf = f => [...stripCode(read(f)).matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
const norm = h => h.toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- Wikilinks in every note and canvas ----------
let links = 0;
for (const f of files) {
  const s = f.endsWith('.canvas') ? JSON.parse(read(f)).nodes.map(n => n.text ?? '').join('\n') : stripCode(read(f));
  for (const m of s.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    links++;
    const inner = m[1].replace(/\\\|/g, '|');
    const [target] = inner.split('|');
    const [name, heading] = target.split('#');
    const dest = name === '' ? f : byName.get(name.trim());
    if (!dest) { warn(f, `broken link [[${target}]]`); continue; }
    if (heading && dest.endsWith('.md') && !headingsOf(dest).some(h => norm(h) === norm(heading)))
      warn(f, `missing heading [[${target}]]`);
  }
}

// ---------- Topic notes against STYLE.md ----------
const BASICS = ['🧠 Think of it like…', 'What it is', 'Why it matters', 'How it works', 'A real-world example', 'Myths and pitfalls', 'Check yourself', 'Key terms', '🧱 Builds on', 'Related', '📚 Sources'];
const DEEP = ['How it really works', 'Design choices and trade-offs', 'Numbers worth knowing', 'Failure modes', 'In the real world', 'In a design interview', '🧱 Builds on', 'Check yourself', 'Further reading', 'Related', '📚 Sources'];
const SOURCE_LINE = /^\[\^\d+\]: (📄|🔬|📝|📘|🎓|🎥|📖) \[[^\]]+\]\(https:\/\/[^)\s]+\) — .+\. Checked 2026-\d\d\.$/;

function words(s) {
  return s.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '').replace(/^\[\^[^\]]+\]:.*$/gm, '')
    .replace(/^>\s*\[![^\]]+\][-+]?/gm, '').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*|`-]/g, ' ').split(/\s+/).filter(w => /\w/.test(w)).length;
}

const stats = { notes: 0, missing: 0, basicsWords: [], deepWords: [] };
const urls = new Map();
for (const t of allTopics()) for (const isDeep of [false, true]) {
  const name = isDeep ? `${t.title} (Deep Dive)` : t.title;
  const f = path.join(VAULT, t.folder, `${name}.md`);
  if (!fs.existsSync(f)) { stats.missing++; warn(f, 'missing'); continue; }
  stats.notes++;
  const s = read(f);
  const fm = s.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) { warn(f, 'no frontmatter'); continue; }
  for (const key of ['aliases', 'tags', 'level', 'part', 'section', isDeep ? 'basics' : 'deep_dive', 'reading_time', 'last_verified'])
    if (!new RegExp(`^${key}:`, 'm').test(fm[1])) warn(f, `frontmatter lacks ${key}`);
  const body = stripCode(s);
  if (/^# /m.test(body)) warn(f, 'has an H1');
  const expected = (isDeep ? DEEP : BASICS).filter(h => h !== '🧱 Builds on' || t.part.title.startsWith('Part 2'));
  const h2 = [...body.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
  const seen = h2.filter(h => expected.includes(h));
  const lacking = expected.filter(h => !h2.includes(h));
  if (lacking.length) warn(f, `lacks headings: ${lacking.join(', ')}`);
  else if (seen.join('|') !== expected.join('|')) warn(f, `headings out of order: ${seen.join(' / ')}`);
  if (!/^> \[!tldr\]/m.test(s)) warn(f, 'no tldr callout');
  if (!isDeep && !/```mermaid/.test(s)) warn(f, 'no Mermaid diagram');
  if (!isDeep && !/^> \[!deepdive\]/m.test(s)) warn(f, 'no go-deeper callout');
  if (isDeep && !/\n\|[^\n]*\|\n\|\s*-{3}/.test(s)) warn(f, 'no table');
  // Footnotes.
  const refs = new Set([...s.replace(/^\[\^[^\]]+\]:.*$/gm, '').matchAll(/\[\^([^\]]+)\]/g)].map(m => m[1]));
  const defs = [...s.matchAll(/^\[\^([^\]]+)\]:(.*)$/gm)];
  const defIds = new Set(defs.map(m => m[1]));
  for (const r of refs) if (!defIds.has(r)) warn(f, `footnote [^${r}] has no definition`);
  for (const d of defIds) if (!refs.has(d)) warn(f, `footnote [^${d}] is never referenced`);
  const bad = defs.filter(m => !SOURCE_LINE.test(m[0].trim()));
  if (bad.length) warn(f, `${bad.length} source line(s) off-format, e.g. ${bad[0][0].slice(0, 90)}`);
  if (defIds.size < (isDeep ? 5 : 3)) warn(f, `only ${defIds.size} sources`);
  const n = words(s);
  (isDeep ? stats.deepWords : stats.basicsWords).push(n);
  if (isDeep ? n < 1100 || n > 2600 : n < 400 || n > 950) warn(f, `${n} words`);
}

for (const f of files) if (f.endsWith('.md'))
  for (const m of read(f).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const u = m[1];
    if (!urls.has(u)) urls.set(u, new Set());
    urls.get(u).add(path.basename(f, '.md'));
  }

// ---------- External URLs ----------
const urlReport = { ok: 0, blocked: [], dead: [] };
if (process.argv.includes('--urls')) {
  const list = [...urls.keys()];
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const u = list[i++];
      let status = 0;
      for (const method of ['HEAD', 'GET']) {
        try {
          const r = await fetch(u, { method, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/pdf,*/*' }, signal: AbortSignal.timeout(25000) });
          status = r.status;
          if (r.ok) break;
        } catch (e) { status = status || -1; }
      }
      if (status >= 200 && status < 400) urlReport.ok++;
      else if ([401, 403, 429, 999].includes(status)) urlReport.blocked.push(`${status} ${u}`);
      else urlReport.dead.push(`${status} ${u}  (in ${[...urls.get(u)].join(', ')})`);
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
}

// ---------- Report ----------
const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
console.log(`files: ${files.length} · wikilinks: ${links} · topic notes: ${stats.notes} (missing ${stats.missing}) · external URLs: ${urls.size}`);
console.log(`avg words: basics ${avg(stats.basicsWords)}, deep dives ${avg(stats.deepWords)}`);
if (process.argv.includes('--urls')) {
  console.log(`URLs ok: ${urlReport.ok} · blocked to scripts (check by hand): ${urlReport.blocked.length} · dead: ${urlReport.dead.length}`);
  if (urlReport.blocked.length) console.log('blocked:\n  ' + urlReport.blocked.join('\n  '));
  if (urlReport.dead.length) console.log('dead:\n  ' + urlReport.dead.join('\n  '));
}
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log('  ' + p);
process.exitCode = problems.length || urlReport.dead.length ? 1 : 0;
