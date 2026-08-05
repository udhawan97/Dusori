# ADR-012: Separated evidence atlas

## Status

Accepted 2026-08-05. Supersedes ADR-008 for the current visual-map presentation; the portable graph derivation remains unchanged.

## Decision

Render the optional visual map as a deterministic evidence atlas. Each topic owns one bordered room with four stable lanes: Sources, Notes, Briefs & learning, and Updates. A topic-level evidence spine reports discovered, saved, read, and quoted counts. Cross-topic wikilinks are summarized as counted connections rather than drawn as crossing paths.

Keep the searchable, filterable Outline as the default view. Both views open the same Markdown artifacts and derive from the same local `WorkspaceGraph`; neither writes layout state or infers mastery.

## Why

The force constellation protected node circles but could not guarantee readable labels. A dense real workspace still produced overlapping text, hid content behind zoom, and asked the learner to tune physics before they could understand the research trail. The atlas makes the primary questions—what was found, what was saved, what was read, and where each artifact belongs—visible without spatial repair.

## Consequences

- Every topic and artifact type remains visually separated at supported widths.
- There is no pan, zoom, node dragging, force tuning, or persistent graph-view geometry.
- Cross-topic relationships retain their counts and destinations but lose an edge-by-edge drawing.
- Historical ADRs and release notes continue to describe the behavior shipped at their time.
