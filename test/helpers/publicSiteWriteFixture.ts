import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const FIXTURE_NOW = "2026-10-28T04:00:00.000Z";

/** Synthetic text inputs only; no production calendars, credentials or media. */
export async function writePublicSiteFixture(root: string): Promise<void> {
  const data = join(root, "data");
  await mkdir(join(data, "content-calendar"), { recursive: true });
  await mkdir(join(data, "approved-log"), { recursive: true });
  await mkdir(join(root, "seo-overrides", "fixture"), { recursive: true });
  const profile = {
    name: "Fixture Laundry", google_business_profile_name: "Fixture Laundry", alternate_names: [],
    address: { "@type": "PostalAddress", postalCode: "000", addressRegion: "Fixture", addressLocality: "Fixture", streetAddress: "1 Test Road", addressCountry: "TW" },
    address_text: "1 Test Road", landmark: "Fixture", map_url: "https://example.invalid/map",
    google_maps_feature_id: "fixture", google_maps_cid: "fixture", google_place_id: null,
    facebook_url: "https://example.invalid/fb", facebook_share_url: "https://example.invalid/fb",
    instagram_url: "https://example.invalid/ig", line_url: "https://example.invalid/line", line_id: "fixture",
    telephone: "+886000000000", telephone_local: "0000000000", mobile_or_line: "0000000000", mobile_or_line_local: "0000000000",
    opening_hours_text: "Monday 09:00-17:00", opening_hours_schema: ["Mo 09:00-17:00"],
    opening_hours_specification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "09:00", closes: "17:00" }],
    holiday_hours_rule: { default_rule: "fixture", social_content_rule: "fixture", schema_rule: "fixture", major_holidays: [], overrides: [] },
    service_topics: ["Laundry"], source_notes: ["Synthetic fixture"], verification_status: {}
  };
  await writeFile(join(data, "business-profile.json"), JSON.stringify(profile));
  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const slots = [1, 2].map((slot) => ({
      slot, time: slot === 1 ? "11:30" : "19:30", category: slot === 1 ? "knowledge" : "situation",
      topic: `Fixture ${day} ${slot}`, instagram_caption: "Fixture caption", facebook_caption: "Fixture caption",
      image_prompt: "fixture", visual_route: "shop-inspection", traffic_route: "object-proof",
      search_intent: "problem-diagnosis", target_queries: ["fixture"], evidence_type: "first-party-inspection",
      local_image_path: `docs/assets/${date}/slot-0${slot}.png`, public_image_url: "", status: "pending"
    }));
    await writeFile(join(data, "content-calendar", `${date}.json`), JSON.stringify({ date, timezone: "Asia/Taipei", generated_at: `${date}T00:00:00.000Z`, slots }));
    const approvals = slots.flatMap(({ slot }) => ["facebook", "instagram"].map((platform) => ({
      date, slot, platform, status: "approved", approved_by: "Fixture", note: "Synthetic", created_at: `${date}T01:00:00.000Z`
    })));
    await writeFile(join(data, "approved-log", `${date}.json`), JSON.stringify(approvals));
  }
  for (let i = 0; i < 20; i += 1) {
    await writeFile(join(root, "seo-overrides", "fixture", `${i}.txt`), `fixture ${i}\n`);
  }
}
