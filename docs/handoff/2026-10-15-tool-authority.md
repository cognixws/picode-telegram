# 2026-10-15 — tool-authority: match the sole Channels tool permission
Version 0.3.1 updates Telegram setup/help, README and protocol documentation for core ADR-0332: enable channels on the caller; no separate Access grant or Assistant workspace admission.
The Assistant picker consumes the host-provided lifecycle revision as an opaque value, including negative versions; stale picks fail closed after a switch change. CLI V1 Messages behavior remains independent.
Reply refusal wording directs the owner to current tool/connection availability without inventing a cause. No iframe JSX/CSS/layout, schema or credential change.
Verification: npm test PASS, exit 0, 74 tests, zero failures/skips; /tmp/telegram-tool-authority-tests.log. Added empty-directory guidance and negative lifecycle/stale-picker tests.
The first new test attempt used a nonexistent guessed helper; corrected to the actual bindHandle helper before PASS. No product failure was diagnosed from that test-harness error.
Source scope: README.md, docs/protocol-v2.md, package.json, picode-extension.json, server/channel.mjs, server/v2.mjs and test/v2.test.mjs; no Makefile/close-summary exists in this repository.
visual-review: n/a — no rendered layout change; companion core passed eight isolated desktop/phone captures, not a new adapter visual/provider receipt.
Historical 0.3.0 live Telegram evidence used the superseded grant policy and does not prove this correction in deployed use.
Publication/install: code 30c13a8 fast-forwarded and pushed to GitHub main, exit 0; normal GitHub preview/install on dev8445 installed 0.3.1, digest 5d2b04e587f399e05825f34214ed4e74b19400afa9359502ce18ca45714f1296. Channel observed connected/paired/unpaused/uncertain0. Later docs-only pushes are distinct from this installed package receipt.
Companion core officially landed a5c3b417e with full CI PASS in 233s; recorded TestResponseLanguageInAssembledTurn retry recovered. Observed runtime 0.8.0+31dd242 still used the old policy; integration/install does not establish deployed new-policy behavior.
Receipts: PiCode root var/qa/channels-tool-authority/{install-receipt,archive}.json; nine bounded visual files archived without databases or keys.

## Next up

- Owner deploy of integrated core, CLI restart and real Telegram validation of the sole tool switch follow these publication/install receipts.

## Debts

- Existing failure/rate, configured restore, Windows WebView2 and physical-phone evidence gaps remain in the PiCode Channels topic.
