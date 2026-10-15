# 2026-10-15 — pairing-copy: recover when clipboard writing is blocked
The user screenshot showed a raw DOMException after Copy command: the opaque sandbox's Permissions Policy blocked navigator.clipboard.writeText.
Version 0.1.3 checks policy and attempts clipboard writing where available; blocked, unavailable or rejected writes select the visible command and explain Ctrl+C, Command+C or touch Copy.
The UI reports copied success only after an awaited write succeeds; it never reads the clipboard and adds no host permission door.
Verification: npm test PASS, 47 tests. Token-free scratch 8473 browser QA PASS: blocked policy and rejected API select the displayed synthetic command; simulated success writes once before success feedback; an expired command adds no write (count stays one).
visual-review: PASS — copy-desktop.png read at 1280×800 and recaptured copy-phone.png in the actual mobile shell at 390×844; selected synthetic command, manual-copy instructions and actions are readable without clipping or occlusion; audits ok, card yes/yes/yes/no/yes.
Harness history: an initial wrong route failed before finding the iframe; the first narrow capture used the desktop shell and visibly clipped content (visual FAIL). The corrected /mobile/?mobile=1 extension-page capture was read and passed; all three browser branches and expiry passed again.
Limits: simulated copy success cannot establish native clipboard behavior, real pairing or live delivery.
Delivery: no publication, installation or integration receipt for 0.1.3 at this checkpoint.
