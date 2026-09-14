// Frozen region excerpts (not full-page snapshots) from d831a4a6.
// docs/guides/plush-doll-cleaning.html blob 38edffd6cf74b9c9ad08adf979cedd2f213e9a9e
// docs/guides/luxury-dry-cleaning.html blob e65d07dc1e39951406e0079598dae56ada0e2d81
export const BASE = 'https://sixiangjialaundry.com/';
export const ASIDE = `<aside class="card">
            <h2>店家資料</h2>
            <p>私享家洗衣店</p>
            <p>407 臺中市西屯區至善里青海路二段365號</p>
            <p><a href="tel:+886-4-2452-7411">04-2452-7411</a>｜0968-327-653</p>
            <p>週一至週五 10:00-20:00；週六 12:00-18:00；週日公休</p>
          </aside>`;
export const RELATED = `<div class="link-row" data-related-guides>
              <a href="https://sixiangjialaundry.com/guides/shirt-suit-dry-cleaning.html">襯衫清洗與西裝乾洗</a>
            </div>`;
export function originalRegion(slug) {
  const luxury = slug === 'luxury-dry-cleaning';
  return `<section class="section">
        <div class="page-shell grid two">
          <div>
            <h2>對應服務</h2>
            <p class="section-copy">${luxury ? '台中西屯 精品乾洗 名牌衣服清潔 精緻乾洗' : '台中西屯 娃娃清洗 絨毛玩偶清潔'}</p>
            <div class="link-row">
              <a href="https://sixiangjialaundry.com/services/taichung-xitun-laundry.html" data-parent-service>台中西屯洗衣店</a>
              <a href="https://sixiangjialaundry.com/go/line.html?source=guide-${slug}-inline">傳照片詢問</a>
            </div>
            ${luxury ? RELATED + '\n            ' : ''}<div class="link-row" data-money-pages>
              <a href="https://sixiangjialaundry.com/services/taichung-laundry-price-list.html">台中洗衣價目表</a>
              <a href="https://sixiangjialaundry.com/services/taichung-citywide-laundry-pickup.html">台中全市免費洗衣收送</a>
              <a href="https://sixiangjialaundry.com/services/business-bulk-laundry.html">店家與公司大量衣物送洗</a>
              <a href="https://sixiangjialaundry.com/local/fengjia-laundry-pickup.html">逢甲洗衣收送：宿舍與租屋怎麼約</a>
              <a href="https://sixiangjialaundry.com/local/qinghai-road-shoe-cleaning.html">青海路洗鞋店怎麼挑：看案例、問界線、約收送</a>
              <a href="https://sixiangjialaundry.com/guides/taichung-laundry-service-search.html">台中洗衣、洗鞋、洗包與免費收送怎麼找？</a>
            </div>
          </div>
          ${ASIDE}
        </div>
      </section>`;
}
export function fixture(slug) {
  const canonical = BASE + `guides/${slug}.html`;
  return `<!doctype html><html lang="zh-Hant-TW"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${canonical}" />
<title>原標題不變</title>
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':[
  {'@type':'WebPage','@id':canonical+'#webpage',url:canonical,dateModified:'2026-08-29',datePublished:'2026-08-23'},
  {'@type':'FAQPage',mainEntity:[{name:'原問答',acceptedAnswer:{text:'原回答不變'}}]},
  {'@type':'Service',url:BASE+'services/taichung-xitun-laundry.html',dateModified:'2026-08-23'}
]})}</script>
</head><body data-analytics-content-id="${slug}"><main>
<h1>原 H1 不變</h1>
<p class="last-updated">內容更新：<time datetime="2026-08-29">2026-08-29</time></p>
<p>原有內容、價格與照片不變</p>
${originalRegion(slug)}
<section id="faq"><h2>原問答不變</h2></section>
</main><footer>原頁尾不變</footer></body></html>`;
}
export function sitemap(slugs) {
  return '<?xml version="1.0"?><urlset>' + slugs.map(s => `<url><loc>${BASE}guides/${s}.html</loc><lastmod>2026-08-29</lastmod></url>`).join('') + '<url><loc>'+BASE+'</loc><lastmod>2026-09-10</lastmod></url></urlset>';
}
