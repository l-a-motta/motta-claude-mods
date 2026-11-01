// Generates everything in the vault that follows from the manifest: hubs, learning paths, breadcrumbs and
// prev/next navigation in every topic note, the glossary, the sources index, both Canvas maps, bookmarks and
// the starting workspace. Safe to run again: it rewrites what it owns and leaves the writers' prose alone.
//
//   node .tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTS, PATHS, RIB_NUMBERS, allTopics, allHubs } from './manifest.mjs';

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = '[[00 Start Here|🏠 Home]]';
const topics = allTopics();
const hubs = allHubs();
const byTitle = Object.fromEntries(topics.map(t => [t.title, t]));

const read = p => fs.readFileSync(path.join(VAULT, p), 'utf8').replace(/\r\n/g, '\n');
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true });
  fs.writeFileSync(path.join(VAULT, p), s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
};
const exists = p => fs.existsSync(path.join(VAULT, p));
const deep = t => `${t} (Deep Dive)`;
const cell = s => s.replace(/\|/g, '\\|'); // a pipe inside a table cell, e.g. a wikilink alias
const partNo = part => PARTS.indexOf(part) + 1;
const shortPart = part => `Part ${partNo(part)}`;

// ---------- Course order: Part 1 then Part 2, manifest order ----------
const course = topics.map(t => t.title);

// ---------- Breadcrumbs and prev/next in topic notes ----------
function crumbs(t, isDeep) {
  const parts = [HOME, `[[${t.part.title}|${shortPart(t.part)}]]`, `[[${t.section.title}]]`];
  if (t.branch) parts.push(`[[${t.branch.title}]]`);
  if (isDeep) parts.push(`[[${t.title}]]`, '🔬 Deep Dive');
  else parts.push(t.title);
  return `> [!crumbs] ${parts.join(' › ')}`;
}

function navCallout(t, isDeep) {
  const i = course.indexOf(t.title);
  const prev = course[i - 1], next = course[i + 1];
  const link = x => (isDeep ? `[[${deep(x)}|${x}]]` : `[[${x}]]`);
  const home = `[[${t.branch?.title ?? t.section.title}|${t.branch ? t.branch.icon : t.section.icon} ${t.branch?.title ?? t.section.title}]]`;
  const row = [prev ? `← ${link(prev)}` : null, home, next ? `${link(next)} →` : null].filter(Boolean).join(' · ');
  const other = isDeep ? `🌱 Back to the basics: [[${t.title}]]` : `🔬 Technical take: [[${deep(t.title)}]]`;
  return `> [!nav] Keep going\n> ${row}\n> ${other} · 🗺️ [[Glossary]]`;
}

function decorateTopic(t, isDeep) {
  const file = `${t.folder}/${isDeep ? deep(t.title) : t.title}.md`;
  if (!exists(file)) return { file, missing: true };
  let s = read(file);
  const fm = s.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) return { file, error: 'no frontmatter' };
  let body = s.slice(fm[0].length);
  // Remove what an earlier run added, then add it again.
  body = body.replace(/^\s*> \[!crumbs\][^\n]*\n+/, '');
  body = body.replace(/\n> \[!nav\] Keep going\n(?:>[^\n]*\n)*\n*/g, '\n');
  body = `${crumbs(t, isDeep)}\n\n${body.replace(/^\n+/, '')}`;
  const nav = navCallout(t, isDeep);
  const at = body.indexOf('\n## 📚 Sources');
  body = at >= 0 ? `${body.slice(0, at).trimEnd()}\n\n${nav}\n${body.slice(at)}` : `${body.trimEnd()}\n\n${nav}\n`;
  write(file, fm[0] + body.trimEnd() + '\n');
  return { file };
}

// ---------- Hubs ----------
function topicTable(list, { ribs = false } = {}) {
  const head = ribs ? '| # | Topic | In one line | Technical take |\n| --- | --- | --- | --- |' : '| Topic | In one line | Technical take |\n| --- | --- | --- |';
  const rows = list.map(t => {
    const cols = [`[[${t.title}]]`, t.summary, cell(`[[${deep(t.title)}|🔬 Deep dive]]`)];
    if (ribs) cols.unshift(`**${RIB_NUMBERS[t.title]}**`);
    return `| ${cols.join(' | ')} |`;
  });
  return `${head}\n${rows.join('\n')}`;
}

const mm = s => s.replace(/"/g, "'");
function sectionDiagram(section) {
  const lines = ['```mermaid', 'flowchart LR'];
  lines.push(`    S["${mm(section.title)}"]`);
  const groups = section.branches ?? [{ title: null, topics: section.topics }];
  groups.forEach((b, bi) => {
    let parent = 'S';
    if (b.title) { lines.push(`    S --> B${bi}["${mm(b.title)}"]`); parent = `B${bi}`; }
    b.topics.forEach(([title], ti) => lines.push(`    ${parent} --> T${bi}_${ti}["${mm(title)}"]`));
  });
  lines.push('```');
  return lines.join('\n');
}

function partHub(part) {
  const n = partNo(part);
  const other = PARTS[n === 1 ? 1 : 0];
  const first = topics.find(t => t.part === part);
  const sections = part.sections.map(s => {
    const inner = s.branches
      ? s.branches.map(b => `- ${b.icon} [[${b.title}]] — ${b.blurb}`).join('\n')
      : s.topics.map(([title, , summary]) => `- [[${title}]] — ${summary}`).join('\n');
    return `### ${s.icon} [[${s.title}]]\n${s.blurb}\n\n${inner}`;
  }).join('\n\n');
  const map = n === 1 ? '[[System Design Map.canvas|🗺️ System Design Map]]' : '[[AI Umbrella Map.canvas|☂️ AI Umbrella Map]]';
  return `---
tags: [hub, part/${n}]
aliases: ["${part.label}"]
---
> [!crumbs] ${HOME} › ${shortPart(part)}

> [!hub] ${part.icon} ${part.label}
> ${part.blurb}

${n === 1
    ? 'Everything here applies to **any** large software system: a shop, a bank, a streaming service. Part 2 builds directly on it: the umbrella\'s handle is made of these ideas.'
    : 'An AI system is still a software system, so it stands on everything in [[Part 1 System Design|Part 1]]. Each note here has a **🧱 Builds on** section pointing back to the basics it relies on.'}

**See it as a picture:** ${map}

## What's inside

${sections}

## Where to start

Begin with [[${first.title}]] and follow the **Keep going** box at the end of each note. Or pick a guided route in [[00 Start Here#🧭 Pick a path|the learning paths]].

## The other part

${other.icon} [[${other.title}|${other.label}]] — ${other.blurb}
`;
}

function sectionHub(part, section) {
  const n = partNo(part);
  const isRibs = section.title === 'The 12 Ribs';
  const list = topics.filter(t => t.section === section);
  const content = section.branches
    ? section.branches.map(b => `### ${b.icon} [[${b.title}]]\n${b.blurb}\n\n${topicTable(list.filter(t => t.branch === b))}`).join('\n\n')
    : topicTable(list, { ribs: isRibs });
  return `---
tags: [hub, part/${n}]
---
> [!crumbs] ${HOME} › [[${part.title}|${shortPart(part)}]] › ${section.title}

> [!hub] ${section.icon} ${section.title}
> ${section.blurb}

${isRibs ? 'On the umbrella, each rib is one concern. Take any rib away and the canopy sags: a system with great models but no monitoring, or great serving but no cost control, fails in production. The numbers follow the image, from data on the left to governance on the right.\n\n' : ''}## Topics

${content}

## The shape of it

${sectionDiagram(section)}

> [!tip] How to read these
> Every topic has a **🌱 basics** note (no jargon, about 5 minutes) and a **🔬 deep dive** (the technical take). Start with the basics; open the deep dive when you want more.
`;
}

function branchHub(part, section, branch) {
  const list = topics.filter(t => t.branch === branch);
  return `---
tags: [hub, part/${partNo(part)}]
---
> [!crumbs] ${HOME} › [[${part.title}|${shortPart(part)}]] › [[${section.title}]] › ${branch.title}

> [!hub] ${branch.icon} ${branch.title}
> ${branch.blurb}

## Topics

${topicTable(list)}

## Suggested order

${list.map((t, i) => `${i + 1}. [[${t.title}]] — ${t.summary}`).join('\n')}

Part of ${section.icon} [[${section.title}]] in [[${part.title}|${part.label}]].
`;
}

// ---------- Learning paths ----------
function pathNote(p, i) {
  const lessons = p.lessons === 'part1' ? topics.filter(t => t.part === PARTS[0]).map(t => t.title)
    : p.lessons === 'part2' ? topics.filter(t => t.part === PARTS[1]).map(t => t.title)
      : p.lessons;
  for (const l of lessons) if (!byTitle[l]) throw new Error(`Path ${p.title}: unknown lesson ${l}`);
  let lastSection = null, out = [];
  lessons.forEach((l, k) => {
    const t = byTitle[l];
    if (t.section !== lastSection) { out.push(`\n### ${t.section.icon} ${t.section.title}`); lastSection = t.section; }
    const deepLink = `[[${deep(l)}|🔬 deep dive]]`;
    out.push(`- [ ] **${k + 1}.** [[${l}]] — ${t.summary}${p.deep ? ` Then ${deepLink}.` : ` *(Curious? ${deepLink})*`}`);
  });
  const others = PATHS.filter(o => o !== p).map(o => `- ${o.icon} [[${o.title}]] — ${o.who}`).join('\n');
  return `---
tags: [path]
---
> [!crumbs] ${HOME} › Learning Paths › ${p.title.replace(/^Path \d+ - /, '')}

> [!path] ${p.icon} ${p.title.replace(/^Path \d+ - /, '')}
> **Who it's for:** ${p.who}
> **Time:** ${p.time} · **Lessons:** ${lessons.length}
> **Goal:** ${p.goal}

## How to take this path

- Go top to bottom. Each lesson is one note; ${p.deep ? 'read the 🌱 basics note, then its 🔬 deep dive.' : 'the 🌱 basics notes take about 5 minutes each.'}
- **Tick the box** when you finish a lesson. Obsidian saves it, so you can stop and come back.
- Each note ends with **Check yourself** questions. Try them before peeking at the answers.
- Stuck on a word? Hover it, or look it up in the [[Glossary]].

## Lessons
${out.join('\n')}

## Other paths

${others}
`;
}

// ---------- Glossary ----------
function glossary() {
  const file = path.join(VAULT, '.tools', 'glossary.json');
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const entries = new Map();
  const add = (term, definition, topic) => {
    term = term.trim();
    const k = term.toLowerCase();
    if (!byTitle[topic] || entries.has(k)) return;
    entries.set(k, { term, definition: definition.trim().replace(/\s+/g, ' '), topic });
  };
  for (const t of topics) add(t.title, t.summary, t.title); // every topic title is a glossary entry
  for (const e of raw) add(e.term, e.definition, e.topic);
  // Sort and group by the first letter or digit, so ".proto file" files under P.
  const key = e => e.term.replace(/^[^A-Za-z0-9]+/, '');
  const sorted = [...entries.values()].sort((a, b) => key(a).localeCompare(key(b), 'en', { sensitivity: 'base' }));
  const letterOf = e => { const c = key(e)[0].toUpperCase(); return /[A-Z]/.test(c) ? c : '0–9'; };
  const letters = [...new Set(sorted.map(letterOf))];
  const sections = letters.map(L => `## ${L}\n\n${sorted.filter(e => letterOf(e) === L).map(e =>
    `- **${e.term}** — ${e.definition}${e.term === e.topic ? '' : ` → [[${e.topic}]]`}`).join('\n')}`).join('\n\n');
  write('Glossary.md', `---
tags: [reference]
aliases: [dictionary, terms, definitions, A-Z]
---
> [!crumbs] ${HOME} › Glossary

> [!tip] ${sorted.length} terms, A to Z
> Each term has a one-line, plain-English definition and an arrow to the note that explains it. Press **Ctrl/Cmd + F** to find a word on this page.

**Jump to:** ${letters.map(L => `[[#${L}|${L}]]`).join(' · ')}

${sections}
`);
  return sorted.length;
}

// ---------- Sources index ----------
const TYPE_NAMES = { '📄': 'Official docs and standards', '🔬': 'Papers', '📝': 'Articles and engineering blogs', '📘': 'Books', '🎓': 'Courses', '🎥': 'Videos and talks', '📖': 'Encyclopedias' };
function sourcesIndex() {
  const byUrl = new Map();
  for (const t of topics) for (const isDeep of [false, true]) {
    const name = isDeep ? deep(t.title) : t.title;
    const file = `${t.folder}/${name}.md`;
    if (!exists(file)) continue;
    for (const m of read(file).matchAll(/^\[\^[^\]]+\]:\s*(\S+)\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:—\s*(.*))?$/gm)) {
      const [, emoji, title, url, rest = ''] = m;
      const publisher = rest.split('.')[0].trim();
      const e = byUrl.get(url) ?? { emoji, title, url, publisher, notes: new Set() };
      e.notes.add(name);
      byUrl.set(url, e);
    }
  }
  const all = [...byUrl.values()];
  const groups = Object.keys(TYPE_NAMES).map(em => {
    const list = all.filter(e => e.emoji === em).sort((a, b) => a.title.localeCompare(b.title));
    if (!list.length) return '';
    return `## ${em} ${TYPE_NAMES[em]} (${list.length})\n\n${list.map(e =>
      `- [${e.title}](${e.url})${e.publisher ? ` — ${e.publisher}` : ''} · cited in ${[...e.notes].map(n => `[[${n}]]`).join(', ')}`).join('\n')}`;
  }).filter(Boolean).join('\n\n');
  write('Sources Index.md', `---
tags: [reference]
aliases: [bibliography, references, sources]
---
> [!crumbs] ${HOME} › Sources Index

> [!info] Every source this vault cites, in one place
> ${all.length} distinct sources. Each was opened and read when its note was written or fact-checked (November 2026). The type marker tells you what kind of source it is:
> 📄 official docs or standard · 🔬 paper · 📝 article or engineering blog · 📘 book · 🎓 course · 🎥 video or talk · 📖 encyclopedia

${groups}
`);
  return all.length;
}

// ---------- Canvas maps ----------
let idSeq = 0;
const nid = () => `n${(++idSeq).toString(16).padStart(6, '0')}`;
const text = (x, y, w, h, t, color) => ({ id: nid(), type: 'text', text: t, x, y, width: w, height: h, ...(color ? { color } : {}) });
const edge = (a, b, fromSide = 'right', toSide = 'left') => ({ id: nid(), fromNode: a.id, fromSide, toNode: b.id, toSide });

function systemDesignMap() {
  idSeq = 0;
  const nodes = [], edges = [];
  const part = PARTS[0];
  const ROW = 100, TOPIC_W = 420, TOPIC_H = 84;
  let y = 0;
  const pillarNodes = [];
  for (const s of part.sections) {
    const branchNodes = [];
    const top = y;
    for (const b of s.branches) {
      const btop = y;
      const tnodes = b.topics.map(([title, , summary]) => {
        const n = text(1240, y, TOPIC_W, TOPIC_H, `**[[${title}]]**\n${summary}`, s.color);
        y += ROW; nodes.push(n); return n;
      });
      const bn = text(780, (btop + y - ROW) / 2, 300, 64, `### ${b.icon} [[${b.title}]]`, s.color);
      nodes.push(bn); branchNodes.push(bn);
      tnodes.forEach(t => edges.push(edge(bn, t)));
      y += 30;
    }
    const pn = text(360, (top + y - ROW - 30) / 2 - 10, 300, 84, `## ${s.icon} [[${s.title}]]`, s.color);
    nodes.push(pn); pillarNodes.push(pn);
    branchNodes.forEach(b => edges.push(edge(pn, b)));
    y += 60;
  }
  const root = text(-120, (y - 60) / 2 - 60, 320, 120, `# 🏗️ [[Part 1 System Design|System Design]]\nClick any box to open its note.`);
  nodes.push(root);
  pillarNodes.forEach(p => edges.push(edge(root, p)));
  const legend = text(-120, -260, 520, 200, `## 🗺️ System Design Map\nThe four pillars of system design, as in the tree. **Click a name** to open the 🌱 basics note; each one links to its 🔬 deep dive.\n\nNext: [[AI Umbrella Map.canvas|☂️ AI Umbrella Map]] · ${HOME}`);
  nodes.push(legend);
  return { nodes, edges };
}

function aiUmbrellaMap() {
  idSeq = 0;
  const nodes = [], edges = [];
  const [foundations, blocks, ribs, llm, capstone] = PARTS[1].sections;
  const W = 230, GAP = 20, N = 12, SPAN = N * (W + GAP);
  // Title and legend.
  nodes.push(text(SPAN / 2 - 360, -900, 720, 150, `# ☂️ [[Part 2 AI System Design|AI System Design]]\nThe umbrella: twelve ribs held up by the fundamentals of [[Part 1 System Design|system design]], standing on business goals. **Click any name** to open its note.`));
  // Ingredients above the canopy, flowing in.
  const ingredients = [
    ...blocks.topics.map(([title, , summary]) => [title, summary]),
    ['AI System Design Overview', 'Users & applications: web, mobile, APIs and internal tools.'],
  ];
  const ingNodes = ingredients.map(([title, summary], i) => {
    const n = text(i * (SPAN / ingredients.length) + 40, -680, SPAN / ingredients.length - 80, 110, `**${i === 3 ? '👥 Users & Applications' : '🧩 ' + title}**\n[[${title}]] — ${summary}`, blocks.color);
    nodes.push(n); return n;
  });
  // The canopy: the 12 ribs on an arc.
  const top = text(SPAN / 2 - 200, -480, 400, 70, `## ☂️ [[The 12 Ribs]]`, ribs.color);
  nodes.push(top);
  ingNodes.forEach(n => edges.push(edge(n, top, 'bottom', 'top')));
  const ribNodes = ribs.topics.map(([title], i) => {
    const lift = Math.sin(Math.PI * (i + 0.5) / N) * 160;
    const n = text(i * (W + GAP), -120 - lift, W, 120, `**${i + 1}**\n[[${title}]]`, ribs.color);
    nodes.push(n); edges.push(edge(top, n, 'bottom', 'top')); return n;
  });
  // The handle: fundamentals from Part 1.
  const handle = text(SPAN / 2 - 170, 120, 340, 360, `### 🦯 The handle: fundamentals\n${PARTS[0].sections.map(s => `- ${s.icon} [[${s.title}]]`).join('\n')}\n\nEvery AI note's **🧱 Builds on** section points back here.`);
  nodes.push(handle);
  edges.push(edge(ribNodes[5], handle, 'bottom', 'top'), edge(ribNodes[6], handle, 'bottom', 'top'));
  // Business goals at the base.
  const goals = text(SPAN / 2 - 330, 540, 660, 110, `## 🎯 [[Business Goals & Requirements]]\nUse cases · constraints · success metrics · stakeholders`, foundations.color);
  nodes.push(goals); edges.push(edge(handle, goals, 'bottom', 'top'));
  // Architecture layers.
  const layers = [['Data Layer', 'Ingestion · processing · storage · feature store'], ['Model Layer', 'Training · fine-tuning · registry · evaluation'], ['Serving Layer', 'APIs · inference · load balancing · autoscaling'], ['Monitoring Layer', 'Logs & metrics · drift · alerts · improvement']];
  const LW = 300;
  const layerNodes = layers.map(([name, items], i) => {
    const n = text(SPAN / 2 - (layers.length * (LW + 60)) / 2 + i * (LW + 60), 760, LW, 120, `**[[AI Architecture Layers|${name}]]**\n${items}`, foundations.color);
    nodes.push(n); return n;
  });
  layerNodes.slice(1).forEach((n, i) => edges.push(edge(layerNodes[i], n)));
  nodes.push(text(SPAN / 2 - 300, 690, 600, 50, `### 🏛️ [[AI Architecture Layers]]`, foundations.color));
  // Modern LLM systems on the right, capstone on the left.
  const llmNodes = llm.topics.map(([title, , summary], i) => {
    const n = text(SPAN + 120, -380 + i * 140, 380, 120, `**[[${title}]]**\n${summary}`, llm.color);
    nodes.push(n); return n;
  });
  nodes.push(text(SPAN + 120, -500, 380, 90, `## 🤖 [[Modern LLM Systems]]`, llm.color));
  const cap = text(-520, 120, 400, 180, `## 🎓 [[Capstone - AI Support Assistant|Capstone]]\nOne AI system designed end to end, using every rib.`, capstone.color);
  nodes.push(cap);
  nodes.push(text(-520, -680, 400, 200, `## 📖 Start here\n- [[AI System Design Overview]]\n- [[Business Goals & Requirements]]\n- [[AI Architecture Layers]]\n\nBack: [[System Design Map.canvas|🗺️ System Design Map]] · ${HOME}`, foundations.color));
  edges.push(edge(llmNodes[2], ribNodes[11], 'left', 'right'));
  return { nodes, edges };
}

// ---------- Bookmarks and workspace ----------
function bookmarks() {
  const f = (p, title) => ({ type: 'file', ctime: 1793548800000, path: p, ...(title ? { title } : {}) });
  return {
    items: [
      f('00 Start Here.md', '🏠 Start Here'),
      f('How to Use This Vault.md', '❓ How to Use This Vault'),
      { type: 'group', ctime: 1793548800000, title: '🧭 Learning Paths', items: PATHS.map(p => f(`01 Learning Paths/${p.title}.md`, `${p.icon} ${p.title.replace(/^Path \d+ - /, '')}`)) },
      { type: 'group', ctime: 1793548800000, title: '🗺️ Maps', items: [f('02 Maps/System Design Map.canvas', '🗺️ System Design Map'), f('02 Maps/AI Umbrella Map.canvas', '☂️ AI Umbrella Map')] },
      { type: 'group', ctime: 1793548800000, title: '📚 The two parts', items: PARTS.map(p => f(`${p.title}/${p.title}.md`, `${p.icon} ${p.label}`)) },
      f('Glossary.md', '🔤 Glossary'),
      f('Sources Index.md', '📚 Sources Index'),
    ],
  };
}

function workspace() {
  const leaf = (id, type, state) => ({ id, type: 'leaf', state: { type, state } });
  return {
    main: { id: 'main0', type: 'split', direction: 'vertical', children: [
      { id: 'tabs0', type: 'tabs', children: [leaf('leaf0', 'markdown', { file: '00 Start Here.md', mode: 'preview', source: false })] },
    ] },
    left: { id: 'left0', type: 'split', direction: 'horizontal', width: 300, children: [
      { id: 'ltabs', type: 'tabs', currentTab: 1, children: [
        leaf('fe', 'file-explorer', { sortOrder: 'alphabetical' }),
        leaf('bm', 'bookmarks', {}),
        leaf('sr', 'search', { query: '', matchingCase: false, explainSearch: false, collapseAll: true, extraContext: false, sortOrder: 'alphabetical' }),
      ] },
    ] },
    right: { id: 'right0', type: 'split', direction: 'horizontal', width: 300, collapsed: true, children: [
      { id: 'rtabs', type: 'tabs', children: [
        leaf('ol', 'outline', { file: '00 Start Here.md' }),
        leaf('bl', 'backlink', { file: '00 Start Here.md', collapseAll: true, extraContext: false, sortOrder: 'alphabetical', showSearch: false, searchQuery: '', backlinkCollapsed: false, unlinkedCollapsed: true }),
      ] },
    ] },
    active: 'leaf0',
    lastOpenFiles: ['00 Start Here.md'],
  };
}

// ---------- Run ----------
const report = { decorated: 0, missing: [], errors: [] };
for (const t of topics) for (const isDeep of [false, true]) {
  const r = decorateTopic(t, isDeep);
  if (r.missing) report.missing.push(r.file);
  else if (r.error) report.errors.push(`${r.file}: ${r.error}`);
  else report.decorated++;
}
for (const h of hubs) {
  const file = `${h.folder}/${h.title}.md`;
  if (h.kind === 'part') write(file, partHub(h.part));
  else if (h.kind === 'section') write(file, sectionHub(h.part, h.section));
  else write(file, branchHub(h.part, h.section, h.branch));
}
PATHS.forEach((p, i) => write(`01 Learning Paths/${p.title}.md`, pathNote(p, i)));
const terms = glossary();
const sources = sourcesIndex();
write('02 Maps/System Design Map.canvas', JSON.stringify(systemDesignMap(), null, 2) + '\n');
write('02 Maps/AI Umbrella Map.canvas', JSON.stringify(aiUmbrellaMap(), null, 2) + '\n');
write('.obsidian/bookmarks.json', JSON.stringify(bookmarks(), null, 2) + '\n');
write('.obsidian/workspace.json', JSON.stringify(workspace(), null, 2) + '\n');

console.log(`topic notes decorated: ${report.decorated}/${topics.length * 2}`);
console.log(`hubs: ${hubs.length} · paths: ${PATHS.length} · glossary terms: ${terms} · sources: ${sources}`);
if (report.missing.length) console.log(`missing notes (${report.missing.length}):\n  ${report.missing.join('\n  ')}`);
if (report.errors.length) console.log(`errors:\n  ${report.errors.join('\n  ')}`);
