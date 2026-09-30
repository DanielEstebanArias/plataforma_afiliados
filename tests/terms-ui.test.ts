import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('pending terms stop loading members and settings', async () => {
  const requests: string[] = [];
  let shown: any;
  const context = vm.createContext({ window: { addEventListener() {} }, navigator: { onLine: true },
    document: { querySelector() { return {}; }, querySelectorAll() { return []; } },
    termsShown: (terms: any) => { shown = terms; },
    request: (route: string) => { requests.push(route); return { csrf: 'csrf', user: { id: 'u' },
      organization: { integration: true }, terms: { required: true, current: { id: 'v1' } } }; } });
  vm.runInContext(fs.readFileSync('affiliates/web/app.js', 'utf8').replace(/\nstart\(\);\s*$/, ''), context);
  vm.runInContext('api = async route => request(route); renderTermsAcceptance = termsShown;', context);
  await vm.runInContext('load()', context);
  assert.deepEqual(requests, ['/me']);
  assert.equal(shown.current.id, 'v1');
});

test('terms render as escaped text and require explicit acceptance', () => {
  const elements = new Map<string, any>();
  const context = vm.createContext({ state: {}, esc: (value: any) => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    $: (key: string) => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); }, logout() {} });
  vm.runInContext(fs.readFileSync('affiliates/web/terms.js', 'utf8'), context);
  vm.runInContext(`renderTermsAcceptance({ current: { id: 'v', title: '<img>', content: '<script>run()</script>', version: 1, publishedAt: '2026-09-29' } })`, context);
  const html = elements.get('#app').innerHTML;
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /type="checkbox" name="accepted" required/);
});
