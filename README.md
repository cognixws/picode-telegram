# Telegram for COGNIX[WS]

A local PiCode extension carrying the owner's Inbox and agent Messages to one
private Telegram chat. Agents keep using `ask_human`, `notify_human` and
Messages. There is no Channels tool family or direct Assistant entry in V1.

Published with owner authorization at [cognixws/picode-telegram](https://github.com/cognixws/picode-telegram).
Version 0.1.3 has 47 adapter tests passing. Owner-authorized dev acceptance
passed 13 real Telegram/managed Pi checks: private pairing, Inbox option/text
answers, bidirectional Messages/Reply, channel pause/resume, configured extension
restart and stopped-recipient refusal. This is partial V1 acceptance; strangers,
concurrent races, provider failures, configured restore and native/physical-phone
acceptance remain unverified. Revisions, digest and limits: [acceptance](docs/acceptance.md).

Requires PiCode extension manifest version 3 (ADR-0327), the Channels V1 Host
API (`channelProtocol: 1`) and Node.js 24
or later. Node is an optional adapter runtime, not a PiCode requirement.
The implementation uses Node builtins only, including `node:sqlite`; no npm
packages or hosted relay are required.

## Setup

1. Create a dedicated bot with BotFather.
2. Install the reviewed extension in COGNIX and enable it on this computer.
3. Enter the bot token in the **host-owned protected Bot token setting**.
   COGNIX verifies the bot and checks for an existing webhook before saving.
4. Open Telegram's extension page, generate a ten-minute one-use pairing code
   and open the private bot chat. The paired account/chat identity is shown.
5. Reply to an Inbox question, tap a supplied option or use `/agents` to select
   a running CLI agent. Replies to agent messages retain their conversation.

Titles and options leave by default. Full message text requires the explicit
**Include message text** setting and always passes through daemon masking.
Long notices are shortened with an ellipsis to fit Telegram; open COGNIX for
the complete text.
Known masking is not complete secret detection. Bot tokens never enter the
extension iframe, ordinary messages, ledgers or activity logs. Only text is
supported. Telegram bot conversations are not end-to-end encrypted; use
COGNIX for content you do not want to send to Telegram. This follows from
Telegram's documented [intermediary encryption for the Bot API](https://core.telegram.org/bots#how-do-bots-work),
which is distinct from its [end-to-end Secret Chat protocol](https://core.telegram.org/api/end-to-end).

A configured public HTTPS COGNIX URL enables **Open in COGNIX** links. Without
one, notices still explain the required COGNIX action. No local path or
loopback URL is sent as an external link.

## Delivery and recovery

| Condition | Behavior |
|---|---|
| Group, stranger, bot sender or reused/expired pairing code | Ignore; no core action or acknowledgement |
| Paused channel | No inbound core mutation or outbound Telegram message; pending provider updates remain subject to Telegram's retention |
| Core delivery paused or raw terminal only | Record the owner's message as held; explain its state; remote transport cannot force terminal keys |
| Inbox title/options default; snoozed item | Forward current eligible title/options; wait until snooze is due |
| Duplicate update/event; restart | Durable claim and receipt prevent repeated core mutation or duplicate notice |
| Known 429 | Wait for the provider's retry deadline; bounded serialized sends; durable retries survive feed cursor progress |
| Invalid token or blocked bot | Stop effects; keep rejected notices eligible after an explicit owner repair/check |
| Lost core/provider write response | Preserve uncertain result; check COGNIX/Telegram before any explicit new send |
| Old reply mapping or changed option | Refuse; never route an unknown reply as a new message |
| Disable/disconnect/change bot | Stop consumption; pairing/cursors/handles cannot authorize another bot/chat |
| Restored database or changed restore generation | Clear pairing and historical dispatch authority; require fresh pairing |
| Offline beyond 24 hours | Warn that provider history may be missing; reconcile current Inbox |
| Seven days with no updates | New update epoch accepts Telegram's possible randomized lower update ID |
| Webhook or another poller | Visible conflict stops consumption until an explicit connection check; no automatic webhook deletion or retry after a poller conflict |

The adapter uses long polling, persists cursors and reads a bounded Inbox
snapshot once a minute to cover snooze transitions and changes whose events
do not name an item. Complete snapshots also replace at most twenty missing
item receipts per pass with an unavailable notice; a truncated snapshot never
proves that an item closed. Every ten seconds it checks metadata for due known-refused
notices, rereading bounded canonical snapshots only when needed. A notice that
has left the available history requires a fresh send in COGNIX. Initial/reset
Messages snapshots are context, never a
historical forwarding queue. One private chat receives at most about one
message per second from this adapter.

The visible setup page reads process metadata every six seconds (two during
pairing) because that private process has no host item feed. This does not
poll Inbox content or read token values.

The SQLite ledger contains pairing identities, hashes/opaque handles, cursors
and metadata receipts, never token or message bodies. Active delivery and
button records stop at 10,000; disconnect archives the previous pairing and
retains at most 2,000 historical delivery receipts. Up to 10,000 recent update
receipts retain the replay floor. Uncertain active sends are never pruned into
new automatic attempts. Data kept at uninstall remains subject to the core
extension lifecycle.

PiCode backs up the extension domain database. Its independent sealed secret
key/envelopes and installed package/Host API token/logs currently remain local
and excluded, even in snapshots with secrets enabled. A fresh restored machine
needs reinstall, token entry and new pairing. A retained local token does not
restore pairing authority. Portable extension credential recovery is a core
debt, not a capability of this adapter.

## Development and acceptance

```sh
npm test
```

Tests use migrated real SQLite files/connections and simulated provider/core
responses. The separate real-bot/live Pi receipt in [acceptance](docs/acceptance.md)
records its installed package digest and scope; neither unit tests nor browser
observations establish Windows WebView2 or physical-phone acceptance.
See PiCode's `docs/plans/channels-v1-completion.md` acceptance rows A01–A20.

Primary provider references: [Bot API](https://core.telegram.org/bots/api),
[update retention and polling](https://core.telegram.org/bots/api#getting-updates),
[rate guidance](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this),
[bot privacy](https://core.telegram.org/bots/faq#how-are-bots-different-from-humans).

Manifest v3 status uses the host closed states `needs-token`, `pairing`,
`connected`, `paused`, `checking` and `error` (core ADR-0327). Pairing readiness
is reported as `pairing` in both the directory and this extension page.

The bundled app icon is the [official Telegram logo](https://telegram.org/tour/screenshots),
served locally for the extension tile and page favicon. This extension is not
an official Telegram product.

The HTTPS Host API trusts the locally provided COGNIX certificate, including
CA-issued development certificates, with certificate and hostname validation
enabled. Provider HTTPS continues to use the standard trust roots.

If the browser blocks clipboard access inside the extension page, **Copy command**
selects the command and explains how to copy it with the keyboard or touch menu.
It never reads the clipboard or reports a failed copy as successful.

| Copy condition | Visible result |
|---|---|
| Clipboard write is allowed and completes | Confirm copied; paste into the bot chat |
| Clipboard is blocked, unavailable or refuses the write | Select the visible command; explain keyboard or touch copying |
| Pairing command expired or absent | No copy attempt; generate a fresh pairing command |
