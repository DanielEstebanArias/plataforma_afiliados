import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function appContext() {
  const elements = new Map<string, any>();
  let exported: Blob | undefined;
  const context = vm.createContext({
    window: { addEventListener() {} },
    navigator: { onLine: true },
    document: {
      querySelector(key: string) {
        if (!elements.has(key)) elements.set(key, { innerHTML: '', classList: { toggle() {} } });
        return elements.get(key);
      },
      querySelectorAll: () => [],
      createElement: () => ({ click() {} }),
    },
    Blob,
    URL: {
      createObjectURL(blob: Blob) {
        exported = blob;
        return 'blob:test';
      },
      revokeObjectURL() {},
    },
    setTimeout() {},
    clearTimeout() {},
  });
  vm.runInContext(
    fs.readFileSync('affiliates/web/app.js', 'utf8').replace(/\nstart\(\);\s*$/, ''),
    context,
  );
  return { context, elements, exported: () => exported };
}

test('superadmin starts at communities without requesting or rendering an unselected tree', async () => {
  const { context, elements } = appContext();
  const requests: string[] = [];
  context.responses = {
    '/me': {
      user: { id: 'admin', name: 'Admin', role: 'ROOT' },
      organization: { name: 'Platform', integration: true },
    },
    '/settings': { superuser: true },
  };
  context.request = (route: string) => {
    requests.push(route);
    return context.responses[route];
  };
  vm.runInContext('api = async (route) => request(route); renderCommunities = () => {};', context);
  await vm.runInContext('load()', context);
  assert.deepEqual(requests, ['/me', '/settings']);
  assert.equal(vm.runInContext('state.view', context), 'communities');
  assert.equal(elements.get('#app').innerHTML.includes('id="network"'), false);
  assert.equal(elements.get('#app').innerHTML.includes('data-nav="tree"'), false);
});

test('CSV includes community on every record across pages and uses selected community endpoint', async () => {
  const { context, exported } = appContext();
  const urls: string[] = [];
  context.fetch = async (url: string) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({
        members: [
          {
            id: String(urls.length),
            name: 'Person',
            email: 'person@test.example',
            status: 'active',
            data: {},
          },
        ],
        nextCursor: urls.length === 1 ? 'next' : null,
      }),
    };
  };
  vm.runInContext(
    `state = { paged: true, selectedCommunity: 'selected', org: { name: 'Community "North"', fields: [] } };`,
    context,
  );
  await vm.runInContext('exportCSV()', context);
  const lines = (await exported()!.text()).replace(/^\ufeff/, '').split('\r\n');
  assert.ok(lines[0].startsWith('"Comunidad";"Nombre"'));
  assert.equal(lines.length, 3);
  for (const line of lines.slice(1)) assert.ok(line.startsWith('"Community ""North""";'));
  assert.deepEqual(urls, [
    '/api/communities/selected/admin/members?limit=100',
    '/api/communities/selected/admin/members?limit=100&after=next',
  ]);
});

test('selected community exposes every admin module and scopes all data requests', () => {
  const { context, elements } = appContext();
  vm.runInContext(
    `
    state = { paged: true, selectedCommunity: 'selected', view: 'communities', members: [],
      user: { id: 'admin', name: 'Admin', role: 'ROOT' }, org: { name: 'Selected community', fields: [] },
      settings: { superuser: true, modules: { access: false, dashboard: false, form: false } } };
    renderCommunities = () => {};
    render();
  `,
    context,
  );
  const html = elements.get('#app').innerHTML;
  for (const module of ['access', 'dashboard', 'fields', 'tree'])
    assert.ok(html.includes(`data-nav="${module}"`));
  assert.ok(html.includes('createSelectedCommunity'));
  for (const route of [
    '/settings',
    '/dashboard?status=active',
    '/fields',
    '/members',
    '/registration?parentId=root',
    '/me',
  ])
    assert.equal(
      vm.runInContext(`scopedRoute(${JSON.stringify(route)})`, context),
      '/communities/selected/admin' + route,
    );
  assert.equal(
    vm.runInContext(`scopedRoute('/communities/export.csv')`, context),
    '/communities/export.csv',
  );
  assert.equal(vm.runInContext(`scopedRoute('/logout')`, context), '/logout');
});

test('tree pans without overflow using mouse or touch and stops after release', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('affiliates/web/tree.js', 'utf8'), context);
  const classes = new Set();
  const viewport: any = {
    clientWidth: 1000,
    scrollLeft: 0,
    scrollTop: 0,
    classList: { add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s) },
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {},
  };
  const world: any = { style: {} },
    stage = { style: {} },
    card = { style: {} };
  const fit: any = { dataset: { action: 'fit' } };
  const host = {
    innerHTML: '',
    closest: () => ({ classList: { contains: () => false } }),
    querySelector: (selector: string) =>
      ({ '.org-viewport': viewport, '.org-stage': stage, '.org-world': world })[selector] ||
      (selector.startsWith('[data-card') ? card : {}),
    querySelectorAll: (selector: string) => (selector === '[data-action]' ? [fit] : []),
  };
  const root = {
    id: 'root',
    role: 'ROOT',
    status: 'active',
    name: 'Root',
    email: 'root@test.example',
    data: {},
  };
  context.window.AffiliateTree.render(
    host,
    [root],
    root,
    () => '',
    () => {},
    null,
    () => {},
  );
  const event = (x: number, y: number, type: string) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: type,
    isPrimary: true,
    button: 0,
    preventDefault() {},
    target: { closest: () => null },
  });
  for (const type of ['mouse', 'touch']) {
    fit.onclick();
    viewport.onpointerdown(event(30, 40, type));
    viewport.onpointermove(event(130, 120, type));
    assert.equal(world.style.transform, 'translate(100px, 80px) scale(1)');
    viewport.onpointerup();
    viewport.onpointermove(event(150, 140, type));
    assert.equal(world.style.transform, 'translate(100px, 80px) scale(1)');
    assert.equal(classes.has('dragging'), false);
  }
  fit.onclick();
  assert.equal(world.style.transform, 'translate(0px, 0px) scale(1)');
});
