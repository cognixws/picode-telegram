# 2026-10-15 — telegram-icon: display the Telegram brand icon
The user screenshot showed a T fallback beside Telegram in the host extension list because the manifest declared no icon.
Version 0.1.1 bundles the official https://telegram.org/img/t_logo.svg as ui/telegram.svg, declares the manifest icon and adds the setup page's HTML favicon link.
Verification: npm test PASS, 46 tests; git diff --check PASS. This repository has no make close-summary harness.
visual-review: PASS — token-free scratch 8473, candidate 0.1.1; extensions.png read at 1280×800 shows the Telegram icon in the list and detail header, no clipping/occlusion; overlay audit ok, card yes/yes/yes/no/yes. Browser-tab favicon and later publication/dev installation remain unverified.
Limits: no claim of browser-tab favicon rendering, native acceptance, publication or installation of this version.
Integration: isolated fix/telegram-icon worktree; no merge or publication receipt for this change.
