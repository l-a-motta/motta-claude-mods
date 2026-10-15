---
name: motta-intake
description: Intake for the agent lane — turn the owner's stakeholder notes, meeting notes or a described need of the users the product serves into spike issues on the delivery board. Use when the owner hands over notes or requests and wants spikes opened from them.
---

# Intake: notes → spike issues

The first stage of the agent lane (`.github/BOARD.md`, "Agent lane"). The owner is present. The
output is one `spike:` issue per **need** — a question that must be decided before anyone builds —
with the stakeholder's words preserved, so the settling session starts from the source, not from
a paraphrase.

**The repo is the current checkout.** Its `.github/BOARD.md` is the rulebook for everything below,
and the scripts, issue forms and PR template named here are that checkout's own, under `.github/`.
If the checkout has no `.github/BOARD.md`, stop and say this repo isn't set up for the agent lane.

## Steps

1. **Read the rules.** In `.github/BOARD.md`: "Issue anatomy", "Before creating: check for
   duplicates", "Creating an issue from the CLI" and "Agent lane". Read
   `.github/ISSUE_TEMPLATE/spike.yml` for the body headings. Done when you know the title prefix,
   labels, Type and board fields a spike carries.
2. **Split the notes into needs.** One need is one question to decide. Asks that hinge on the same
   decision are one need; one ask that hides two independent decisions is two. Keep, for each need,
   who asked and their own words (quote them). Done when every sentence of the notes maps to a need
   or is marked "no action" with a reason.
3. **Duplicate scan** each need as BOARD.md describes. A match becomes "comment on #n" (the new
   context appended to that issue) instead of a new spike.
4. **Confirm with the owner.** Show one numbered table: need, proposed title (or "comment on #n"),
   Area, Priority, Size, timebox. Wait for the owner's go and apply their edits. Done when the
   owner has confirmed the whole list.
5. **File.** For each confirmed need, follow the CLI recipe in BOARD.md:
   - Body headings mirror `spike.yml` labels exactly — `### Question to answer`, `### Context`,
     `### Timebox`, `### Expected outcome`, `### Area`, then each `### Settlement: …` heading with
     `_Filled when the spike is settled._` under it.
   - Labels `type: spike` only — the owner confirmed the fields, so the issue is already triaged.
     Type `Task`. Assign the owner.
   - Board fields with `.github/scripts/board.sh set <n> <Field> "<Option>"`: Status `Backlog`
     (or `Todo` when the owner wants it settled now), Priority, Size, Area.
   - Matches from step 3 get a comment with the new context instead.
6. **Report** a numbered list: issue link, title, and one line on what must be decided.
