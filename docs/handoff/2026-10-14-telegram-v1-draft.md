# 2026-10-14 — telegram-v1-draft: prepare the Telegram transport
Implemented on feat/v1: a draft extension carrying existing Inbox and Messages to one private paired Telegram chat; no direct Assistant entry.
Runtime: Node.js >=24 builtins, including SQLite; no npm dependencies or hosted relay. Node is optional adapter infrastructure, not a PiCode requirement.
The ledger stores identities, opaque handles, cursors and receipts; explicit uncertainty, throttling and reconciliation avoid automatic duplicate effects.
Verified: npm test PASS, 45 tests using migrated SQLite and simulated provider/core responses; strict boolean full-text opt-in covered; complete V1 acceptance is not claimed.
visual-review: PASS — all eight desktop/actual-mobile scratch PNGs read, including pairing code, privacy footer, errors, uncertainty and busy check; host audits ok.
Installed visual/lifecycle fixture digest: e2b75870e7a538ae979f4f3b64579d48fc3aff75c703cc1810462bc7cfac78fe; latest source adds only backend opt-in hardening.
Scratch runtime: core 0.8.0+18b1857, predating the integration merges.
Core binary SHA-256: 33c834cae2c01d4ffc988ed925c33c2e2e32157c8a45becaf3d67c8cd1290318.
Lifecycle JSON: disabling removed the old PID; Keep data preserved the independent canary; Remove data deleted the database; fresh reinstall ran without the canary.
Mobile Bot settings navigation reached the protected password field without reading or saving values; this is not pre-save provider validation.
Limits: lifecycle had no token or pairing; other UI states used canned process metadata. No real bot, live CLI, Windows shell or physical-phone acceptance.
Remaining: host pre-save validation/Channels list, Inbox options/visible origin, live bot/CLI, installed restart/restore beyond this fixture, portable credentials and publication authorization.
V2 channels tools remain absent and default-off by decision; connecting this transport is not an agent tool grant.
Delivery: external main integration, remote creation/push and publication were not performed.
