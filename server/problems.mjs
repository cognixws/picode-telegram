// Closed diagnostic vocabulary. Never retain transport exception text, URLs or
// provider response bodies; the setup page needs a next action, not internals.
const problems = Object.freeze({
  'host-unavailable': 'COGNIX could not be reached. Keep it open and check the connection again.',
  'host-refused': 'COGNIX refused this connection. Check the extension access in COGNIX.',
  'host-incompatible': 'Update COGNIX before connecting this channel.',
  'missing-token': 'Add your bot token in Bot settings.',
  'token-rejected': 'Telegram rejected the bot token. Check it in Bot settings.',
  'webhook-conflict': 'This bot has a webhook. Remove that connection or use another bot.',
  'poller-conflict': 'Another connection is using this bot. Stop it, then check this connection.',
  'chat-blocked': 'Unblock this bot in Telegram, then check the connection.',
  'provider-unavailable': 'Telegram could not be reached. Check your connection and try again.',
});
export function diagnostic(error, stage = '') {
  let code = error?.code === 'host-version' ? 'host-incompatible' : error?.code === 'webhook-conflict' ? 'webhook-conflict' : '';
  if (!code && (stage === 'host' || error?.stage === 'host')) code = error?.status === 401 || error?.status === 403 ? 'host-refused' : 'host-unavailable';
  if (!code) code = error?.status === 401 ? 'token-rejected' : error?.status === 409 ? 'poller-conflict' : error?.status === 403 ? 'chat-blocked' : 'provider-unavailable';
  return {code,message:problems[code]};
}
export function problemMessage(code) { return problems[code] || ''; }
