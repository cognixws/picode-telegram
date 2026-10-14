(async () => {
  const $ = id => document.getElementById(id);
  await picode.use('theme');
  const process = await picode.use('process');
  const links = await picode.use('links');
  let state, active = false, checking = false, code = '', expires = 0, actionProblem = '', pollProblem = '', lastStatus = 0, statusRevision = 0;
  async function call(path, body) {
    const result = await process.request(path, body === undefined ? { method: 'GET' } : { method: 'POST', body: JSON.stringify(body), contentType: 'application/json' });
    const data = JSON.parse(result.body || '{}');
    if (result.status >= 400) throw new Error(data.message || 'Enable Telegram in COGNIX and check the connection again.');
    return data;
  }
  function show() {
    const labels = { checking: 'Checking the bot connection…', 'needs-token': 'Add your bot token in Bot settings to begin.', 'needs-pairing': state.restored ? 'Restored connection: pair your Telegram account again.' : 'Your bot is ready. Pair your private chat.', connected: 'Connected to your private Telegram chat.', paused: 'Paused. Questions and messages will wait.', error: 'The connection needs your attention.' };
    $('identity').hidden = !state.identity;
    $('identity').textContent = state.identity ? `Paired Telegram account: ${state.identity.user}` : '';
    $('status').textContent = labels[state.state] || 'Check your Telegram connection.';
    $('problem').textContent = actionProblem || pollProblem || state.problem || '';
    $('problem').hidden = !actionProblem && !pollProblem && !state.problem;
    $('pair').hidden = state.paired || ['needs-token', 'error', 'checking'].includes(state.state);
    $('settings').classList.toggle('primary', state.state === 'needs-token');
    $('refresh').classList.toggle('primary', state.state === 'error');
    $('pause').hidden = !state.paired;
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
    $('pause').classList.toggle('primary', state.paused);
    $('disconnect').hidden = !state.paired;
    $('uncertain').hidden = !state.uncertain;
    $('retry').hidden = !state.retryAvailable;
    $('retry').disabled = state.paused || state.state === 'error';
    requestAnimationFrame(alignRows);
    if (state.paired) { $('pairing').hidden = true; code = ''; $('code').textContent = ''; }
  }
  function alignRows() {
    for (const row of document.querySelectorAll('.actions')) {
      const tops = [...row.children].filter(e => !e.hidden).map(e => Math.round(e.getBoundingClientRect().top));
      row.toggleAttribute('data-align-row', tops.length > 0 && new Set(tops).size === 1);
    }
  }
  const resize = new ResizeObserver(alignRows);
  for (const row of document.querySelectorAll('.actions')) resize.observe(row);
  async function act(button, work) {
    if (active) return;
    statusRevision++;
    active = true; actionProblem = ''; const label = button.textContent;
    const width = button.getBoundingClientRect().width;
    button.style.minWidth = width + 'px'; button.classList.add('is-working');
    button.disabled = true; button.textContent = 'Working…';
    try { await work(); state = await call('/status'); lastStatus = Date.now(); pollProblem = ''; show(); }
    catch (error) { actionProblem = error.message; $('problem').textContent = actionProblem; $('problem').hidden = false; }
    finally { button.disabled = false; button.textContent = label; button.style.minWidth = ''; button.classList.remove('is-working'); active = false; if (state) show(); }
  }
  $('settings').onclick = () => links.open(new URL('/#/extensions/telegram', location.href).href);
  $('refresh').onclick = () => act($('refresh'), () => call('/check', {}));
  $('pair').onclick = () => act($('pair'), async () => {
    const result = await call('/pair-code', {});
    expires = result.expires; code = '/start ' + result.code; $('code').textContent = code;
    $('telegram').href = result.url; $('telegram').hidden = !result.url;
    $('pairing').hidden = false;
  });
  $('pause').onclick = () => act($('pause'), () => call('/pause', { paused: !state.paused }));
  $('disconnect').onclick = () => act($('disconnect'), () => call('/disconnect', {}));
  $('retry').onclick = () => act($('retry'), () => call('/retry-notice', {}));
  $('copy').onclick = () => act($('copy'), async () => { await navigator.clipboard.writeText(code); });
  try { state = await call('/status'); lastStatus = Date.now(); show(); }
  catch (error) {
    $('status').textContent = 'Telegram is not available yet.';
    $('problem').textContent = error.message; $('problem').hidden = false;
  }
  $('loading').hidden = true; $('content').hidden = false;
  // This private process has no host item feed. Read metadata status while
  // the setup page is visible: two seconds during pairing, six otherwise.
  // No Inbox/message polling or secret value enters this page.
  const timer = setInterval(async () => {
    if (active || checking || document.hidden || !code && Date.now() - lastStatus < 6000) return;
    if (code && expires <= Date.now()) { code = ''; $('code').textContent = ''; $('pairing').hidden = true; actionProblem = 'The pairing code expired. Pair your chat again.'; if (state) show(); }
    checking = true;
    const revision = statusRevision;
    try { const next = await call('/status'); if (revision === statusRevision) { state = next; lastStatus = Date.now(); pollProblem = ''; show(); } }
    catch (error) { if (revision === statusRevision) { pollProblem = error.message; if (state) show(); } }
    finally { checking = false; }
  }, 2000);
  window.addEventListener('pagehide', () => { clearInterval(timer); resize.disconnect(); }, { once: true });
})().catch(() => {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
  document.getElementById('status').textContent = 'Open Telegram from COGNIX to configure it.';
});
