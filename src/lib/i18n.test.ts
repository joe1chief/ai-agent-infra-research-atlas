import { describe, expect, it } from "vitest";
import { categoryLabel, localized, localizedTitle, originalTitle, statusLabel } from "./i18n";

describe("bilingual catalog presentation", () => {
  it("keeps the original paper title while switching display locale", () => {
    const title = {
      original: "A Runtime for Reliable Agents",
      zh: "可靠 Agent 运行时",
      en: "A Runtime for Reliable Agents",
    };
    expect(localizedTitle(title, "zh")).toBe("可靠 Agent 运行时");
    expect(localizedTitle(title, "en")).toBe("A Runtime for Reliable Agents");
    expect(originalTitle(title)).toBe("A Runtime for Reliable Agents");
  });

  it("labels the fixed taxonomy and window status in both languages", () => {
    expect(categoryLabel("AG-5", "zh")).toContain("可观测性");
    expect(categoryLabel("AG-5", "en")).toContain("observability");
    expect(statusLabel("venue_carry_in", "zh")).toBe("正式发表补录");
    expect(statusLabel("venue_carry_in", "en")).toBe("Venue carry-in");
  });

  it("falls back to the available bilingual field", () => {
    expect(localized({ zh: "仅中文", en: "" }, "en")).toBe("仅中文");
  });
});
