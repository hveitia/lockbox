import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ENTRY_COLORS, DEFAULT_COLOR } from "./entry.ts";

/**
 * The color list lives in TypeScript and the values live in CSS. Nothing in
 * either file forces them to agree, so a name added to one and forgotten in
 * the other would ship as an invisible swatch. This test is that link.
 */
const css = readFileSync(
  path.join(import.meta.dirname, "..", "app", "globals.css"),
  "utf8",
);

function toneRule(color: string): string | null {
  const match = css.match(
    new RegExp(`\\.tone-${color}\\s*\\{([^}]*)\\}`, "i"),
  );

  return match ? match[1] : null;
}

describe("color tokens", () => {
  for (const color of ENTRY_COLORS) {
    test(`.tone-${color} exists and sets --accent`, () => {
      const rule = toneRule(color);

      assert.ok(rule, `.tone-${color} is missing from globals.css`);
      assert.match(rule, /--accent\s*:/, `.tone-${color} does not set --accent`);
    });
  }

  test("no tone class exists for a color that is not on the list", () => {
    const declared = [...css.matchAll(/\.tone-([a-z]+)\s*(?:\.|\{)/gi)].map(
      (m) => m[1],
    );

    for (const name of new Set(declared)) {
      assert.ok(
        (ENTRY_COLORS as readonly string[]).includes(name),
        `.tone-${name} has no matching entry in ENTRY_COLORS`,
      );
    }
  });

  test("every non-default color resolves to its own distinct value", () => {
    const values = ENTRY_COLORS.filter((c) => c !== DEFAULT_COLOR).map((color) => {
      const rule = toneRule(color) ?? "";
      return rule.match(/--accent\s*:\s*([^;]+);/)?.[1].trim().toLowerCase();
    });

    assert.ok(values.every(Boolean), "a color has no literal value");
    assert.equal(
      new Set(values).size,
      values.length,
      "two colors share the same value and would be indistinguishable",
    );
  });
});
