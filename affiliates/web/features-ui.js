async function communityPhotos() {
  for (const img of document.querySelectorAll('[data-community-photo]')) {
    try {
      const r = await fetch(apiBase + '/api/communities/' + img.dataset.communityPhoto + '/photo', {
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
async function renderCommunities() {
  const host = $('#featurePage');
  host.innerHTML = '<p>Cargando comunidades…</p>';
  try {
    const result = await api('/communities');
    const labels = {
      PENDING: 'Pendiente de aprobación',
      APPROVED: 'Habilitada',
      REJECTED: 'Rechazada',
      SUSPENDED: 'Suspendida',
    };
    host.innerHTML = `<div class="hero"><div><div class="eyebrow">${result.superuser ? 'Superusuario · revisión y aprobación' : 'Tu espacio de comunidades'}</div><h1>Comunidades que crecen.</h1><p>Las nuevas comunidades necesitan aprobación antes de operar.</p></div><button class="primary" id="requestCommunity">＋ Crear comunidad</button></div><div class="community-grid">${result.communities.map((c) => `<article class="community-card"><div class="community-cover">${c.hasPhoto ? `<img data-community-photo="${c.id}" alt="Foto de ${esc(c.name)}">` : `<span>${esc(c.name.slice(0, 2).toUpperCase())}</span>`}</div><div class="community-body"><span class="badge ${c.approvalStatus === 'APPROVED' ? '' : 'inactive'}">${labels[c.approvalStatus]}</span><h2>${esc(c.name)}</h2><p class="muted">${c.current ? 'Comunidad actual' : c.approvalStatus === 'APPROVED' ? 'Accede con el correo y contraseña de la cuenta raíz asignada.' : 'La cuenta raíz tendrá acceso cuando se apruebe la solicitud.'}</p>${c.reviewNote ? `<p class="review-note">${esc(c.reviewNote)}</p>` : ''}<div class="profile-actions">${c.current ? '<button data-current="true">Ver mi árbol</button>' : c.approvalStatus === 'APPROVED' ? `<a class="button-link" href="${esc(c.url)}">Abrir comunidad →</a>` : ''}${result.superuser && !c.current ? `<button data-review="${c.id}" data-status="APPROVED">Aprobar / habilitar</button><button class="ghost" data-review="${c.id}" data-status="${c.approvalStatus === 'APPROVED' ? 'SUSPENDED' : 'REJECTED'}">${c.approvalStatus === 'APPROVED' ? 'Suspender' : 'Rechazar'}</button>` : ''}${c.canEditPhoto ? `<button class="ghost" data-community-edit="${c.id}">Cambiar foto</button>` : ''}</div></div></article>`).join('')}</div>`;
    $('#requestCommunity').onclick = () => {
      modal(
        'Solicitar una comunidad',
        `<form id="communityRequest"><p class="form-note">La comunidad quedará pendiente. Serás su cuenta raíz, con tu correo y contraseña actuales; tendrá su propio árbol y formulario.</p><label>Nombre de la comunidad<input name="name" required maxlength="150"></label><label>Foto de la comunidad<input name="photo" type="file" accept="image/*"></label><p class="error" id="communityError"></p><div class="actions"><button class="primary">Enviar solicitud</button></div></form>`,
      );
      $('#communityRequest').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target),
          button = e.target.querySelector('button');
        button.disabled = true;
        try {
          const image = f.get('photo');
          await post('/communities', {
            name: f.get('name'),
            ...(image.size ? { base64: await compress(image) } : {}),
          });
          $('#modal').close();
          toast('Comunidad pendiente de aprobación.');
          await renderCommunities();
        } catch (e) {
          $('#communityError').textContent = e.message;
        } finally {
          button.disabled = false;
        }
      };
    };
    host.querySelectorAll('[data-current]').forEach(
      (b) =>
        (b.onclick = () => {
          state.view = 'tree';
          render();
        }),
    );
    host.querySelectorAll('[data-review]').forEach(
      (b) =>
        (b.onclick = () => {
          modal(
            'Revisar comunidad',
            `<form id="reviewForm"><p>${b.dataset.status === 'APPROVED' ? 'Habilitarás el ingreso y la administración de esta comunidad.' : 'Se impedirá el acceso a la comunidad.'}</p><label>Motivo / observaciones<textarea name="note" maxlength="500" ${b.dataset.status === 'APPROVED' ? '' : 'required'}></textarea></label><p id="reviewError" class="error"></p><button class="primary">Confirmar decisión</button></form>`,
          );
          $('#reviewForm').onsubmit = async (e) => {
            e.preventDefault();
            try {
              await post(
                '/communities/' + b.dataset.review,
                { status: b.dataset.status, note: new FormData(e.target).get('note') },
                'PUT',
              );
              $('#modal').close();
              await renderCommunities();
              toast('Decisión guardada.');
            } catch (e) {
              $('#reviewError').textContent = e.message;
            }
          };
        }),
    );
    host
      .querySelectorAll('[data-community-edit]')
      .forEach((b) => (b.onclick = () => editCommunityPhoto(b.dataset.communityEdit)));
    communityPhotos();
  } catch (e) {
    host.textContent = e.message;
  }
}
function editCommunityPhoto(id) {
  modal(
    'Foto de comunidad',
    '<form id="communityPhotoForm"><label>Selecciona una imagen<input name="photo" type="file" accept="image/*" required></label><p class="error" id="photoError"></p><button class="primary">Guardar foto</button></form>',
  );
  $('#communityPhotoForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post(
        '/communities/' + id + '/photo',
        { base64: await compress(new FormData(e.target).get('photo')) },
        'PUT',
      );
      $('#modal').close();
      toast('Foto guardada.');
      if (state.view === 'communities') renderCommunities();
      else renderAccess();
    } catch (e) {
      $('#photoError').textContent = e.message;
    }
  };
}
async function renderAccess() {
  const host = $('#featurePage');
  try {
    const s = await api('/settings');
    state.settings = s;
    host.innerHTML = `<div class="eyebrow">Administración de la comunidad</div><h1>Acceso por nivel.</h1><p class="muted">La raíz es el nivel 0. Sus afiliados directos son el nivel 1, y así sucesivamente.</p><article class="core-card"><div class="community-mini">${s.hasPhoto ? `<img data-community-photo="${s.id}" alt="Foto de comunidad">` : ''}<div><h2>${esc(s.name)}</h2><p>Los afiliados debajo del límite seguirán registrados, aunque no podrán iniciar sesión.</p></div></div>${state.user.role === 'ROOT' ? `<form id="accessForm"><label class="check"><input type="checkbox" name="unlimited" ${s.maxLoginLevel === null ? 'checked' : ''}>Permitir acceso en todos los niveles</label><label>Nivel máximo con acceso<input name="level" required type="number" min="0" max="10000" value="${s.maxLoginLevel ?? 2}" ${s.maxLoginLevel === null ? 'disabled' : ''}></label><p class="form-note">Los cambios se aplican también a las sesiones ya abiertas. Cada afiliado con acceso ve exclusivamente su propia rama.</p><p id="accessError" class="error"></p><button class="primary">Guardar permisos</button></form><br><button id="accessPhoto">Cambiar foto de comunidad</button>` : `<p>Acceso permitido: ${s.maxLoginLevel === null ? 'todos los niveles' : 'hasta el nivel ' + s.maxLoginLevel}.</p>`}</article>`;
    const f = $('#accessForm');
    if (f) {
      f.elements.unlimited.onchange = () =>
        (f.elements.level.disabled = f.elements.unlimited.checked);
      f.onsubmit = async (e) => {
        e.preventDefault();
        try {
          state.settings = await post(
            '/settings',
            { maxLoginLevel: f.elements.unlimited.checked ? null : Number(f.elements.level.value) },
            'PUT',
          );
          toast('Permisos actualizados.');
        } catch (e) {
          $('#accessError').textContent = e.message;
        }
      };
      $('#accessPhoto').onclick = () => editCommunityPhoto(s.id);
    }
    communityPhotos();
  } catch (e) {
    host.textContent = e.message;
  }
}
let dashboardData = null;
const chartColors = ['#2c7256', '#72a889', '#b0cd94', '#d7b76b', '#719cb0', '#b190b4'];
async function renderDashboard(filters = '') {
  const host = $('#featurePage');
  host.innerHTML = '<p>Calculando indicadores de tu rama…</p>';
  try {
    const d = await api('/dashboard' + filters);
    dashboardData = d;
    host.innerHTML = `<div class="hero"><div><div class="eyebrow">Información de tu comunidad</div><h1>Tu red, en cifras.</h1><p>Indicadores calculados sobre toda tu rama autorizada.</p></div><button id="configureDashboard" class="primary">Configurar gráficas</button></div><form id="dashboardFilters" class="dashboard-filters"><label>Desde<input type="date" name="from"></label><label>Hasta<input type="date" name="to"></label><label>Estado<select name="status"><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label><button>Aplicar filtros</button></form><div class="dashboard-grid">${d.charts.map((c, i) => `<article class="chart-card"><div class="eyebrow">${{ count: 'Cantidad', sum: 'Suma', avg: 'Promedio' }[c.metric]}</div><h2>${esc(c.title)}</h2><strong class="chart-total">${c.total === null ? '—' : Number(c.total).toLocaleString('es-CO', { maximumFractionDigits: 2 })}</strong><p class="muted">${c.records.toLocaleString('es-CO')} registros en el filtro</p><div id="chart_${i}"></div>${c.truncated ? '<p class="muted">Se muestran las primeras 50 categorías. El indicador superior incluye todas.</p>' : ''}</article>`).join('') || '<div class="empty">Añade tu primera gráfica.</div>'}</div>`;
    const params = new URLSearchParams(filters.replace(/^\?/, ''));
    for (const key of ['from', 'to', 'status'])
      $('#dashboardFilters').elements[key].value = params.get(key) || '';
    $('#dashboardFilters').onsubmit = (e) => {
      e.preventDefault();
      renderDashboard('?' + new URLSearchParams(new FormData(e.target)));
    };
    $('#configureDashboard').onclick = configureDashboard;
    d.charts.forEach((c, i) => {
      const el = $('#chart_' + i);
      if (c.chart === 'kpi') return;
      if (!c.rows.length) {
        el.innerHTML = '<p class="muted">Sin datos para estos filtros.</p>';
        return;
      }
      const label = (v) =>
        v === 'active'
          ? 'Activo'
          : v === 'inactive'
            ? 'Inactivo'
            : v === 'true'
              ? 'Sí'
              : v === 'false'
                ? 'No'
                : v;
      const max = Math.max(1, ...c.rows.map((r) => Math.abs(r.value || 0)));
      el.innerHTML = c.rows
        .map(
          (r, j) =>
            `<div class="chart-row"><div><span>${esc(label(r.label))}</span><b>${r.value === null ? '—' : Number(r.value).toLocaleString('es-CO', { maximumFractionDigits: 2 })}</b></div><div class="bar-track"><span data-value="${(Math.abs(r.value || 0) / max) * 100}" data-color="${chartColors[j % chartColors.length]}"></span></div></div>`,
        )
        .join('');
      el.querySelectorAll('[data-value]').forEach((b) => {
        b.style.width = b.dataset.value + '%';
        b.style.backgroundColor = b.dataset.color;
      });
      if (c.chart === 'donut' && c.metric !== 'avg' && c.rows.every((r) => (r.value ?? 0) >= 0)) {
        const sum = c.rows.reduce((n, r) => n + (r.value || 0), 0);
        if (sum) {
          let offset = 0;
          const segments = c.rows.map((r, j) => {
            const share = ((r.value || 0) / sum) * 100;
            const segment = `<circle cx="60" cy="60" r="45" fill="none" stroke="${chartColors[j % chartColors.length]}" stroke-width="15" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"/>`;
            offset += share;
            return segment;
          });
          el.insertAdjacentHTML(
            'afterbegin',
            `<svg viewBox="0 0 120 120" class="donut-chart" role="img" aria-label="Distribución de ${esc(c.title)}">${segments.join('')}</svg>`,
          );
        }
      }
    });
  } catch (e) {
    host.innerHTML = `<p class="error">${esc(e.message)}</p><button id="resetDashboard">Restablecer panel</button>`;
    $('#resetDashboard').onclick = async () => {
      await post('/dashboard', { widgets: [] }, 'PUT');
      renderDashboard();
    };
  }
}
function configureDashboard() {
  let widgets = structuredClone(dashboardData.widgets);
  const fields = dashboardData.fields;
  const groups = [
    { id: '$status', label: 'Estado' },
    { id: '$month', label: 'Mes de registro' },
    ...fields,
  ];
  modal(
    'Configurar dashboard',
    '<form id="dashboardEditor"><p class="muted">Asocia cada gráfica a un campo del formulario. Las sumas y promedios requieren datos numéricos.</p><div id="widgetRows"></div><div class="actions"><button type="button" id="addWidget">＋ Gráfica</button><button class="primary">Guardar panel</button></div><p class="error" id="dashboardError"></p></form>',
  );
  const read = () => {
    $('#widgetRows')
      .querySelectorAll('.widget-editor')
      .forEach((row, i) => {
        for (const key of ['title', 'groupBy', 'metric', 'valueField', 'chart'])
          widgets[i][key] = row.querySelector(`[data-key="${key}"]`).value;
      });
  };
  const draw = () => {
    $('#widgetRows').innerHTML = widgets
      .map(
        (w, i) =>
          `<div class="widget-editor"><label>Título<input data-key="title" value="${esc(w.title)}" required maxlength="100"></label><div class="form-grid"><label>Agrupar por<select data-key="groupBy">${groups.map((f) => `<option value="${esc(f.id)}" ${w.groupBy === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label><label>Operación<select data-key="metric">${Object.entries(
            { count: 'Cantidad de afiliados', sum: 'Suma', avg: 'Promedio' },
          )
            .map(
              ([k, v]) => `<option value="${k}" ${w.metric === k ? 'selected' : ''}>${v}</option>`,
            )
            .join(
              '',
            )}</select></label><label>Campo numérico<select data-key="valueField"><option value="">No aplica para cantidad</option>${fields
            .filter((f) => f.type === 'number')
            .map(
              (f) =>
                `<option value="${esc(f.id)}" ${w.valueField === f.id ? 'selected' : ''}>${esc(f.label)}</option>`,
            )
            .join('')}</select></label><label>Presentación<select data-key="chart">${Object.entries(
            { bar: 'Barras', donut: 'Distribución + barras', kpi: 'Indicador' },
          )
            .map(
              ([k, v]) => `<option value="${k}" ${w.chart === k ? 'selected' : ''}>${v}</option>`,
            )
            .join(
              '',
            )}</select></label></div><button type="button" class="danger" data-remove-widget="${i}">Quitar gráfica</button></div>`,
      )
      .join('');
    $('#widgetRows')
      .querySelectorAll('[data-remove-widget]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            read();
            widgets.splice(Number(b.dataset.removeWidget), 1);
            draw();
          }),
      );
  };
  draw();
  $('#addWidget').onclick = () => {
    read();
    if (widgets.length >= 12) return toast('Puedes configurar hasta 12 gráficas.');
    widgets.push({ title: 'Nueva gráfica', groupBy: '$status', metric: 'count', chart: 'bar' });
    draw();
  };
  $('#dashboardEditor').onsubmit = async (e) => {
    e.preventDefault();
    read();
    try {
      await post('/dashboard', { widgets }, 'PUT');
      $('#modal').close();
      renderDashboard();
      toast('Dashboard guardado.');
    } catch (e) {
      $('#dashboardError').textContent = e.message;
    }
  };
}
