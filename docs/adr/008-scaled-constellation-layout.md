# ADR-008: Scaled constellation layout

**Status:** accepted · **Date:** 2026-07-21

## Decision

Render the knowledge graph with a count-scaled, wikilink-affinity-ordered, deterministic constellation layout in a pure browser module. Keep the layout view-only and validate its bounds and node clearance with geometry self-audit tests.

## Consequences

Large workspaces receive enough space for topic and artifact rings without persisting coordinates or adding a force simulation. The same graph always produces the same positions, and unresolved links remain visible. Existing workspaces receive a one-time visual relayout when they next open the Graph view.
