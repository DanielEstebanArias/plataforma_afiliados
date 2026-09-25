async function renderDirectory() {
  const host = $('#network');
  if (!host) return;
  const token = (state.listToken = (state.listToken || 0) + 1);
  host.innerHTML = '<div class="empty">Buscando en toda tu rama…</div>';
  try {
    const page = await api(
      '/members?limit=50&q=' +
        encodeURIComponent(state.query || '') +
        (state.cursor ? '&after=' + state.cursor : ''),
    );
    if (token !== state.listToken || !$('#network')) return;
    state.listRows = page.members;
    host.innerHTML = `<div class="search-status">${page.total.toLocaleString('es-CO')} coincidencias en toda tu rama · hasta 50 por página</div>${page.members.length ? `<div class="table-wrap"><table><thead><tr><th>Afiliado</th><th>Correo</th><th>Estado</th><th>Directos</th><th></th></tr></thead><tbody>${page.members.map((m) => `<tr><td><div class="account">${avatar(m)}<b>${esc(m.name)}</b></div></td><td>${esc(m.email)}</td><td><span class="badge">${m.status === 'active' ? 'Activo' : 'Inactivo'}</span></td><td>${m.childCount}</td><td><button data-directory-member="${m.id}">Ver ficha</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No se encontraron afiliados.</div>'}<div class="pagination"><button id="previousPage" ${!state.cursor ? 'disabled' : ''}>← Anterior</button><span>Página ${(state.history || [null]).length}</span><button id="nextPage" ${!page.nextCursor ? 'disabled' : ''}>Siguiente →</button></div>`;
    host
      .querySelectorAll('[data-directory-member]')
      .forEach((b) => (b.onclick = () => profile(b.dataset.directoryMember)));
    $('#nextPage').onclick = () => {
      state.cursor = page.nextCursor;
      (state.history ||= []).push(page.nextCursor);
      renderDirectory();
    };
    $('#previousPage').onclick = () => {
      state.history.pop();
      state.cursor = state.history.at(-1) || null;
      renderDirectory();
    };
    photos();
  } catch (e) {
    if (token === state.listToken && $('#network')) host.textContent = e.message;
  }
}
async function loadBranch(id) {
  try {
    const cursor = state.branchPages?.[id];
    const page = await api(
      '/members?parentId=' + id + '&limit=25' + (cursor ? '&after=' + cursor : ''),
    );
    if (state.members.length + page.members.length > 500) {
      const detail = await api('/members/' + id);
      state.focus = id;
      state.members = [{ ...detail.member, childCount: page.total, hasMore: !!page.nextCursor }, ...page.members];
      state.branchPages = { [id]: page.nextCursor };
      toast('Mostrando el siguiente grupo de esta rama. El directorio permite buscar cualquier afiliado.');
      network();
      return;
    }
    const ids = new Set(state.members.map((m) => m.id));
    state.members.push(...page.members.filter((m) => !ids.has(m.id)));
    state.branchPages[id] = page.nextCursor;
    const parent = state.members.find((m) => m.id === id);
    if (parent) { parent.childCount = page.total; parent.hasMore = !!page.nextCursor; }
    network();
  } catch (e) {
    toast(e.message);
    network();
  }
}
async function focusBranch(id) {
  try {
    const [detail, page] = await Promise.all([
      api('/members/' + id),
      api('/members?parentId=' + id + '&limit=25'),
    ]);
    state.focus = id;
    state.members = [{ ...detail.member, childCount: page.total, hasMore: !!page.nextCursor }, ...page.members];
    state.branchPages = { [id]: page.nextCursor };
    state.view = 'tree';
    state.query = '';
    render();
  } catch (e) {
    toast(e.message);
  }
}
