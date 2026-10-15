# Channels V2 adapter contract

Core decisions: ADR-0330, amended by ADR-0332 in PiCode. This adapter requires manifest API 4 and
`channelProtocol: 2`; Node.js 24 remains an optional extension runtime.
Telegram remains the only provider. V1 Inbox and CLI Messages transport is
independent of V2 outbound tools and tool-enabled Assistant entry.

## Authority and routing

The host owns caller identity, tool-family settings, lifecycle versions, turn scope,
operation IDs, masking and canonical Assistant turns. The adapter owns provider
calls and one paired private owner chat. Neither tool text nor an extension
request can choose another provider recipient. The eight manifest permissions
retain the five V1 doors and add `channels:send`, `assistants:read` and
`assistants:message`; installation/pairing alone grants no V2 caller access.

After configuration and pairing/pause changes the adapter registers
`{session,paired,paused}` at `POST /api/ext/v2/channel/session`. Session is a
SHA-256 hash of the adapter's random pairing generation, without provider IDs.
It is stable across process restart. The host returns a distinct connection
generation used in input bindings and selection. Sync is serialized; uncertain sync
blocks effects until confirmation. Resume/disconnect HTTP handlers await it.
Bot change, disconnect and restore clear pairing and selected target. Host
restore generation invalidates old authority even when domain data survives.

`/agents` and `/assistants` use one `{kind,id,generation,revision}` selection.
Opaque callbacks expire after ten minutes, bind to their Telegram message and
current picker revision, and become stale when either picker opens or a target
is selected. Legacy CLI selection migrates once; old CLI buttons refuse.
Assistant names/revisions come only from the tool-enabled host directory. An empty
directory directs the person to enable Channels in the Assistant tools.

Assistant text uses `POST /api/ext/v2/assistants/messages` with an immutable
update-epoch/update-ID request key. Reply uses the persisted canonical message
binding and omits the selected target; the host resolves and rechecks the
original Assistant/tool lifecycle. Unknown replies never fall through. Input receipt IDs
are retained without bodies so startup/reset/minute-independent reconciliation
can return only their automatic canonical responses, without forwarding V1
history. Every Assistant response rechecks
`POST /api/ext/v2/assistants/replies/check` immediately before provider dispatch,
including after waiting behind another send. Local Assistant history is never
a subscription source. The core separately controls durable turns and holds.

Include message text must be the saved boolean `true` for tool sends, new
Assistant input and automatic Assistant responses. It is reread before the
provider effect; V1 notices reconstruct their body at that point too. With it
off, V1 title/options remain usable. Turning it off does not retract past sends.
An Assistant uses its existing memory, enabled tools and ordinary owner reach.
There is no second workspace or per-connection grant. Non-local origin, execution
holds and credential-input restrictions remain enforced by the core.

## Protected process endpoints

Both declared routes require the host process proxy secret; their HTTP errors
never echo submitted bodies or provider exceptions.

| Endpoint | Request | Response |
|---|---|---|
| `POST /v2/send` | `{operation,session,payloadHash,text}` | `{operation,payloadHash,state}` |
| `POST /v2/receipt` | `{operation,session,payloadHash}` | Same metadata, without a send |

`operation` is the opaque host operation ID, 1–128 printable ASCII bytes;
`session` and exact UTF-8 text SHA-256 `payloadHash` are 64 lowercase hex bytes.
Text is nonempty, at most 16 KiB UTF-8; Telegram tool sends additionally refuse
more than 4,096 UTF-16 units instead of silently shortening them. V1/automatic
notices retain visible ellipsis shortening. The send HTTP envelope is bounded
at 112 KiB to accommodate JSON escaping of the 16 KiB body; other requests
retain the 16 KiB bound. No body or token is retained in the operation ledger.

The adapter durably claims the host ID before any provider effect. Session and
payload hash are immutable attributes. Duplicate matching requests return only
the recorded state; changed attributes refuse. `dispatching` projects as
`uncertain` until known completion, and becomes uncertain on process startup.
A receipt read never calls Telegram. Known sent/refused receipts may reconcile
a lost host response; unknown effects never enter the V1 retry mechanism.

Tool sends refuse while the serialized provider queue is busy. Consent/pairing
checks have an 18-second pre-dispatch window; Telegram writes have the existing
15-second deadline. A write already dispatched may finish after the host's
response deadline, so the host truthfully retains uncertainty and may read the
receipt. No deferred tool send survives in an in-memory or restored queue.
A known 429 is terminal for that operation; new deliberate operations respect
`retry_after`. V1 notices retain their existing known-refusal retry behavior.

Unsolicited tool text has no canonical Messages conversation. Reply to such a
message refuses with picker guidance. Choosing a CLI uses the existing V1
Messages path; choosing an Assistant uses tool-enabled entry. The Channels tool
switch authorizes Assistant entry. Lifecycle revisions are opaque signed integers: the core uses negative
versions for tool-authorized inputs, invalidating old pickers when the switch
changes. The adapter preserves these exactly; it never creates caller grants.

## Persistence and recovery

Migration 002 adds `operations` and `targets` to the existing extension domain
SQLite database; no new file or credential source is introduced. The core's
extension-domain backup coverage includes both tables, independent of sessions
and secrets options. The portable-credential exclusion remains unchanged.
Operation IDs survive disconnect, pruning, restore and bot change. At 10,000
operations new keys refuse rather than evict an uncertain key into a new effect.
Target handles are transient authority and are cleared at pairing boundaries.

The independent fixed-SQL V1 writer tests upgrade, one-time selection migration,
retained historical mapping, restored pairing invalidation and startup unknown
operations without calling current writers. Main-database grant/operation
four-option and pre-migration recovery fixtures belong to core ADR-0330.

## Decision table

| Conditions | Action | Evidence |
|---|---|---|
| Exact concurrent operation or repeat receipt | One provider call; duplicate reads metadata | Real SQLite/protected HTTP fixtures |
| Changed hash/session on existing key | Refuse; retain prior receipt | V2 operation fixture |
| Unknown write/crashed dispatch/restore | Preserve uncertain key; never retry | Drop simulation, reopen and fixed-SQL recovery |
| Text off/stale pairing/paused/busy queue/oversize/expired dispatch | Refuse before provider effect | Negative operation/queue/body fixtures |
| Known 429 | Terminal tool refusal; next operation respects delay | Fake-clock provider fixture; V1 retries separately covered |
| New picker/selected target/expired callback | Old handle refuses | Interleaved typed-picker fixture |
| Reply to Assistant A while CLI/B selected | Canonical A binding; no fallback | Routing fixture; host grant checks in core tests |
| Queued reply revoked or text disabled | No Assistant body; do not misdiagnose blocked bot | Final-dispatch guard fixture |
| Startup/reset snapshot with pending V2 response | Only matching canonical response is reconciled | Snapshot/input receipt fixture |
| Session sync response unknown | Block until confirmed | Host-failure/recovery fixture |

These fixtures do not establish real V2 Telegram/CLI/Assistant, configured
restore, stranger/group account, native/WebView2 or physical-phone acceptance.
V1's accepted live receipt and its residual A01–A20 debts remain separate.
