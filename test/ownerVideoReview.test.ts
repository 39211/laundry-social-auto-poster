import { describe, expect, it } from "vitest";
import { recordOwnerVideoReview } from "../src/ownerVideoReview";

describe("owner video review", () => {
  it("refuses to record a review the owner has not watched", async () => {
    await expect(
      recordOwnerVideoReview({ date: "2026-07-29", slot: 1, watched: false })
    ).rejects.toThrow(/--watched/);
  });
});
