# ADR-014: Question-shaped provider routing and consent

**Status:** accepted · **Date:** 2026-08-13

## Decision

Classify the current research question on the device before presenting provider consent or
selecting already allowed adapters. The provider catalog owns one explicit routing class per
adapter. General providers remain relevant to every question; developer, Microsoft, biomedical,
and cultural-heritage providers join only for bounded local term and phrase matches. Polysemous
words such as `virus`, `infection`, `archive`, `office`, `windows`, and `library` do not activate a
specialist on their own. Cross-audience near-miss fixtures make the fail-closed preference explicit:
a missed specialist is safer than surprise egress.

Routing is an exact intersection, never an authorization or fallback. A match cannot check a box,
grant, revoke, reuse, or broaden consent. An ambiguous question, denial, unavailable adapter,
timeout, or provider failure does not reroute to a different specialist. No classifier action
prefetches, probes, retries, emits telemetry, or otherwise contacts the network.

The per-question consent dialog shows only undecided providers relevant to that question so its
heading and actions remain fixed while the provider rows scroll. The complete catalog and every
saved decision remain reachable from Research provider setup and Settings.

Europe PMC enters the catalog as a biomedical `readable-or-reference` provider. It saves returned
metadata and an abstract when present, never labels an abstract as a full paper, and makes no
open-access inference from metadata alone. Library of Congress enters as a cultural-heritage
`reference-only` provider. It accepts canonical digitized `www.loc.gov/item/` records and never
fetches item media, OCR, or arbitrary result pages.

## Why

- Asking for every undecided adapter made consent actions unreachable on a 320 x 568 screen as the
  provider catalog grew.
- A fallback to any allowed specialist could send an unrelated question to a provider whose prior
  consent did not make it relevant.
- Biomedical literature and digitized primary-source records address demonstrated evidence gaps,
  but neither should become hidden default egress.
- One catalog-owned routing policy keeps the UI, CSP, disclosures, tests, and persisted run trail
  aligned.

## Consequences

- New specialist providers require conservative positive and near-miss routing fixtures in
  addition to ADR-011's disclosure, bounded capture, legal, and documentation gates.
- A run may report that no allowed provider matches the question. Dusori asks the learner to reset
  a relevant decision or revise the question instead of silently widening egress.
- Canonical DOI/URL and conservative scholarly-title duplicates collapse to one shelf item. An
  abstract already returned with search wins over a duplicate reference, while every answering
  provider retains its `found`, `empty`, or `failed` run outcome.
- Europe PMC search is bounded to eight core JSON records. Library of Congress fetches one
  digitized-results page, keeps at most eight canonical items, starts requests at least three
  seconds apart, and records `Retry-After` as local backoff without automatic retry.
- Hugging Face remains outside the runtime catalog until a concrete model-or-dataset workflow,
  authentication boundary, disclosure, and evidence-capture outcome are demonstrated.
