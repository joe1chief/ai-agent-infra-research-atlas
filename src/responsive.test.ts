import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const mobileStart = css.indexOf("@media (max-width: 650px)");
const mobileEnd = css.indexOf("@media (prefers-reduced-motion", mobileStart);
const mobileCss = css.slice(mobileStart, mobileEnd);

describe("responsive and accessibility CSS contract", () => {
  it("replaces the force graph with an accessible relation list on small screens", () => {
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileCss).toContain(".lineage-chart { display: none; }");
    expect(mobileCss).toContain(".lineage-list { display: grid;");
  });

  it("provides a reduced-motion mode", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: .01ms !important");
  });
});
