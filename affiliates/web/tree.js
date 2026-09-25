/* Presentation only. The server returns only the authenticated person's branch. */
window.AffiliateTree = (() => {
  const folded = new Set();
  let scale = 1;
  const cardWidth = 252,
    cardHeight = 176,
    gap = 30,
    row = 244,
    padding = 48;
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  function render(host, members, user, avatar, onOpen, onAdd, loadPhotos, onLoad) {
    const byId = new Map(members.map((m) => [m.id, m])),
      children = new Map();
    for (const m of members) {
      const key = m.id === user.id ? null : m.parentId;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(m);
    }
    const root = byId.get(user.id);
    if (!root) {
      host.textContent = 'No hay afiliados disponibles.';
      return;
    }
    const descendants = new Map();
    function size(m, seen = new Set()) {
      if (seen.has(m.id)) return 0;
      seen.add(m.id);
      const n = (children.get(m.id) || []).reduce((n, c) => n + 1 + size(c, seen), 0);
      descendants.set(m.id, n);
      return n;
    }
    size(root);
    function draw() {
      const positions = [],
        edges = [],
        widths = new Map();
      let budget = 0;
      function measure(m, depth) {
        budget++;
        if (depth > 40 || budget > 500 || folded.has(m.id)) {
          widths.set(m.id, cardWidth);
          return cardWidth;
        }
        const branch = children.get(m.id) || [];
        const width = Math.max(
          cardWidth,
          branch.reduce((s, c) => s + measure(c, depth + 1), 0) +
            Math.max(0, branch.length - 1) * gap,
        );
        widths.set(m.id, width);
        return width;
      }
      const totalWidth = measure(root, 0) + padding * 2;
      function place(m, left, depth) {
        const width = widths.get(m.id) || cardWidth;
        const x = left + width / 2 - cardWidth / 2,
          y = padding + depth * row;
        positions.push({ m, x, y, depth });
        if (folded.has(m.id) || depth > 40) return;
        const branch = (children.get(m.id) || []).filter((c) => widths.has(c.id));
        let childLeft = left;
        for (const child of branch) {
          const w = widths.get(child.id);
          edges.push({
            x1: x + cardWidth / 2,
            y1: y + cardHeight,
            x2: childLeft + w / 2,
            y2: y + row,
          });
          place(child, childLeft, depth + 1);
          childLeft += w + gap;
        }
      }
      place(root, padding, 0);
      const totalHeight = Math.max(...positions.map((p) => p.y)) + cardHeight + padding;
      host.innerHTML = `<div class="org-toolbar"><div class="org-legend"><span class="legend-dot"></span> Tu rama <span class="org-separator">/</span> ${members.length} cargados <span class="org-separator">/</span> ${positions.length} visibles</div><div class="org-controls"><button data-action="wide" title="Ampliar el área del árbol">Vista amplia</button><button data-action="expand" title="Desplegar ramas">Desplegar</button><button data-action="fold" title="Mostrar primer nivel">Resumir</button><span class="org-divider"></span><button data-action="minus" aria-label="Reducir zoom">−</button><output aria-label="Nivel de zoom"></output><button data-action="plus" aria-label="Aumentar zoom">＋</button><button data-action="fit" title="Ajustar árbol a la pantalla">⛶ Ajustar</button></div></div><div class="org-viewport" tabindex="0" aria-label="Árbol de afiliación. Desplázate para explorar las ramas."><div class="org-stage"><div class="org-world"><svg class="org-lines" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">${edges.map((e) => `<path d="M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + 34}, ${e.x2} ${e.y1 + 34}, ${e.x2} ${e.y2}"/>`).join('')}</svg>${positions.map(({ m, depth }) => `<article class="org-card ${m.id === root.id ? 'org-root' : ''} ${m.status === 'inactive' ? 'org-inactive' : ''}" data-card="${m.id}"><div class="org-card-top"><span>${m.id === root.id ? (m.role === 'ROOT' ? 'ENTIDAD RAÍZ' : 'RAÍZ DE ESTA VISTA') : 'NIVEL ' + depth}</span><span class="org-status" title="${m.status === 'active' ? 'Cuenta activa' : 'Cuenta inactiva'}"></span></div><button class="org-person" data-open="${m.id}">${avatar(m)}<span><strong>${escape(m.name)}</strong><small>${escape(m.data.city || m.email)}</small></span></button><div class="org-card-bottom"><button class="org-branch" data-fold="${m.id}" ${children.has(m.id) ? '' : 'disabled'} aria-expanded="${!folded.has(m.id)}" aria-label="${folded.has(m.id) ? 'Expandir' : 'Contraer'} rama de ${escape(m.name)}">${children.has(m.id) ? (folded.has(m.id) ? '⊞' : '⊟') : '○'} ${m.childCount ?? (children.get(m.id) || []).length} directos <span>· ${descendants.get(m.id) || 0} en vista</span></button><button class="org-add" data-add="${m.id}" aria-label="Añadir afiliado debajo de ${escape(m.name)}">＋</button></div>${onLoad && m.hasMore !== false && (m.childCount || 0) > (children.get(m.id) || []).length ? `<button class="org-more" data-load="${m.id}">Cargar rama (${(children.get(m.id) || []).length}/${m.childCount}) ↓</button>` : ''}</article>`).join('')}</div></div></div><div class="org-help"><span>Arrastra el fondo para moverte. Selecciona una persona para abrir su ficha.</span><span>＋ Añade personas a cualquier rama visible</span></div>`;
      const viewport = host.querySelector('.org-viewport'),
        stage = host.querySelector('.org-stage'),
        world = host.querySelector('.org-world');
      world.style.width = totalWidth + 'px';
      world.style.height = totalHeight + 'px';
      positions.forEach((p) => {
        const card = host.querySelector(`[data-card="${p.m.id}"]`);
        card.style.left = p.x + 'px';
        card.style.top = p.y + 'px';
      });
      function zoom(next, center = true) {
        scale = Math.max(0.25, Math.min(1.6, next));
        world.style.transform = `scale(${scale})`;
        stage.style.width = totalWidth * scale + 'px';
        stage.style.height = totalHeight * scale + 'px';
        host.querySelector('output').textContent = Math.round(scale * 100) + '%';
        if (center)
          viewport.scrollLeft = Math.max(0, (totalWidth * scale - viewport.clientWidth) / 2);
      }
      if (host.closest('.board').classList.contains('board-focus'))
        host.querySelector('[data-action="wide"]').textContent = 'Cerrar vista amplia';
      host.querySelectorAll('[data-action]').forEach(
        (b) =>
          (b.onclick = () => {
            const a = b.dataset.action;
            if (a === 'wide') {
              const panel = host.closest('.board');
              panel.classList.toggle('board-focus');
              b.textContent = panel.classList.contains('board-focus')
                ? 'Cerrar vista amplia'
                : 'Vista amplia';
            }
            if (a === 'plus') zoom(scale + 0.15);
            if (a === 'minus') zoom(scale - 0.15);
            if (a === 'fit') {
              zoom(Math.min(1, (viewport.clientWidth - 24) / totalWidth));
              viewport.scrollTop = 0;
            }
            if (a === 'expand') {
              folded.clear();
              draw();
            }
            if (a === 'fold') {
              for (const m of members) if (m.id !== root.id && children.has(m.id)) folded.add(m.id);
              draw();
            }
          }),
      );
      host.querySelectorAll('[data-load]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            await onLoad(b.dataset.load);
          }),
      );
      host.querySelectorAll('[data-fold]').forEach(
        (b) =>
          (b.onclick = () => {
            folded.has(b.dataset.fold) ? folded.delete(b.dataset.fold) : folded.add(b.dataset.fold);
            draw();
          }),
      );
      host
        .querySelectorAll('[data-open]')
        .forEach((b) => (b.onclick = () => onOpen(b.dataset.open)));
      host.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => onAdd(b.dataset.add)));
      let drag = null;
      viewport.onpointerdown = (e) => {
        if (e.target.closest('button') || e.pointerType === 'touch') return;
        drag = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(e.pointerId);
        viewport.classList.add('dragging');
      };
      viewport.onpointermove = (e) => {
        if (drag) {
          viewport.scrollLeft = drag.left - e.clientX + drag.x;
          viewport.scrollTop = drag.top - e.clientY + drag.y;
        }
      };
      viewport.onpointerup = viewport.onpointercancel = () => {
        drag = null;
        viewport.classList.remove('dragging');
      };
      zoom(scale);
      loadPhotos();
    }
    draw();
  }
  return { render };
})();
