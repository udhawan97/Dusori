# Dusori v0.11.3 compatibility fixtures

These machine-file fixtures are pinned to the last pre-redesign baseline, commit
`7798845f5dcdedcadc5fa6ff51f7992974656b04` (Dusori v0.11.3).

Each file includes deliberately unknown top-level and nested fields. Mutation tests load the
fixtures through the real schemas and write paths to prove that the redesign keeps the v0.11.3
schema version and does not erase data written by a compatible newer reader.
