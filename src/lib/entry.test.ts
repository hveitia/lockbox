import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeUrl,
  normalizeColor,
  readColor,
  DEFAULT_COLOR,
  ENTRY_COLORS,
} from "./entry.ts";

describe("entry colors", () => {
  test("the default is one of the offered colors", () => {
    assert.ok(ENTRY_COLORS.includes(DEFAULT_COLOR));
  });

  test("the default comes first so it is the obvious choice", () => {
    assert.equal(ENTRY_COLORS[0], DEFAULT_COLOR);
  });

  test("every color name is unique", () => {
    assert.equal(new Set(ENTRY_COLORS).size, ENTRY_COLORS.length);
  });
});

describe("normalizeColor", () => {
  for (const color of ENTRY_COLORS) {
    test(`accepts ${color}`, () => {
      assert.equal(normalizeColor(color), color);
    });
  }

  test("treats an empty value as the default", () => {
    assert.equal(normalizeColor(""), DEFAULT_COLOR);
    assert.equal(normalizeColor("   "), DEFAULT_COLOR);
  });

  // Only the name is stored; the stylesheet owns the actual color value.
  // Rejecting unknown names keeps anything else out of the render path.
  test("rejects a name that is not on the list", () => {
    assert.throws(() => normalizeColor("hotpink"));
  });

  test("rejects an attempt to smuggle css through the field", () => {
    assert.throws(() => normalizeColor("red; background: url(evil)"));
  });
});

describe("readColor", () => {
  test("returns a stored color unchanged", () => {
    assert.equal(readColor("teal"), "teal");
  });

  // Reading is forgiving where writing is strict: a row written by an older
  // build must still render rather than break the whole list.
  test("falls back to the default for a missing value", () => {
    assert.equal(readColor(null), DEFAULT_COLOR);
    assert.equal(readColor(""), DEFAULT_COLOR);
  });

  test("falls back to the default for an unknown value", () => {
    assert.equal(readColor("chartreuse"), DEFAULT_COLOR);
  });
});

describe("normalizeUrl", () => {
  test("returns an empty string for an empty input", () => {
    assert.equal(normalizeUrl(""), "");
    assert.equal(normalizeUrl("   "), "");
  });

  test("keeps an https url as it is", () => {
    assert.equal(normalizeUrl("https://acme.dev/admin"), "https://acme.dev/admin");
  });

  test("keeps an http url as it is", () => {
    assert.equal(normalizeUrl("http://localhost:8080"), "http://localhost:8080");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(normalizeUrl("  https://acme.dev  "), "https://acme.dev");
  });

  test("assumes https when no scheme is given", () => {
    assert.equal(normalizeUrl("acme.dev/admin"), "https://acme.dev/admin");
  });

  test("treats a bare localhost with a port as a host, not a scheme", () => {
    assert.equal(normalizeUrl("localhost:3000"), "https://localhost:3000");
  });

  test("is idempotent", () => {
    const once = normalizeUrl("acme.dev");

    assert.equal(normalizeUrl(once), once);
  });

  // The stored value is rendered as an href, so a scripting scheme would be
  // a stored XSS waiting for a click.
  for (const hostile of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    test(`rejects ${hostile.trim().slice(0, 24)}`, () => {
      assert.throws(() => normalizeUrl(hostile), /http/i);
    });
  }

  test("rejects a url that cannot be parsed at all", () => {
    assert.throws(() => normalizeUrl("https://"));
  });
});
