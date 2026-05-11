---
name: deslop
description: Remove AI writing patterns from prose so it reads like a specific human wrote it. TRIGGER when drafting or reviewing any text meant for a human audience — PR descriptions, PR inline comments, Slack messages, Jira descriptions and comments, RCA narratives, technical documentation. SKIP for code, log messages, config, or anything where the goal is mechanical correctness rather than prose quality.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# Deslop

Strip predictable AI patterns from prose. Make it sound like a specific person wrote it, not like a language model generated it.

Apply before any message reaches a human audience — PR descriptions, inline comments, Slack announcements, Jira content, postmortem narratives.

## Ten rules

### 1. Cut filler phrases

Drop throat-clearing openers, emphasis crutches, business jargon, and meta-commentary. "Here's the thing:" / "Let that sink in." / "navigate the landscape" / "In this section, we'll explore…" — all noise. Full catalog in [references/phrases.md](references/phrases.md).

### 2. Break formulaic structures

Stop using:
- binary contrasts ("Not X. Y.")
- negative listings ("Not a X. Not a Y. A Z.")
- dramatic fragmentation ("Speed. That's it. That's the tradeoff.")
- self-answered rhetorical questions ("The result? Devastating.")
- anaphora / tricolons stacked for effect

Patterns and fixes in [references/structures.md](references/structures.md).

### 3. Eliminate AI tropes

Common tells:
- magic adverbs — "quietly", "seamlessly", "effortlessly"
- AI-vocabulary words — "delve", "tapestry", "realm", "nuanced"
- the "serves as" dodge
- false ranges — "from X to Y" where the range is meaningless
- superficial participle analyses — "highlighting its importance"
- invented concept labels — "the supervision paradox"
- patronizing analogies, false vulnerability, grandiose stakes

Full catalog in [references/tropes.md](references/tropes.md).

### 4. Active voice, human subjects

Prefer active constructions with named actors. "The complaint becomes a fix" is wrong — "the team fixed it" is right. If no specific person fits, use "we" in narrative prose or "you" when addressing the reader.

### 5. Be specific

No vague declaratives — "The reasons are structural" → name the structural reason. No lazy extremes — "every", "always", "never" doing vague work. No unsourced attributions — "Experts argue…" without a name is a gap, not evidence.

Domain terminology is fine. "Weighted interval score" is precise. The problem is business buzzwords ("leverage", "ecosystem", "synergy") and AI vocabulary leaking in.

### 6. Match register to context

- **PR descriptions / technical writing**: direct and compact. No narrator voice, no "let's explore together."
- **Slack**: short first line, specifics, emoji sparingly. No meta ("Just a quick note that…"). Put the point first.
- **Jira / RCA**: factual and chronological. Attribute observations to specific commits, logs, or tickets.

### 7. Vary rhythm

Mix sentence lengths. Two items beat three. End paragraphs differently. No em dashes. Don't stack short punchy fragments for manufactured emphasis.

### 8. Trust readers

State facts directly. Skip softening, justification, and hand-holding. No "Let's break this down." No "Think of it as…" No fractal summaries (telling the reader what you'll say, saying it, then summarizing what you said).

### 9. Watch formatting tells

- No bold-first bullets (every list item starting with a bolded keyword)
- No unicode arrows
- No em dashes
- No signposted conclusions ("In conclusion…")
- No "Despite these challenges…" formulas

These are strong AI signals, especially in Slack and short-form writing.

### 10. Don't dilute

One point per section. Don't restate the same argument in ten ways. Don't stack analogies for false authority ("Apple didn't build Uber. Facebook didn't build Spotify…"). If a metaphor works, use it once.

## Quick pre-send checklist

Before delivering any prose:

- [ ] Heavy `-ly` adverbs? Cut them.
- [ ] Passive voice? Find the actor.
- [ ] Throat-clearing opener ("Here's what…", "It's worth noting…")? Delete.
- [ ] "Not X, it's Y" contrast? State Y directly.
- [ ] Self-posed rhetorical question? Fold into a statement.
- [ ] Em dash? Replace with comma, period, or parenthesis.
- [ ] Vague declarative ("The implications are significant")? Name the implication.
- [ ] Meta-joiner ("The rest of this section…")? Delete.
- [ ] Three-item list? Usually two is enough.
- [ ] Bold-first bullets? Remove bold leads.
- [ ] "Despite these challenges…" formula? Rewrite.

## Scoring (optional, useful when reviewing someone else's text)

| Dimension | 1–10 |
|---|---|
| Directness — statements, not announcements | |
| Rhythm — varied, not metronomic | |
| Trust — respects reader intelligence | |
| Authenticity — sounds like a specific person | |
| Density — nothing cuttable | |

Below 35/50: revise.

## Examples

See [references/examples.md](references/examples.md) for before/after pairs in PR comments, Slack messages, and Jira descriptions.
