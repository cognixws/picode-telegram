# 2026-10-15 — tool-authority: match the sole Channels tool permission
Version 0.3.1 updates Telegram setup/help, README and protocol documentation for core ADR-0332: enable channels on the caller; no separate Access grant or Assistant workspace admission.
The Assistant picker consumes the host-provided lifecycle revision as an opaque value, including negative versions; stale picks fail closed after a switch change. CLI V1 Messages behavior remains independent.
Reply refusal wording directs the owner to current tool/connection availability without inventing a cause. No iframe JSX/CSS/layout, schema or credential change.
Verification: npm test PASS, exit 0, 74 tests, zero failures/skips; /tmp/telegram-tool-authority-tests.log. Added empty-directory guidance and negative lifecycle/stale-picker tests.
The first new test attempt used a nonexistent guessed helper; corrected to the actual bindHandle helper before PASS. No product failure was diagnosed from that test-harness error.
Source scope: README.md, docs/protocol-v2.md, package.json, picode-extension.json, server/channel.mjs, server/v2.mjs and test/v2.test.mjs; no Makefile/close-summary exists in this repository.
visual-review: n/a — no rendered layout change; companion core passed eight isolated desktop/phone captures, not a new adapter visual/provider receipt.
Historical 0.3.0 live Telegram evidence used the superseded grant policy and does not prove this correction in deployed use.
Merge/publication/install: not performed by this closing reviewer; report exact receipts separately. Owner deployment remains separate.

## Next up

- Publish/install the compatible adapter after core integration, then validate the sole tool switch with the real Telegram bot.

## Debts

- Existing failure/rate, configured restore, Windows WebView2 and physical-phone evidence gaps remain in the PiCode Channels topic.
