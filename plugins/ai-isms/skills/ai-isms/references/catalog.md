# Catalog of AI-isms

Every tell the sources document, grouped into families. Each entry gives what to write instead, the signs that mark it, and when the device earns its place. A single occurrence is rarely the problem; a habit repeated across a text, or several from one family together, is. Evidence for each entry is in [sources.md](sources.md).

Contents: [Significance and praise](#significance-and-praise) · [Sentence shapes](#sentence-shapes) · [Vocabulary and register](#vocabulary-and-register) · [Structure and flow](#structure-and-flow) · [Hedging and evidence](#hedging-and-evidence) · [Talking to the reader](#talking-to-the-reader) · [Formatting and punctuation](#formatting-and-punctuation) · [Commits, PRs and change notes](#commits-prs-and-change-notes) · [What is not a tell](#what-is-not-a-tell)

## Significance and praise

### Inflated significance
- Instead: state the contribution and its evidence. A detail that matters shows it through its consequence.
- Signs: "a pivotal/crucial/key moment", "marks a shift", "is a testament to", "sets the stage for", "reflects broader trends", "an evolving landscape", "leaves an indelible mark", "a significant step forward". Even mundane facts get tied to a larger theme.
- Keep when: the significance is the claim and you can support it ("the first release to run on ARM").

### Promotional tone
- Instead: describe it neutrally, with its features in plain terms.
- Signs: "boasts", "vibrant", "rich", "nestled", "in the heart of", "groundbreaking", "renowned", "showcasing", "a diverse array of", "commitment to". The same stock praise whatever the topic.
- Keep when: you are writing marketing copy on purpose, and even then concrete beats adjectives.

### Praise inflation in reviews and feedback
- Instead: praise one specific thing and say why it is good: "the retry handles the partial-write case I would have missed."
- Signs: commendable, meticulous, laudable, ingenious, invaluable, impressive, robust, seamless, elegant, thoughtful; meticulously, seamlessly, effortlessly, elegantly. Praise that would fit under any PR.
- Keep when: never as filler; specific praise is always fine.

### Bleached intensifiers
- Instead: drop the intensifier or replace it with the size: "40% faster", "blocks the release".
- Signs: "crucial" for important, "notably" for very ("notably faster"), "significant" with no statistics, "critical", "key", "vital", "essential" stacked on routine points.
- Keep when: the word has its full sense: a crucial step without which the build fails, a statistically significant result.

### Grand compression claims
- Instead: give the summary without promising it: write the sentence.
- Signs: "The argument in one sentence", "It all comes down to", "In a nutshell", repeated promises of a single explanation.
- Keep when: a long document whose point really fits one line, said once.

### Results turned into morals
- Instead: end on the result and what it means for this case.
- Signs: a specific calculation followed by a general admonition: "more compute is not always better", "this adds another discipline", "the lesson here is".
- Keep when: the reader asked what general rule follows.

### Moralised precision
- Instead: name the property: unbiased, calibrated, held-out, reproducible.
- Signs: "honest constants", "honest validation", "an honest estimate", "be honest about".
- Keep when: honesty itself is the subject.

## Sentence shapes

### Corrective antithesis
- Instead: state the true thing. If the reader holds the wrong view, give the correct claim first and the denied one after it in a clause, or drop it.
- Signs: "It's not X, it's Y", "not X but Y", "not just X, but also Y", "not only… but…", "no X, no Y, just Z", and the newer reversed form "Y rather than X". Measured at several times the human rate; the most recognised tell.
- Keep when: the reader actually believes X and the correction is the news; once per piece is usually enough. A before-and-after in a change note ("used to show a blank page; now redirects to /login") reports a change and is fine.

### A misconception nobody raised, then the reveal
- Instead: explain it straight. "Ridge shrinks coefficients toward zero, which also stabilises collinear fits" in place of "Ridge is often seen as a fix for collinearity. That picture is incomplete."
- Signs: "X is often described as… That description is incomplete", "Many assume… In fact", "It's tempting to think…".
- Keep when: the misconception is real, common among your readers, and you can name where it comes from.

### Defending against an objection nobody made
- Instead: give the reason directly: "The function skips nulls because the caller filters them" in place of "This is not an omission."
- Signs: "That is not an omission", "This is not a contradiction", "This isn't a bug", "To be clear,".
- Keep when: someone did raise it.

### Mirror sentences
- Instead: state each half with its own qualifications, in its own sentence if they differ.
- Signs: two clauses built on the same frame for a tidy symmetry: "Attention retrieves from the context, and the MLP retrieves from the training data." The symmetry makes the claim cleaner than the facts allow.
- Keep when: the parallel is exact and the parallelism helps the reader compare.

### Trailing "-ing" effect clauses
- Instead: put the effect in its own sentence with what shows it, or cut it.
- Signs: ", highlighting…", ", underscoring…", ", ensuring…", ", reflecting…", ", contributing to…", ", fostering…", ", enhancing…", ", creating a…". The strongest grammatical marker measured (about 5 times the human rate).
- Keep when: the participle states a plain, simultaneous fact: "the job retries, logging each attempt."

### Avoiding "is" and "has"
- Instead: use `is`, `are`, `has`, `there is`.
- Signs: "serves as", "stands as", "functions as", "acts as", "represents", "marks"; "features", "offers", "boasts", "maintains" for has; "refers to" opening a definition; "holds the distinction of being".
- Keep when: the verb carries a distinct meaning: a proxy that acts as a cache it is not.

### Vague association
- Instead: name the relation: wrote, calls, depends on, replaced, was CEO of. If you don't know it, say so.
- Signs: "associated with", "connected to", "in connection with", "in association with", "linked to", often with "widely" or "particularly".
- Keep when: the relation is statistical: a gene associated with a disease.

### Nominalisation stacks
- Instead: turn the nouns back into verbs and give them a subject: "we investigated why it failed."
- Signs: "performed an investigation into", "enables the facilitation of", "the implementation of the optimisation of", weak verbs (perform, conduct, provide, enable) carrying a chain of "of".
- Keep when: the noun is the term of art (garbage collection, authentication) or the process is the topic.

### Clause subjects
- Instead: start with the subject and verb: "The tests pass on CI but not locally, so it's probably the environment."
- Signs: "That the tests pass on CI suggests…", "What this means is that…", "The fact that X shows Y".
- Keep when: occasional deliberate emphasis.

### Reflex pairs
- Instead: keep the one word that says it.
- Signs: "clear and concise", "robust and scalable", "clean and maintainable", "challenges and opportunities", "insights and recommendations", one pair after another.
- Keep when: both words name different properties that matter: thread-safe and reentrant.

### Counted symmetry and reflex triplets
- Instead: list what exists, in the number it exists, without announcing the count.
- Signs: "One filter, two notations", "Two questions, two answers"; three adjectives or three short phrases in a row; triplets even in commit messages and chat replies.
- Keep when: there really are three, or the count is the information ("three of the five tests fail").

### Manufactured lessons
- Instead: state the findings; let their number be whatever it is.
- Signs: "Four facts stand out", "This adds two lessons", "X adds three things".
- Keep when: a numbered list the reader will refer back to.

## Vocabulary and register

### Register inflation
- Instead: the plain word.

  | Inflated | Plain |
  | --- | --- |
  | utilize, employ, leverage | use |
  | demonstrate, exhibit | show |
  | enhance | improve |
  | facilitate | help |
  | encompass, incorporate | include |
  | subsequently | then |
  | additionally, furthermore | also |
  | initially | first |
  | numerous, various | many |
  | solely | only |
  | distinct | different |
  | commence, initiate | start |
  | endeavor, attempt | try |
  | ascertain | find out |

- Signs: the plain words (use, show, have, then, also, very, good, problem, way) vanish from the text.
- Keep when: the formal word means something else (to demonstrate is also to give a demo) or the genre requires it.

### Display verbs
- Instead: say what the thing does or what the data shows, with the number.
- Signs: showcase, underscore, highlight, unveil, boast, garner, delve, in any form. "The results underscore the need for caching." These are among the largest measured excess words in academic writing since 2023.
- Keep when: the literal sense: a showcase event, text highlighted in yellow, a product unveiled.

### Vocabulary by model era
Words whose overuse is documented, from Wikipedia's lists. A word on its own means little; several together, many times, is the tell. The lists drift as models change and as people learn to avoid the famous ones.

- 2023 to mid-2024: additionally, boasts, bolstered, crucial, delve, emphasizing, enduring, garner, intricate/intricacies, interplay, key, landscape, meticulously, pivotal, underscore, tapestry, testament, valuable, vibrant.
- Mid-2024 to mid-2025: align with, bolstered, crucial, emphasizing, enhance, enduring, fostering, highlighting, pivotal, showcasing, underscore, vibrant.
- Mid-2025 to mid-2026: emphasizing, enhance, highlighting, showcasing.
- Mid-2026 on: challenge, clearer, dependable, echoed, foster, leverage, matters, multifaceted, practical, prioritize, quietly, steady, universally. Most of these are ordinary words; only their density marks the text.
- From the research corpora: significant, comprehensive, effectively, notably, potential, insights, realm, advancements, commendable, innovative, robust, seamless.
- Seen in our own Claude sessions (observed, not sourced): genuinely, load-bearing, "the real fix/question", "worth flagging".

### Consultancy vocabulary
- Instead: name the procedure plainly.
- Signs: "An Operational Playbook", "Freeze the geometry", "a Spectrum-First Audit", "north star", "unlock", "drive alignment", "actionable insights", "best practices" without saying which.
- Keep when: the term is your team's established name for the thing.

### Metaphors on autopilot
- Instead: describe the mechanism. Use an analogy only when it maps the mechanism exactly and the reader lacks the concept.
- Signs: the same device applied to unrelated things ("what X buys", "the information purchased by", "prices in"); generic analogies ("like a traffic cop", "a Swiss Army knife", "a double-edged sword", "the backbone of", "a safety net").
- Keep when: one well-chosen analogy that is specific to this problem.

### Objects with personalities
- Instead: describe the behaviour: "the estimator shrinks this direction most."
- Signs: an estimator that "decides", a function that "wants", an eigendirection that "prefers", repeated agency verbs for code and maths.
- Keep when: established usage (a process "listens" on a port) or a single light touch.

### Synonym rotation
- Instead: use the same term for the same thing every time.
- Signs: one referent called "the constraint", "the restriction", "the imposed limit" and "the boundary" in successive sentences.
- Keep when: never in technical writing; a changed term suggests a changed thing.

## Structure and flow

### Announcing importance
- Instead: say the thing. If it matters, the consequence you state next shows it.
- Signs: "It's important to note that", "It's worth noting", "Importantly,", "Notably,", "This distinction matters", "The key insight is", "Crucially,". "It is important to note that" is the top rising five-word phrase in post-2023 papers.
- Keep when: a warning the reader would otherwise skip, phrased as the warning itself ("Back up first: this deletes the volume").

### Exposition staged as questions
- Instead: state the topic and answer it.
- Signs: "This raises a question: which…?", "So what does this mean?", "Here the question changes", "The answer?". The prose keeps announcing its own agenda.
- Keep when: a question the reader is actually asking, once.

### Tutorial headings
- Instead: a heading that names the content: "Bound on the estimation error".
- Signs: "What the bound says", "Why it holds", "What this means", "How it works", "Why it matters", each section shepherding the reader.
- Keep when: an FAQ, where the headings are the readers' questions.

### Slogan headings and title case
- Instead: descriptive headings in sentence case.
- Signs: "Structure Beats Tuning", "The Penalty Matters", "The Criteria Disagree"; paired-noun headings ("Risks and Mitigations", "Context and Motivation", "Impact and Legacy"); every main word capitalised.
- Keep when: the house style uses title case.

### Tour-guide transitions
- Instead: start the next paragraph with its content.
- Signs: "Back to finance.", "Now let's turn to", "With that in mind,", "Let's dive in", "Here's the thing:", "Forecast weights become portfolio weights."
- Keep when: a long document changes subject sharply, and a plain transition helps.

### Roadmaps, previews and recaps
- Instead: let the structure carry itself. One short roadmap in a long document is fine.
- Signs: "In this section, we will", "The next chapter measures", "As we saw above", "In summary", "In conclusion", "Overall,", "Key takeaways", a box that repeats the paragraph before it.
- Keep when: a long reference doc where readers jump in mid-way.

### Formal meta-phrases
- Instead: do the thing the phrase names.
- Signs: "provides an overview of", "to address the issue of", "to mitigate the impact of", "it is evident that", "it has been observed that", "provides valuable insights into", "the key contribution of this".
- Keep when: a formal genre where one such line is expected.

### The challenges-and-outlook ending
- Instead: end on the last real point, or name the specific open problem and who owns it.
- Signs: "Despite these challenges, X continues to thrive", "While some challenges remain, this lays a strong foundation", "Future outlook", an upbeat closing paragraph that says nothing new.
- Keep when: a concrete list of open issues with owners.

### Fluent but pointless
- Instead: decide the point first. If a paragraph adds no claim or decision, cut it.
- Signs: each sentence reads well but the whole adds up to nothing; paragraphs restate each other; an answer "touches on several considerations" and ends without a recommendation. Low density and poor relevance are what readers judge as slop.
- Keep when: never; an exploratory brainstorm should say that it is one.

### Mechanical uniformity
- Instead: let sentence and paragraph length follow the content.
- Signs: every paragraph on the same template (claim, elaboration, significance); identical sentence lengths; the same transition opening each paragraph; fixed tense and person throughout; the 8-to-20-word comma-and-period monotone of newer models.
- Keep when: a list of parallel entries, like this catalog.

### Over-compression
- Instead: put the articles and verbs back.
- Signs: noun piles with no function words: "Comprehensive cache invalidation strategy implementation ensures robust data consistency."
- Keep when: commit subjects, labels, headlines, release-note lines.

## Hedging and evidence

### Reflex disclaimers
- Instead: one hedge where the uncertainty is real, saying what it rests on.
- Signs, by era: "It's important to remember that…, so always check" (2023 to 2024); "not widely documented", "based on available information", "while specific details are limited" (2024 to 2025); "should be treated as X rather than Y", "does not by itself establish", "should not be confused with" (mid-2026 on). In agent output: "based on the files I reviewed", "this may not cover every case".
- Keep when: the caveat changes what the reader will do: "I only checked the Windows path."

### Stacked softeners
- Instead: make the claim at the strength the evidence supports.
- Signs: "could potentially", "may somewhat", "relatively", "arguably", "essentially", "generally", "typically", several in one sentence.
- Keep when: one qualifier that matches the evidence: "usually", "probably", "in the tests I ran".

### Theatrical scope disclaimers
- Instead: state the limit plainly: "This covers finite-width networks."
- Signs: "Not a classification of every conceivable construction", "This is by no means exhaustive", inflated words in the disclaimer.
- Keep when: the plain version, always.

### Repeated caveats
- Instead: say each caveat once, where it applies.
- Signs: the same limitation restated a paragraph later in other words.
- Keep when: a long document where the reader may have skipped the first mention, with a back-reference.

### Vague attribution
- Instead: cite the specific source and what it says, or drop the claim.
- Signs: "experts agree", "studies have shown", "observers have noted", "industry reports", "several sources" when there is one, "such as" before a list that is complete.
- Keep when: never vague; a real source is always better.

### Sources praised for their type
- Instead: report what the source found.
- Signs: "independent coverage", "featured in trade publications", "well documented upstream", "per the docs", "benchmarks show" with no figure.
- Keep when: the source's standing is itself the point (a peer-reviewed result versus a blog post), stated once.

### Dropped specifics
- Instead: keep or add the anchors: dates, versions, figures, names, links you have checked.
- Signs: "recent updates", "various stakeholders", "significant improvements", "a number of issues". When rewriting a human draft, the dates and references disappear.
- Keep when: the specific is unknown (say so) or irrelevant to the reader.

### Unverified references
- Instead: cite only what you opened. Strip tracking parameters from URLs.
- Signs: links, page numbers, issue numbers, commit hashes or doc sections that were never checked; `utm_source=` parameters; leaked citation tokens.
- Keep when: never.

## Talking to the reader

### Openers and flattery
- Instead: start with the answer.
- Signs: "Great question!", "What a fascinating idea", "Certainly!", "Of course!", "Absolutely!", "Sure! Here's…", "I'd be happy to help".
- Keep when: a greeting the channel expects, like "Hi Ana," in an email.

### Unearned agreement
- Instead: check first, then agree with the reason, or disagree with the reason.
- Signs: "You're absolutely right", "Exactly!", "Great plan!" before any checking; a blocking problem softened into "one small consideration".
- Keep when: you checked and the person is right; say what confirmed it.

### Closing menus and question stacks
- Instead: stop when the answer is done. Ask one question only when you need the answer to continue.
- Signs: "Let me know if you'd like me to A, B or C", "I can also…!", "I hope this helps", "Is there anything else?", several clarifying questions in a row.
- Keep when: one concrete next step the reader is likely to want, offered once.

### Clerk register
- Instead: plain, direct sentences about the specific thing.
- Signs: "I apologise for any inconvenience I may have caused", "I assure you", "I have carefully reviewed", "I am committed to", "Moving forward, I will", "I respectfully", "I welcome any feedback", "Thank you for your time and consideration".
- Keep when: a formal letter that calls for one such line.

### Generic text
- Instead: use the details of this case: the names, the error, the decision.
- Signs: a message that could be sent to anyone about anything ("I understand the importance of following the guidelines").
- Keep when: never.

### Preamble and full rewrites
- Instead: give the deliverable directly. Asked to change one thing, give the change.
- Signs: "Here's the updated function:", "Below is a revised version that addresses your feedback:", reprinting a whole document to change one sentence.
- Keep when: one clause of orientation the output needs ("Two options, depending on whether X"), or the reader asked for the full version.

### Unfilled placeholders and leaked artefacts
- Instead: fill them or ask for the value.
- Signs: "[Your Name]", "[link]", "TODO: add URL", "<insert date>", "example.com/article"; citation tokens like `:contentReference[oaicite:0]`, `[cite: 17]`, `【85†L261】`; "As of my last knowledge update"; "As an AI language model".
- Keep when: never in something you hand over.

## Formatting and punctuation

### Bold confetti
- Instead: no bold in running prose, or one phrase the reader must not miss.
- Signs: bold on many phrases per paragraph, or on every mention of a term. Judges and reward models prefer the bolded version of an otherwise identical answer about 90% of the time, which is why models overdo it.
- Keep when: a single warning, or the defined term on first use in a reference doc.

### Label-colon bullets
- Instead: a paragraph, or plain bullets that are full sentences.
- Signs: "**Performance:** The new cache…" on every item; runs of bolded mini-headers with no colon.
- Keep when: a reference list where the labels are lookup keys (like this catalog).

### Fragmented bullets
- Instead: prose that keeps the because, so and unless.
- Signs: reasoning split into fragments, a three-sentence answer as four bullets.
- Keep when: steps to follow, options to compare, a checklist.

### Headers on short replies
- Instead: no headers in chat replies, Slack messages or short emails.
- Signs: "## Summary", "## Next steps" in a five-line answer; an email-style "Subject:" line in a chat message.
- Keep when: a document long enough that readers navigate it.

### Emoji as formatting
- Instead: words.
- Signs: 🚀 ✅ 💡 📌 as bullet markers or heading decorations.
- Keep when: the channel's culture uses them, or the person you're replying to did.

### Tiny tables
- Instead: a sentence.
- Signs: a two- or three-row table, a "Comparison of A and B" that two sentences would cover.
- Keep when: several items compared on several attributes.

### Markdown where it won't render
- Instead: plain text, with line breaks and plain words for structure.
- Signs: `**bold**`, `##` and `[text](url)` in plain-text email, commit bodies or SMS; horizontal rules between every section; prose wrapped in a code fence.
- Keep when: the target renders Markdown.

### Em dash as the default joint
- Instead: a comma, colon, parentheses or a full stop, chosen for what the clause does.
- Signs: several em dashes per paragraph for asides and reveals, often spaced ( — ). Wikipedia's page reports a July 2026 study in which Claude was the one current model still using them more than professional writers.
- Keep when: an occasional real interruption. Swapping every dash for a period produces the flat monotone instead.

### Exclamation marks
- Instead: a full stop.
- Signs: enthusiasm in technical answers, status updates and commit messages.
- Keep when: a casual message to someone who writes that way.

### Curly quotes
- A weak sign only: Word, macOS and publishers produce them, and Claude rarely does. Match the surrounding text.

## Commits, PRs and change notes

### Stacked assurances
- Instead: what changed and why, in one or two sentences.
- Signs: "Improved clarity, ensured consistency, and enhanced maintainability", "refined", "streamlined", "in line with best practices", more kinds of improvement than one change plausibly makes.
- Keep when: never stacked; one real improvement, named specifically, is fine.

### What you kept
- Instead: mention preserved behaviour when a reviewer would doubt it, and how you checked it.
- Signs: "while preserving existing behavior", "retained the original structure", "avoided breaking changes", "no functional changes" where nobody asked.
- Keep when: a refactor touching public behaviour, with the check named.

### Content-free nouns
- Instead: say what is now tested, documented or fixed.
- Signs: "added tests", "updated docs", "improved error handling", "added sourced content".
- Keep when: the detail is in the next sentence.

### Identifier inventories
- Instead: the intent. The diff lists the files.
- Signs: a body that names every touched function, parameter and file.
- Keep when: a migration note where readers need the renamed identifiers.

### Empty feedback references
- Instead: what was asked for and what you did.
- Signs: "Address review feedback", "Per reviewer comments", "Rewrote per feedback".
- Keep when: followed by the specifics.

### Overjustification and principle-reciting
- Instead: the concrete reason: "splits the 600-line handler so each route can be tested alone."
- Signs: "These changes improve readability and maintainability", "following SOLID, DRY and KISS principles", "to adhere to best practices".
- Keep when: a principle that decided a real trade-off, named with the trade-off.

### Self-certification
- Instead: what you verified and how: "ran the suite on Windows and Linux; added a test for the empty-cart path."
- Signs: "This PR fully addresses the requirements", "ensures compliance with", "production-ready".
- Keep when: never as a claim; the evidence makes it.

## What is not a tell

These are unreliable signs, and avoiding them makes writing worse:

- Correct grammar, a formal register, or long words in general. The overused words are specific ones; formal prose as a whole is not the problem.
- Transition words on their own ("however", "therefore"), Markdown in technical channels, a single em dash, a single word from the lists.
- The plain features of human writing: "there is", "it has", "very", "perhaps", "tends to", "as a result of", "in order to", an outright superlative, plain verbs like wrote, used, tried, moved.
- Mixed registers, an unusual voice, or a writer who has always written this way.

Readers also like some of what these habits produce: experts rated LLM-polished paragraphs clearer and more exciting than the originals. Target the habits that make text repetitive, vague, inflated or generic, and keep the fluency.
