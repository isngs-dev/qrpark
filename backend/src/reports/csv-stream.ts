import { Logger } from '@nestjs/common';
import { csvCell } from './report-rules';

/**
 * Hardening H5: a CSV written as it is read. Written new; tested in
 * csv-stream.test.ts.
 *
 *   - rows come in batches (CSV_BATCH_ROWS) read by keyset paging, so memory
 *     stays flat however long the range
 *   - each batch is written as soon as it is read; when the client is slower
 *     than the database, the next batch waits for 'drain' (back-pressure)
 *   - a client that goes away stops the reading
 *   - a failure part-way ABORTS the connection, so the client never gets a
 *     file that looks complete but is short; the log names the report, the
 *     rows sent and the error's class only, never a value
 *
 * The caller has already counted the rows and refused an oversized range,
 * before any header was sent; once the file starts, the status is 200.
 */

export const CSV_BATCH_ROWS = 5_000;

/** What writeCsv needs of an HTTP response (Express's Response is one). */
export interface CsvSink {
  write(chunk: string): boolean;
  end(): void;
  destroy(error?: Error): void;
  readonly destroyed: boolean;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  removeListener(event: 'drain' | 'close', listener: () => void): unknown;
}

export interface CsvOutcome {
  rows: number;
  result: 'complete' | 'client-gone' | 'failed';
}

const nestLog = new Logger('ReportsCsv');

/** Resolves true on 'drain', false if the client went away first. */
function drained(out: CsvSink): Promise<boolean> {
  return new Promise((resolve) => {
    // Gone already ('close' fired during the write): neither event will come.
    if (out.destroyed) {
      resolve(false);
      return;
    }
    const onDrain = () => {
      out.removeListener('close', onClose);
      resolve(true);
    };
    const onClose = () => {
      out.removeListener('drain', onDrain);
      resolve(false);
    };
    out.once('drain', onDrain);
    out.once('close', onClose);
  });
}

/**
 * Writes the byte-order mark and [header], then every batch of ready-made
 * rows (each cell already passed through csvCell), CRLF line ends.
 */
export async function writeCsv(
  out: CsvSink,
  report: string,
  header: string[],
  batches: AsyncIterable<string[][]>,
  log: (line: string) => void = (line) => nestLog.error(line),
): Promise<CsvOutcome> {
  let rows = 0;
  const it = batches[Symbol.asyncIterator]();
  let finished = false;
  try {
    let ok = out.write('\uFEFF' + header.map((h) => csvCell(h, 'text')).join(',') + '\r\n');
    for (;;) {
      // Back-pressure: the next batch is read only once the client has taken the last.
      if (!ok && !(await drained(out))) return { rows, result: 'client-gone' };
      if (out.destroyed) return { rows, result: 'client-gone' };
      const next = await it.next();
      if (next.done) break;
      if (out.destroyed) return { rows, result: 'client-gone' };
      const batch = next.value;
      if (batch.length === 0) continue;
      ok = out.write(batch.map((r) => r.join(',') + '\r\n').join(''));
      rows += batch.length;
    }
    finished = true;
    out.end();
    return { rows, result: 'complete' };
  } catch (error) {
    finished = true; // a generator that threw is already closed
    // Never the error's message: it may quote a value. The class name only.
    const kind = error instanceof Error ? error.constructor.name : typeof error;
    log(`CSV ${report} stopped after ${rows} rows (${kind}); the connection was aborted, so no short file was delivered.`);
    out.destroy();
    return { rows, result: 'failed' };
  } finally {
    // The client went away: close the reader so no further page is read.
    if (!finished) await it.return?.().catch(() => undefined);
  }
}

/**
 * Pages of at most [size] rows, each starting after the last row of the one
 * before (keyset paging: no OFFSET, so every page costs the same). Lazy: a
 * page is read only when the consumer asks for it.
 */
export async function* keysetPages<R>(fetchPage: (after: R | null) => Promise<R[]>, size: number): AsyncGenerator<R[]> {
  let after: R | null = null;
  for (;;) {
    const page = await fetchPage(after);
    if (page.length > 0) yield page;
    if (page.length < size) return;
    after = page[page.length - 1];
  }
}
