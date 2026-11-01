# Writer's style guide

Read this whole file before writing. The exemplar pair — `Part 1 System Design/3 Scalability/Performance/Caching.md`
and `Caching (Deep Dive).md` — shows every rule below applied. Match its shape, tone and length.

## Who reads this vault

- **Basics notes:** someone with no tech background (a manager, a designer, a curious student). They must finish
  the note understanding the idea and able to explain it to a friend.
- **Deep dives:** an engineer who wants the real mechanics, the numbers, the trade-offs and the interview angle.

## Files

- Each topic is two notes in the folder the manifest gives: `<Title>.md` and `<Title> (Deep Dive).md`.
- Titles are fixed by `.tools/manifest.mjs`. Never rename, never add new notes, never touch hub notes,
  paths, maps, `00 Start Here`, `Glossary` or `Sources Index`: scripts generate those.
- UTF-8, LF line endings, no trailing whitespace. The file starts with the frontmatter (`---` on line 1).

## Frontmatter

Basics:

```yaml
---
aliases: [<every alias from the manifest, in order>]
tags: [level/basics, part/1, section/<section-slug>, branch/<branch-slug>]
level: Basics
part: "[[Part 1 System Design]]"
section: "[[Scalability]]"
branch: "[[Performance]]"
deep_dive: "[[Caching (Deep Dive)]]"
reading_time: 5 min
last_verified: 2026-11-01
---
```

Deep dive: same, but `aliases: [<Title> deep dive]`, `tags: [level/deep-dive, ...]`, `level: Deep Dive`,
and `basics: "[[<Title>]]"` instead of `deep_dive`.

- Slugs are lowercase with hyphens: `section/scalability`, `branch/data-and-storage`, `section/the-12-ribs`.
- Part 2 topics have no branch: drop `branch:` and the `branch/` tag; use `part/2`.
- `reading_time` = words / 200, rounded up, in minutes.

## Fixed headings

Use exactly these H2 headings, in this order, with these emoji. Other notes link to them by name, so they never
change. You may add H3s under any of them. Do **not** add an H1: Obsidian shows the filename as the title.

**Basics**

1. *(no heading)* a `> [!tldr] In one sentence` callout, first thing after the frontmatter
2. `## 🧠 Think of it like…` — opens with an `> [!analogy]` callout holding an everyday analogy, then 1–2 short paragraphs mapping the analogy back to the real thing
3. `## What it is`
4. `## Why it matters`
5. `## How it works` — must contain one Mermaid diagram
6. `## A real-world example` — a named, real company or product, with a source
7. `## Myths and pitfalls` — 3–4 bullets, each `**❌ Myth:** … **✅ Reality:** …`
8. `## Check yourself` — 3 questions as folded callouts: `> [!question]- The question?` then `> The answer.`
9. `## Key terms` — 4–8 bullets, `**Term** — plain-English definition.`
10. `## 🧱 Builds on` — **Part 2 topics only**: one bullet per Part 1 topic in the manifest's BUILDS_ON list, saying in one line how this topic uses it
11. *(no heading)* the go-deeper callout: `> [!deepdive] Ready for the technical take?` then one line naming 3–5 things the deep dive covers, then `> → [[<Title> (Deep Dive)]]`
12. `## Related` — 3–6 bullets `[[Other Topic]] — why it connects.`
13. `## 📚 Sources` — the footnote definitions

**Deep dive**

1. *(no heading)* `> [!tldr] For engineers` — 2–4 sentences, dense
2. `> [!basics]- New to this? Start with the basics` then `> [[<Title>]] explains it with no jargon.`
3. `## How it really works`
4. `## Design choices and trade-offs` — must include a Markdown table
5. `## Numbers worth knowing` — a table or list of real figures, each with a footnote
6. `## Failure modes` — what goes wrong in production and how teams defend against it
7. `## In the real world` — named systems, tools, company engineering write-ups
8. `## In a design interview` — what to say, what interviewers probe, a short answer skeleton
9. `## 🧱 Builds on` — **Part 2 topics only**, as in basics but naming the deeper mechanism used
10. `## Check yourself` — 3 harder folded questions
11. `## Further reading` — 3–6 curated links, each `- 📘 [Title](url) — one line on why it is worth it.` These are recommendations; they don't need footnotes, but every URL must be one you fetched.
12. `## Related` — wikilinks, prefer deep dives: `[[Replication (Deep Dive)]]`
13. `## 📚 Sources`

The scripts add a breadcrumb at the top and a prev/next callout before `## 📚 Sources`. Don't write either.

## Writing

**Basics**
- 450–800 words (not counting frontmatter and sources). Short sentences: aim for under 20 words.
- Write to "you". Active voice. One idea per paragraph, paragraphs of 1–3 sentences.
- Explain every technical word the first time it appears, in the same sentence. If a word needs more than a
  clause to explain, it belongs in the deep dive instead.
- No code. Numbers only when they make the idea vivid ("a few milliseconds instead of a few seconds").
- Bold the 3–6 most important phrases so a skimmer gets the gist.

**Deep dive**
- 1,200–2,200 words. Precise vocabulary is welcome; still prefer plain words when they are as exact.
- Code, config or pseudocode where it clarifies (short, fenced, with a language tag).
- Every number, benchmark, date or "company X does Y" claim gets a footnote.

**Both**
- Mermaid: `flowchart LR` or `flowchart TD` or `sequenceDiagram`, ≤ 10 nodes. Quote any label with spaces or
  punctuation: `A["User's phone"]`. No HTML, no `style`/`classDef` lines, no emoji inside Mermaid.
- Callouts available: `tldr`, `analogy`, `deepdive`, `basics`, `question`, `example`, `tip`, `warning`, `info`.
- No first-person ("I", "we") and no "In this note we will…". Start with substance.
- American English spelling.

## Links

- Wikilinks only to titles in the manifest (topics, `<Title> (Deep Dive)`, hubs, `Glossary`) — exact spelling and case.
  The list of allowed titles is in your prompt. Anything else is a broken link.
- Link a topic the first time it is mentioned in a section; don't link the same topic twice in one paragraph.
- Display text is fine: `[[Load Balancing|load balancers]]`.
- External links use Markdown: `[text](https://…)`. Only `https://` URLs.

## Sources (the most important rule)

- **Research on the web before writing.** Use WebSearch to find sources and WebFetch to read them.
- **Cite only pages you fetched in this task and that support the sentence they are attached to.** Never cite a
  URL from memory. If you can't fetch it, don't cite it.
- Prefer, in order: official docs and standards (RFCs, vendor docs), original papers, engineering blogs of the
  company that built the thing, well-known books' publisher pages, respected courses, then Wikipedia (fine as an
  extra, never as the only source of a claim).
- Basics: at least 3 distinct sources. Deep dive: at least 5. Every footnote must be referenced in the text at
  least once (Obsidian hides unreferenced footnotes).
- Footnote IDs are numbers, `[^1]`, `[^2]`, …, numbered in order of first use.
- Format, one per line under `## 📚 Sources`:

```
[^1]: 📄 [Page title](https://url) — Publisher. Official docs. Checked 2026-11.
```

Type emoji: 📄 official docs or standard · 🔬 paper · 📝 article or engineering blog · 📘 book ·
🎓 course · 🎥 video or talk · 📖 encyclopedia (Wikipedia).
