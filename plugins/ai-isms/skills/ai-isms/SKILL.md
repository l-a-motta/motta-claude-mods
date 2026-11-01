---
name: ai-isms
description: Write or revise prose without the habits that mark text as machine-made.
disable-model-invocation: true
---

# AI-isms

Some habits mark prose as machine-written: the corrective "it's not X, it's Y", a trailing "highlighting the importance of…", three lessons that stand out, a bold header on every bullet. Treat each one as a cue for editorial judgment. When you notice one, ask what it stands in for. Usually it is filling the place of something specific you haven't said, and the fix is to say that thing. When the device does real work (a contrast the reader needs, three items that really are three), keep it.

The habit is a symptom. Swapping "delve" for "explore" leaves the sentence as empty as it was, and writers told to drop a word drift to its synonyms. Fix what sits underneath: say what was found, by how much, compared with what.

No habit here proves who wrote something; people use every one of them. Use this to edit your own and others' prose on request, never to judge whether a person used AI.

When drafting, write by "Write it this way" and check the draft against "The tells that come up most" and, for change notes, "Commits, PRs and status updates". The full catalog pass in "Revising a draft" is for a draft someone hands you, or when you're asked to remove AI tells.

## Write it this way

1. **Lead with the point.** The first sentence says what happened, what you found or what you recommend.
2. **Be specific.** Names, numbers, versions, dates, paths, the exact error. "Cold start went from 4.1 s to 1.2 s in v2.3" carries what "significantly improved performance" only gestures at.
3. **Use plain words.** `is`, `has`, `use`, `show`, `help`, `then`, `also`, `but`, `so`. "Serves as" is "is"; "utilize" is "use"; "facilitate" is "help".
4. **Name the real relation.** "Calls", "replaced", "was CEO of", "fails when". If you don't know the relation, say that.
5. **Back each effect with evidence.** A consequence gets its own sentence with what shows it, or it goes.
6. **State the true thing directly.** If the reader is likely to hold the wrong view, give the correct claim first and mention the wrong one after it, briefly.
7. **Hedge once, where the doubt is,** and say what it rests on: "probably the cache; I haven't reproduced it."
8. **Count what is there.** Two reasons are two. One example can stand alone.
9. **Format only when it helps.** Reasoning reads best as prose, because the connectives (because, so, unless) carry it. Use a list for parallel steps or options, bold for the one thing the reader must not miss, and headers only for documents long enough to navigate.
10. **Let rhythm follow content.** Mix short and long sentences, with a parenthesis or a colon where it fits. "Very", "perhaps", "there is", "it has" and a plain superlative ("the only", "the first") are normal human writing.

Overcorrecting is a tell too. Text stripped of every qualifier, dash and transition reads as flat 8-to-20-word sentences joined by commas and periods, and newer models already produce that. Aim for a person explaining something they know well.

## The tells that come up most

Each line names the tell and the move. [references/catalog.md](references/catalog.md) has the full set.

1. **Corrective antithesis** in all its forms: "not X, but Y", "not just X, it's Y", "Y rather than X". Say Y. Keep the contrast only when the reader actually holds X, and then put Y first.
   - Draft: "The bug isn't in the parser; it's in how the tokenizer handles CRLF."
   - Edited: "The tokenizer keeps the `\r` from CRLF endings, and the parser chokes on it."
   - If the reviewer had blamed the parser: "The tokenizer keeps the `\r` from CRLF endings, so the parser is fine; it just receives the stray character."
2. **A misconception nobody raised, then the reveal,** or a defence against an objection nobody made ("That is not an omission"). Give the reason directly.
3. **A trailing "-ing" clause claiming an effect:** ", ensuring robustness", ", highlighting the need for…". State the effect with its evidence, or cut the clause.
4. **Announcing importance:** "It's worth noting", "Importantly,", "This matters because", "The key insight is". Say the thing; its consequence shows the importance.
5. **Inflated words:** robust, seamless, comprehensive, crucial, pivotal, leverage, utilize, enhance, delve, underscore, showcase. Use the plain word or a number.
6. **Counted packages and reflex triplets:** "Three things stand out", "fast, reliable, and scalable". List what exists, in the number it exists.
7. **Slogan and tutorial headings:** "Structure beats tuning", "Why it matters", "What this means". Use a heading that names the content, in sentence case.
8. **Reflex hedges and scope disclaimers:** "based on the files I reviewed", "does not by itself establish", "should be treated as a starting point", "could potentially". Keep one hedge that carries real uncertainty, where it applies.
9. **The chat wrapper:** an opener ("Great question", "You're absolutely right", "Certainly! Here's…"), a closing menu ("Let me know if you'd like me to A, B or C"), a recap ("In summary"). Start with the answer and stop when it is done. Ask at most one question, and only when you need the answer.
10. **Formatting confetti:** bold scattered through prose, "**Label:** text" bullets, headers on a five-line reply, emoji markers, a three-row table, an em dash as the default joint between clauses. Write the paragraph.

## Commits, PRs and status updates

Change notes have their own tells, and they are the ones a coding agent produces most:

- **Stacked assurances:** "improved clarity, ensured consistency, enhanced maintainability". One change rarely does all three. Name what changed and why.
- **What you kept:** "while preserving existing behavior". Mention it when a reviewer would doubt it, such as a refactor of a public API, and say how you checked.
- **Content-free nouns:** "added tests", "updated docs". Say what is now tested or documented: "tests for the empty-cart and expired-coupon paths".
- **An inventory of identifiers** in place of intent. Say the intent; the diff already lists the files.
- **"Address review feedback"** with nothing after it. Say what the reviewer asked for and what you did.
- **Self-certification:** "This PR fully addresses the requirements and follows best practices." Say what you verified and how.

## By medium

| Medium | What fits |
| --- | --- |
| Commit subject | Imperative and compressed by convention ("Fix CRLF handling in tokenizer"). No period, no adjectives. |
| Commit body, PR description | Prose: what changed, why, how it was checked, what is left. A list only for separate changes or steps. Keep the headers a repo's PR template asks for. |
| Chat or Slack reply | The answer first, no headers, little or no bold, at most one question. Match the channel's register and emoji habits. |
| Docs, README | Headers and lists earn their place in reference material. Explanations stay prose. |
| Email | Plain text where Markdown won't render. A greeting and sign-off are normal; skip the "I hope this finds you well" filler. |

## Revising a draft

1. **Find the point.** Write down, for yourself, the one claim or decision the draft makes. If there isn't one, the problem is content: fix that before touching style.
2. **Check the draft against every entry in [references/catalog.md](references/catalog.md).** For each hit, decide: cut it, replace it with the specific thing it stood in for, or keep it because it carries the point. A claim nothing backs (a "fully addresses the requirements", a "significant improvement") goes, unless it is central; then ask the author for the evidence.
3. **Read the result as its recipient.** Check that the edits added no new tells, such as flat monotone sentences where the dashes used to be, and that every fact, number and caveat that mattered survived.
4. **Hand back the edited text.** "Clean up", "fix", "polish" and "edit" ask for the edited text: give it, and explain only the few changes that alter what the text claims. "Review" and "feedback" ask for comments: quote each passage and offer a rewrite.

Done when every catalog entry has been checked, every hit has a decision, and the point from step 1 sits in the first or second sentence.

Sources and evidence for all of this are in [references/sources.md](references/sources.md).
