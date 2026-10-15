import { diagnostic } from './problems.mjs';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function createServer(channel, { secret, verify }) {
  return http.createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers['x-picode-proxy-secret'] || '');
    const expected = Buffer.from(secret);
    const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { reply(401, { message: 'Open this page through COGNIX.' }); return; }
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && path === '/status') { reply(200, channel.status()); return; }
      if (request.method !== 'POST') { reply(404, { message: 'This action is unavailable.' }); return; }
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16 * 1024) { reply(413, { message: 'This request is too large.' }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
      catch { reply(400, { message: 'This request could not be read.' }); return; }
      if (path === '/settings/check') { await verify(body); reply(200, { valid: true }); }
      else if (path === '/check') reply(200, await channel.check());
      else if (path === '/pair-code') reply(200, await channel.pairingCode());
      else if (path === '/pause' && typeof body.paused === 'boolean') reply(200, channel.pause(body.paused));
      else if (path === '/retry-notice') reply(200, await channel.retryNotice());
      else if (path === '/disconnect') reply(200, channel.disconnect());
      else if (path === '/acknowledge') { channel.problem = ''; channel.warning = ''; reply(200, channel.status()); }
      else reply(404, { message: 'This action is unavailable.' });
    } catch (error) {
      const status = [400, 401, 409, 429].includes(error.status) ? error.status : 502;
      // Consumer errors are fixed strings; never reflect submitted settings.
      const message = pathForError(request) === '/check' ? diagnostic(error).message : error.code === 'history-unavailable' ? 'This notice is outside the available history. Open COGNIX to send it again.' : status === 401 ? 'The bot token is invalid. Check it in BotFather.' : status === 409 ? 'This bot already has a connection. Check Telegram or try another bot.' : status === 400 ? 'Check the bot token and try again.' : 'The connection could not be checked. Try again.';
      reply(status, { message, ...(pathForError(request) === '/check' ? {problemCode:diagnostic(error).code} : {}) });
    }
  });
}

function pathForError(request) { return String(request.url || '').split('?')[0]; }
