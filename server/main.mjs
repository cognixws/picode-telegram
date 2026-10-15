import { Ledger } from './ledger.mjs';
import { HostAPI, TelegramAPI } from './http.mjs';
import { verifySettings } from './settings.mjs';
import { Channel } from './channel.mjs';
import { createServer } from './server.mjs';

const required = ['PICODE_URL', 'PICODE_EXT_TOKEN', 'PICODE_EXT_DATA', 'PICODE_EXT_DB', 'PICODE_EXT_PORT', 'PICODE_EXT_PROXY_SECRET'];
if (Number(process.versions.node.split('.')[0]) < 24 || required.some(key => !process.env[key])) {
  process.stderr.write('Telegram needs Node.js 24 or newer and must be started by COGNIX.\n');
  process.exit(1);
}
const ledger = new Ledger(process.env.PICODE_EXT_DB);
const host = new HostAPI({ url: process.env.PICODE_URL, token: process.env.PICODE_EXT_TOKEN, dataDir: process.env.PICODE_EXT_DATA });
const channel = new Channel({ ledger, host, makeBot: token => new TelegramAPI(token) });
const server = createServer(channel, {
  secret: process.env.PICODE_EXT_PROXY_SECRET,
  verify: body => verifySettings(body, token => new TelegramAPI(token)),
});
server.listen(Number(process.env.PICODE_EXT_PORT), '127.0.0.1', async () => {
  try { await channel.configure(); }
  catch (error) { channel.setProblem(error); }
  channel.start();
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  channel.stop();
  server.close(() => { ledger.close(); process.exit(0); });
  // The supervised process must release its consumer even if a local page
  // keeps a socket open. Claimed work recovers as uncertain at next start.
  setTimeout(() => { ledger.close(); process.exit(0); }, 1500).unref();
});
process.on('uncaughtException', () => { process.stderr.write('Telegram stopped unexpectedly. Restart it from COGNIX.\n'); process.exit(1); });
process.on('unhandledRejection', () => { process.stderr.write('Telegram stopped unexpectedly. Restart it from COGNIX.\n'); process.exit(1); });
