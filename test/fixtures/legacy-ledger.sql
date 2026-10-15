-- Frozen V1 writer independent of Ledger and the current migrations.
CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE updates (epoch INTEGER NOT NULL,id INTEGER NOT NULL,state TEXT NOT NULL,received_at INTEGER NOT NULL,receipt TEXT NOT NULL DEFAULT '',PRIMARY KEY(epoch,id));
CREATE TABLE deliveries (key TEXT PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT NOT NULL,state TEXT NOT NULL,telegram_id INTEGER,changed_at INTEGER NOT NULL,retry_at INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL DEFAULT '');
CREATE TABLE buttons (handle TEXT PRIMARY KEY,item_id TEXT NOT NULL,choice INTEGER NOT NULL,choice_hash TEXT NOT NULL DEFAULT '',telegram_id INTEGER,created_at INTEGER NOT NULL);
INSERT INTO metadata VALUES('bot_id','"91"'),('restore_generation','""'),('pair','{"chat":14,"user":14,"bot":"91","connectedAt":1800000000000,"generation":"legacy-pair"}'),('selected_agent','"cli"');
INSERT INTO deliveries VALUES('legacy-pair:message:v1-message','message','v1-message','sent',77,1800000000000,0,'');
