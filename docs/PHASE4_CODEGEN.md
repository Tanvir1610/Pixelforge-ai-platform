# Planning, tools and versioning (Phase 4)

## Planning is two sequential stages

```
analysis → architecture plan → component plan
```

Sequential on purpose. The component planner needs the directory layout the
architecture planner chose; running them in parallel produces two plans that
disagree about where files live, and reconciling that afterwards costs more than
the extra call.

Planners read the **analysis**, not the raw IR. The sections were already
identified in Phase 3, and re-deriving them would spend context and risk two
stages describing the same page differently.

### Settings beat the model

Framework, styling and TypeScript are settings the user chose explicitly. A
model that suggests Vue for a Next.js project is overruled silently, and routes
or directories containing `..` or a leading `/` are dropped. Tested.

### Component extraction

`findRepeatedStructures` groups nodes by a deliberately coarse signature — role,
child count, size rounded to 20px, layout mode. Two cards differing by three
pixels are the same component; an exact signature would miss that.

The model judges candidates rather than scanning for them: cheaper, and more
reliable. Single-instance UI primitives (button, input, badge, avatar, card)
are kept as candidates because they are worth extracting even once.

The planner is also asked what it deliberately left inline, and why. Over-
abstraction is a real failure mode, and making the model justify a non-decision
discourages it.

## The tool system

Agents do not touch the database. They call tools, and the registry does
authorisation once — in one place, so a new tool cannot accidentally widen what
an agent may do.

`ToolContext.allowedModes` is the ceiling. A planner runs with `READ_ONLY` even
though write tools exist in the registry; naming one is refused regardless.
Tools are advertised to the model filtered by the same set, so it never sees a
tool it cannot call.

Every call is validated against a Zod schema and recorded in `ai_tool_calls`
with its arguments, mode, outcome and duration. Arguments are stored, results
are not — a result can be a whole file, and the ledger is for auditing
decisions, not for holding content.

Tool failures are **returned, not thrown**. A model calling a tool wrongly is an
ordinary event the agent loop recovers from by trying again, not an exception
that aborts a generation. Ledger writes that fail are swallowed for the same
reason: observability must not become control flow.

### Writes are staged

`write_file` and `delete_file` stage changes rather than writing rows. The
orchestrator commits them as one version, so a generation is atomic — either the
whole file set lands or none of it does, and a crash mid-run cannot leave a
half-written project.

## Versioning

Every generation produces a version. Versions are immutable once written and
form a chain through `parent_version_id`.

**A version is a complete snapshot**, not a delta. Untouched files are carried
forward marked `unchanged`, so reading a version never walks the parent chain.
Content is hashed to decide what actually changed, keeping the write path
proportional to the diff rather than the project size.

**Deletions are explicit.** A generation that touches two files must not be read
as deleting everything else, so `diffFileSet` only deletes paths it was given.

**Version numbers are assigned in Postgres** under a row lock on the generated
project. Doing it in application code would be a race between two concurrent
generations.

**Restore is additive.** `restore_code_version` copies an old file set forward
into a *new* version rather than rewinding. History stays intact, and a restore
can itself be undone. A user never loses working code to an AI mistake (§27).

## Path safety

Generated code is untrusted output. `isSafePath` rejects `..`, absolute paths,
drive letters, null bytes and empty segments, and it is applied in three places:
the file tools, the version write path, and the planners' output filtering.
Rejected paths are reported rather than silently dropped — a model emitting
`../../.env` is a signal worth surfacing.

## Status

Implemented: both planners, planning stage orchestration, the tool system with
authorisation and ledger, design and file tools, staged writes, the diff engine,
version storage and restore.

Not implemented: the Code Generator itself (the agent loop that calls
`write_file` per build-order step), the sandbox that runs the result, and
streaming progress from within a tool call.
