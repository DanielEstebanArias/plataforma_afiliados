'use strict';
const $ = (id) => document.getElementById(id);
let token = null,
  selected = null,
  socket = null,
  config = null;
const notice = (message) => ($('notice').textContent = message);
const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch('/api/' + route, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error ?? 'Error de conexión');
  }
  return response.json();
}
async function run(work) {
  notice('');
  try {
    await work();
  } catch (e) {
    notice(e.message);
  }
}
async function login() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem('oidc', JSON.stringify({ verifier, state, created: Date.now() }));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const url = new URL(config.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: location.origin + '/',
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    audience: config.audience,
  });
  location.assign(url);
}
async function loadApps() {
  const apps = await request('apps');
  $('apps').replaceChildren();
  for (const app of apps) {
    const card = document.createElement('button');
    card.className = 'card';
    const title = document.createElement('strong');
    title.textContent = app.name;
    const detail = document.createElement('small');
    detail.textContent = app.bundleId + ' · v' + app.version;
    if (app.affiliateNetwork) detail.textContent += ' · Afiliados integrado';
    card.append(title, detail);
    card.onclick = () =>
      run(async () => {
        if (app.affiliateNetwork) {
          const module = await request('apps/' + app.id + '/affiliates');
          location.assign(module.url);
          return;
        }
        selected = app;
        $('editor').hidden = false;
        $('app-name').textContent = app.name;
        $('messages').replaceChildren();
        await metadata();
        await builds();
      });
    $('apps').append(card);
  }
}
async function metadata() {
  if (selected)
    $('metadata').textContent = JSON.stringify(
      await request('apps/' + selected.id + '/metadata'),
      null,
      2,
    );
}
async function builds() {
  if (!selected) return;
  const rows = await request('builds?appId=' + selected.id);
  $('builds').replaceChildren();
  for (const build of rows) {
    const item = document.createElement('li');
    item.textContent = build.platform + ' · ' + build.status;
    if (build.artifactUrl) {
      const link = document.createElement('a');
      link.href = build.artifactUrl;
      link.textContent = ' Descargar';
      link.rel = 'noopener';
      item.append(link);
    }
    $('builds').append(item);
  }
}
function message(role, text) {
  const div = document.createElement('div');
  div.className = 'message';
  const label = document.createElement('strong');
  label.textContent = role;
  div.append(label, document.createTextNode(text));
  $('messages').append(div);
  div.scrollIntoView({ block: 'nearest' });
}
$('login').onclick = () => run(login);
$('logout').onclick = () => {
  token = null;
  socket?.disconnect();
  location.replace('/');
};
$('refresh').onclick = () => run(loadApps);
$('new-app').onclick = () => $('create-dialog').showModal();
$('cancel-create').onclick = () => $('create-dialog').close();
$('create-form').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const form = new FormData(e.currentTarget);
    await request('apps', { method: 'POST', body: Object.fromEntries(form) });
    $('create-dialog').close();
    await loadApps();
  });
};
$('prompt-form').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    if (!selected) return;
    const prompt = $('prompt').value;
    message('Tú', prompt);
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await request('apps/' + selected.id + '/ai/prompt', {
        method: 'POST',
        body: { prompt },
      });
      message('Asistente', result.answer);
      $('prompt').value = '';
      await metadata();
    } finally {
      button.disabled = false;
    }
  });
};
$('load-metadata').onclick = () => run(metadata);
for (const platform of ['android', 'ios'])
  $(platform).onclick = () =>
    run(async () => {
      if (!selected) return;
      await request('builds', { method: 'POST', body: { appId: selected.id, platform } });
      notice('Compilación en cola. Puedes consultar su estado aquí.');
      await builds();
    });
run(async () => {
  config = await (await fetch('/auth-config')).json();
  const query = new URLSearchParams(location.search);
  if (query.has('error')) throw new Error('El proveedor rechazó el inicio de sesión');
  if (!query.has('code')) return;
  const saved = JSON.parse(sessionStorage.getItem('oidc') ?? 'null');
  sessionStorage.removeItem('oidc');
  if (!saved || saved.state !== query.get('state') || Date.now() - saved.created > 600000)
    throw new Error('Inicio de sesión inválido o expirado');
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: location.origin + '/',
      code: query.get('code'),
      code_verifier: saved.verifier,
    }),
  });
  history.replaceState({}, '', location.pathname);
  if (!response.ok) throw new Error('No se pudo completar la sesión');
  const result = await response.json();
  token = result.access_token;
  $('login').hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;
  socket = io('/portal', { auth: { token } });
  socket.on('connect', () => ($('connection').textContent = 'Conectado'));
  socket.on('disconnect', (reason) => {
    $('connection').textContent = token ? 'Reconectando…' : 'Sin conexión';
    if (reason === 'io server disconnect' && token) {
      setTimeout(() => {
        if (token) socket.connect();
      }, 5000);
    }
  });
  socket.on('app.updated', (event) => {
    if (event.appId === selected?.id) run(metadata);
  });
  setTimeout(
    () => {
      token = null;
      socket.disconnect();
      notice('La sesión expiró. Vuelve a conectar tu cuenta.');
      $('login').hidden = false;
      $('workspace').hidden = true;
    },
    Math.max(0, (result.expires_in ?? 300) * 1000),
  );
  await loadApps();
  setInterval(() => {
    if (token && selected) run(builds);
  }, 15000);
});
