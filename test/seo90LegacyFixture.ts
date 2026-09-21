import {mkdir,writeFile,open} from 'node:fs/promises';
import {join} from 'node:path';
export async function writeCalendar(root: string, date: string, options: { carouselSlot1?: boolean } = {}): Promise<void> {
  await Promise.all([
    mkdir(join(root, "data", "content-calendar"), { recursive: true }),
    mkdir(join(root, "docs", "content-calendar"), { recursive: true })
  ]);
  const calendar = `${JSON.stringify(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: `${date}T00:00:00.000Z`,
      slots: [
        {
          slot: 1,
          time: "11:30",
          category: "knowledge",
          topic: "Sneaker edge inspection",
          instagram_caption: "IG caption #test",
          facebook_caption: "FB caption #test",
          image_prompt: "photo prompt",
          ...(options.carouselSlot1
            ? {
                media_type: "carousel",
                carousel_items: [
                  {
                    slide: 3,
                    image_prompt: "slide 3 prompt",
                    local_image_path: `docs/assets/${date}/slot-01-slide-03.png`,
                    public_image_url: ""
                  },
                  {
                    slide: 1,
                    image_prompt: "slide 1 prompt",
                    local_image_path: `docs/assets/${date}/slot-01.png`,
                    public_image_url: ""
                  },
                  {
                    slide: 2,
                    image_prompt: "slide 2 prompt",
                    local_image_path: `docs/assets/${date}/slot-01-slide-02.png`,
                    public_image_url: ""
                  }
                ]
              }
            : {}),
          visual_route: "shop-inspection",
          traffic_route: "object-proof",
          search_intent: "problem-diagnosis",
          target_queries: ["台中洗鞋店", "白鞋泛黃怎麼辦"],
          evidence_type: "first-party-inspection",
          local_image_path: `docs/assets/${date}/slot-01.png`,
          public_image_url: "",
          status: "pending"
        },
        {
          slot: 2,
          time: "19:30",
          category: "situation",
          topic: "Bag corner care",
          instagram_caption: "IG caption 2 #test",
          facebook_caption: "FB caption 2 #test",
          image_prompt: "photo prompt 2",
          visual_route: "macro-detail",
          traffic_route: "value-prop-lead",
          search_intent: "trust-proof",
          target_queries: ["台中洗包包", "洗包包會不會掉色"],
          evidence_type: "real-case-photo",
          local_image_path: `docs/assets/${date}/slot-02.png`,
          public_image_url: "",
          status: "pending"
        }
      ]
    },
    null,
    2
  )}\n`;

  await Promise.all([
    writeFile(join(root, "data", "content-calendar", `${date}.json`), calendar, "utf8"),
    writeFile(join(root, "docs", "content-calendar", `${date}.json`), calendar, "utf8")
  ]);
}

export async function writeApprovalLog(root: string, date: string, slots = [1, 2]): Promise<void> {
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  const entries = slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date,
      slot,
      platform,
      status: "approved",
      approved_by: "Test",
      note: "Approved for public SEO sync",
      created_at: `${date}T02:20:00.000Z`
    }))
  );

  await writeFile(join(root, "data", "approved-log", `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}
