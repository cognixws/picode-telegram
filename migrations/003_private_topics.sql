-- Private-chat topics (Bot API 9.3 and 9.4) mapped to an Assistant's topics
-- in COGNIX[WS] (ADR-0376 T4b). A thread is known by the name Telegram gave
-- it, kept as the topic's slug ("Jingle ideas" is jingle-ideas); a message in
-- it goes to COGNIX[WS] with a leading "#slug", and only to the Assistant it
-- was opened for (another Assistant chosen since does not get it). Each input remembers its
-- thread so the Assistant's answer returns there. Names are labels the owner
-- chose, never message content.
CREATE TABLE threads (
  thread_id INTEGER PRIMARY KEY,
  assistant TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX threads_slug ON threads(assistant, slug);
CREATE TABLE input_threads (
  message_id TEXT PRIMARY KEY,
  thread_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
