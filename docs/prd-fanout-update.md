# PRD update: fan-out capture extension

**Status:** draft for review
**Date:** 10 August 2026
**Owner:** Roy Huiskes
**Supersedes:** nothing yet. This is an additive update to the existing extension.

---

## 1. Why now

Three inputs landed in the same week and they point at the same build.

1. **RESONEO ships a competing extension** (`ChatGPT Search & fan-outs capture`, v5.1.2, ~3.000 users, free, open source). It is the instrument behind a published reverse-engineering study, so its data model has been validated against ground truth: fingerprinted test pages, server logs, an account fleet behind a VPN.
2. **The RESONEO July 2026 study** (`think.resoneo.com/chatgpt-retrieval/`, 1.249 answers, 27.000 pages) documents which fields exist, which ones OpenAI removed on 21 July, and how to recover the removed ones from format signatures.
3. **Moz released a 50.000-prompt fan-out dataset** (Dr. Pete Meyers, August 2026): 20 verticals, 1.000 subtopics, balanced 5 instances × 10 fan-out types, with alignment scores and 5.333 Gemini grounding queries.

The gap none of them closes: nobody joins **generated** fan-outs (what a model would ask) to **observed** fan-outs (what it actually asked) to **retrieval outcome** (retrieved, promoted, cited, opened). That join is the product.

**Positioning bet for this update:** stop competing on capture-field parity and compete on layer-honest aggregation, replay discipline, and the join to topic space. Section 8 grills that bet.

---

## 2. In scope

Everything below assumes the extension already captures the ChatGPT SSE stream. If it scrapes rendered DOM instead, stop and answer Q1 in section 8 first, because most of this becomes unbuildable.

### F0. Provenance on every captured row (foundation, blocks everything else)

Every result row gets: `captured_at`, `account_id` (hashed), `plan` (free/plus/pro/team), `country`, `model_slug`, `thinking_effort`, `parser_version`, `field_origin` (`read` or `inferred`).

Why: RESONEO measured that a third of replayed prompts switch engine outright two days later on the same account. Any aggregate without these columns is uninterpretable. `field_origin` matters because after 21 July, engine attribution is a guess, and a guess stored in the same column as a read value poisons every historical query.

**Acceptance:** export a single conversation, confirm all eight fields present per result. Re-run the same prompt on two accounts, confirm rows are distinguishable without manual annotation.

### F1. Engine classifier from format signatures

`result_source` is gone from the stream. Rebuild it as a scored classifier, not a threshold.

Signals per result:

| Signal | labrador | bright (scraped Google) |
|---|---|---|
| Snippet length | caps hard at 202 chars | ~159 chars median |
| Title truncation | near zero | ~23% carry an ellipsis |
| Title over 75 chars | ~24% | ~1,5% |
| H1 anchoring | snippet contains the page H1 ~83% of the time | no |
| News format | ~1.100 chars, rewritten summary, 200-word cap | not applicable |

Output a label plus a confidence score plus the signals used, exposed in a tooltip so the inference stays checkable. RESONEO uses a single ≥186-char threshold. Beat that by scoring three or four signals.

**Validation test to ship with it:** Bing caps displayed titles at 75 characters. If your classifier ever labels a result `bing` while the title runs longer, the classifier is broken. Run this as a unit test against a stored fixture set.

**Acceptance:** classify a held-out set of pre-21-July captures (if you have any) against their real `result_source` value. Target ≥90% agreement. If you have no pre-cut-off captures, this ships as unvalidated and gets flagged as such in the UI.

### F2. Listed → promoted → cited → opened funnel

Per conversation, and aggregated across a filtered set:

- every URL in the sources side panel
- promoted to the top section, splitting lead source from supporting sources
- lead source of a citation pill
- opened and read by the model

Report absolute counts and share of panel. Count carousels separately. Median reference points from the RESONEO corpus: ~20 listed, 5 promoted, 3 cited, 0 opened per answer.

**Acceptance:** the four numbers reconcile (opened ⊆ listed, cited ⊆ promoted ⊆ listed) on 20 test conversations with zero exceptions.

### F3. Link-role and result-nature labels

Roles: citation lead, citation secondary (the `+1` in the tooltip), other panel source (`More`), footnote, widget, opened/fetched, residual.

Natures: web search, news, scientific, forum, video, local, product, image, weather, opened page, no ref_type.

**Acceptance:** every captured URL carries exactly one role and one nature. No `unknown` bucket above 5% of rows.

### F4. Layer-honest domain reporting

The top-domains table gets a mandatory layer selector (listed / promoted / cited / opened). No default view that mixes them.

Why: arXiv appeared over 2.600 times in the RESONEO corpus and was cited ten times, including zero times on the 117 occasions it arrived with a snippet. Reddit shows the same pattern. A top-domains chart without a layer selector reports retrieval volume and calls it visibility. That single design choice is what separates your tool from every market visibility tracker.

**Acceptance:** switching layers changes the domain ranking. If it does not, the layer filter is not wired to the data.

### F5. Opened pages card and attribution reconciliation

Surface the pages the model actually opened, deduplicated on normalised URL. Two reasons this earns its own view:

- an opened page gets cited ~74% of the time, against ~7% for a page merely present in the grounding set
- ChatGPT appends `utm_source=chatgpt.com` to ~95% of displayed links, but never to pages it opened itself

Second point is the client-facing feature: export opened URLs as a CSV to diff against their analytics, showing the ChatGPT traffic their GA4 cannot attribute.

**Acceptance:** a captured opened-page set exports with URL, conversation id, citation status, and `utm_present` flag.

### F6. Replay runs

A prompt set is a first-class object: n prompts, m repetitions, executed across accounts, grouped under a `run_id`. Aggregates default to run level, never to single capture.

**Acceptance:** the UI refuses to show an engine share for a run with n=1, and says why.

### F7. BigQuery export

Newline-delimited JSON with a stable schema, plus a `parser_version` column so historical rows stay queryable after a schema change. TSV export stays for the Excel path.

**Acceptance:** a full export loads into BigQuery with autodetect off and an explicit schema file, no manual repair.

---

## 3. Companion services (outside the extension)

### C1. Cache oracle (n8n + BigQuery)

`POST /v1/responses` with the `web_search` tool and `include: ["web_search_call.results"]` returns internal metadata: `Crawled` (age of the served copy, per URL) and `wordlim` (per-domain word budget). `external_web_access: false` queries the store without going to the web.

A scheduled job over a client's key URLs produces a finding no rank tracker generates: "these product pages are served from a copy six weeks old." Undocumented and removable at any time, so treat output as observational.

### C2. Topic map generator

Port the Moz method to Dutch verticals rather than reusing their English rows.

- Balanced design: 5 instances × 10 fan-out types per subtopic. Balance is what makes per-type rates comparable. Their finding (97% of brand mentions in `[Entity]` and `[Comparison]`, which works out to ~62% of prompts in those two types against ~0,5% across the other eight) only holds because every type got exactly 5.000 prompts.
- Brands passed as **contextual hints, not commands**. As a command you get ~100% brand mention and the measurement collapses.
- Alignment = cosine similarity of prompt to the subtopic phrased as "What is [subtopic]?". Band rules: ≥0,85 same page, 0,45 to 0,85 supporting page, below 0,45 check whether it belongs to a neighbouring node.
- Dutch adjustment: cap prompt length in characters (~55 to 60), not the English 12 words. Dutch compounds compress, so a word cap produces systematically broader prompts.
- Store the generator model as a column. Type distribution is a property of the model.

**The join:** per topic node, does a fan-out exist (generated), does one fire (grounded), are we retrieved, are we cited. Four layers, one map.

---

## 4. Non-goals

- Feature parity with RESONEO's dashboard. Their tag cloud, entity disambiguation and map carousel views are nice and not worth your time.
- Multi-model capture in this update. See Q4.
- Anything that phones home. Local storage only, same as today.

---

## 5. Build order

**Phase 1:** F0, F7. Nothing else is worth building on an unversioned schema.
**Phase 2:** F1, F3. Classification before aggregation.
**Phase 3:** F2, F4, F5. The visible product.
**Phase 4:** F6, C1, C2.

Phase 1 and 2 are refactors of existing capture. Phase 3 is where the tool becomes demonstrably different from what RESONEO ships.

---

## 6. Risks

| Risk | Impact | Response |
|---|---|---|
| OpenAI removes another field | Classifier silently degrades | `field_origin` column plus a weekly fixture test that fails loudly |
| Chrome Web Store review on `scripting` + `tabs` + host permissions | Ship blocked | Only relevant if you publish. See Q3 |
| `chrome.storage.local` quota | Data loss at scale | Requires `unlimitedStorage`. Measure current usage before Phase 1 |
| RESONEO ships the same funnel first | They already did, in v5.1.2 | Your edge is F4, F6 and C2, none of which they have |
| Moz dataset encodes Gemini's priors | Topic map inherits a model's bias, not the market's | C2 regenerates on Dutch subtopics. Use their rows as a validation corpus only |

---

## 7. Success criteria

The update is done when you can answer this for a client, from one export: "for topic X, here are the fan-outs that fire, here is where you appear at each of the four layers, here is what your competitors get that you do not, and here are the pages ChatGPT read that your analytics never saw."

If the build cannot produce that sentence, a phase is missing.

---

## 8. Grill me

Answer these before Phase 1. The first four are blocking.

**Q1 (blocking). How does your extension capture today: SSE stream injection, or DOM after render?**
If it is DOM, F1, F3 and most of F2 are unbuildable and this PRD needs rewriting as a rebuild rather than an update. Say which, and paste the manifest.

**Q2 (blocking). Who is this for?**
Personal instrument, client deliverable, or a public tool you support. The three answers produce three different products. A client deliverable needs F5 and F7 and can skip the dashboard entirely. A public tool needs a privacy policy, permission justifications and a maintenance commitment against a field surface that changed twice in six months.

**Q3 (blocking). Are you publishing to the Chrome Web Store?**
If yes, the permission set and a review rejection path enter scope now, not later. If no, drop the store constraints and use an unpacked build, which also removes the review latency from your iteration loop.

**Q4 (blocking). ChatGPT only, or ChatGPT plus Gemini?**
C2 is a Gemini pipeline. F1 to F5 are ChatGPT-specific. Building both inside one extension doubles the surface. The alternative is an extension that captures ChatGPT and an n8n pipeline that handles Gemini, joined in BigQuery. Pick one before Phase 1, because F0's schema depends on the answer.

**Q5. What does RESONEO's extension not do that you actually need?**
List three concrete things. If the list is thin, the honest move is contributing to their open-source repo and spending your build time on C1 and C2, which nobody has. That is a real option and this PRD does not assume you reject it.

**Q6. Do you have any captures from before 21 July 2026?**
If yes, F1 gets a validation set and a defensible accuracy number. If no, the classifier ships unvalidated and you need to decide whether to say so in the UI or quietly not mention it.

**Q7. Where does the topic map actually run?**
Chrome extension, n8n, or a local Python job. Embedding and clustering 50.000 prompts inside a browser extension is a bad fit. Your stack says n8n plus BigQuery. Confirm, and C2 leaves this PRD to become its own document.

**Q8. What is your storage ceiling today, and have you hit it?**
Measure before you design. If you are already near quota, F0's extra columns per row make it worse and archival design moves into Phase 1.

**Q9. Do you intend to publish research off this corpus?**
If yes, F6 stops being a nice-to-have. A published engine share with n=1 per prompt gets taken apart, correctly. If no, F6 drops to Phase 5.

**Q10. What is the smallest version of this that would change one client conversation next month?**
If the answer is not Phase 1 plus F4, the phasing in section 5 is wrong and should be rebuilt around that answer.
