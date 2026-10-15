# 2026-10-14 — telegram-v1-draft: prepare the Telegram transport
Implemented on feat/v1: a draft extension carrying existing Inbox and Messages to one private paired Telegram chat; no direct Assistant entry.
Runtime: Node.js >=24 builtins, including SQLite; no npm dependencies or hosted relay. Node is optional adapter infrastructure, not a PiCode requirement.
The ledger stores identities, opaque handles, cursors and receipts; explicit uncertainty, throttling and reconciliation avoid automatic duplicate effects.
Verified: npm test PASS, 46 tests using migrated SQLite and simulated provider/core responses; strict boolean full-text opt-in covered; complete V1 acceptance is not claimed.
visual-review: PASS — all eight desktop/actual-mobile scratch PNGs read, including pairing code, privacy footer, errors, uncertainty and busy check; host audits ok.
Installed visual/lifecycle fixture digest: e2b75870e7a538ae979f4f3b64579d48fc3aff75c703cc1810462bc7cfac78fe; this is a historical fixture, not the current draft package.
Scratch runtime: core 0.8.0+18b1857, predating the integration merges.
Core binary SHA-256: 33c834cae2c01d4ffc988ed925c33c2e2e32157c8a45becaf3d67c8cd1290318.
Lifecycle JSON: disabling removed the old PID; Keep data preserved the independent canary; Remove data deleted the database; fresh reinstall ran without the canary.
Mobile Bot settings navigation reached the protected password field without reading or saving values; this is not pre-save provider validation.
Limits: lifecycle had no token or pairing; other UI states used canned process metadata. No real bot, live CLI, Windows shell or physical-phone acceptance.
Current draft declares manifest v3 with /settings/check and /status (core ADR-0327); 46 adapter tests PASS again after the declaration change.
Core setup/origin landed in 88f93c021 with full CI PASS in 204s; 34 desktop/mobile Chromium captures PASS, audits ok; channel migration 169 retains Assistant trace 168.
Remaining: private pairing, real bot/live-CLI round trips, configured restart/restore, native handoff observations, portable credentials and publication authorization.
V2 channels tools remain absent and default-off by decision; connecting this transport is not an agent tool grant.
Delivery: remote creation/push, publication and deployment were not performed; this remains an unpublished local draft.
Real setup found/fixed a needs-pairing/pairing contract mismatch; six-state regression PASS. BotFather created @picode_v1_goat_20261014_bot; owner entered the token, no agent secret reads; private pairing/delivery still unverified.
Installed runtime 286a7b6 / digest 3114da2099d5683277fce57086c02848bada5c90013fafeb8d0c3b0c8c2a0ea2 authenticated the expected bot; a synthetic invalid candidate was refused without reflection; persisted-secret recheck awaits restart.
