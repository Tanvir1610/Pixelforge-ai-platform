# AI architecture

## The pipeline is not Figma → LLM → code

```
Figma → Parser → Design IR → Design analysis → Design plan
      → Implementation plan → Component plan → Code generation
      → Build → Test → Screenshot → Visual diff → Fix → Rebuild → Validate
```

Each stage produces structured output that is persisted and inspectable. A run
that fails at stage 7 does not discard stages 1–6.

## Agents

| Agent | Reads | Produces |
| --- | --- | --- |
| Design Analyst | Design IR | semantic roles, confidence |
| Architecture Planner | IR + tokens | folder structure, routing |
| Component Planner | detected components | component boundaries and props |
| Code Generator | plans + tokens | files, incrementally |
| Responsive Engineer | constraints + hints | breakpoint rules |
| Visual QA | reference + actual screenshots | scored difference regions |
| Debugging Agent | build errors + source | targeted patches |
| Refinement Agent | user request + code index | scoped diffs |
| Deployment Agent | build output | host configuration |

Agents do not edit the project freely. They call tools, and every call is
recorded in `ai_tool_calls` with its arguments and outcome.

## Persistence

`generation_runs` (status, progress, error) → `generation_steps` (one per stage)
→ `ai_messages` (with a `proposal` column holding structured changes awaiting
approval) → `ai_tool_calls` → `model_runs` (tokens, cost, latency, provider).

This is also the training-data pipeline (§35): IR, generated code, human
corrections, visual scores and accepted/rejected outcomes are all already rows.

## Generation is incremental

Architecture → folder structure → tokens → global styles → layout → components
→ pages → interactions → responsive → validation. Generating a whole project in
one model response is the single largest source of hallucinated, broken output.

## Editing beats regenerating

Once code exists, changes are targeted: read the file, search the index, replace
a region, produce a diff, version it. `code_versions` and `generated_files` make
rollback cheap, so an AI mistake never costs working code.

## Streaming

The UI shows safe progress messages — "Analysing layout…", "Generating Hero
component…". Internal reasoning is never streamed to the user.

## Status

Schema, message model and orchestration contracts are defined. The agents and
tool system are Phase 3–4; nothing in this document is claimed to run today.
