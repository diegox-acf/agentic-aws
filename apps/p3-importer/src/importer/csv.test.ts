import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readUrlRows, type CsvRow } from "./csv";

async function rows(text: string | string[]): Promise<CsvRow[]> {
  const out: CsvRow[] = [];
  for await (const row of readUrlRows(Readable.from(Array.isArray(text) ? text : [text]))) {
    out.push(row);
  }
  return out;
}

describe("readUrlRows", () => {
  it("yields one URL per row, numbered from 1", async () => {
    expect(await rows("https://a.io\nhttps://b.io\n")).toStrictEqual([
      { row: 1, url: "https://a.io" },
      { row: 2, url: "https://b.io" },
    ]);
  });

  it("skips an optional 'url' header in any case", async () => {
    expect(await rows("URL\nhttps://a.io\n")).toStrictEqual([{ row: 1, url: "https://a.io" }]);
  });

  it("treats 'url' after the first row as data (it is just an invalid URL)", async () => {
    expect(await rows("https://a.io\nurl\n")).toStrictEqual([
      { row: 1, url: "https://a.io" },
      { row: 2, url: "url" },
    ]);
  });

  it("handles CRLF line endings, a BOM and surrounding spaces", async () => {
    expect(await rows("﻿url\r\n  https://a.io  \r\nhttps://b.io")).toStrictEqual([
      { row: 1, url: "https://a.io" },
      { row: 2, url: "https://b.io" },
    ]);
  });

  it("skips blank lines; they don't count as rows", async () => {
    expect(await rows("https://a.io\n\n\nhttps://b.io\n")).toStrictEqual([
      { row: 1, url: "https://a.io" },
      { row: 2, url: "https://b.io" },
    ]);
  });

  it("keeps a quoted URL that contains a comma as one value", async () => {
    expect(await rows('"https://a.io/?q=1,2"\n')).toStrictEqual([{ row: 1, url: "https://a.io/?q=1,2" }]);
  });

  it("reports a row with more than one column as an error, and keeps going", async () => {
    expect(await rows("https://a.io,extra\nhttps://b.io\n")).toStrictEqual([
      { row: 1, error: "expected 1 column, got 2" },
      { row: 2, url: "https://b.io" },
    ]);
  });

  it("parses rows split across stream chunks", async () => {
    expect(await rows(["https://a.", "io\nhttps://b", ".io\n"])).toStrictEqual([
      { row: 1, url: "https://a.io" },
      { row: 2, url: "https://b.io" },
    ]);
  });

  it("numbers rows the same way every time (codes are derived from row numbers)", async () => {
    const text = "url\nhttps://a.io\n\nhttps://b.io,x\nhttps://c.io\n";
    expect(await rows(text)).toStrictEqual(await rows(text));
  });

  it("fails, instead of ending quietly, when the download breaks mid-file", async () => {
    const broken = new Readable({ read() {} });
    broken.push("https://a.io\n");
    setImmediate(() => broken.destroy(new Error("socket hang up")));

    const seen: CsvRow[] = [];
    await expect(
      (async () => {
        for await (const row of readUrlRows(broken)) {
          seen.push(row);
        }
      })(),
    ).rejects.toThrow("socket hang up");
  });

  it("releases the download when the consumer stops early (e.g. a write failed)", async () => {
    // A download still in progress: one row has arrived, the rest never comes.
    const source = new Readable({ read() {} });
    source.push("https://a.io\nhttps://b.io\n");

    for await (const row of readUrlRows(source)) {
      expect(row.row).toBe(1);
      break; // what an exception thrown inside the importer's loop does too
    }

    expect(source.destroyed).toBe(true);
  });

  it("rejects malformed CSV such as an unclosed quote", async () => {
    await expect(rows('"https://a.io\n')).rejects.toThrow();
  });
});
