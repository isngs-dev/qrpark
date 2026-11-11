import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CSV_BATCH_ROWS, keysetPages, writeCsv } from './csv-stream';

/**
 * Hardening H5: a CSV is written as it is read, batch by batch, with
 * back-pressure; a failure part-way aborts the connection (never a silently
 * short file) and is logged without any value; a client that goes away stops
 * the reading.
 */

const BOM = '\uFEFF';
const HEADER = ['Ticket', 'Amount (NGN)'];
/**
 * The tests that wait on a stream or an event get a time limit, so a broken
 * stream FAILS here instead of waiting for ever (node:test has no default).
 */
const WAITS = { timeout: 10_000 };

/** A promise and its resolver. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

/** [p], or a failure with [message] if it has not settled within [ms]. */
async function within<T>(ms: number, p: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function serve(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

test('batches of 5,000 rows', () => {
  assert.equal(CSV_BATCH_ROWS, 5_000);
});

test('the file starts reaching the client before the last batch is read (a stream, not a whole file in memory)', WAITS, async () => {
  const second = gate();
  const logs: string[] = [];
  const { server, port } = await serve((_req, res) => {
    async function* batches() {
      yield [['AAAA-0001', '500.00']];
      await second.p; // held until the client has the first batch
      yield [['AAAA-0002', '700.00']];
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    void writeCsv(res, 'transactions', HEADER, batches(), (l) => logs.push(l));
  });
  try {
    const body = await new Promise<string>((resolve, reject) => {
      // A writer that builds the whole file first never sends row 1 while
      // batch 2 is held back: that is a FAILURE here, not a wait for ever.
      const deadline = setTimeout(
        () => reject(new Error('the first row did not reach the client while the last batch was still unread: the file was built whole, not streamed')),
        2_000,
      );
      request({ port, host: '127.0.0.1', path: '/' }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
          // The first row arrived while the second batch was still held back.
          if (text.includes('AAAA-0001') && !text.includes('AAAA-0002')) {
            clearTimeout(deadline);
            second.open();
          }
        });
        res.on('end', () => resolve(text));
        res.on('error', reject);
      })
        .on('error', reject)
        .end();
    });
    assert.equal(body, `${BOM}Ticket,Amount (NGN)\r\nAAAA-0001,500.00\r\nAAAA-0002,700.00\r\n`);
    assert.deepEqual(logs, []);
  } finally {
    second.open();
    server.closeAllConnections(); // a held-open request must not keep the test process alive
    server.close();
  }
});

test('a failure part-way aborts the connection: the client gets an error, never a short file; the log holds no value', WAITS, async () => {
  const logs: string[] = [];
  const done = gate();
  const { server, port } = await serve((_req, res) => {
    async function* batches(): AsyncGenerator<string[][]> {
      yield [['AAAA-0001', '500.00']];
      throw new TypeError('connection lost while reading row K7MP-3QZ9 token=SECRET-VALUE');
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    void writeCsv(res, 'transactions', HEADER, batches(), (l) => logs.push(l)).then(() => done.open());
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200, 'the headers were already sent');
    await assert.rejects(res.text(), 'reading the body fails: the file is not complete');
    await done.p;
    assert.equal(logs.length, 1);
    assert.match(logs[0], /transactions/);
    assert.match(logs[0], /after 1 rows/);
    assert.match(logs[0], /TypeError/);
    assert.doesNotMatch(logs[0], /K7MP|SECRET|token|connection lost/);
  } finally {
    server.closeAllConnections(); // a held-open request must not keep the test process alive
    server.close();
  }
});

/** A sink like an HTTP response whose buffer is full until told otherwise. */
class SlowSink extends EventEmitter {
  chunks: string[] = [];
  full = true;
  destroyed = false;
  ended = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return !this.full;
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

test('back-pressure: no further batch is read until the client has taken the last one (drain)', WAITS, async () => {
  const sink = new SlowSink();
  let pulled = 0;
  async function* batches() {
    for (let i = 1; i <= 3; i++) {
      pulled = i;
      yield [[`AAAA-000${i}`, '500.00']];
    }
  }
  const run = writeCsv(sink, 'finance', HEADER, batches(), () => {});
  await new Promise((r) => setTimeout(r, 50));
  // Header written (buffer full), so not even the first batch is pulled... or at most the first.
  const before = pulled;
  assert.ok(before <= 1, `pulled ${before} batches while the client was not reading`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(pulled, before, 'still waiting for drain');
  sink.full = false;
  sink.emit('drain');
  const outcome = await run;
  assert.equal(pulled, 3);
  assert.equal(outcome.rows, 3);
  assert.equal(outcome.result, 'complete');
  assert.ok(sink.ended);
  assert.equal(sink.chunks.join(''), `${BOM}Ticket,Amount (NGN)\r\nAAAA-0001,500.00\r\nAAAA-0002,500.00\r\nAAAA-0003,500.00\r\n`);
});

test('a client that goes away stops the reading: no more batches, no error logged', WAITS, async () => {
  const sink = new SlowSink();
  sink.full = false; // a client reading happily...
  let pulled = 0;
  let finished = false;
  async function* batches() {
    try {
      for (let i = 1; i <= 1000; i++) {
        await new Promise((r) => setTimeout(r, 2)); // each page takes the database a moment
        pulled = i;
        yield [[`AAAA-${i}`, '500.00']];
      }
    } finally {
      finished = true;
    }
  }
  const logs: string[] = [];
  const run = writeCsv(sink, 'audit', HEADER, batches(), (l) => logs.push(l));
  await new Promise((r) => setTimeout(r, 40));
  sink.destroy(); // ...then the browser closed the download
  const at = pulled;
  // Reading on to the end would take seconds; stopping takes one page.
  const outcome = await within(1_000, run, 'the reading did not stop within 1 s after the client left');
  assert.equal(outcome.result, 'client-gone');
  assert.ok(at > 0 && at < 1000, `pulled ${at}`);
  assert.ok(pulled <= at + 1, `kept reading after the client left: ${at} -> ${pulled}`);
  assert.ok(finished, 'the batch reader was closed');
  assert.ok(!sink.ended);
  assert.deepEqual(logs, []);
});

/** A client that goes away during a write: the socket is closed ('close' fired) before the write returns false. */
class GoneDuringWrite extends SlowSink {
  writes = 0;
  write(chunk: string): boolean {
    super.write(chunk);
    if (++this.writes === 2) {
      this.destroy();
      return false;
    }
    return true;
  }
}

test('a client that leaves during a write, before the wait for drain starts, still stops the reading (no wait for ever)', WAITS, async () => {
  const sink = new GoneDuringWrite();
  let pulled = 0;
  let finished = false;
  async function* batches() {
    try {
      for (let i = 1; i <= 5; i++) {
        pulled = i;
        yield [[`AAAA-000${i}`, '500.00']];
      }
    } finally {
      finished = true;
    }
  }
  const logs: string[] = [];
  // 'close' has already fired when the wait would start: waiting for 'drain' or 'close' would never end.
  const outcome = await within(1_000, writeCsv(sink, 'transactions', HEADER, batches(), (l) => logs.push(l)), 'still waiting for drain from a client that has gone');
  assert.equal(outcome.result, 'client-gone');
  assert.equal(outcome.rows, 1);
  assert.equal(pulled, 1, 'no batch read after the client left');
  assert.ok(finished, 'the batch reader was closed');
  assert.ok(!sink.ended);
  assert.deepEqual(logs, []);
});

test('keyset pages: each page starts after the last row of the one before; stops on a short page; reads lazily', async () => {
  const all = Array.from({ length: 12 }, (_, i) => ({ k: i + 1 }));
  const asked: Array<number | null> = [];
  const pages = keysetPages<{ k: number }>(async (after) => {
    asked.push(after ? after.k : null);
    const start = after ? after.k : 0;
    return all.filter((r) => r.k > start).slice(0, 5);
  }, 5);
  const got: number[][] = [];
  for await (const p of pages) got.push(p.map((r) => r.k));
  assert.deepEqual(got, [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12]]);
  assert.deepEqual(asked, [null, 5, 10]);

  // Exactly a page's worth: one more (empty) read, nothing yielded empty.
  const ten = all.slice(0, 10);
  const got2: number[][] = [];
  for await (const p of keysetPages<{ k: number }>(async (after) => ten.filter((r) => r.k > (after?.k ?? 0)).slice(0, 5), 5)) got2.push(p.map((r) => r.k));
  assert.deepEqual(got2, [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);

  // Lazy: a consumer that stops after one page causes one read only.
  let reads = 0;
  for await (const _p of keysetPages<{ k: number }>(async (after) => { reads++; return all.filter((r) => r.k > (after?.k ?? 0)).slice(0, 5); }, 5)) break;
  assert.equal(reads, 1);
});
