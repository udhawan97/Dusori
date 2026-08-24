# Dusori Learning Workspace

Dusori helps a learner continue intentional study while keeping learning material portable, local, and under the learner's control.

## Language

**Today**:
The workspace-wide orientation surface that presents Continue learning and Needs attention before recent activity and per-topic context. Its items disappear only when their underlying workspace evidence changes; Today does not own a separate completion or dismissal state.
_Avoid_: Focus, Inbox, Dashboard

**Continue learning**:
A learner-chosen next step justified by explicit workspace state, such as reviewing due material or continuing an objective. Opening it does not itself change progress, and it is not a deadline unless the learner explicitly created a review schedule.
_Avoid_: Task, assignment, recommendation

**Needs attention**:
A condition proven by current local workspace evidence that needs a learner's decision to preserve workspace correctness or health, such as resolving a conflicting edit or repairing source metadata. It exists only while that evidence is present and is separate from learning progress.
_Avoid_: Notification, alert, task

**Integrity issue**:
A Needs attention condition that can leave workspace data ambiguous, inaccessible, or unsafe to update. It may take precedence over Continue learning; structural hygiene such as an unresolved wikilink may not.
_Avoid_: Emergency, critical alert

**Pending proposal**:
A durable alternative version created because the learner-owned document changed before Dusori could safely update it. The current document remains authoritative until the learner explicitly accepts a proposal or keeps the current version.
_Avoid_: Conflict file, failed save, replacement

**Attention summary**:
A compact, evidence-derived grouping of related Needs attention conditions that routes the learner to the workflow responsible for resolving them. It does not duplicate that workflow's repair actions.
_Avoid_: Inbox item, repair task

**Source-ready objective**:
An objective with at least one learner-approved source whose text is readable on the current device. The term claims availability only, not source quality, completeness, or learner understanding.
_Avoid_: Well-researched objective, complete objective

**Research run**:
A user-requested, consent-bounded attempt that records its exact question and every provider outcome before saving a varied shortlist. A run may finish with results, no results, or provider failures; each is durable evidence about that attempt.
_Avoid_: Crawl, background search, research session

**Research provider**:
A named external discovery capability with its own disclosure, consent scope, availability, run outcome, and bounded capture policy. Availability never implies that a run found evidence.
_Avoid_: Search engine, integration, data source

**Source-grounded annotation**:
A learner-owned Markdown note created from a local reading copy. When it begins from a selected passage, it preserves the exact quote, nearest section heading, source path, and source-content fingerprint before the learner adds interpretation. It does not claim that the quote supports a conclusion or silently follow later source revisions.
_Avoid_: Highlight, generated note, verified claim
