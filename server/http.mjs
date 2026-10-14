import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class ApiError extends Error {
  constructor(status, message, { uncertain = false, retryAfter = 0, code = '' } = {}) {
    super(message); this.status = status; this.uncertain = uncertain; this.retryAfter = retryAfter; this.code = code;
  }
}

// Never expose request URLs, tokens, response bodies or transport exceptions
// in logs. Redirects are errors; only the named endpoint receives a request.
export function jsonRequest(url, { method = 'GET', body, headers = {}, ca, timeout = 30_000, acceptErrorBody = false, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolveResult, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(deadline); fn(value); };
    let deadline;
    const transport = url.protocol === 'https:' ? https : http;
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = transport.request(url, {
      method, ca, headers: { ...headers, ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) },
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(); else chunks.push(chunk);
      });
      response.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { finish(reject, new ApiError(response.statusCode, 'The response could not be confirmed.', { uncertain: method !== 'GET' })); return; }
        if (response.statusCode >= 300 && (!acceptErrorBody || response.statusCode < 400)) { finish(reject, new ApiError(response.statusCode, 'The service refused this action.', { uncertain: response.statusCode >= 500 })); return; }
        finish(resolveResult, data);
      });
      response.on('error', () => finish(reject, new ApiError(0, 'The connection could not be confirmed.', { uncertain: method !== 'GET' })));
    });
    // A trickling response must not keep an owner check or write alive beyond
    // its deadline. The socket timeout alone measures inactivity, not time.
    deadline = setTimeout(() => request.destroy(), timeout);
    request.setTimeout(timeout, () => request.destroy());
    request.on('error', () => finish(reject, new ApiError(0, 'The connection could not be confirmed.', { uncertain: method !== 'GET' })));
    request.end(bytes);
  });
}

export class HostAPI {
  constructor({ url, token, dataDir }) {
    this.url = new URL(url);
    if (!['http:', 'https:'].includes(this.url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(this.url.hostname)) throw new Error('PiCode must provide its loopback address.');
    this.headers = { 'X-PiCode-Extension-Token': token };
    if (this.url.protocol === 'https:') this.ca = readFileSync(resolve(dataDir, '../../..', 'cert.pem'));
  }
  request(path, body) {
    if (!path.startsWith('/api/ext/v1/')) throw new Error('Only the extension Host API may be used.');
    return jsonRequest(new URL(path, this.url), { body, method: body === undefined ? 'GET' : 'POST', headers: this.headers, ca: this.ca, maxBytes: 32 * 1024 * 1024 });
  }
}

export class TelegramAPI {
  constructor(token, { origin = 'https://api.telegram.org', request = jsonRequest } = {}) {
    this.base = new URL('/bot' + token + '/', origin); this.request = request;
  }
  async call(method, body = {}) {
    const data = await this.request(new URL(method, this.base), { method: 'POST', body, timeout: method === 'getUpdates' ? 35_000 : 15_000, acceptErrorBody: true });
    if (!data.ok) {
      const status = Number(data.error_code) || 500;
      throw new ApiError(status, status === 401 ? 'The bot token is no longer valid.' : status === 409 ? 'Another connection is using this bot.' : status === 429 ? 'Telegram asked us to wait.' : 'Telegram refused this action.', { uncertain: status >= 500, retryAfter: Number(data.parameters?.retry_after) || 0 });
    }
    return data.result;
  }
}
