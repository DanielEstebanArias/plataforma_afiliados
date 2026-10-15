let campaignDirectoryRequest = 0;
async function campaignEntries(campaign, cursor = null, history = [null], query = '') {
  const host = $('#featurePage');
  if (host.dataset.campaignDirectory !== campaign.id) {
    host.dataset.campaignDirectory = campaign.id;
    host.innerHTML = `<section class="hero campaign-directory-hero"><div><button class="button-link" id="backToCampaigns">← Volver a campañas</button><div class="eyebrow">Registros de campaña</div><h1>${esc(campaign.name)}</h1><p>Completa aquí los campos que no se solicitaron en el formulario público.</p></div></section><div class="toolbar campaign-directory-toolbar"><div><b>Directorio de registros</b><div class="muted" id="campaignSearchStatus">Buscando registros…</div></div><div class="search-box"><span aria-hidden="true">⌕</span><input id="campaignSearch" class="search" type="search" autocomplete="off" placeholder="Buscar por nombre o correo…"><button id="clearCampaignSearch" type="button" aria-label="Limpiar búsqueda" hidden>×</button></div></div><section class="board campaign-directory" id="campaignDirectoryResults"><div class="empty">Cargando registros…</div></section>`;
    $('#backToCampaigns').onclick = () => renderCampaigns();
    let timer;
    $('#campaignSearch').oninput = (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => campaignEntries(campaign, null, [null], event.target.value.trim()), 180);
    };
    $('#clearCampaignSearch').onclick = () => { $('#campaignSearch').value = ''; campaignEntries(campaign); };
  }
  const resultsHost = $('#campaignDirectoryResults'), request = ++campaignDirectoryRequest;
  resultsHost.classList.add('directory-searching');
  resultsHost.setAttribute('aria-busy', 'true');
  const result = await api('/campaigns/entries?limit=50&campaignId=' + encodeURIComponent(campaign.id) + (cursor ? '&after=' + cursor : '') + (query ? '&q=' + encodeURIComponent(query) : ''));
  if (request !== campaignDirectoryRequest || host.dataset.campaignDirectory !== campaign.id) return;
  const rows = result.entries;
  $('#campaignSearchStatus').textContent = `${result.total.toLocaleString('es-CO')} coincidencias · hasta 50 por página`;
  resultsHost.innerHTML = `<div class="table-wrap campaign-entry-table"><table><thead><tr><th>Aliado</th><th>Correo</th><th>Fecha de registro</th><th></th></tr></thead><tbody>${rows.map((entry) => `<tr><td><div class="campaign-person"><span class="avatar">${esc((entry.name || entry.data.firstNames || '?').trim().charAt(0).toUpperCase() || '?')}</span><b>${esc(entry.name || entry.data.firstNames || 'Sin completar')}</b></div></td><td>${esc(entry.email || 'Sin completar')}</td><td>${new Date(entry.createdAt).toLocaleDateString('es-CO')}</td><td><button type="button" data-edit-campaign-entry="${entry.id}">Ver ficha</button></td></tr>`).join('')}</tbody></table></div>${rows.length ? '' : '<div class="empty">No hay registros que coincidan con la búsqueda.</div>'}<div class="pagination"><button type="button" id="previousCampaignEntries" ${history.length === 1 ? 'disabled' : ''}>← Anterior</button><span>Página ${history.length}</span><button type="button" id="nextCampaignEntries" ${result.nextCursor ? '' : 'disabled'}>Siguiente →</button></div>`;
  resultsHost.classList.remove('directory-searching');
  resultsHost.removeAttribute('aria-busy');
  document.querySelectorAll('[data-edit-campaign-entry]').forEach((button) => button.onclick = () => editCampaignEntry(rows.find((entry) => entry.id === button.dataset.editCampaignEntry), campaign));
  $('#previousCampaignEntries').onclick = () => { const previous = history.slice(0, -1); campaignEntries(campaign, previous.at(-1), previous, query); };
  $('#nextCampaignEntries').onclick = () => campaignEntries(campaign, result.nextCursor, [...history, result.nextCursor], query);
}
function editCampaignEntry(entry, campaign) {
  const splitNames = state.org.fields.some((field) => field.id === 'firstNames') && state.org.fields.some((field) => field.id === 'lastNames');
  modal('Completar registro de campaña', `<p class="muted">Campaña: ${esc(campaign.name)}</p><form id="campaignEntryForm"><div class="form-grid">${splitNames ? '' : `<label>Nombre completo<input name="name" maxlength="150" value="${esc(entry.name)}"></label>`}<label>Correo<input name="email" type="email" maxlength="254" value="${esc(entry.email)}"></label>${state.org.fields.map((field) => dynamicField(field, entry.data || {})).join('')}</div><p class="error" id="campaignEntryError"></p><div class="actions"><button type="button" id="backToCampaign">Volver</button><button class="primary">Guardar ficha</button></div></form>`);
  bindMunicipalityAutocomplete();
  $('#backToCampaign').onclick = () => { $('#modal').close(); campaignEntries(campaign); };
  $('#campaignEntryForm').onsubmit = async (event) => {
    event.preventDefault(); const fd = new FormData(event.target), data = {};
    for (const field of state.org.fields) data[field.id] = field.type === 'checkbox' ? fd.has('field_' + field.id) : fd.get('field_' + field.id);
    const name = splitNames ? `${data.firstNames || ''} ${data.lastNames || ''}`.trim() : fd.get('name'), button = event.target.querySelector('button.primary'); button.disabled = true;
    try { await post('/campaigns/entries/' + entry.id, { name, email: fd.get('email'), data }, 'PUT'); $('#modal').close(); toast('Ficha de campaña actualizada.'); await campaignEntries(campaign); }
    catch (error) { $('#campaignEntryError').textContent = error.message; button.disabled = false; }
  };
}
async function renderCampaigns() {
  const host = $('#featurePage'); host.innerHTML = '<p>Cargando campañas…</p>';
  try {
    const campaigns = (await api('/campaigns')).campaigns;
    host.innerHTML = `<section class="hero"><div><div class="eyebrow">Captura pública por QR</div><h1>Campañas.</h1><p>Crea formularios públicos con campos seleccionados y conserva cada registro dentro de su campaña.</p></div><button class="primary" id="newCampaign">＋ Nueva campaña</button></section><div class="campaign-grid">${campaigns.map((campaign) => `<article class="campaign-card"><div><span class="badge ${campaign.enabled ? '' : 'inactive'}">${campaign.enabled ? 'Activa' : 'Deshabilitada'}</span><h2>${esc(campaign.name)}</h2><p class="muted">${campaign.entries.toLocaleString('es-CO')} registros · creada ${new Date(campaign.createdAt).toLocaleDateString('es-CO')}</p></div><label class="campaign-toggle"><input type="checkbox" data-campaign-toggle="${campaign.id}" ${campaign.enabled ? 'checked' : ''}> Recibir nuevos registros</label><div class="profile-actions"><button class="primary" data-campaign-entries="${campaign.id}">Ver registros</button><button data-campaign-qr="${campaign.id}">Descargar QR vectorial</button><button class="ghost" data-campaign-copy="${campaign.token}">Copiar enlace</button></div></article>`).join('') || '<div class="empty">Crea la primera campaña de esta subregión.</div>'}</div>`;
    $('#newCampaign').onclick = () => {
      const splitNames = state.org.fields.some((field) => field.id === 'firstNames') && state.org.fields.some((field) => field.id === 'lastNames');
      const options = [...(splitNames ? [] : [{ id: '__name', label: 'Nombre completo', required: true }]), { id: '__email', label: 'Correo', required: true }, ...state.org.fields];
      modal('Nueva campaña', `<form id="campaignForm"><label>Nombre de la campaña<input name="name" required maxlength="150" placeholder="Ej. Encuentro Medellín"></label><fieldset><legend>Campos visibles en el formulario público</legend><div class="campaign-fields">${options.map((field) => `<label class="check"><input type="checkbox" name="fieldIds" value="${esc(field.id)}" ${field.required ? 'checked' : ''}>${esc(field.label)}${field.required ? ' · obligatorio' : ''}</label>`).join('')}</div></fieldset><p class="form-note">Los campos que no selecciones podrán completarse después desde los registros de la campaña.</p><p class="error" id="campaignError"></p><div class="actions"><button type="button" id="cancelCampaign">Cancelar</button><button class="primary">Crear campaña</button></div></form>`);
      $('#cancelCampaign').onclick = () => $('#modal').close();
      $('#campaignForm').onsubmit = async (event) => { event.preventDefault(); const fd = new FormData(event.target), button = event.target.querySelector('button.primary'); button.disabled = true; try { await post('/campaigns', { name: fd.get('name'), fieldIds: fd.getAll('fieldIds') }); $('#modal').close(); toast('Campaña creada. El QR permanecerá inalterable.'); await renderCampaigns(); } catch (error) { $('#campaignError').textContent = error.message; button.disabled = false; } };
    };
    document.querySelectorAll('[data-campaign-toggle]').forEach((input) => input.onchange = async () => { input.disabled = true; try { await post('/campaigns/' + input.dataset.campaignToggle, { enabled: input.checked }, 'PUT'); toast(input.checked ? 'Campaña habilitada.' : 'Campaña deshabilitada.'); await renderCampaigns(); } catch (error) { input.checked = !input.checked; input.disabled = false; toast(error.message); } });
    document.querySelectorAll('[data-campaign-entries]').forEach((button) => button.onclick = () => campaignEntries(campaigns.find((campaign) => campaign.id === button.dataset.campaignEntries)));
    document.querySelectorAll('[data-campaign-copy]').forEach((button) => button.onclick = async () => { await navigator.clipboard.writeText(location.origin + '/campaign.html?token=' + button.dataset.campaignCopy); toast('Enlace público copiado.'); });
    document.querySelectorAll('[data-campaign-qr]').forEach((button) => button.onclick = async () => { button.disabled = true; try { const route = scopedRoute('/campaigns/' + button.dataset.campaignQr + '/qr'), response = await fetch(apiBase + '/api' + route, { headers: nativeToken ? { Authorization: 'Bearer ' + nativeToken } : {} }); if (!response.ok) throw new Error((await response.json()).error || 'No se pudo generar el QR.'); const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = 'qr-campana.svg'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { toast(error.message); } finally { button.disabled = false; } });
  } catch (error) { host.textContent = error.message; }
}
