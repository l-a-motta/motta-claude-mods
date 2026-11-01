# Sources

What the skill draws on, and what each source supports. Read in November 2026.

## Where it started

- The "Correct and avoid AI stylistic tropes" section of the `scholarly-paper-revision` skill, written for revising mathematical papers. It gave the stance (cues for judgment, applied when a pattern is repetitive, vague, overstated or distracting) and these entries: counted symmetry, the "buys" metaphor, corrective antithesis, the imagined misconception and reveal, defending against unraised objections, grand compression claims, slogan headings, manufactured lessons, mirror sentences, anthropomorphised objects, economic metaphors, exposition staged as questions, tutorial headings, announced importance, tour-guide transitions, chapter previews, consultancy vocabulary, moralised precision, theatrical disclaimers, repeated caveats, recap boxes, results turned into morals. Its examples are mathematical; this skill rewrote them for everyday technical prose.

## Wikipedia

- *Wikipedia:Signs of AI writing*, WikiProject AI Cleanup, revision of late October 2026, with its subpages `/Style`, `/Markup` and *Signs of AI use in comments*. <https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing>
- Supports: inflated significance, promotional tone, vague association, vague attribution, sources praised for their type, trailing "-ing" clauses, avoiding "is", all three forms of negative parallelism, rule of three, title case, bold, label-colon bullets, emoji, tiny tables, the chat wrapper, the three eras of reflex disclaimers, placeholders and leaked artefacts, the clerk register, the challenges-and-outlook ending, synonym rotation, em dashes and the flat punctuation that replaced them, and the edit-summary habits mapped here onto commits and PRs. The "signs of human writing" and "ineffective indicators" sections are the basis of "What is not a tell".
- Its central explanation: models drift toward the statistically likely and broadly pleasing, so text gets less specific and more exaggerated at the same time. It asks editors to fix the underlying problem, since scrubbing the signs only hides it.
- Licence: Wikipedia text is CC BY-SA 4.0. The word lists under "Vocabulary by model era" and several phrase lists in the catalog are taken from the page, by Wikipedia contributors; the explanations are paraphrased.

## Research

- Geng, M. & Trotta, R. (2025). Human-LLM Coevolution: Evidence from Academic Writing. *Findings of ACL 2025*, 12689–12696. <https://aclanthology.org/2025.findings-acl.657/> Publicised marker words (delve, intricate, pivotal, showcasing) fell after April 2024 while common ones kept rising (significant, additionally, crucial, enhance). A prompt banning four words reduced them without removing them. Detection on individual short texts is unreliable.
- Miletić, F. & Falk, N. (2026). What Are LLMs Doing to Scientific Communication? *LREC 2026*, 1811–1830. <https://aclanthology.org/2026.lrec-1.142/> Register inflation (use to utilize, then to subsequently; additionally from 141 to 816 per million in rewrites), "it is important to note that" as the top rising five-word phrase, bleached intensifiers (crucial, notably), formal meta-phrases, fewer dates and references. Experts still rated the LLM versions clearer and more exciting.
- Kobak, D. et al. (2025). Delving into LLM-assisted writing in biomedical publications through excess vocabulary. *Science Advances* 11(27). <https://arxiv.org/abs/2406.07016> Excess 2024 vocabulary is mostly style verbs and adjectives (delves, underscores, showcasing, potential, crucial); at least 13.5% of abstracts processed.
- Liang, W. et al. (2024). Monitoring AI-Modified Content at Scale. *ICML 2024*. <https://arxiv.org/abs/2403.07183> Praise adjectives and adverbs in peer reviews (meticulous, commendable, intricate, seamlessly); LLM-heavy reviews cite less and converge.
- Liang, W. et al. (2024). Mapping the Increasing Use of LLMs in Scientific Papers. <https://arxiv.org/abs/2404.01268> realm, intricate, showcasing, pivotal.
- Juzek, T. S. & Ward, Z. B. (2025). Why Does ChatGPT "Delve" So Much? *COLING 2025*. <https://arxiv.org/abs/2412.11385> 21 overused words with their increases; evidence that post-training, not pretraining data, causes them. Readers already disprefer text that opens with "delve".
- Reinhart, A. et al. (2025). Do LLMs write like humans? *PNAS* 122. <https://arxiv.org/abs/2410.16107> Grammatical tells: present participial clauses about 5 times the human rate, clause subjects 2.6 times, nominalisations 2.1 times, phrasal coordination 1.9 times; instruction tuning widens the gap.
- Paech, S. et al. (2026). Antislop. *ICLR 2026*. <https://arxiv.org/abs/2510.15061> "It's not X, it's Y" up to 6.3 times the human rate; tics recur across prompts within a model.
- Shaib, C. et al. (2025). Measuring AI "Slop" in Text. <https://arxiv.org/abs/2509.19163> Readers judge slop mostly by low density, poor relevance and wrong tone; templatedness and verbosity follow. Humans produce it too.
- Zhang, X. et al. (2025). From Lists to Emojis: How Format Bias Affects Model Alignment. <https://arxiv.org/abs/2409.11704> Judges and reward models prefer bold, lists, emoji, exclamations and affirmative tone, which explains the formatting habits. A GPT-4 Turbo judge picked the bolded version of an otherwise identical answer 89.5% of the time; most reward models did so 95–99% of the time.
- Sharma, M. et al. (2024). Towards Understanding Sycophancy in Language Models. *ICLR 2024*. <https://arxiv.org/abs/2310.13548> Preference data rewards agreeing with the user.
- Herbold, S. et al. (2023). A large-scale comparison of human-written versus ChatGPT-generated essays. <https://arxiv.org/abs/2304.14276> More nominalisations, fewer real epistemic markers.

## Practitioner and vendor guidance

- Anthropic's published Claude system prompts (Sonnet 4 through Opus 5.5). <https://platform.claude.com/docs/en/release-notes/system-prompts> No flattering openers, minimum formatting, prose in reports, at most one question, the change in place of the whole piece again.
- OpenAI Model Spec, sections on matching the audience and programmatic use. <https://model-spec.openai.com/> Preamble and emoji as bad examples.
- Charlie Guo, "The Field Guide to AI Slop". <https://www.ignorance.ai/p/the-field-guide-to-ai-slop> Generic analogies, prose with no throughline, monotone rhythm; specificity as the main remedy.
- Sean Goedecke, "Why do AI models use so many em-dashes?" (2025). <https://www.seangoedecke.com/em-dashes>

## What every quantitative source says

The measurements work across large corpora only. None of them can tell whether one passage was written by a model, and people use every one of these patterns. Use the catalog to edit, never to accuse.
