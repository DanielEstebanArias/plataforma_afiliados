const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
let state = { members: [], view: 'tree', query: '' },
  csrf = '',
  nativeToken = '',
  apiBase = '',
  installPrompt;
let directoryBranding = { name: 'Directorio de Antioquia', slogan: 'Por Antioquia ¡Lo que sea!', divisionLabel: 'Subregiones', directoryAdminName: 'José Ignacio Cano', primaryColor: '#073d34', secondaryColor: '#032d27', accentColor: '#c8f000', backgroundColor: '#f5f8f5' };
const divisionLabel = () => directoryBranding.divisionLabel || 'Subregiones';
function colorContrast(hex) {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const luminance = rgb.map((channel) => { const value = channel / 255; return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  return luminance > .48 ? '#123a32' : '#ffffff';
}
function applyDirectoryTheme(directory = directoryBranding) {
  const defaults = { primaryColor: '#073d34', secondaryColor: '#032d27', accentColor: '#c8f000', backgroundColor: '#f5f8f5' }, root = document.documentElement;
  for (const [key, fallback] of Object.entries(defaults)) if (!/^#[0-9a-f]{6}$/i.test(directory[key] || '')) directory[key] = fallback;
  if (!root?.style) return;
  root.style.setProperty('--brand-forest', directory.primaryColor);
  root.style.setProperty('--brand-forest-deep', directory.secondaryColor);
  root.style.setProperty('--brand-lime', directory.accentColor);
  root.style.setProperty('--brand-surface', directory.backgroundColor);
  root.style.setProperty('--brand-on-primary', colorContrast(directory.primaryColor));
  root.style.setProperty('--brand-on-accent', colorContrast(directory.accentColor));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', directory.primaryColor);
  document.title = directory.name || 'Aliados por Antioquia';
}
const native = !!window.Capacitor?.isNativePlatform?.();
function scopedRoute(route) {
  if (
    !state.selectedCommunity ||
    !/^\/(members(?:[/?]|$)|campaigns(?:[/?]|$)|me(?:\?|$)|stats(?:\?|$)|settings(?:\?|$)|dashboard(?:\?|$)|fields(?:\?|$)|registration(?:\?|$)|superapp(?:\?|$))/.test(
      route,
    )
  )
    return route;
  return '/communities/' + state.selectedCommunity + '/admin' + route;
}
async function api(route, options = {}) {
  route = scopedRoute(route);
  const response = await fetch(apiBase + '/api' + route, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 428) {
      state.selectedCommunity = null;
      const terms = await api('/terms');
      renderTermsAcceptance(terms);
    }
    throw Object.assign(new Error(data.error || 'No se pudo conectar.'), { status: response.status });
  }
  return data;
}
const post = (route, data, method = 'POST') =>
  api(
    route === '/communities' && state.selectedCommunity
      ? '/communities/' + state.selectedCommunity + '/admin/communities'
      : route,
    { method, body: JSON.stringify(data) },
  );
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('#toast').style.display = 'none'), 4500);
}
const initials = (m) =>
  m.name
    .split(/\s+/)
    .slice(0, 2)
    .map((v) => v[0])
    .join('')
    .toUpperCase();
const avatar = (m) =>
  m.hasPhoto
    ? `<img class="avatar" data-photo="${esc(m.id)}" alt="Foto de ${esc(m.name)}">`
    : `<span class="avatar">${esc(initials(m))}</span>`;
async function photos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    try {
      const photoRoute = `/members/${img.dataset.photo}/photo`;
      const r = await fetch(
        apiBase +
          '/api' +
          (state.selectedCommunity && img.dataset.photo === state.user.id
            ? photoRoute
            : scopedRoute(photoRoute)),
        {
          headers: nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {},
        },
      );
      if (r.ok) {
        const u = URL.createObjectURL(await r.blob());
        img.src = u;
        img.onload = () => URL.revokeObjectURL(u);
      }
    } catch {}
  }
}
let logoRevision = Date.now();
const brand = () =>
  '<div class="brand"><img src="icon.svg" data-platform-logo alt="Logo de la plataforma"></div>';
async function platformLogos() {
  try {
    const response = await fetch(apiBase + '/api/platform-logo?v=' + logoRevision, {
      headers: nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {},
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    document.querySelectorAll('[data-platform-logo]').forEach((img) => {
      img.src = url;
    });
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {}
}
function auth(configured, directory) {
  if (directory) directoryBranding = { ...directoryBranding, ...directory };
  applyDirectoryTheme();
  $('#app').innerHTML =
    `<main class="auth"><section class="auth-intro">${brand()}<span class="eyebrow">${esc(directoryBranding.name)}</span><h1>Toda tu información<br>en un solo lugar.</h1><div class="campaign-slogan">${esc(directoryBranding.slogan)}</div><p>Personas, relaciones e información en un solo lugar.</p><div class="auth-art"><span>Árbol de aliados</span><span>Formularios a tu medida</span><span>Acceso por rama</span></div></section><section class="auth-form"><form id="authForm"><div class="eyebrow">${configured ? 'Bienvenido de nuevo' : 'Comienza tu red'}</div><h2>${configured ? 'Ingresa a tu organización' : 'Crea tu entidad raíz'}</h2><p class="muted">${configured ? 'Accede con la cuenta que te asignó tu organización.' : 'Esta cuenta administrará toda la red y configurará el formulario de aliados.'}</p>${configured ? '' : '<label>Nombre de la entidad<input name="organization" required maxlength="150" placeholder="Mi organización"></label><label>Tu nombre<input name="name" required maxlength="150" autocomplete="name"></label>'}<label>Correo electrónico<input name="email" type="email" required autocomplete="username"></label><label>Contraseña<input name="password" type="password" minlength="10" maxlength="200" required autocomplete="${configured ? 'current-password' : 'new-password'}" placeholder="Mínimo 10 caracteres"></label><p class="error" id="authError"></p><button class="primary">${configured ? 'Ingresar →' : 'Crear organización →'}</button>${configured ? '<button type="button" class="button-link recovery-link" id="forgotPassword">¿Olvidaste tu contraseña?</button><a class="button-link recovery-link" href="/platform.html">Administración global de directorios</a>' : ''}<p class="footnote">Datos guardados en la base de esta instalación. ${configured ? '' : 'Puedes añadir aliados después de crear tu cuenta.'}</p></form></section></main>`;
  platformLogos();
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      if (!configured) await post('/setup', b);
      const result = await post('/login', {
        email: b.email,
        password: b.password,
        native,
        communityAppId: b.communityAppId,
      });
      if (result.communities) {
        let chooser = $('#loginCommunity');
        if (!chooser) {
          chooser = document.createElement('label');
          chooser.id = 'loginCommunity';
          $('#authError').before(chooser);
        }
        chooser.innerHTML = `Estas credenciales pertenecen a varias divisiones. Selecciona una:<select name="communityAppId" required><option value="">Seleccionar división</option>${result.communities.map((c) => `<option value="${esc(c.appId)}">${esc(c.name)}</option>`).join('')}</select>`;
        $('#authError').textContent = '';
        return;
      }
      csrf = result.csrf;
      nativeToken = result.token || '';
      if (result.redirectUrl) {
        if (!native) {
          location.assign(result.redirectUrl);
          return;
        }
        apiBase = new URL(result.redirectUrl, apiBase || location.href).href.replace(/\/$/, '');
      }
      await load();
    } catch (error) {
      if (error.status !== 428) $('#authError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $('#authForm').addEventListener('input', (event) => {
    if (['email', 'password'].includes(event.target.name)) $('#loginCommunity')?.remove();
  });
  if ($('#forgotPassword')) $('#forgotPassword').onclick = passwordRecoveryRequest;
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) passwordRecoveryReset(resetToken);
}
function passwordRecoveryRequest() {
  modal('Recuperar contraseña', `<form id="recoveryRequestForm"><p class="muted">Escribe el correo de tu cuenta. Si tiene permiso de ingreso, recibirás un enlace que vence en 30 minutos.</p><label>Correo electrónico<input name="email" type="email" required maxlength="254" autocomplete="email"></label><p class="error" id="recoveryError"></p><div class="actions"><button type="button" id="cancelRecovery">Cancelar</button><button class="primary">Enviar enlace</button></div></form>`);
  $('#cancelRecovery').onclick = () => $('#modal').close();
  $('#recoveryRequestForm').onsubmit = async (event) => { event.preventDefault(); const button=event.target.querySelector('.primary'); button.disabled=true; try { const result=await post('/password-recovery/request',{email:new FormData(event.target).get('email')}); event.target.innerHTML=result.mailReady?'<div class="success"><b>Revisa tu correo</b><p>Si la cuenta puede ingresar, enviaremos las instrucciones de recuperación.</p></div>':'<div class="success"><b>Servicio pendiente de configuración</b><p>La recuperación está preparada. El administrador debe agregar las credenciales de Resend para habilitar los envíos.</p></div>'; } catch(error) { $('#recoveryError').textContent=error.message; button.disabled=false; } };
}
function passwordRecoveryReset(token) {
  modal('Crear nueva contraseña', `<form id="recoveryResetForm"><p class="muted">La nueva contraseña debe tener entre 10 y 200 caracteres.</p><label>Nueva contraseña<input name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label><label>Confirmar contraseña<input name="confirm" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label><p class="error" id="recoveryResetError"></p><div class="actions"><button class="primary">Guardar nueva contraseña</button></div></form>`);
  $('#recoveryResetForm').onsubmit = async (event) => { event.preventDefault(); const fd=new FormData(event.target),password=fd.get('password'),button=event.target.querySelector('.primary'); if(password!==fd.get('confirm')){ $('#recoveryResetError').textContent='Las contraseñas no coinciden.'; return; } button.disabled=true; try { await post('/password-recovery/confirm',{token,password}); history.replaceState({},'',location.pathname); event.target.innerHTML='<div class="success"><b>Contraseña actualizada</b><p>Ya puedes cerrar esta ventana e ingresar con tu nueva contraseña.</p><button type="button" id="finishRecovery">Volver al ingreso</button></div>'; $('#finishRecovery').onclick=()=>$('#modal').close(); } catch(error) { $('#recoveryResetError').textContent=error.message; button.disabled=false; } };
}
async function load() {
  const selected = state.selectedCommunity,
    previousView = state.view;
  state.selectedCommunity = null;
  state.treeRoot = null;
  state.wholeTreeLoaded = false;
  const me = await api('/me');
  csrf = me.csrf;
  state.user = me.user;
  state.org = me.organization;
  state.pendingTerms = me.terms || null;
  if (me.terms?.required) {
    state.members = [];
    state.settings = null;
    renderTermsAcceptance(me.terms);
    return;
  }
  state.paged = !!state.org.integration;
  if (state.paged) {
    const settings = await api('/settings');
    state.settings = settings;
    directoryBranding = { ...directoryBranding, ...(settings.directory || {}) };
    applyDirectoryTheme();
    if (settings.superuser) {
      if (selected) {
        await openCommunityTree(selected);
        state.view = previousView;
        render();
        return;
      }
      state.view = 'communities';
      state.members = [];
      state.stats = null;
      render();
      return;
    }
    const [stats, page] = await Promise.all([
      api('/stats'),
      api('/members?parentId=' + state.user.id + '&limit=25'),
    ]);
    state.stats = stats;
    state.settings = settings;
    state.focus = state.user.id;
    state.branchPages = { [state.user.id]: page.nextCursor };
    state.members = [{ ...state.user, childCount: stats.direct }, ...page.members];
    state.cursor = null;
    state.history = [null];
  } else state.members = (await api('/members')).members;
  render();
}
async function openCommunityTree(id) {
  try {
    const data = await api('/communities/' + id + '/tree?limit=25');
    state.selectedCommunity = id;
    state.treeRoot = data.root;
    state.org = { ...data.organization, integration: true };
    state.stats = data.stats;
    state.members = [data.root];
    state.branchPages = {};
    state.cursor = null;
    state.history = [null];
    await focusBranch(data.root.id);
  } catch (error) {
    toast(error.message);
  }
}
function moduleEnabled(key) {
  return !state.paged || state.settings?.superuser || state.settings?.modules?.[key] !== false;
}
function render() {
  if (state.pendingTerms?.required) return renderTermsAcceptance(state.pendingTerms);
  if (state.settings?.superuser && !state.selectedCommunity && !['terms', 'birthdays'].includes(state.view)) state.view = 'communities';
  const viewModule = { access: 'access', dashboard: 'dashboard', fields: 'form' }[state.view];
  if (viewModule && !moduleEnabled(viewModule)) state.view = 'tree';
  const me = state.user,
    all = state.members;
  const metrics = state.stats || {
    total: all.length,
    direct: all.filter((m) => m.parentId === me.id).length,
    levels: 0,
    active: all.filter((m) => m.status === 'active').length,
  };
  $('#app').innerHTML =
    `${navigator.onLine ? '' : '<div class="offline">Sin conexión. La información y los cambios requieren conexión con el servidor.</div>'}<div class="layout"><aside>${brand()}<nav class="nav">${state.paged ? `<button data-nav="communities">◉ &nbsp; ${esc(divisionLabel())}</button>` + ((!state.settings?.superuser || state.selectedCommunity) && me.role === 'ROOT' && moduleEnabled('access') ? '<button data-nav="access">⚙ &nbsp; Acceso y foto</button>' : '') : ''}${!state.settings?.superuser || state.selectedCommunity ? '<button data-nav="tree">♧ &nbsp; Mi red</button>' : ''}${state.paged && (!state.settings?.superuser || state.selectedCommunity) && moduleEnabled('dashboard') ? '<button data-nav="dashboard">▥ &nbsp; Dashboard</button>' : ''}${(!state.settings?.superuser || state.selectedCommunity) && me.role === 'ROOT' && moduleEnabled('form') ? '<button data-nav="fields">▤ &nbsp; Formulario</button>' : ''}${me.role === 'ROOT' && (!state.settings?.superuser || state.selectedCommunity) ? '<button data-nav="campaigns">⌁ &nbsp; Campañas</button>' : ''}${state.settings?.superuser ? '<button data-nav="birthdays">▣ &nbsp; Tarjetas de cumpleaños</button><button data-nav="terms">▤ &nbsp; Términos y condiciones</button>' : ''}<button id="install" class="install">↓ &nbsp; Instalar aplicación</button></nav><div class="sidebar-bottom"><span class="campaign-slogan">${esc(directoryBranding.slogan)}</span><button id="logout">Cerrar sesión</button></div></aside><main class="main"><header class="topbar"><span><b>${state.settings?.superuser ? (state.selectedCommunity ? 'División seleccionada' : esc(directoryBranding.name)) : 'Mi división'}</b></span><button class="account ghost" id="myProfile">${avatar(me)}<span>${state.settings?.superuser ? (state.settings.platformAdministrator ? 'Administración global' : esc(directoryBranding.directoryAdminName || me.name)) : esc(me.name)}<br><small class="muted">${state.settings?.superuser ? (state.settings.platformAdministrator ? 'Acceso global' : 'Superadministrador de directorio') : me.role === 'ROOT' ? 'Administrador raíz' : 'Aliado'}</small></span></button><button class="mobile-logout ghost" id="logoutMobile" type="button">Cerrar sesión</button></header>${['dashboard', 'communities', 'access', 'terms', 'birthdays'].includes(state.view) ? '<div id="featurePage"></div>' : state.view === 'superapp' ? '<div id="corePage"></div>' : state.view === 'fields' ? '<div id="fieldsPage"></div>' : `<section class="hero"><div><div class="eyebrow">Personas que conectan</div><h1>${state.selectedCommunity ? esc(state.org.name) : 'Tu red empieza contigo.'}</h1><p>${state.selectedCommunity ? 'Administra los aliados, permisos, formulario y dashboard de esta división.' : 'Visualiza tu división, acompaña a cada persona y sigue creciendo.'}</p></div><button class="primary" id="addMember">＋ Registrar aliado</button></section><section class="stats"><div class="stat"><span>ALIADOS EN TU RED</span><b>${metrics.total}</b><span>Incluye tu cuenta</span></div><div class="stat"><span>ALIADOS DIRECTOS</span><b>${metrics.direct}</b><span>Conectados contigo</span></div><div class="stat"><span>NIVELES DE TU RED</span><b>${metrics.levels}</b><span>Debajo de tu cuenta</span></div><div class="stat"><span>CUENTAS ACTIVAS</span><b>${metrics.active}</b><span>Aliados activos</span></div></section><div class="toolbar"><div class="tabs"><button data-view="tree" class="${state.view === 'tree' ? 'active' : ''}">♧ Árbol de aliados</button><button data-view="list" class="${state.view === 'list' ? 'active' : ''}">☷ Directorio</button></div><div class="search-box"><span aria-hidden="true">⌕</span><input id="search" class="search" type="search" aria-label="Buscar aliados" autocomplete="off" placeholder="Buscar por cualquier dato del aliado…" value="${esc(state.query)}"><button id="clearSearch" type="button" aria-label="Limpiar búsqueda" ${state.query ? '' : 'hidden'}>×</button></div></div><section class="board"><div class="board-title"><div><b>${state.view === 'tree' ? 'Así se conecta tu división' : 'Directorio de aliados'}</b><div class="muted">${me.role === 'ROOT' ? 'Vista completa de tu organización' : 'Tu cuenta y todos tus descendientes'}</div></div><button id="export" class="ghost">↓ CSV</button></div><div id="network"></div></section><p class="footnote">${state.selectedCommunity ? `Selecciona una persona para administrar su ficha. Vuelve a ${esc(divisionLabel())} para elegir otra división.` : 'Selecciona una persona para ver su ficha o registrar un aliado debajo de ella. No hay un límite de cuentas configurado.'}</p>`}</main></div>`;
  if (state.view === 'campaigns') {
    $('.main').querySelectorAll(':scope > :not(.topbar)').forEach((element) => element.remove());
    $('.main').insertAdjacentHTML('beforeend', '<div id="featurePage"></div>');
  }
  platformLogos();
  document.querySelectorAll('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.nav === 'communities' && state.settings?.superuser) {
          state.selectedCommunity = null;
          load().catch((e) => toast(e.message));
          return;
        }
        state.view = b.dataset.nav;
        render();
      }),
  );
  document
    .querySelectorAll('[data-nav]')
    .forEach((b) =>
      b.classList.toggle(
        'active',
        b.dataset.nav === state.view || (b.dataset.nav === 'tree' && state.view === 'list'),
      ),
    );
  $('#logout') && ($('#logout').onclick = logout);
  $('#logoutMobile') && ($('#logoutMobile').onclick = logout);
  $('#myProfile').onclick = () => {
    if (!state.settings?.superuser) profile(me.id);
  };
  $('#install').onclick = install;
  if (state.view === 'terms') renderTermsManagement();
  else if (state.view === 'birthdays') renderBirthdays();
  else if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'communities') renderCommunities();
  else if (state.view === 'access') renderAccess();
  else if (state.view === 'campaigns') renderCampaigns();
  else if (state.view === 'superapp') renderCore();
  else if (state.view === 'fields') renderFields();
  else {
    $('#addMember').onclick = () => memberForm(null, (state.treeRoot || me).id);
    document.querySelectorAll('[data-view]').forEach(
      (b) =>
        (b.onclick = () => {
          state.view = b.dataset.view;
          render();
        }),
    );
    $('#search').oninput = (e) => {
      state.query = e.target.value;
      state.cursor = null;
      state.history = [null];
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => network(), 180);
    };
    $('#export').onclick = exportCSV;
    network();
  }
  photos();
}
function network() {
  if (state.paged && (state.view === 'list' || state.query.trim())) {
    renderDirectory();
    return;
  }
  const all = state.members,
    q = state.query.trim().toLowerCase(),
    filtered = all.filter((m) =>
      JSON.stringify([m.name, m.email, m.data]).toLowerCase().includes(q),
    );
  const node = (m) =>
    `<button class="node ${m.id === state.user.id ? 'root' : ''}" data-member="${m.id}">${avatar(m)}<span class="info"><strong>${esc(m.name)}</strong><small>${esc(m.data.city || m.email)}</small></span><span class="badge ${m.status === 'inactive' ? 'inactive' : ''}">${m.role === 'ROOT' ? 'Raíz' : m.status === 'inactive' ? 'Pausa' : all.filter((x) => x.parentId === m.id).length + ' ↳'}</span></button>`;
  if (state.view === 'tree' && !q) {
    window.AffiliateTree.render(
      $('#network'),
      all,
      state.paged
        ? state.members.find((m) => m.id === state.focus) || state.treeRoot || state.user
        : state.user,
      avatar,
      profile,
      (id) => memberForm(null, id),
      photos,
      state.paged ? loadBranch : null,
      state.paged ? loadWholeTree : null,
    );
    if (state.paged) {
      $('#network').insertAdjacentHTML(
        'afterbegin',
        '<div class="branch-context"><span>Árbol por ramas · ' +
          state.stats.total +
          ' aliados en tu red</span><button id="myTree">Volver a mi raíz</button></div>',
      );
      $('#myTree').onclick = () => focusBranch((state.treeRoot || state.user).id);
    }
  } else
    $('#network').innerHTML = filtered.length
      ? `<div class="table-wrap"><table><thead><tr><th>Aliado</th><th>Contacto</th><th>Depende de</th><th>Estado</th><th></th></tr></thead><tbody>${filtered.map((m) => `<tr><td><div class="account">${avatar(m)}<b>${esc(m.name)}</b></div></td><td>${esc(m.email)}<br><small class="muted">${esc(m.data.phone || '')}</small></td><td>${esc(all.find((p) => p.id === m.parentId)?.name || 'Raíz de tu vista')}</td><td><span class="badge ${m.status === 'inactive' ? 'inactive' : ''}">${m.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><button data-member="${m.id}" class="ghost">Ver ficha →</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No encontramos aliados con esa búsqueda.</div>';
  document
    .querySelectorAll('[data-member]')
    .forEach((b) => (b.onclick = () => profile(b.dataset.member)));
  photos();
}
async function renderCore() {
  $('#corePage').innerHTML = '<p class="muted">Cargando la aplicación desde SuperApp…</p>';
  try {
    const data = await api('/superapp');
    if (!$('#corePage')) return;
    $('#corePage').innerHTML =
      `<div class="eyebrow">SUPERAPP · CENTRO DE APLICACIONES</div><h1>Tu aplicación, integrada.</h1><p class="muted">Gestiona Aliados por Antioquia sobre los modelos centrales de SuperApp.</p><div class="core-panel"><article class="core-card"><span class="badge">Aplicación activa</span><h2>${esc(data.app.name)}</h2><p>${esc(state.org.name)}</p><div class="core-badges"><span class="badge">${esc(data.storage)}</span><span class="badge">${data.members} cuentas</span><span class="badge">Formulario v${data.formVersion}</span><span class="badge">Revisión ${data.app.revision}</span></div><p class="muted">Los aliados se guardan en PostgreSQL y sus datos de registro están disponibles como registros dinámicos del motor. Cada cambio del formulario crea una versión nueva.</p><div class="profile-actions"><button class="primary" id="openCoreApp">Abrir árbol →</button><button id="editCoreForm">Configurar formulario</button></div><p class="footnote">Identificador de aplicación<br><code>${esc(data.app.id)}</code></p></article><article class="core-card"><h2>Formularios del motor</h2><p class="muted">El historial conserva los datos registrados con cada versión.</p>${data.schemas.map((s) => `<div class="core-schema"><span><b>${esc(s.name)}</b><br><small class="muted">${s.fields.length} campos · esquema central</small></span><span class="badge">Versión ${s.version}</span></div>`).join('')}</article></div>`;
    $('#openCoreApp').onclick = () => {
      state.view = 'tree';
      render();
    };
    $('#editCoreForm').onclick = () => {
      state.view = 'fields';
      render();
    };
  } catch (e) {
    if ($('#corePage')) $('#corePage').textContent = e.message;
  }
}
function modal(title, content) {
  const d = $('#modal');
  d.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button id="closeModal" aria-label="Cerrar">×</button></div>${content}`;
  $('#closeModal').onclick = () => d.close();
  if (!d.open) d.showModal();
}
async function profile(id) {
  let m = state.members.find((m) => m.id === id);
  if (state.paged) {
    try {
      m = (await api('/members/' + id)).member;
      if (!state.members.some((x) => x.id === id)) state.members.push(m);
    } catch (e) {
      toast(e.message);
      return;
    }
  }
  modal(
    'Ficha del aliado',
    `<div class="profile-top">${avatar(m)}<div><h2>${esc(m.name)}</h2><span class="badge">${m.role === 'ROOT' ? 'Entidad raíz' : m.status === 'active' ? 'Aliado activo' : 'Cuenta inactiva'}</span></div></div><div class="details"><div><span class="muted">Correo</span><b>${esc(m.email)}</b></div><div><span class="muted">Fecha de nacimiento</span><b>${esc(m.data.birthDate || 'Sin registrar')}</b></div><div><span class="muted">Registro</span><b>${new Date(m.created).toLocaleDateString('es-CO')}</b></div>${state.org.fields.filter((f) => f.id !== 'birthDate').map((f) => `<div><span class="muted">${esc(f.label)}</span><b>${esc(typeof m.data[f.id] === 'boolean' ? (m.data[f.id] ? 'Sí' : 'No') : m.data[f.id] || 'Sin registrar')}</b></div>`).join('')}</div><div class="profile-actions"><button class="primary" id="addBelow">＋ Añadir debajo</button><button id="editMember">Editar ficha</button>${m.id === state.user.id ? '<button id="logoutProfile" class="ghost">Cerrar sesión</button>' : ''}</div>`,
  );
  if (state.paged) {
    $('#modal')
      .querySelector('.profile-actions')
      .insertAdjacentHTML('beforeend', '<button id="exploreBranch">Explorar su árbol</button>');
    $('#exploreBranch').onclick = () => {
      $('#modal').close();
      focusBranch(id);
    };
  }
  $('#addBelow').onclick = () => memberForm(null, m.id);
  $('#editMember').onclick = () => memberForm(m, m.parentId);
  $('#logoutProfile') && ($('#logoutProfile').onclick = logout);
  photos();
}
function dynamicField(f, data) {
  const value = data[f.id] ?? '',
    required = f.required ? 'required' : '';
  const attrs = `name="field_${esc(f.id)}" ${required}`;
  if (f.type === 'checkbox')
    return `<label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}>${esc(f.label)}${f.required ? ' *' : ''}</label>`;
  if (f.id === 'municipality')
    return `<label class="municipality-picker">${esc(f.label)}${f.required ? ' *' : ''}<input type="text" ${attrs} value="${esc(value)}" maxlength="100" autocomplete="off" data-municipality aria-autocomplete="list" aria-expanded="false"><span class="municipality-options" role="listbox"></span></label>`;
  return `<label>${esc(f.label)}${f.required ? ' *' : ''}${f.type === 'select' ? `<select ${attrs}><option value="">Seleccionar…</option>${f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea ${attrs} maxlength="4000">${esc(value)}</textarea>` : `<input type="${f.type}" ${attrs} value="${esc(value)}" maxlength="4000" ${f.type === 'number' ? 'step="1" min="0" inputmode="numeric"' : ''}>`}</label>`;
}
const normalizeMunicipality = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function bindMunicipalityAutocomplete() {
  const input = document.querySelector('[data-municipality]');
  if (!input || typeof ANTIOQUIA_MUNICIPALITIES === 'undefined') return;
  const box = input.nextElementSibling;
  const draw = () => {
    const query = normalizeMunicipality(input.value);
    const matches = ANTIOQUIA_MUNICIPALITIES.filter((name) => normalizeMunicipality(name).includes(query)).slice(0, 10);
    box.innerHTML = matches.map((name) => `<button type="button" role="option" data-municipality-option="${esc(name)}">${esc(name)}</button>`).join('');
    box.hidden = !query || !matches.length;
    input.setAttribute('aria-expanded', String(!box.hidden));
    box.querySelectorAll('[data-municipality-option]').forEach((button) => button.onclick = () => {
      input.value = button.dataset.municipalityOption;
      input.setCustomValidity('');
      box.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.focus();
    });
  };
  input.oninput = draw;
  input.onfocus = draw;
  input.onblur = () => setTimeout(() => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150);
}
async function memberForm(m, parentId) {
  let loginAllowed = true;
  if (state.paged && (!m || (m.role !== 'ROOT' && m.id !== state.user.id))) {
    try {
      loginAllowed = (await api('/registration?parentId=' + parentId)).loginAllowed;
    } catch (e) {
      toast(e.message);
      return;
    }
  }
  const splitNames = state.org.fields.some((f) => f.id === 'firstNames') && state.org.fields.some((f) => f.id === 'lastNames');
  const orderedIds = ['firstNames', 'lastNames', 'documentNumber', 'municipality', 'neighborhood'];
  const endIds = ['phone', 'voteContribution'];
  const byId = Object.fromEntries(state.org.fields.map((f) => [f.id, f]));
  const customForm = splitNames
    ? `${orderedIds.map((id) => byId[id] ? dynamicField(byId[id], m?.data || {}) : '').join('')}<label>Fecha de nacimiento *<input name="birthDate" type="date" required value="${esc(m?.data?.birthDate || '')}"></label>${byId.phone ? dynamicField(byId.phone, m?.data || {}) : ''}<label>Correo *<input name="email" type="email" required maxlength="254" value="${esc(m?.email)}"></label>${byId.voteContribution ? dynamicField(byId.voteContribution, m?.data || {}) : ''}`
    : `<label>Nombre completo *<input name="name" required maxlength="150" value="${esc(m?.name)}"></label><label>Correo de acceso *<input name="email" type="email" required value="${esc(m?.email)}"></label><label>Fecha de nacimiento<input name="birthDate" type="date" value="${esc(m?.data?.birthDate || '')}"></label>${state.org.fields.filter((f) => f.id !== 'birthDate').map((f) => dynamicField(f, m?.data || {})).join('')}`;
  modal(
    m ? 'Editar aliado' : 'Registrar aliado',
    `<p class="muted">${m ? 'Actualiza los datos de la ficha.' : 'Se registrará debajo de ' + esc(state.members.find((x) => x.id === parentId)?.name) + '.'}</p><form id="memberForm"><div class="form-grid">${customForm}<label class="full">${m ? 'Nueva contraseña (opcional)' : loginAllowed ? 'Contraseña inicial *' : 'Sin acceso por nivel · contraseña opcional'}<input name="password" type="password" minlength="10" maxlength="200" ${m || !loginAllowed ? '' : 'required'} autocomplete="new-password"><small class="muted">Mínimo 10 caracteres. Compártela de forma privada con el aliado.</small></label>${loginAllowed ? '<label class="full">Foto de perfil<input name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted">La foto se ajustará antes de guardarla.</small></label>' : ''}${m && m.id !== state.user.id ? `<label>Estado<select name="status"><option value="active">Activo</option><option value="inactive" ${m.status === 'inactive' ? 'selected' : ''}>Inactivo</option></select></label>` : ''}</div><p class="error" id="formError"></p><div class="actions"><button type="button" id="cancel">Cancelar</button><button class="primary">Guardar aliado</button></div></form>`,
  );
  bindMunicipalityAutocomplete();
  $('#cancel').onclick = () => $('#modal').close();
  $('#memberForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      fd = new FormData(form),
      data = { ...m?.data };
    const municipality = fd.get('field_municipality');
    if (municipality && !ANTIOQUIA_MUNICIPALITIES.includes(municipality)) {
      form.querySelector('[data-municipality]').setCustomValidity('Selecciona un municipio del listado de Antioquia.');
      form.reportValidity();
      return;
    }
    data.birthDate = fd.get('birthDate') || '';
    for (const f of state.org.fields) {
      if (f.id === 'birthDate') continue;
      data[f.id] = f.type === 'checkbox' ? fd.has('field_' + f.id) : fd.get('field_' + f.id);
    }
    const b = {
      name: splitNames ? `${fd.get('field_firstNames')} ${fd.get('field_lastNames')}`.trim() : fd.get('name'),
      email: fd.get('email'),
      password: fd.get('password'),
      status: fd.get('status') || 'active',
      data,
      parentId,
    };
    const button = form.querySelector('button.primary');
    button.disabled = true;
    try {
      const photo = loginAllowed ? fd.get('photo') : null;
      const encoded = photo?.size ? await compress(photo) : null;
      const r = await post(m ? '/members/' + m.id : '/members', b, m ? 'PUT' : 'POST');
      if (encoded) await post('/members/' + r.member.id + '/photo', { base64: encoded }, 'PUT');
      $('#modal').close();
      if (!state.selectedCommunity && m?.id === state.user.id && b.password) {
        nativeToken = '';
        csrf = '';
        auth(true);
        toast('Contraseña cambiada. Inicia sesión de nuevo.');
      } else {
        await load();
        toast('Aliado guardado.');
      }
    } catch (error) {
      $('#formError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function compress(file) {
  if (file.size > 15000000) throw new Error('La imagen original debe pesar menos de 15 MB.');
  const image = await createImageBitmap(file);
  const ratio = Math.min(1, 600 / Math.max(image.width, image.height));
  const c = document.createElement('canvas');
  c.width = Math.round(image.width * ratio);
  c.height = Math.round(image.height * ratio);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  image.close();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
function renderFields() {
  let fields = structuredClone(state.org.fields);
  $('#fieldsPage').innerHTML =
    `<div class="eyebrow">Administración de la entidad raíz</div><h1>Un formulario a tu medida.</h1><p class="muted">Nombre, correo, contraseña y foto están incluidos. Configura aquí los datos adicionales de todos los aliados.</p><div class="form-note">Los cambios se aplican a los próximos registros y ediciones. Quitar un campo lo oculta; conserva los datos ya guardados en la base.</div><br><form id="schemaForm"><div id="fieldList"></div><div class="actions"><button type="button" id="newField">＋ Añadir campo</button><button class="primary">Guardar formulario</button></div><p class="error" id="schemaError"></p></form>`;
  const read = () => {
    document.querySelectorAll('.field-card').forEach((card, i) => {
      fields[i].label = card.querySelector('[data-label]').value;
      fields[i].type = card.querySelector('[data-type]').value;
      fields[i].required = card.querySelector('[data-required]').checked;
      if (fields[i].type === 'select')
        fields[i].options = (card.querySelector('[data-options]')?.value || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
    });
  };
  const draw = () => {
    $('#fieldList').innerHTML = fields
      .map(
        (f, i) =>
          `<div class="field-card"><div class="field-line"><input data-label aria-label="Etiqueta del campo" required maxlength="100" value="${esc(f.label)}"><select data-type aria-label="Tipo de campo">${Object.entries(
            {
              text: 'Texto',
              textarea: 'Texto largo',
              email: 'Correo',
              tel: 'Teléfono',
              number: 'Número',
              date: 'Fecha',
              select: 'Lista',
              checkbox: 'Casilla',
            },
          )
            .map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${v}</option>`)
            .join(
              '',
            )}</select><button type="button" data-remove="${i}" aria-label="Quitar campo">×</button></div><label class="check"><input type="checkbox" data-required ${f.required ? 'checked' : ''}>Obligatorio</label>${f.type === 'select' ? `<label>Opciones (una por línea)<textarea data-options required>${esc((f.options || []).join('\n'))}</textarea></label>` : ''}</div>`,
      )
      .join('');
    document.querySelectorAll('[data-type]').forEach(
      (el) =>
        (el.onchange = () => {
          read();
          draw();
        }),
    );
    document.querySelectorAll('[data-remove]').forEach(
      (el) =>
        (el.onclick = () => {
          read();
          fields.splice(Number(el.dataset.remove), 1);
          draw();
        }),
    );
  };
  draw();
  $('#newField').onclick = () => {
    read();
    fields.push({ id: 'f_' + Date.now(), label: 'Nuevo campo', type: 'text', required: false });
    draw();
  };
  $('#schemaForm').onsubmit = async (e) => {
    e.preventDefault();
    read();
    try {
      await post('/fields', { fields }, 'PUT');
      state.org.fields = fields;
      toast('Formulario actualizado.');
    } catch (error) {
      $('#schemaError').textContent = error.message;
    }
  };
}
async function exportCSV() {
  const communityName = state.org.name,
    fields = state.org.fields,
    membersRoute = scopedRoute('/members');
  let exportMembers = state.members;
  let campaignRecords = [];
  if (state.paged) {
    const button = $('#export');
    button.disabled = true;
    exportMembers = [];
    try {
      let cursor = null;
      do {
        const page = await api(membersRoute + '?limit=100' + (cursor ? '&after=' + cursor : ''));
        exportMembers.push(...page.members);
        cursor = page.nextCursor;
        button.textContent = exportMembers.length + ' registros…';
      } while (cursor);
    } catch (e) {
      toast(e.message);
      return;
    } finally {
      button.disabled = false;
      button.textContent = '↓ CSV';
    }
  }
  if (state.user?.role === 'ROOT') {
    try {
      let cursor = null;
      do {
        const page = await api('/campaigns/entries?limit=100' + (cursor ? '&after=' + cursor : ''));
        campaignRecords.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor);
    }
    catch (error) { toast('No se pudieron incluir las campañas: ' + error.message); return; }
  }
  const cell = (v) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [
    [divisionLabel(), 'Nombre', 'Correo', 'Superior', 'Estado', ...fields.map((f) => f.label)],
    ...exportMembers.map((m) => [
      communityName,
      m.name,
      m.email,
      exportMembers.find((p) => p.id === m.parentId)?.name || '',
      m.status,
      ...fields.map((f) => m.data[f.id]),
    ]),
    ...campaignRecords.map((entry) => [
      communityName,
      entry.name,
      entry.email,
      entry.campaign.name,
      'Registro de campaña',
      ...fields.map((f) => entry.data[f.id]),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aliados.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function logout() {
  try {
    await post('/logout', {});
  } catch {}
  nativeToken = '';
  csrf = '';
  state = { members: [], view: 'tree', query: '' };
  $('#modal').close();
  auth(true);
}
async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
  } else
    toast('En el menú del navegador elige “Instalar aplicación” o “Añadir a pantalla de inicio”.');
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('online', () =>
  state.user ? load().catch((e) => toast(e.message)) : start(),
);
window.addEventListener('offline', () => {
  if (state.user) render();
});
async function start() {
  try {
    try {
      apiBase =
        (await (await fetch('app-config.json')).json()).apiBase ||
        (location.pathname.startsWith('/affiliates/') ? location.pathname.replace(/\/$/, '') : '');
    } catch {}
    if (native && !apiBase) {
      $('#app').innerHTML =
        '<div class="loading"><h2>Configuración móvil pendiente</h2><p>Esta compilación necesita el servidor HTTPS de tu organización. Configura su dirección antes de distribuir la aplicación.</p></div>';
      return;
    }
    const status = await api('/status');
    if (status.directory) directoryBranding = { ...directoryBranding, ...status.directory };
    applyDirectoryTheme();
    try {
      await load();
    } catch (error) {
      if (error.status !== 428) auth(status.configured, status.directory);
    }
  } catch {
    $('#app').innerHTML =
      '<div class="loading"><h2>No se pudo conectar con la plataforma.</h2><p>Comprueba que el servidor esté encendido y vuelve a abrir la aplicación.</p></div>';
  }
}
if ('serviceWorker' in navigator && !native)
  navigator.serviceWorker.register('sw.js').catch(() => {});
start();
