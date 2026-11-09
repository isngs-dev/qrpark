import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Sprint 5b source rules, like the Android app's source scan: the portal's own
 * code is read and the rules are checked as text, so a change that breaks one
 * fails here before it reaches a screen.
 */

const ROOT = join(import.meta.dirname, '..');
const SOURCES = ['app', 'lib', 'middleware.ts', 'next.config.mjs'];

function files(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else if (/\.(ts|tsx|mjs|js)$/.test(p)) {
      out.push({ path: relative(ROOT, p).replaceAll('\\', '/'), text: readFileSync(p, 'utf8') });
    }
  };
  for (const s of SOURCES) walk(join(ROOT, s));
  return out;
}

const all = files();
const lines = all.flatMap((f) => f.text.split('\n').map((line, i) => ({ path: f.path, n: i + 1, line })));
const where = (hits: typeof lines) => hits.map((h) => `${h.path}:${h.n}  ${h.line.trim()}`).join('\n');

test('the scan sees the portal: login, session, api, middleware, every page', () => {
  const paths = all.map((f) => f.path);
  for (const p of ['lib/session.ts', 'lib/api.ts', 'lib/auth-actions.ts', 'middleware.ts', 'app/login/login-form.tsx']) {
    assert.ok(paths.includes(p), `${p} scanned`);
  }
  assert.ok(paths.length >= 20, `${paths.length} files`);
});

test('no console logging anywhere (so never a token, a cookie, a request body or a password)', () => {
  const hits = lines.filter((l) => /\bconsole\s*\.\s*\w+/.test(l.line));
  assert.equal(hits.length, 0, where(hits));
});

test('the backend address is server-only: no NEXT_PUBLIC_ anywhere; QRPARK_API_URL read in one file', () => {
  const pub = lines.filter((l) => /NEXT_PUBLIC_/.test(l.line));
  assert.equal(pub.length, 0, where(pub));
  const reads = lines.filter((l) => /process\.env\.QRPARK_API_URL/.test(l.line));
  assert.deepEqual([...new Set(reads.map((r) => r.path))], ['lib/backend-url.ts'], where(reads));
});

test('no script touches cookies, and browser storage holds only the theme and sidebar choice', () => {
  const cookie = lines.filter((l) => /document\.cookie/.test(l.line));
  assert.equal(cookie.length, 0, where(cookie));
  const storage = lines.filter((l) => /(localStorage|sessionStorage)\s*\.\s*(setItem|getItem)/.test(l.line));
  const bad = storage.filter((l) => !/(SIDEBAR_KEY|THEME_KEY|'qrpark-theme')/.test(l.line) || /sessionStorage/.test(l.line));
  assert.equal(bad.length, 0, where(bad));
});

test('a password never goes into a URL, a message or a template; every password field is type="password"', () => {
  const inUrl = lines.filter((l) => /password/i.test(l.line) && /(redirect\(|href=|searchParams|URLSearchParams|router\.push|\?password)/.test(l.line));
  assert.equal(inUrl.length, 0, where(inUrl));
  const inTemplate = lines.filter((l) => /\$\{[^}]*\b(password|newPassword)\b[^}]*\}/.test(l.line));
  assert.equal(inTemplate.length, 0, where(inTemplate));
  let fields = 0;
  for (const f of all) {
    for (const m of f.text.matchAll(/name="password"/g)) {
      // The <input ... /> element around this name, and nothing beyond it.
      const start = f.text.lastIndexOf('<input', m.index);
      const end = f.text.indexOf('/>', m.index);
      const element = f.text.slice(start, end);
      const at = `${f.path}:${f.text.slice(0, m.index).split('\n').length}`;
      assert.ok(start >= 0 && end > m.index, `${at} not inside an <input />`);
      assert.match(element, /type="password"/, `${at} password field without type="password"`);
      assert.doesNotMatch(element, /defaultValue|value=/, `${at} password field must start empty`);
      fields++;
    }
  }
  assert.ok(fields >= 3, `${fields} password fields checked (sign-in, new account, reset)`);
});

test('nothing changes state through a GET: no GET forms, and every write goes through a Server Action', () => {
  const getForms = lines.filter((l) => /method=["'{]?\s*["']?get/i.test(l.line));
  assert.equal(getForms.length, 0, where(getForms));
  const routeHandlers = all.filter((f) => /\/route\.(ts|js)$/.test(f.path));
  assert.equal(routeHandlers.length, 0, routeHandlers.map((f) => f.path).join(', '));
  const writes = lines.filter((l) => /method:\s*'(POST|PATCH|DELETE)'/.test(l.line));
  const outside = writes.filter((l) => !/^lib\/(\w|-)+-actions\.ts$|^lib\/api\.ts$|^middleware\.ts$/.test(l.path));
  assert.equal(outside.length, 0, where(outside));
  for (const f of all.filter((x) => /-actions\.ts$/.test(x.path))) {
    assert.match(f.text, /^'use server';/, `${f.path} is a Server Action module`);
  }
});

test('the security headers are set for every route', async () => {
  const config = (await import('../next.config.mjs')).default as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> };
  const rules = await config.headers();
  const every = rules.find((r) => r.source === '/:path*');
  assert.ok(every, 'a rule for every path');
  const h = Object.fromEntries(every.headers.map((x) => [x.key.toLowerCase(), x.value]));
  assert.match(h['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.equal(h['x-frame-options'], 'DENY');
});
