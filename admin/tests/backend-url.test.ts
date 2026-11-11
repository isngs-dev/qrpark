import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendUrl, checkBackendUrl } from '../lib/backend-url.mjs';

/**
 * Hardening H3 (T12): in production the portal refuses to start unless
 * QRPARK_API_URL is set and https. Development keeps the localhost default.
 */

const PRODUCTION = true;

test('production: a missing or empty address is refused, naming the variable', () => {
  for (const value of [undefined, '', '   ']) {
    assert.throws(() => checkBackendUrl(value, PRODUCTION), /QRPARK_API_URL.*must be set/, JSON.stringify(value));
  }
});

test('production: only https is accepted', () => {
  for (const value of ['http://api.example.com', 'http://localhost:3000', 'ftp://api.example.com', 'ws://api.example.com', 'api.example.com', 'not a url', '//api.example.com']) {
    assert.throws(() => checkBackendUrl(value, PRODUCTION), /QRPARK_API_URL.*https/, value);
  }
});

test('production: no user name or password inside the address, no query, no fragment', () => {
  for (const value of ['https://user:secret@api.example.com', 'https://user@api.example.com', 'https://api.example.com/?x=1', 'https://api.example.com/#x']) {
    assert.throws(() => checkBackendUrl(value, PRODUCTION), /QRPARK_API_URL/, value);
  }
});

test('production: a valid https address is used, without trailing slashes', () => {
  assert.equal(checkBackendUrl('https://api.example.com', PRODUCTION), 'https://api.example.com');
  assert.equal(checkBackendUrl('https://api.example.com/', PRODUCTION), 'https://api.example.com');
  assert.equal(checkBackendUrl(' https://qrpark-api.example.com/// ', PRODUCTION), 'https://qrpark-api.example.com');
  assert.equal(checkBackendUrl('https://api.example.com:8443/v1', PRODUCTION), 'https://api.example.com:8443/v1');
});

test('the refusal never repeats the value it refused (it may hold a password)', () => {
  try {
    checkBackendUrl('http://user:hunter2-not-real@api.example.com', PRODUCTION);
    assert.fail('should throw');
  } catch (e) {
    assert.doesNotMatch((e as Error).message, /hunter2|api\.example\.com/);
  }
});

test('development: the localhost default stays, and http is allowed', () => {
  assert.equal(checkBackendUrl(undefined, false), 'http://localhost:3000');
  assert.equal(checkBackendUrl('', false), 'http://localhost:3000');
  assert.equal(checkBackendUrl('http://localhost:3010/', false), 'http://localhost:3010');
});

test('at run time too: in production every backend call refuses a missing or http address', () => {
  const saved = { node: process.env.NODE_ENV, url: process.env.QRPARK_API_URL };
  const env = process.env as Record<string, string | undefined>;
  try {
    env.NODE_ENV = 'production';
    delete env.QRPARK_API_URL;
    assert.throws(() => backendUrl(), /must be set/);
    env.QRPARK_API_URL = 'http://api.example.com';
    assert.throws(() => backendUrl(), /https/);
    env.QRPARK_API_URL = 'https://api.example.com/';
    assert.equal(backendUrl(), 'https://api.example.com');
    env.NODE_ENV = 'development';
    delete env.QRPARK_API_URL;
    assert.equal(backendUrl(), 'http://localhost:3000');
  } finally {
    env.NODE_ENV = saved.node;
    if (saved.url === undefined) delete env.QRPARK_API_URL;
    else env.QRPARK_API_URL = saved.url;
  }
});

test('next.config refuses to load for "next start" (production server) without a valid address; build and dev are not blocked', async () => {
  const load = (await import('../next.config.mjs')).default as (phase: string) => unknown;
  const saved = process.env.QRPARK_API_URL;
  try {
    delete process.env.QRPARK_API_URL;
    assert.throws(() => load('phase-production-server'), /QRPARK_API_URL.*must be set/);
    process.env.QRPARK_API_URL = 'http://api.example.com';
    assert.throws(() => load('phase-production-server'), /https/);
    process.env.QRPARK_API_URL = 'https://api.example.com';
    assert.ok(load('phase-production-server'));
    delete process.env.QRPARK_API_URL;
    assert.ok(load('phase-production-build'), 'a production build needs no backend address');
    assert.ok(load('phase-development-server'));
  } finally {
    if (saved === undefined) delete process.env.QRPARK_API_URL;
    else process.env.QRPARK_API_URL = saved;
  }
});
