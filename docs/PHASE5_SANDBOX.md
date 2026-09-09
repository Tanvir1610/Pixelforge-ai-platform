# Code generation and the sandbox (Phase 5)

```
plans → generate per step → one version → sandbox build → repair → version
```

## Generation is stepwise

The generator writes one build-order step at a time, not a whole project in one
response (§17). Asking for everything at once is the largest single source of
hallucinated imports and truncated files: the model loses track of what it
already wrote, and one bad token ruins the whole output.

Stepping also makes failure partial. If components generate and pages do not,
the components still exist and the retry is cheap.

Each step is told which files already exist, so imports resolve against reality
rather than the model's memory of what it intended to write.

## One version per generation

Files accumulate in memory across steps and are committed as a **single**
version. A project is never half-generated on disk, and a crash mid-run leaves
the previous version intact.

## The sandbox

`LocalSandbox` is the development and CI backend. Its controls, all tested by
executing real processes:

**Environment is an allowlist, not a denylist.** The parent process holds
Supabase service keys, model API keys and Figma tokens. Inheriting `process.env`
would hand all of them to untrusted code, so only `PATH`, `HOME`, `NODE_ENV`,
`CI` and npm's own cache settings are passed. A test asserts a secret set on the
parent is invisible to the child.

**`shell: false` everywhere.** Arguments are passed as an array, so a filename
containing `; rm -rf /` stays a filename. Tested.

**Timeouts kill the process group**, not just the direct child — npm spawns
children that outlive it. `detached: true` plus `kill(-pid)`.

**Output is bounded.** A runaway process producing gigabytes of logs is
truncated at 512 KB rather than buffered into the worker's heap.

**`npm install --ignore-scripts`** is the most important flag in the pipeline.
Without it a dependency's `postinstall` runs arbitrary code the instant install
begins, before any other control applies. Generated projects have no legitimate
need for install scripts.

**Paths are re-validated at materialise time.** The write path already checked
them, but this is the last point before bytes hit a real filesystem, and
`resolve()` collapses any traversal the string check missed.

### Honest limits

Process isolation is weaker than a container: no cgroup memory cap, no network
namespace, no user namespace. `build_runs.sandbox_backend` records which backend
ran a build precisely because that determines how much to trust it. Production
needs the container backend; the `Sandbox` interface exists so it drops in
without touching the orchestrator.

## The repair loop

Build output becomes structured errors — file, line, code, message — and those
feed a bounded repair pass. Errors are ordered by phase, earliest first, because
fixing one missing import removes the dozen type errors it caused.

The loop is capped at two repairs by default. A model that cannot fix its own
output in two passes will not fix it in ten, and an uncapped loop spends a
user's whole credit balance discovering that.

Every parser degrades to a single unparsed error rather than returning nothing:
an error we cannot parse still has to reach the user. A non-zero exit with no
parseable output becomes an `EXIT_n` error carrying the last few lines.

## Status

Implemented: the generator agent, stepwise generation, the generation stage with
versioning, the local sandbox, the build pipeline, error parsing and
prioritisation, build persistence, and the bounded repair loop.

Not implemented: the container sandbox backend, a running preview server (builds
are checked, not served), and browser automation for screenshots — which is what
Phase 6's visual comparison needs.
