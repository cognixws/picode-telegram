import { ApiError } from './http.mjs';

// The host forwards a declared candidate secret over supervised loopback
// before persistence. No candidate value is returned, logged or retained.
export async function verifySettings(body, makeBot) {
  const token = body.secrets?.bot_token;
  if (token === undefined || token === '') return;
  if (typeof token !== 'string' || !/^\d{6,20}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new ApiError(400, 'Check your bot token.');
  const bot = makeBot(token);
  await bot.call('getMe');
  const webhook = await bot.call('getWebhookInfo');
  if (webhook.url) throw new ApiError(409, 'This bot has a webhook.', {code:'webhook-conflict'});
}
