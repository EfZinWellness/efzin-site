import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "../../lib/import/csv";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\nlast,,\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["last", "", ""],
    ]);
  });

  it("maps headers case-insensitively and ignores blank lines", () => {
    const recs = parseCsvRecords("First Name,EMAIL\n\nAnn,a@b.com\n");
    expect(recs).toEqual([{ "first name": "Ann", email: "a@b.com" }]);
  });
});
