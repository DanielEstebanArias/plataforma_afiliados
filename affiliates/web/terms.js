function termsText(current) {
  return `<h2>${esc(current.title)}</h2><p class="muted">Versión ${esc(current.version)} · Publicada el ${esc(new Date(current.publishedAt).toLocaleDateString())}</p><div class="terms-text">${esc(current.content)}</div>`;
}
function renderTermsAcceptance(terms) {
  if (!terms.current) return;
  state.pendingTerms = terms;
  state.selectedCommunity = null;
  state.members = [];
  $('#modal')?.close?.();
  $('#app').innerHTML = `<main class="terms-gate"><section class="board terms-card"><div class="eyebrow">Antes de continuar</div><h1>Términos y condiciones</h1><p>Revisa la versión vigente. Para usar la plataforma debes aceptarla.</p>${termsText(terms.current)}<form id="termsAccept"><label class="terms-check"><input type="checkbox" name="accepted" required> He leído y acepto estos términos y condiciones.</label><p class="error" id="termsError"></p><button class="primary">Aceptar y continuar</button> <button type="button" id="termsLogout" class="ghost">Cerrar sesión</button></form></section></main>`;
  $('#termsLogout').onclick = logout;
  $('#termsAccept').onsubmit = async (event) => {
    event.preventDefault();
    if (!event.target.elements.accepted.checked) return;
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await post('/terms/accept', { versionId: terms.current.id, accepted: true });
      await load();
    } catch (error) {
      // Reload the document when another version was published while reading.
      try {
        const fresh = await api('/terms');
        if (fresh.current?.id !== terms.current.id) {
          renderTermsAcceptance(fresh);
          $('#termsError').textContent = 'Los términos se actualizaron. Revisa la nueva versión.';
          return;
        }
      } catch {}
      $('#termsError').textContent = error.message;
    } finally { button.disabled = false; }
  };
}
async function renderTermsManagement() {
  const container = $('#featurePage');
  container.innerHTML = '<p>Cargando términos…</p>';
  try {
    const { versions } = await api('/terms/manage');
    if (container !== $('#featurePage')) return;
    const current = versions[0];
    container.innerHTML = `<section class="hero"><div><div class="eyebrow">Superadministrador</div><h1>Términos y condiciones</h1><p>Al publicar una versión, todas las cuentas deberán aceptarla para continuar. Las versiones publicadas se conservan.</p></div></section><section class="board terms-card"><form id="termsPublish"><label>Título<input name="title" required maxlength="200" value="${esc(current?.title || 'Términos y condiciones')}"></label><label>Texto de los términos<textarea name="content" rows="18" required maxlength="100000">${esc(current?.content || '')}</textarea></label><p class="muted">Escribe texto sin formato. Publica el contenido aprobado por tu organización.</p><label class="terms-check"><input type="checkbox" name="confirmPublish" required> Confirmo que esta nueva versión debe ser aceptada por todas las cuentas.</label><p class="error" id="termsPublishError"></p><button class="primary">Publicar nueva versión</button></form></section><section class="board terms-card"><h2>Versiones publicadas</h2>${versions.length ? versions.map(v => `<details><summary>Versión ${esc(v.version)} · ${esc(v.title)} · ${esc(new Date(v.publishedAt).toLocaleDateString())}</summary>${termsText(v)}</details>`).join('') : '<p>Aún no hay términos publicados. El acceso actual se mantiene hasta la primera publicación.</p>'}</section>`;
    $('#termsPublish').onsubmit = async event => {
      event.preventDefault();
      const form = event.target;
      if (!form.elements.confirmPublish.checked) return;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        await post('/terms/publish', { title: form.elements.title.value,
          content: form.elements.content.value, confirmPublish: true,
          expectedVersionId: current?.id || null });
        toast('Versión publicada. Revisa y acepta los términos para continuar.');
        await load();
      } catch (error) { $('#termsPublishError').textContent = error.message; }
      finally { button.disabled = false; }
    };
  } catch (error) { if (container === $('#featurePage')) container.textContent = error.message; }
}
