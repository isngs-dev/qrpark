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

test('nothing changes state through a GET: GET forms (report filters) never call a Server Action, and every write goes through one', () => {
  let getForms = 0;
  for (const f of all) {
    for (const m of f.text.matchAll(/<form\b[^>]*>/g)) {
      if (!/method="get"/.test(m[0])) continue;
      getForms++;
      assert.doesNotMatch(m[0], /action=\{/, `${f.path}: a GET form calls a Server Action`);
      assert.doesNotMatch(f.text, /^'use server';/, `${f.path}: a GET form in a Server Action module`);
    }
  }
  assert.ok(getForms >= 4, `${getForms} report filter forms`);
  // Sprint 5c: exactly one route handler, the read-only CSV download, and it exports GET only.
  const routeHandlers = all.filter((f) => /\/route\.(ts|js)$/.test(f.path));
  assert.deepEqual(routeHandlers.map((f) => f.path), ['app/csv/[report]/route.ts']);
  const exported = [...routeHandlers[0].text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported.filter((n) => n !== 'dynamic'), ['GET'], `the CSV route exports ${exported.join(', ')}`);
  const writes = lines.filter((l) => /method:\s*'(POST|PATCH|DELETE)'/.test(l.line));
  const outside = writes.filter((l) => !/^lib\/(\w|-)+-actions\.ts$|^lib\/api\.ts$|^middleware\.ts$/.test(l.path));
  assert.equal(outside.length, 0, where(outside));
  for (const f of all.filter((x) => /-actions\.ts$/.test(x.path))) {
    assert.match(f.text, /^'use server';/, `${f.path} is a Server Action module`);
  }
});

test('no day from the portal\'s own clock, and every time is formatted in Africa/Lagos', () => {
  const clock = lines.filter((l) => /Date\.now\(|new Date\(\s*\)/.test(l.line));
  assert.equal(clock.length, 0, where(clock));
  for (const f of all) {
    for (const m of f.text.matchAll(/Intl\.DateTimeFormat\(([\s\S]*?)\}\)/g)) {
      assert.match(m[1], /timeZone:\s*'Africa\/Lagos'/, `${f.path}: a date format without Africa/Lagos`);
    }
  }
  const locale = lines.filter((l) => /toLocale(Date|Time)?String\(/.test(l.line));
  assert.equal(locale.length, 0, where(locale));
});

test('no money is computed in the portal: no arithmetic on an amount in kobo', () => {
  const sums = lines.filter((l) => !/^\s*(\*|\/\/)/.test(l.line) && /(\b\w*[kK]obo\b(\)|\])?\s*[-+*/%]\s*[\w(]|[\w)]\s*[-+*/%]\s*\w*\.\w*[kK]obo\b|reduce\([^)]*[kK]obo)/.test(l.line));
  assert.equal(sums.length, 0, where(sums));
});

const REPORT_PAGES = ['app/(portal)/page.tsx', 'app/(portal)/transactions/page.tsx', 'app/(portal)/transactions/[id]/page.tsx', 'app/(portal)/incomplete/page.tsx', 'app/(portal)/finance/page.tsx', 'app/(portal)/audit/page.tsx'];

test('every report page shows its range, "Lagos time" and that nothing here can change a payment', () => {
  const frame = all.find((f) => f.path === 'app/(portal)/report-frame.tsx');
  assert.ok(frame, 'the shared report frame');
  assert.match(frame.text, /· all times are Lagos time/, "the rendered line, not a comment");
  assert.match(frame.text, /Nothing here can change a payment/);
  for (const p of REPORT_PAGES) {
    const f = all.find((x) => x.path === p);
    assert.ok(f, `${p} exists`);
    assert.match(f.text, /<ReportFrame\b/, `${p} uses the report frame`);
  }
});

test('the plain explanations are on the pages', () => {
  const text = (p: string) => all.find((x) => x.path === p)?.text ?? '';
  assert.match(text('app/(portal)/finance/page.tsx'), /a payment counts on the Lagos day it was recorded as paid/i);
  assert.match(text('app/(portal)/incomplete/page.tsx'), /in progress = today's tickets, never validated = earlier days/i);
  for (const p of ['app/(portal)/finance/page.tsx', 'app/(portal)/page.tsx']) {
    assert.match(text(p), /not revenue/i, `${p} says DUPLICATE and cancelled are not revenue`);
  }
});

test('nothing secret has a field to land in: no token, checkout URL, access code, authorization code or Paystack payload in the report shapes or pages', () => {
  const scope = all.filter((f) => f.path === 'lib/reports-types.ts' || f.path === 'lib/reports.ts' || REPORT_PAGES.includes(f.path));
  assert.ok(scope.length >= 8);
  for (const f of scope) {
    const hit = /\b(token|ticketToken|authorizationUrl|authorization_url|accessCode|access_code|authorizationCode|authorization_code|paystackEvent|paystack_event)\b/i.exec(f.text);
    assert.equal(hit, null, `${f.path}: ${hit?.[0]}`);
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
