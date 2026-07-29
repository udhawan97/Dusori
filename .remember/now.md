
## 01:39 | main
Fixed 10 Dusori flow gaps (73ae97f): topic creation, research relevance, draft preservation, graph legibility, inspector persistence, overflow/truncation, URL state, conflicts, label collisions; 91 tests pass; pushed to main, CI red on pre-existing .remember files.
## 02:00 | dusori-research-storage-fix
Fixed StorageConflictError dead-code in research-file.ts:writeDismissedResearchSuggestion (removed attempt===2 from retry catch); added test suggest.test.ts; pushed (73ceb73). Found same bug in recordResearchRun + sources/import.ts; user asked to fix both.
## 03:19 | friendly-wizard-claude/improve-userflow-design-7c15cc
Fixed 8 Dusori userflow gaps (offline reopen, CTA fold, research hero, topic prefill, drawer focus, connectivity label, rail icon, button explanation), added e2e tests (547 unit, 58 e2e green), pushed main w/ CI pass (3db7402), rebuilt knowledge graph w/ subagents (1966 nodes clean).