# Channels V1 adapter acceptance

Status: draft. The core plan in `docs/plans/channels-v1-completion.md` owns
A01–A20 and the final integration receipt. Passing simulations below are
adapter evidence, not real-bot or complete-V1 acceptance.

| Conditions | Expected action | Current evidence |
|---|---|---|
| Manifest v3 status transitions | Use the core closed state names, including `pairing` before a chat is paired | Six-state regression fixture PASS; 46 adapter tests PASS |
| Private one-use code, correct account/chat/bot | Pair one owner; never store raw code | Real migrated SQLite fixture PASS |
| Stranger, group, bot, expired/reused/predating/undated code | No core effect or acknowledgement | Ledger/channel tests PASS |
| Owner verifies valid candidate token with no webhook | Check identity and webhook; no returned or retained token | Candidate tests PASS; host loopback check/persistence table PASS on core setup branch; UI/real-bot acceptance separate |
| Malformed/rejected token or existing webhook | Refuse before host persistence | Adapter tests PASS; host rejection/no-write table PASS on core setup branch |
| Check in progress, invalid token, blocked chat or other poller | Stop effects until explicit repair/check | Checking/auth/block/conflict simulations PASS; provider receipt UNVERIFIED |
| Title/options default or explicit full-text setting | Only declared masked content leaves | Default-content simulation PASS; core masking corpus/live opt-in UNVERIFIED |
| Current question with unchanged button or text reply | One canonical answer; changed/stale button refuses | Channel tests PASS; core persisted options landed; real-bot question flow UNVERIFIED |
| Core raw terminal or delivery paused | Hold the owner's message; remote transport cannot force keys | Core V1-0 fixtures; live CLI receipt UNVERIFIED |
| Paused channel or pause during a core read | No core write/send; preserve unconsumed update | Channel tests PASS |
| Agent message reply or selected live CLI | Preserve reply mapping/recipient; unknown reply never falls through | Channel tests PASS; live CLI receipt UNVERIFIED |
| Duplicate update/event or process crash | Durable receipt/uncertainty prevents automatic duplicate | Ledger/channel tests PASS |
| Known provider/core 429 | Keep durable retry deadline; progress cursor without losing retry | Real HTTP and channel tests PASS |
| Lost core/provider response | Keep uncertain receipt; retry one outbound notice only after explicit owner action | Real dropped HTTP + SQLite/channel tests PASS |
| Known retry no longer present in bounded history | Visible repair in COGNIX; no invented body/history replay | Channel tests PASS |
| Change pairing during in-flight send | Never revive old mappings or send next item to new owner | Channel test PASS |
| Restore/change bot/disconnect | Clear pairing/handles/cursors; archive authority and require new pairing | Ledger tests PASS; installed restart/restore flow UNVERIFIED |
| Offline over a day/week without updates | Retention warning; fresh update epoch after possible provider ID reset | Epoch fixture PASS; live outage UNVERIFIED |
| Initial/reset Messages snapshot or non-owner mail | No historical/agent-to-agent/extension mail forwarding | Channel tests PASS |
| Unsignalled clear, due snooze or truncated snapshot | Update only proven-current/unavailable notices; wait until due; truncation is not closure evidence | Reconciliation simulations PASS |

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
keeps captured origin independent of extension removal. Remaining delivery
gates: private pairing, real bot/live-CLI round trips, configured
restart/restore/disable receipts, native handoff observations and publication authorization. The
adapter has no published remote yet. Portable extension credentials remain
a core backup debt; installed domain data alone does not restore authority.

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
