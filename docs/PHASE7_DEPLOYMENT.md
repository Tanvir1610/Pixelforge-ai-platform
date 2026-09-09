# Deployment (Phase 7)

```
passing build → upload → host build → poll → live URL
```

## The gate

`start_deployment` refuses a version whose build did not pass, and refuses one
that was never built at all. The rule lives in the database, not in application
code, because *never publish broken output* has to hold even when a caller
forgets to check. Both paths are tested.

`start_deployment` is also what opens the record, so nothing is uploaded before
the gate runs.

## One interface, three hosts

Each host has a different API shape, a different status vocabulary and a
different idea of what an upload is. None of that reaches the orchestrator.

| Host | Upload model | Status source |
| --- | --- | --- |
| Vercel | Files inline with the deployment | `readyState` |
| Netlify | SHA-1 digest first, then only missing files | `state` |
| Cloudflare Pages | Multipart direct upload | `latest_stage.name` + `status` |

Details that bite:

- **Netlify is two-phase by design.** Post a digest, get back only the hashes it
  lacks, upload those. Re-deploying a project where one file changed uploads one
  file — that is the whole point of the API.
- **Cloudflare wraps everything in `{ success, result, errors }`.** A 200 with
  `success: false` is still a failure. Missing that produces a deployment that
  silently never appears.
- **Cloudflare only means "live" when the `deploy` stage succeeds.** A successful
  `build` stage just means it moved on.
- **Vercel's alias is the stable production URL**; the deployment URL is
  per-build. The alias is preferred when present.

An unrecognised status maps to *still running*, never to done. A new host state
should delay a result, not fabricate a success.

## Secrets never enter the file set

Environment variables are sent in the deploy request, not written into files.
Writing them into the project would commit them to version history and hand them
to anyone who exports the repository.

`deployment_credentials` has **no client policy at all** — a deploy token can
create and destroy infrastructure on a customer's account, so only the service
role reads it. `my_deployment_connections()` exposes the account label and
nothing else. Tested: even the organization owner reads zero rows from that
table.

## Polling

The loop lives in one place rather than in each provider, so backoff, timeout
and terminal-state policy are decided once. Exponential from 1s to an 8s
ceiling: responsive early, and not hammering the host through a five-minute
build. Every observed state is written through, so the deploy screen tracks the
host rather than guessing from elapsed time.

Time is injectable, so the tests exercise the backoff curve and the timeout
without waiting.

## Retry policy

Idempotent status polls retry on 429 and 5xx, honouring `Retry-After`. **A
failed deploy request is never retried** — on a deploy API that risks creating
two deployments from one click.

## What "live" means

`finish_deployment` sets the project to `live` and meters the deployment only on
success. A failed deployment is recorded but not metered, and does not change
the project's status. Tested both ways.

## Honest gap

**No provider was exercised against a real API.** `api.vercel.com`,
`api.netlify.com` and `api.cloudflare.com` are all blocked from this
environment.

Unlike the browser in Phase 6, `fetch` is injectable here, so request shape,
auth headers, status mapping, envelope handling and error classification are all
covered — 17 tests against a fake transport. What remains unverified is the wire
itself: whether the real APIs accept these exact payloads. Expect to adjust
field names on first contact; the shape of the code should hold.

## Custom domains

`project_domains` stores the verification record relationally rather than as a
blob, because the UI has to show the user exactly which DNS record to create and
support has to be able to see what we asked for. The value is surfaced
**verbatim** — someone pasting it into a registrar needs it byte-identical.

Two constraints are enforced by the database rather than by convention: a domain
must look like a domain (it is sent straight to a host API), and a project can
have at most one primary domain, via a partial unique index.

Host behaviour differs and each needed care:

- **Vercel** returns the challenge to display. No challenge yet means the host
  is still working it out, so that maps to *verifying*, not *failed* — calling
  it failed sends users chasing a problem that does not exist.
- **Netlify** has no per-domain challenge; it verifies by CNAME to the site
  hostname. SSL only provisions once DNS resolves, so the presence of an SSL URL
  covering the domain is the real signal that it worked.
- **Cloudflare** exposes a status list; `active` is verified, `blocked` and
  `error` are failures, everything else is still in progress.

Verification results are written by `set_domain_verification`, which is revoked
from `authenticated`. A user marking their own domain verified would let them
claim a domain they do not own.

## Rollback

`rollback_deployment` is additive, like the code-version restore: it creates a
**new** deployment publishing the older version, records `rolled_back_from`, and
leaves the original untouched. A rollback can itself be rolled back.

It refuses to roll back to a deployment that never went live. Publishing output
nobody has ever seen working is the opposite of what a rollback is for.

Authorization and the build gate are re-checked, because it delegates to
`start_deployment` rather than inserting directly.

## Host OAuth

The state token is 32 bytes of CSPRNG, stored server-side and consumed exactly
once by an atomic `UPDATE ... RETURNING` in Postgres. Without it, an attacker can
complete a callback against a victim's session and attach **their own** host
account to the victim's organization — every subsequent deployment would go to
the attacker's infrastructure.

The callback validates the state *before* exchanging the code: doing it the
other way spends a real authorization code on a request about to be rejected,
and signals to an attacker that their guess was close. Unknown, expired and
replayed states all return the same error, since the difference is only useful
to someone probing.

`oauth_states` has no client policy, and the redirect path is restricted to
same-origin relative paths so the callback cannot be turned into an open
redirect.

## Still not built

Automatic DNS provisioning for registrars we could integrate with, and
refresh-token rotation for hosts whose tokens expire (the column exists; nothing
rotates yet).

## Status

Implemented: the provider interface, all three clients, the polling loop, the
build gate, phase tracking, credential isolation, metering, stage orchestration,
custom domains with verification, additive rollback, and the OAuth connect flow
with single-use state.
