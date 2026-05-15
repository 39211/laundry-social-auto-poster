import { buildGitHubPagesImageUrl } from "./githubPages";
import { relativeAssetPath } from "./paths";
import { DAILY_SCHEDULE } from "./scheduler";
import type { AppConfig, Category, DailyContent, DailySlot } from "./types";

interface TopicTemplate {
  topic: string;
  instagram: string;
  facebook: string;
  image: string;
}

const templates: Record<Category, TopicTemplate[]> = {
  "知識文": [
    {
      topic: "棉被多久該洗一次",
      instagram:
        "棉被每天陪你睡，卻常常被忘記要清洗。建議定期把棉被、床單分開清潔與烘乾，減少悶味，也讓睡前多一點清爽感。\n\n私享家洗衣店適合處理棉被、床單這類大件衣物，週末帶來一次整理剛剛好。\n\n#私享家洗衣店 #棉被清洗 #床單清洗 #自助洗衣 #生活小知識",
      facebook:
        "棉被、床單這類大件衣物，最怕在家洗不乾、曬不透。定期清洗再完整烘乾，可以讓睡眠用品維持清爽，也讓房間少一點悶味。\n\n這週如果準備整理床鋪，私享家洗衣店可以幫你把大件衣物一次處理得更輕鬆。\n\n#私享家洗衣店 #棉被清洗 #床單清洗 #自助洗衣",
      image:
        "A clean modern Taiwanese self-service laundromat with neatly folded bedding and a soft quilt in a basket, warm daylight, calm lifestyle photography, no people, no logos, no readable text, square social media image"
    },
    {
      topic: "運動衣汗味怎麼處理",
      instagram:
        "運動衣流汗後，別讓它悶在袋子裡太久。先攤開透氣、再集中清洗，味道比較不容易卡住。\n\n下班運動後順路到私享家洗衣店，把衣物洗好烘乾，回家就少一件待辦事。\n\n#私享家洗衣店 #運動衣清洗 #洗衣小知識 #衣物照顧 #台灣生活",
      facebook:
        "運動衣的汗味，常常不是洗不掉，而是悶太久才變得難處理。運動後先讓衣物透氣，再盡快清洗與烘乾，會更容易維持清爽。\n\n私享家洗衣店適合一次處理運動衣、毛巾和日常衣物，省下回家等待晾乾的時間。\n\n#私享家洗衣店 #運動衣清洗 #洗衣小知識",
      image:
        "A tidy laundromat counter with a sports towel, laundry basket, and clean folded activewear, bright clean Taiwanese lifestyle photography, fresh atmosphere, no brand logos, no readable text, square image"
    },
    {
      topic: "換季衣物收納前先清洗",
      instagram:
        "換季收衣服前，先洗乾淨再收，比明年拿出來才發現味道更安心。\n\n外套、薄被、長袖衣物整理好，生活也會跟著清爽一點。\n\n#私享家洗衣店 #換季收納 #衣物清洗 #生活整理 #自助洗衣",
      facebook:
        "換季整理衣櫃時，建議把要收起來的衣物先清洗、烘乾，再放進收納袋或衣櫃。這樣下次拿出來時，味道和觸感都會比較舒服。\n\n私享家洗衣店適合一次處理多件換季衣物，讓整理不必拖很久。\n\n#私享家洗衣店 #換季收納 #衣物清洗",
      image:
        "A clean laundromat scene with seasonal clothes neatly sorted into baskets, folded sweaters and light jackets, warm natural light, organized lifestyle photography, no people, no logos, no readable text"
    }
  ],
  "情境文": [
    {
      topic: "雨天衣服不悶臭",
      instagram:
        "雨天衣服乾得慢，最怕悶出味道。\n\n把衣服帶到私享家洗衣店，清洗、烘乾一次完成，不用在家裡掛滿衣架，也不用擔心一整天乾不了。\n\n今天讓衣服清爽一點，也讓生活輕鬆一點。\n\n#私享家洗衣店 #雨天洗衣 #衣物清爽 #自助洗衣 #台灣洗衣店",
      facebook:
        "雨天最麻煩的不是洗衣服，而是洗完後乾不了。衣架掛滿房間、衣物帶著悶味，真的會讓人有點累。\n\n私享家洗衣店讓你把清洗和烘乾一次處理好，雨天也能把衣物帶回清爽狀態。\n\n#私享家洗衣店 #雨天洗衣 #自助洗衣",
      image:
        "A cozy self-service laundromat in Taiwan on a rainy day, raindrops on the window, washing machines and dryers, basket of fresh folded clothes, warm indoor lighting, modern clean composition, no people, no fake logos, no readable text, square image"
    },
    {
      topic: "租屋族不用在房間曬衣服",
      instagram:
        "租屋空間小，最怕洗完衣服整間都變成曬衣區。\n\n把衣物帶來私享家洗衣店，洗好、烘好再帶回家，房間留給休息，衣服交給洗衣日處理。\n\n#私享家洗衣店 #租屋族 #自助洗衣 #小空間生活 #洗衣日",
      facebook:
        "租屋族常遇到的洗衣困擾，就是沒有足夠空間曬衣服。潮濕天氣一來，房間更容易有悶味。\n\n私享家洗衣店適合把一週衣物集中清洗與烘乾，讓小空間維持舒服，也讓下班後少一點家事壓力。\n\n#私享家洗衣店 #租屋族 #自助洗衣",
      image:
        "A compact Taiwanese apartment doorway next to a clean laundromat bag and folded clothes, then a bright laundromat interior in the background, lifestyle photography, tidy and realistic, no people, no logos, no readable text"
    }
  ],
  "優惠提醒": [
    {
      topic: "週末洗衣日提醒",
      instagram:
        "週末到了，把累積一週的衣物整理一下吧。\n\n衣服、毛巾、床單分批處理，洗好烘好帶回家，週一開始會輕鬆很多。優惠與活動請以店內公告為準。\n\n#私享家洗衣店 #週末洗衣日 #生活提醒 #自助洗衣 #台灣生活",
      facebook:
        "週末很適合安排一個洗衣日。把一週累積的衣物、毛巾、床單分批處理，回家後就能直接收納。\n\n私享家洗衣店提醒你，優惠與活動請以店內公告為準，不用擔心錯過最新資訊。\n\n#私享家洗衣店 #週末洗衣日 #生活提醒",
      image:
        "A bright weekend morning laundromat scene with laundry baskets, folded towels, and sunlight through windows, cheerful but clean Taiwanese lifestyle photography, no people, no logos, no readable promotional text"
    },
    {
      topic: "店內服務提醒",
      instagram:
        "洗衣前先看衣物標籤，深淺色分開，大件衣物也記得留足空間。\n\n到店前可以先整理好分類，洗衣流程會更順。優惠與服務資訊請以店內公告為準。\n\n#私享家洗衣店 #洗衣提醒 #衣物照顧 #自助洗衣 #生活品質",
      facebook:
        "出門洗衣前，先把深色、淺色、毛巾、床單分開，到了店裡就能更快開始。大件衣物也建議留足洗滌與烘乾空間，效果會更穩定。\n\n優惠、服務與機台資訊請以店內公告為準。\n\n#私享家洗衣店 #洗衣提醒 #衣物照顧",
      image:
        "A neat laundromat table with sorted laundry piles by color, towels and bedding separated, clean practical composition, Taiwanese self-service laundromat, no people, no logos, no readable text"
    }
  ],
  "生活洗衣小技巧": [
    {
      topic: "毛巾變硬怎麼辦",
      instagram:
        "毛巾用久變硬，可能是清潔劑殘留或沒有完全乾透。\n\n清洗時別放太滿，烘乾時讓熱風有空間流動，毛巾會更容易回到蓬鬆手感。\n\n#私享家洗衣店 #毛巾清洗 #洗衣小技巧 #生活感 #自助洗衣",
      facebook:
        "毛巾變硬不一定是壞掉了，有時候是清潔劑殘留、洗衣量太滿，或烘乾不夠完整。清洗與烘乾時留一點空間，毛巾會比較容易恢復蓬鬆。\n\n私享家洗衣店適合一次處理家裡累積的毛巾，洗好烘好更省時間。\n\n#私享家洗衣店 #毛巾清洗 #洗衣小技巧",
      image:
        "A basket of fluffy clean towels on a laundromat folding table, soft warm light, fresh texture, clean modern Taiwanese laundromat, no people, no logos, no readable text"
    },
    {
      topic: "下班後快速洗衣",
      instagram:
        "下班後最想做的事，是快點把生活整理好。\n\n把衣物集中帶來私享家洗衣店，洗衣、烘衣一次處理，等待時間也能順便安排自己的小休息。\n\n#私享家洗衣店 #上班族洗衣 #省時生活 #自助洗衣 #下班日常",
      facebook:
        "上班族的時間很珍貴。與其回家等衣服慢慢乾，不如把一週衣物集中處理，清洗與烘乾一次完成。\n\n私享家洗衣店讓洗衣變成下班後可以快速完成的小任務，生活節奏也會舒服一點。\n\n#私享家洗衣店 #上班族洗衣 #省時生活",
      image:
        "Evening laundromat scene in Taiwan with warm lights, clean washing machines, a folded shirt and work bag on a bench, calm after-work lifestyle photography, no people, no logos, no readable text"
    }
  ],
  "品牌形象文": [
    {
      topic: "把洗衣變成生活裡輕鬆的一段",
      instagram:
        "洗衣不只是把衣服洗乾淨，也是把生活重新整理一下。\n\n私享家洗衣店希望陪你把日常變得更乾淨、更省時，也更舒服。\n\n#私享家洗衣店 #生活品質 #自助洗衣 #乾淨日常 #台灣生活",
      facebook:
        "日常裡有很多小事，洗衣就是其中一件。把衣服洗乾淨、烘乾、摺好，生活好像也跟著回到有秩序的狀態。\n\n私享家洗衣店希望成為你生活裡可靠的一站，讓洗衣這件事簡單一點、舒服一點。\n\n#私享家洗衣店 #生活品質 #乾淨日常",
      image:
        "A polished brand lifestyle photo of a clean Taiwanese self-service laundromat, folded clothes on a table, soft warm lighting, calm premium everyday atmosphere, no people, no fake logos, no readable text, square social image"
    }
  ]
};

function hashDate(date: string): number {
  return [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pickTemplate(category: Category, date: string, slot: number): TopicTemplate {
  const choices = templates[category];
  const index = (hashDate(date) + slot) % choices.length;
  const template = choices[index];
  if (!template) throw new Error(`No template for category ${category}`);
  return template;
}

export function buildDailyContent(date: string, config: AppConfig): DailyContent {
  const slots: DailySlot[] = DAILY_SCHEDULE.map((schedule) => {
    const template = pickTemplate(schedule.category, date, schedule.slot);
    return {
      slot: schedule.slot,
      time: schedule.time,
      category: schedule.category,
      topic: template.topic,
      instagram_caption: template.instagram,
      facebook_caption: template.facebook,
      image_prompt: template.image,
      local_image_path: relativeAssetPath(date, schedule.slot),
      public_image_url: config.publicImageBaseUrl
        ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, date, schedule.slot)
        : "",
      status: "pending"
    };
  });

  return {
    date,
    timezone: config.timezone,
    generated_at: new Date().toISOString(),
    slots
  };
}
