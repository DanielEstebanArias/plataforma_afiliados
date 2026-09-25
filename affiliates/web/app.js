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
const native = !!window.Capacitor?.isNativePlatform?.();
async function api(route, options = {}) {
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
  if (!response.ok) throw new Error(data.error || 'No se pudo conectar.');
  return data;
}
const post = (route, data, method = 'POST') => api(route, { method, body: JSON.stringify(data) });
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
      const r = await fetch(apiBase + `/api/members/${img.dataset.photo}/photo`, {
        headers: nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {},
      });
      if (r.ok) {
        const u = URL.createObjectURL(await r.blob());
        img.src = u;
        img.onload = () => URL.revokeObjectURL(u);
      }
    } catch {}
  }
}
const brand = '<div class="brand"><img src="icon.svg" alt="">Plataforma<br>Afiliados</div>';
function auth(configured) {
  $('#app').innerHTML =
    `<main class="auth"><section class="auth-intro">${brand}<span class="eyebrow" hidden></span><h1>Tu comunidad.<br>Conectada desde<br>la raíz.</h1><p>Personas, relaciones e información en un solo lugar. Haz crecer tu red con una administración simple.</p><div class="auth-art"><span>Árbol de afiliación</span><span>Formularios a tu medida</span><span>Acceso por rama</span></div></section><section class="auth-form"><form id="authForm"><div class="eyebrow">${configured ? 'Bienvenido de nuevo' : 'Comienza tu red'}</div><h2>${configured ? 'Ingresa a tu organización' : 'Crea tu entidad raíz'}</h2><p class="muted">${configured ? 'Accede con la cuenta que te asignó tu organización.' : 'Esta cuenta administrará toda la red y configurará el formulario de afiliación.'}</p>${configured ? '' : '<label>Nombre de la entidad<input name="organization" required maxlength="150" placeholder="Mi organización"></label><label>Tu nombre<input name="name" required maxlength="150" autocomplete="name"></label>'}<label>Correo electrónico<input name="email" type="email" required autocomplete="username"></label><label>Contraseña<input name="password" type="password" minlength="10" maxlength="200" required autocomplete="${configured ? 'current-password' : 'new-password'}" placeholder="Mínimo 10 caracteres"></label><p class="error" id="authError"></p><button class="primary">${configured ? 'Ingresar →' : 'Crear organización →'}</button><p class="footnote">Datos guardados en la base de esta instalación. ${configured ? '' : 'Puedes añadir afiliados después de crear tu cuenta.'}</p></form></section></main>`;
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      if (!configured) await post('/setup', b);
      const result = await post('/login', { email: b.email, password: b.password, native });
      csrf = result.csrf;
      nativeToken = result.token || '';
      await load();
    } catch (error) {
      $('#authError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function load() {
  const me = await api('/me');
  csrf = me.csrf;
  state.user = me.user;
  state.org = me.organization;
  state.paged = !!state.org.integration;
  if (state.paged) {
    const [stats, settings, page] = await Promise.all([
      api('/stats'),
      api('/settings'),
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
function render() {
  const me = state.user,
    all = state.members;
  const metrics = state.stats || {
    total: all.length,
    direct: all.filter((m) => m.parentId === me.id).length,
    levels: 0,
    active: all.filter((m) => m.status === 'active').length,
  };
  $('#app').innerHTML =
    `${navigator.onLine ? '' : '<div class="offline">Sin conexión. La información y los cambios requieren conexión con el servidor.</div>'}<div class="layout"><aside>${brand}<nav class="nav">${state.paged ? '<button data-nav="communities">◉ &nbsp; Comunidades</button>' + (me.role === 'ROOT' ? '<button data-nav="access">⚙ &nbsp; Acceso y foto</button>' : '') : ''}<button data-nav="tree">♧ &nbsp; Mi red</button>${state.paged ? '<button data-nav="dashboard">▥ &nbsp; Dashboard</button>' : ''}${me.role === 'ROOT' ? '<button data-nav="fields">▤ &nbsp; Formulario</button>' : ''}<button id="install" class="install">↓ &nbsp; Instalar aplicación</button></nav><div class="sidebar-bottom">UNA RED, MUCHAS POSIBILIDADES<br>Cada persona hace la diferencia.<br><button id="logout">Cerrar sesión</button></div></aside><main class="main"><header class="topbar"><span>${esc(state.org.name)} &nbsp; / &nbsp; <b>Mi comunidad</b></span><button class="account ghost" id="myProfile">${avatar(me)}<span>${esc(me.name)}<br><small class="muted">${me.role === 'ROOT' ? 'Administrador raíz' : 'Afiliado'}</small></span></button></header>${['dashboard', 'communities', 'access'].includes(state.view) ? '<div id="featurePage"></div>' : state.view === 'superapp' ? '<div id="corePage"></div>' : state.view === 'fields' ? '<div id="fieldsPage"></div>' : `<section class="hero"><div><div class="eyebrow">Personas que conectan</div><h1>Tu red empieza contigo.</h1><p>Visualiza tu comunidad, acompaña a cada persona y sigue creciendo.</p></div><button class="primary" id="addMember">＋ Registrar afiliado</button></section><section class="stats"><div class="stat"><span>AFILIADOS EN TU RED</span><b>${metrics.total}</b><span>Incluye tu cuenta</span></div><div class="stat"><span>AFILIADOS DIRECTOS</span><b>${metrics.direct}</b><span>Conectados contigo</span></div><div class="stat"><span>NIVELES DE TU RED</span><b>${metrics.levels}</b><span>Debajo de tu cuenta</span></div><div class="stat"><span>CUENTAS ACTIVAS</span><b>${metrics.active}</b><span>Afiliaciones activas</span></div></section><div class="toolbar"><div class="tabs"><button data-view="tree" class="${state.view === 'tree' ? 'active' : ''}">♧ Árbol de afiliación</button><button data-view="list" class="${state.view === 'list' ? 'active' : ''}">☷ Directorio</button></div><input id="search" class="search" aria-label="Buscar afiliados" placeholder="Buscar por nombre, correo o ciudad…" value="${esc(state.query)}"></div><section class="board"><div class="board-title"><div><b>${state.view === 'tree' ? 'Así se conecta tu comunidad' : 'Directorio de afiliados'}</b><div class="muted">${me.role === 'ROOT' ? 'Vista completa de tu organización' : 'Tu cuenta y todos tus descendientes'}</div></div><button id="export" class="ghost">↓ CSV</button></div><div id="network"></div></section><p class="footnote">Selecciona una persona para ver su ficha o registrar un afiliado debajo de ella. No hay un límite de cuentas configurado.</p>`}</main></div>`;
  document.querySelectorAll('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
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
  $('#myProfile').onclick = () => profile(me.id);
  $('#install').onclick = install;
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'communities') renderCommunities();
  else if (state.view === 'access') renderAccess();
  else if (state.view === 'superapp') renderCore();
  else if (state.view === 'fields') renderFields();
  else {
    $('#addMember').onclick = () => memberForm(null, me.id);
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
      state.searchTimer = setTimeout(() => network(), 250);
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
      state.paged ? state.members.find((m) => m.id === state.focus) || state.user : state.user,
      avatar,
      profile,
      (id) => memberForm(null, id),
      photos,
      state.paged ? loadBranch : null,
    );
    if (state.paged) {
      $('#network').insertAdjacentHTML(
        'afterbegin',
        '<div class="branch-context"><span>Árbol por ramas · ' +
          state.stats.total +
          ' afiliados en tu red</span><button id="myTree">Volver a mi raíz</button></div>',
      );
      $('#myTree').onclick = () => focusBranch(state.user.id);
    }
  } else
    $('#network').innerHTML = filtered.length
      ? `<div class="table-wrap"><table><thead><tr><th>Afiliado</th><th>Contacto</th><th>Depende de</th><th>Estado</th><th></th></tr></thead><tbody>${filtered.map((m) => `<tr><td><div class="account">${avatar(m)}<b>${esc(m.name)}</b></div></td><td>${esc(m.email)}<br><small class="muted">${esc(m.data.phone || '')}</small></td><td>${esc(all.find((p) => p.id === m.parentId)?.name || 'Raíz de tu vista')}</td><td><span class="badge ${m.status === 'inactive' ? 'inactive' : ''}">${m.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td><button data-member="${m.id}" class="ghost">Ver ficha →</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No encontramos afiliados con esa búsqueda.</div>';
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
      `<div class="eyebrow">SUPERAPP · CENTRO DE APLICACIONES</div><h1>Tu aplicación, integrada.</h1><p class="muted">Gestiona Afiliados sobre los modelos centrales de SuperApp.</p><div class="core-panel"><article class="core-card"><span class="badge">Aplicación activa</span><h2>${esc(data.app.name)}</h2><p>${esc(state.org.name)}</p><div class="core-badges"><span class="badge">${esc(data.storage)}</span><span class="badge">${data.members} cuentas</span><span class="badge">Formulario v${data.formVersion}</span><span class="badge">Revisión ${data.app.revision}</span></div><p class="muted">Los afiliados se guardan en PostgreSQL y sus datos de registro están disponibles como registros dinámicos del motor. Cada cambio del formulario crea una versión nueva.</p><div class="profile-actions"><button class="primary" id="openCoreApp">Abrir árbol →</button><button id="editCoreForm">Configurar formulario</button></div><p class="footnote">Identificador de aplicación<br><code>${esc(data.app.id)}</code></p></article><article class="core-card"><h2>Formularios del motor</h2><p class="muted">El historial conserva los datos registrados con cada versión.</p>${data.schemas.map((s) => `<div class="core-schema"><span><b>${esc(s.name)}</b><br><small class="muted">${s.fields.length} campos · esquema central</small></span><span class="badge">Versión ${s.version}</span></div>`).join('')}</article></div>`;
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
    'Ficha del afiliado',
    `<div class="profile-top">${avatar(m)}<div><h2>${esc(m.name)}</h2><span class="badge">${m.role === 'ROOT' ? 'Entidad raíz' : m.status === 'active' ? 'Afiliado activo' : 'Cuenta inactiva'}</span></div></div><div class="details"><div><span class="muted">Correo</span><b>${esc(m.email)}</b></div><div><span class="muted">Registro</span><b>${new Date(m.created).toLocaleDateString('es-CO')}</b></div>${state.org.fields.map((f) => `<div><span class="muted">${esc(f.label)}</span><b>${esc(typeof m.data[f.id] === 'boolean' ? (m.data[f.id] ? 'Sí' : 'No') : m.data[f.id] || 'Sin registrar')}</b></div>`).join('')}</div><div class="profile-actions"><button class="primary" id="addBelow">＋ Añadir debajo</button><button id="editMember">Editar ficha</button>${m.id === state.user.id ? '<button id="logoutProfile" class="ghost">Cerrar sesión</button>' : ''}</div>`,
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
  return `<label>${esc(f.label)}${f.required ? ' *' : ''}${f.type === 'select' ? `<select ${attrs}><option value="">Seleccionar…</option>${f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea ${attrs} maxlength="4000">${esc(value)}</textarea>` : `<input type="${f.type}" ${attrs} value="${esc(value)}" maxlength="4000" ${f.type === 'number' ? 'step="any"' : ''}>`}</label>`;
}
async function memberForm(m, parentId) {
  let loginAllowed = true;
  if (!m && state.paged) {
    try {
      loginAllowed = (await api('/registration?parentId=' + parentId)).loginAllowed;
    } catch (e) {
      toast(e.message);
      return;
    }
  }
  modal(
    m ? 'Editar afiliado' : 'Registrar afiliado',
    `<p class="muted">${m ? 'Actualiza los datos de la ficha.' : 'Se registrará debajo de ' + esc(state.members.find((x) => x.id === parentId)?.name) + '.'}</p><form id="memberForm"><div class="form-grid"><label>Nombre completo *<input name="name" required maxlength="150" value="${esc(m?.name)}"></label><label>Correo de acceso *<input name="email" type="email" required value="${esc(m?.email)}"></label>${state.org.fields.map((f) => dynamicField(f, m?.data || {})).join('')}<label class="full">${m ? 'Nueva contraseña (opcional)' : loginAllowed ? 'Contraseña inicial *' : 'Sin acceso por nivel · contraseña opcional'}<input name="password" type="password" minlength="10" maxlength="200" ${m || !loginAllowed ? '' : 'required'} autocomplete="new-password"><small class="muted">Mínimo 10 caracteres. Compártela de forma privada con el afiliado.</small></label><label class="full">Foto de perfil<input name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="muted">La foto se ajustará antes de guardarla.</small></label>${m && m.id !== state.user.id ? `<label>Estado<select name="status"><option value="active">Activo</option><option value="inactive" ${m.status === 'inactive' ? 'selected' : ''}>Inactivo</option></select></label>` : ''}</div><p class="error" id="formError"></p><div class="actions"><button type="button" id="cancel">Cancelar</button><button class="primary">Guardar afiliado</button></div></form>`,
  );
  $('#cancel').onclick = () => $('#modal').close();
  $('#memberForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      fd = new FormData(form),
      data = { ...m?.data };
    for (const f of state.org.fields)
      data[f.id] = f.type === 'checkbox' ? fd.has('field_' + f.id) : fd.get('field_' + f.id);
    const b = {
      name: fd.get('name'),
      email: fd.get('email'),
      password: fd.get('password'),
      status: fd.get('status') || 'active',
      data,
      parentId,
    };
    const button = form.querySelector('button.primary');
    button.disabled = true;
    try {
      const photo = fd.get('photo');
      const encoded = photo?.size ? await compress(photo) : null;
      const r = await post(m ? '/members/' + m.id : '/members', b, m ? 'PUT' : 'POST');
      if (encoded) await post('/members/' + r.member.id + '/photo', { base64: encoded }, 'PUT');
      $('#modal').close();
      if (m?.id === state.user.id && b.password) {
        nativeToken = '';
        csrf = '';
        auth(true);
        toast('Contraseña cambiada. Inicia sesión de nuevo.');
      } else {
        await load();
        toast('Afiliado guardado.');
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
    `<div class="eyebrow">Administración de la entidad raíz</div><h1>Un formulario a tu medida.</h1><p class="muted">Nombre, correo, contraseña y foto están incluidos. Configura aquí los datos adicionales de todos los afiliados.</p><div class="form-note">Los cambios se aplican a los próximos registros y ediciones. Quitar un campo lo oculta; conserva los datos ya guardados en la base.</div><br><form id="schemaForm"><div id="fieldList"></div><div class="actions"><button type="button" id="newField">＋ Añadir campo</button><button class="primary">Guardar formulario</button></div><p class="error" id="schemaError"></p></form>`;
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
  let exportMembers = state.members;
  if (state.paged) {
    const button = $('#export');
    button.disabled = true;
    exportMembers = [];
    try {
      let cursor = null;
      do {
        const page = await api('/members?limit=100' + (cursor ? '&after=' + cursor : ''));
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
  const fields = state.org.fields;
  const cell = (v) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [
    ['Nombre', 'Correo', 'Superior', 'Estado', ...fields.map((f) => f.label)],
    ...exportMembers.map((m) => [
      m.name,
      m.email,
      exportMembers.find((p) => p.id === m.parentId)?.name || '',
      m.status,
      ...fields.map((f) => m.data[f.id]),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'afiliados.csv';
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
    try {
      await load();
    } catch {
      auth(status.configured);
    }
  } catch {
    $('#app').innerHTML =
      '<div class="loading"><h2>No se pudo conectar con la plataforma.</h2><p>Comprueba que el servidor esté encendido y vuelve a abrir la aplicación.</p></div>';
  }
}
if ('serviceWorker' in navigator && !native)
  navigator.serviceWorker.register('sw.js').catch(() => {});
start();
