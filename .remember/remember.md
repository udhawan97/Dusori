## Handoff | friendly-wizard-claude/userflow-research-agent-05e55b

Grilled research-agent feature (10 decisions), confirmed shared understanding, wrote + committed spec `docs/superpowers/specs/2026-07-21-research-agent-design.md` (3c1e4b5).

Key resolutions: target is Dusori product (not the /improve-userflow-design skill); Phase 2 + npm publish already shipped to main. Design: per-provider consent + approve=fetch; keyless providers HN/GitHub/SE app-direct, arXiv + web search (brave|tavily|searxng) via companion; layered vetting (deterministic always, AI advisory-only on top); all keys/AI via companion env; top-5 type-diverse shortlist, approve auto-fetches; marked research-brief note; re-run memory in research.json (additive); no scheduling.

Build phases: A prep refactors (companion server.ts → Fastify plugins; panel provider switches → provider metadata; delete unused AIProvider placeholder) → B deterministic agent → C AI layer. B ships before C.

Next: write phase A+B implementation plan (superpowers writing-plans), then subagent-driven execution like Phase 2.
