# 2026-10-15 — live-acceptance: record real Telegram and managed Pi round trips
Owner-authorized development acceptance on HTTPS localhost8445; publication/install had already been authorized and completed at https://github.com/cognixws/picode-telegram.
Installed adapter 0.1.3/code7a5627e, digest 2366c784d96d39841c88e36974e74ce6cf5002b5ac9f11695b3f73b8e24f4792; full_text true. The adapter's 47 tests PASS; this docs session ran no new gates.
Real managed Pi channels-qa-dev-8bfabe used zai/glm-5.3-flash and existing Inbox/Messages tools; V2 channels tools remain absent/default-off.
Receipt: PiCode root var/qa/channels-live-dev/receipt.json, 2026-10-15T14:18:14Z; all 13 live checks PASS, no secret or pairing code read.
Two Telegram Inbox replies, option Alpha and text Lime, became canonical done answers with ext:telegram/Telegram origin; sequential duplicate refused.
Actual /agents selection, Telegram-to-Pi messages and agent-to-owner replies passed; eight canonical Messages (four inbound/four replies) were delivered. Actual Reply preserved its conversation and replyTo.
Channel pause held inbound work; resume delivered once. Configured extension restart retained pairing, selection and canonical IDs before a fresh message/reply succeeded.
A stopped recipient was refused without creating a Message. Browser Telegram showed question/answer, PONG, reply, pause and restart markers.
After tests the CLI was stopped; channel connected/paired, uncertain0. A final /agents command visibly opened the picker for the owner.
Fixture history: initial to=Owner send failed under existing reply-only owner semantics; reply_to without to passed. This is not a demonstrated product regression.
Limits: sequential duplication is not a simultaneous race; strangers/groups, webhook conflict, provider outage/rate-limit, configured backup restore, other CLIs, native/WebView2 and physical-phone acceptance remain unverified.
visual-review: no new screenshot verdict; live browser observations above are bounded behavior receipts. Earlier synthetic desktop/mobile copy captures passed separately.
Partial V1 acceptance only; portable extension credentials and remaining core A01–A20 rows stay open. No source change or new publication/install was performed by this docs session.
