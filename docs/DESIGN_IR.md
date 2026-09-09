# Design IR

The platform's own representation of a design, defined in
`lib/design-ir/types.ts` and stored in `design_nodes`.

## Why not raw Figma JSON

- It couples every downstream stage to one vendor's API shape.
- It is far larger than the model needs; most of it is rendering detail.
- It carries no semantics — a `RECTANGLE` is not a "button".
- It cannot represent designs from anywhere else.

The IR is normalised, typed and semantic. A second importer (Sketch,
screenshots, an existing codebase) targets the same IR and everything downstream
keeps working.

## Shape

```
DesignDocument
  frames[]                 one per artboard / breakpoint
  nodes: Record<id, IrNode>   flat map — O(1) lookup, maps to one table
  tokens[] components[] assets[]
```

`IrNode` carries: identity and tree position (`parentId`, `childIds`,
`orderIndex`, `depth`), geometry (`box`), `layout` (mode, gap, padding,
alignment, hug/fill sizing, grid columns), `style`, `typography`, `constraints`,
`responsiveHints`, `interactions`, and the analysis output — `semanticRole` and
`confidence`.

A flat map rather than a nested tree: lookups are constant time, the structure
maps directly onto one table, and cycles are impossible to serialise by accident.

## Observed vs derived

`constraints` are read from the file. `responsiveHints` are inferred by the
analyser. They are separate fields because the UI shows the difference — the
responsive screen badges a breakpoint "Derived" when we worked it out rather
than read it. Users should always know which is which.

## Semantic roles

An open vocabulary. The union lists what the detector emits today; `(string & {})`
keeps autocomplete while allowing new roles without a schema migration, per §12.

## Confidence

0–100 per node. `lowConfidenceNodes(document, 85)` returns everything below
threshold, worst first — this is what the design-understanding screen asks the
user to review before generating. Correcting a mapping there is much cheaper
than a refinement pass afterwards.

## Helpers

`walk(document, rootId)` — depth-first traversal.
`findByRole(document, role)` — every node with a role, in document order.
`lowConfidenceNodes(document, threshold)` — review queue.

## Status

Types, traversal and the storage schema are implemented and unit-tested. The
Figma importer that populates a `DesignDocument` is Phase 2.
