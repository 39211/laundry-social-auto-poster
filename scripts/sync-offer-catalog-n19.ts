import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { OFFER_CATALOG_AREA_SERVED, OFFER_CATALOG_COPY } from "../src/offerCatalogCopy";
import { repoRootFromHere } from "./check-sitemap-links";

const BASE = "https://sixiangjialaundry.com/";
const CATALOG_ID = `${BASE}#offer-catalog`;
const CATALOG_NAME = "私享家洗衣店服務目錄";

const SERVICE_DEFS = [
  { slug: "shoe-bag-care", name: "鞋包清潔" },
  { slug: "white-shoe-cleaning", name: "白鞋清潔" },
  { slug: "fabric-storage", name: "布品收納" },
  { slug: "taichung-xitun-laundry", name: "台中西屯洗衣店" },
  { slug: "business-bulk-laundry", name: "店家與公司大量衣物送洗" },
  { slug: "taichung-citywide-laundry-pickup", name: "台中洗衣收送" },
  { slug: "taichung-laundry-price-list", name: "台中洗衣價目表" }
] as const;

export const REFERENCE_PRICE_DESCRIPTIONS: Record<string, string> = {
  "guides/jacket-cleaning-price.html": "水洗參考價，乾洗、柔洗另計，看過實品再報價。",
  "guides/leather-garment-cleaning-price.html":
    "皮衣清潔參考價 $1200、特殊皮衣 $2000；乾洗、柔洗另計，皮革發霉與特殊污漬要看過實品再報價。",
  "guides/leather-shoe-cleaning-price.html":
    "皮鞋清潔參考價 $400；乾洗、柔洗另計，發霉、特殊污漬與特殊材質要看過實品再報價；補色、修補另計，屬修繕，不包含在清潔內。",
  "guides/luxury-garment-cleaning-price.html": "水洗參考價，乾洗、柔洗另計，看過實品再報價。",
  "services/shoe-bag-care.html": "水洗參考價，乾洗、柔洗另計，看過實品再報價。",
  "guides/bag-cleaning-price.html":
    "包包參考價：背包 $500、一般包 $600、皮包 $1000、名牌包 $1500 起、特殊類名牌包 $2500；乾洗、柔洗另計，發霉、特殊污漬與特殊材質要看過實品再報價。",
  "guides/taichung-shoe-cleaning-price.html":
    "鞋子參考價：童鞋 $150、一般運動鞋 $250、皮鞋清潔參考價 $400、麂皮鞋清潔參考價 $400（麂皮盡量少碰水）、名牌鞋 $600；乾洗、柔洗另計，看過實品再報價。"
};

export function buildCanonicalOfferCatalog(): Record<string, unknown> {
  return {
    "@type": "OfferCatalog",
    "@id": CATALOG_ID,
    name: CATALOG_NAME,
    itemListElement: SERVICE_DEFS.map((service) => {
      const copy = OFFER_CATALOG_COPY[service.slug];
      if (!copy) throw new Error(`OFFER_CATALOG_COPY 缺少 ${service.slug}`);
      return {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.name,
          serviceType: service.name,
          description: copy.description,
          areaServed: OFFER_CATALOG_AREA_SERVED,
          url: `${BASE}services/${service.slug}.html`
        },
        ...(copy.offer ? { name: copy.offer.name, description: copy.offer.description } : {})
      };
    })
  };
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

export function syncOfferCatalogN19(options: { root?: string; checkOnly?: boolean } = {}): {
  scanned: number;
  catalogPages: number;
  updated: string[];
} {
  const root = options.root ?? repoRootFromHere();
  const overrides = join(root, "seo-overrides");
  const canonicalCatalog = buildCanonicalOfferCatalog();
  const canonicalStr = JSON.stringify(canonicalCatalog);
  const files = htmlFiles(overrides);
  const updated: string[] = [];
  let catalogPages = 0;

  for (const file of files) {
    const rel = relative(overrides, file).replaceAll("\\", "/");
    const html = readFileSync(file, "utf8");
    let fileChanged = false;
    let fileHasCatalog = false;

    const nextHtml = html.replace(
      /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/gu,
      (_all, openTag: string, rawJson: string, closeTag: string) => {
        const parsed = JSON.parse(rawJson) as { "@graph"?: Array<Record<string, unknown>> };
        const graph = parsed["@graph"];
        if (!Array.isArray(graph)) return `${openTag}${rawJson}${closeTag}`;
        let blockChanged = false;

        for (const node of graph) {
          const cat = node["hasOfferCatalog"] as Record<string, unknown> | undefined;
          if (cat && cat["name"] === CATALOG_NAME) {
            fileHasCatalog = true;
            if (JSON.stringify(cat) !== canonicalStr) {
              node["hasOfferCatalog"] = JSON.parse(canonicalStr) as Record<string, unknown>;
              blockChanged = true;
            }
          }
          const refDesc = REFERENCE_PRICE_DESCRIPTIONS[rel];
          if (refDesc && node["@id"] === `${BASE}${rel}#reference-prices`) {
            if (node["description"] !== refDesc) {
              node["description"] = refDesc;
              blockChanged = true;
            }
            const items = node["itemListElement"] as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(items)) {
              for (const offer of items) {
                if (offer["description"] !== refDesc) {
                  offer["description"] = refDesc;
                  blockChanged = true;
                }
              }
            }
          }
        }

        if (!blockChanged) return `${openTag}${rawJson}${closeTag}`;
        fileChanged = true;
        return `${openTag}${JSON.stringify(parsed)}${closeTag}`;
      }
    );

    if (fileHasCatalog) catalogPages += 1;
    if (fileChanged) {
      updated.push(rel);
      if (!options.checkOnly) {
        writeFileSync(file, nextHtml, "utf8");
      }
    }
  }

  return { scanned: files.length, catalogPages, updated };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/sync-offer-catalog-n19.ts")) {
  const checkOnly = process.argv.includes("--check");
  const result = syncOfferCatalogN19({ checkOnly });
  console.log(JSON.stringify(result));
  if (checkOnly && result.updated.length > 0) {
    process.exitCode = 1;
  }
}
