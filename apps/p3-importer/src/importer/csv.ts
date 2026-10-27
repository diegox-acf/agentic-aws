import type { Readable } from "node:stream";
import { parse } from "csv-parse";

export type CsvRow = { row: number; url: string } | { row: number; error: string };

// A URL is at most 2048 bytes; a record far longer isn't a URL row. Exceeding this fails the whole
// file (a CsvError, so FAILED) instead of buffering up to a megabyte into one value.
const MAX_RECORD_BYTES = 4096;

/**
 * Streams a CSV with one URL per row (an optional first row "url" is a header) and yields each
 * data row with its 1-based number. Blank lines don't count, so a file always numbers its rows
 * the same way: the importer derives each link's code from that number.
 * Throws on CSV that can't be parsed at all (e.g. an unclosed quote).
 */
export async function* readUrlRows(source: Readable): AsyncGenerator<CsvRow> {
  const parser = parse({
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true, // a row with extra columns becomes a per-row error, not a failed file
    max_record_size: MAX_RECORD_BYTES,
  });
  // pipe() doesn't forward errors: a failed download must fail the parse, not end it quietly.
  source.on("error", (error) => parser.destroy(error));
  source.pipe(parser);

  let row = 0;
  let first = true;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      const isHeader = first && record.length === 1 && record[0]?.toLowerCase() === "url";
      first = false;
      if (isHeader) {
        continue;
      }
      row++;
      const [url] = record;
      yield record.length === 1 && url !== undefined ? { row, url } : { row, error: `expected 1 column, got ${record.length}` };
    }
  } finally {
    // Runs when the consumer stops early too (a failed write, the row cap): release the S3
    // download's socket now instead of leaving it open until the execution environment freezes.
    source.destroy();
  }
}
