import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { bootTestApp, call, type TestApp } from '../test-support/app';

/**
 * Route coverage: every route the app maps is listed here with who may call
 * it, and every route is called with no token and as each role.
 *
 * Adding a route without adding it here fails the first test. Removing a
 * @Roles() or the global guard fails the second. This is the access-control
 * contract; docs/api.md says the same in prose.
 */

type Access = 'PUBLIC' | UserRole[];

const ANY: UserRole[] = ['ADMIN', 'ENTRY_OPERATOR', 'EXIT_OPERATOR'];
const ADMIN: UserRole[] = ['ADMIN'];

const ROUTES: Record<string, Access> = {
  'GET /health': 'PUBLIC',
  'POST /auth/login': 'PUBLIC',
  'POST /auth/refresh': 'PUBLIC',
  'POST /auth/logout': ANY,

  'GET /admin/categories': ADMIN,
  'POST /admin/categories': ADMIN,
  'PATCH /admin/categories/:id': ADMIN,

  'GET /admin/settings': ADMIN,
  'PATCH /admin/settings': ADMIN,

  'GET /admin/gates': ADMIN,
  'POST /admin/gates': ADMIN,
  'PATCH /admin/gates/:id': ADMIN,

  'GET /admin/users': ADMIN,
  'GET /admin/users/:id': ADMIN,
  'POST /admin/users': ADMIN,
  'PATCH /admin/users/:id': ADMIN,
  'POST /admin/users/:id/password': ADMIN,
};

let t: TestApp;
before(async () => {
  t = await bootTestApp();
});
after(() => t?.close());

function mappedRoutes(): string[] {
  const server = t.app.getHttpAdapter().getInstance() as {
    _router?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
  };
  return (server._router?.stack ?? [])
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route!.methods).map((m) => `${m.toUpperCase()} ${layer.route!.path}`),
    );
}

test('route coverage: the app maps exactly the routes in the access table', () => {
  const mapped = mappedRoutes().sort();
  const listed = Object.keys(ROUTES).sort();
  assert.deepEqual(mapped, listed);
});

/** Empty bodies: an allowed caller gets past the guard and stops at validation, writing nothing. */
function concrete(route: string): { method: string; path: string } {
  const [method, path] = route.split(' ');
  return { method, path: path.replace(':id', randomUUID()) };
}

const BY_ROLE: Record<UserRole, 'admin' | 'entry' | 'exit'> = {
  ADMIN: 'admin',
  ENTRY_OPERATOR: 'entry',
  EXIT_OPERATOR: 'exit',
};

test('route coverage: no token is 401 on every non-public route; public routes never ask for one', async () => {
  for (const [route, access] of Object.entries(ROUTES)) {
    const { method, path } = concrete(route);
    const res = await call(t, method, path, { body: method === 'GET' ? undefined : {} });
    if (access === 'PUBLIC') {
      assert.notEqual(res.status, 401, `${route} is public but answered 401`);
      assert.notEqual(res.status, 403, `${route} is public but answered 403`);
    } else {
      assert.equal(res.status, 401, `${route} without a token answered ${res.status}`);
    }
  }
});

test('route coverage: each role is refused (403) where not listed and let through where listed', async () => {
  for (const [route, access] of Object.entries(ROUTES)) {
    if (access === 'PUBLIC') continue;
    for (const role of ANY) {
      const user = t.users[BY_ROLE[role]];
      // Minted at the user's current token_version, so a logout earlier in
      // the loop cannot make a later call look refused.
      const token = await t.accessToken(user.id);
      const { method, path } = concrete(route);
      const res = await call(t, method, path, { token, body: method === 'GET' ? undefined : {} });

      if (access.includes(role)) {
        assert.ok(
          res.status !== 401 && res.status !== 403,
          `${role} should pass the guard on ${route}, got ${res.status} ${JSON.stringify(res.body)}`,
        );
      } else {
        assert.equal(res.status, 403, `${role} on ${route} answered ${res.status}, expected 403`);
      }
    }
  }
});
