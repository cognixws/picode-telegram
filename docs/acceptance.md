# Channels V1 adapter acceptance

Status: V1 accepted by the owner on 2026-10-15 with retained validation debt. The core plan in `docs/plans/channels-v1-completion.md`
owns A01–A20 and the final integration receipt. The 47 adapter tests pass;
simulations and the bounded real-bot receipt below do not establish PASS for every acceptance row.
The owner carried residual validation and setup/routing improvements into a
Telegram-only V2 plan, alongside default-off channel tools and separately
enabled inbound Assistant conversations. No V2 code or new adapter is included.

| Conditions | Expected action | Current evidence |
|---|---|---|
| Manifest v3 status transitions | Use the core closed state names, including `pairing` before a chat is paired | Six-state regression fixture PASS; 47 adapter tests PASS |
| Private one-use code, correct account/chat/bot | Pair one owner; never store raw code | Migrated SQLite fixture PASS; real owner pairing/connected state PASS; no secret/code read |
| Stranger, group, bot, expired/reused/predating/undated code | No core effect or acknowledgement | Ledger/channel tests PASS |
| Owner verifies valid candidate token with no webhook | Check identity and webhook; no returned or retained token | Candidate tests PASS; host loopback check/persistence table PASS on core setup branch; UI/real-bot acceptance separate |
| Malformed/rejected token or existing webhook | Refuse before host persistence | Adapter tests PASS; host rejection/no-write table PASS on core setup branch |
| Check in progress, invalid token, blocked chat or other poller | Stop effects until explicit repair/check | Checking/auth/block/conflict simulations PASS; provider receipt UNVERIFIED |
| Title/options default or explicit full-text setting | Only declared masked content leaves | Default-content simulation PASS; real full_text true flow PASS; live prose masking coverage remains UNVERIFIED |
| Current question with unchanged button or text reply | One canonical answer; changed/stale button refuses | Real option Alpha and free text Lime answers PASS, canonical done with ext:telegram/Telegram; stale-option cases simulated |
| Core raw terminal or delivery paused | Hold the owner's message; remote transport cannot force keys | Core V1-0 fixtures; live core-pause/raw-terminal scenarios remain UNVERIFIED |
| Paused channel or pause during a core read | No core write/send; preserve unconsumed update | Tests PASS; real channel held inbound work, resume delivered once; during-read race remains simulated |
| Agent message reply or selected live CLI | Preserve reply mapping/recipient; unknown reply never falls through | Real /agents, selected Pi sends, agent replies and actual Reply conversation/replyTo PASS; stopped recipient refused without Message |
| Duplicate update/event or process crash | Durable receipt/uncertainty prevents automatic duplicate | Tests PASS; real sequential duplicate refused; simultaneous race/crash acceptance UNVERIFIED |
| Known provider/core 429 | Keep durable retry deadline; progress cursor without losing retry | Real HTTP and channel tests PASS |
| Lost core/provider response | Keep uncertain receipt; retry one outbound notice only after explicit owner action | Real dropped HTTP + SQLite/channel tests PASS |
| Known retry no longer present in bounded history | Visible repair in COGNIX; no invented body/history replay | Channel tests PASS |
| Change pairing during in-flight send | Never revive old mappings or send next item to new owner | Channel test PASS |
| Configured extension process restart | Retain pair, selected agent and canonical IDs; new sends work | Real dev restart PASS, including unchanged IDs before a fresh message/reply; not a host restart or backup restore |
| Restore/change bot/disconnect | Clear pairing/handles/cursors; archive authority and require new pairing | Ledger tests PASS; configured restore/change-bot/disconnect flow UNVERIFIED |
| Offline over a day/week without updates | Retention warning; fresh update epoch after possible provider ID reset | Epoch fixture PASS; live outage UNVERIFIED |
| Initial/reset Messages snapshot or non-owner mail | No historical/agent-to-agent/extension mail forwarding | Channel tests PASS |
| Unsignalled clear, due snooze or truncated snapshot | Update only proven-current/unavailable notices; wait until due; truncation is not closure evidence | Reconciliation simulations PASS |

Owner-authorized live receipt (2026-10-15): development HTTPS localhost8445,
extension 0.1.3/code `7a5627e`, installed digest
`2366c784d96d39841c88e36974e74ce6cf5002b5ac9f11695b3f73b8e24f4792`,
from the already owner-authorized public https://github.com/cognixws/picode-telegram.
Managed Pi `channels-qa-dev-8bfabe` used zai/glm-5.3-flash and existing Inbox/Messages;
full_text was true. All 13 live checks PASS: two canonical Inbox answers,
eight delivered Messages (four inbound/four agent replies), actual Reply preserving
its conversation, channel pause/resume once, configured extension restart preserving
pair/selection/IDs and a fresh send, and stopped-recipient refusal without a Message.
Telegram browser UI showed question/answer, PONG, reply, pause and restart markers.
The test CLI was stopped afterward; channel connected/paired, uncertain0. A final
real /agents command displayed the picker for the owner. No secret or pairing code was read.
Evidence: PiCode root `var/qa/channels-live-dev/receipt.json` and this repository's
`docs/handoff/2026-10-15-live-acceptance.md`.

Limits: sequential duplicate refusal is not a simultaneous race. No separate
stranger/group account, webhook conflict, provider outage/rate-limit, configured
backup restore, native clipboard/handoff, WebView2 or physical phone was verified live.
The initial fixture sent to=Owner, while existing owner routing requires
reply_to without an explicit to; correcting the fixture passed. This was a fixture correction,
not a demonstrated product regression. Partial live acceptance does not close all A01–A20.

The eight scratch UI captures cover token setup, pairing, connected, paused,
conflict, uncertain delivery and a busy connection check. They use the real
host iframe and mobile route, with explicitly simulated process metadata
except the real installed `needs-token` state. Final screenshot review passed
after adding the published host token stylesheet; all host overlay audits
were `ok`. They do not validate Telegram delivery, Windows WebView2 or a
physical phone.

Installed scratch lifecycle receipt (2026-10-14): disabling removed the old
process, re-enabling started a new PID, uninstall with data kept preserved an
independent metadata canary, uninstall with data removed deleted its database,
and fresh reinstall did not recreate the canary. No token or pairing existed;
each destructive fixture step first verified that condition. Installed digest:
`e2b75870e7a538ae979f4f3b64579d48fc3aff75c703cc1810462bc7cfac78fe`.
Core runtime version stamp was `0.8.0+18b1857`, with scratch binary SHA-256
`33c834cae2c01d4ffc988ed925c33c2e2e32157c8a45becaf3d67c8cd1290318`;
it predates the core integration merges. This establishes that fixture's
process/data lifecycle, not the current core HEAD or configured-bot recovery.

Core directory/protected-form and trusted-origin scratch acceptance passed
on desktop/mobile Chromium: 34 images were read with overlay audits ok.
Core landed in `88f93c021` with full CI green in 204 seconds; migration 169
keeps captured origin independent of extension removal. At that integration
checkpoint, private pairing, live delivery, configured restart/restore/disable,
native observations and publication had no receipt. The later live receipt above
pays pairing, managed Pi round trips and configured extension restart; publication
was owner-authorized. Configured restore/disable and native acceptance remain open.
Portable extension credentials remain a core backup debt; domain data alone does not restore authority.

Real setup checkpoint (2026-10-14): the owner authorized creation of
`@picode_v1_goat_20261014_bot` (PiCode V1 Test) through the visible BotFather UI.
Only the non-code success prefix was projected; no bot token was read or copied
by the agent. The owner reported saving the token in the host protected form.
The running adapter exposed a previously untested state-name mismatch
(`needs-pairing` versus the host `pairing`); this draft corrects it and covers
all six status transitions. Private pairing and real deliveries are still
UNVERIFIED at this checkpoint.

The corrected runtime package (`286a7b6`, installed digest
`3114da2099d5683277fce57086c02848bada5c90013fafeb8d0c3b0c8c2a0ea2`)
reports `pairing` through the real host projection and identifies the expected
test bot. A synthetic well-shaped invalid candidate was refused with HTTP 400
without reflection; the running valid bot stayed configured. Rechecking the
persisted credential belongs to the configured restart receipt. The native
Open Telegram click did not expose a controllable tab to this agent; its cause
is unverified and the owner manual command remains available. No active pairing
code or real token was captured.

## V2-1 setup candidate — 2026-10-15

The candidate adds bounded host/provider/token diagnostics and explicit token/pairing
steps with expiry/copy guidance. Reported npm test: 51 PASS, including the real
CA-issued TLS fixture. All eight desktop/actual-mobile token-free scratch 8474
screenshots were read and passed visual review with overlay audits ok. Statuses
and pairing commands were simulated; no new real-bot failure acceptance is claimed.
The initial capture set failed state coverage because same-URL navigation retained
the mounted iframe; explicit reload and expected-state waits corrected the captures.
See [the V2-1 handoff](handoff/2026-10-15-v2-setup.md) for states, evidence and limits.
This supersedes the earlier no-V2-code planning checkpoint only for setup work;
no outbound tool family, inbound Assistant entry, version 0.2 publication or
deployed-dev installation is established by this receipt.
