/**
 * First-party, static HTML enhancement for two existing, accepted guides.
 * Run after generate-public-site; --check before publish-pages is read-only.
 * No network, new URLs, pricing changes, approvals, or analytics events.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVISION = '2026-09-12';
export const SLUGS = Object.freeze(['plush-doll-cleaning', 'luxury-dry-cleaning']);
const escapeHtml = (value) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const exactlyOne = (text, regex, name) => {
  const matches = [...text.matchAll(regex)];
  if (matches.length !== 1) throw new Error(`${name}: expected one match, got ${matches.length}`);
  return matches[0];
};
const hash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
const COPY = Object.freeze({
  'plush-doll-cleaning': {
    title: '娃娃送洗前，先把照片與狀況一起傳給門市',
    note: '正反面、五官與配件、洗標及在意的位置先拍清楚；填充硬塊、潮味、掉毛或曾自行清洗，也可一起說明。',
    price: '娃娃依大小報價，沒有按公分列出的固定金額；先傳照片詢問，實際可行性與費用以門市檢視為準。不保證完全恢復或變全新。',
    message: '你好，我想詢問絨毛娃娃清洗。\n大小約：\n在意的污漬／異味／掉毛：\n是否受潮或曾自行清洗：\n五官或配件是否鬆動：\n我會附上正反面、五官配件、洗標與污況照片。\n想先確認是否適合送洗、估價與處理限制。'
  },
  'luxury-dry-cleaning': {
    title: '精品衣物送洗前，先說明材質與既有痕跡',
    note: '準備洗標、整體、五金飾件、內襯與污漬位置照片；舊污漬、磨損、褪色及曾自行處理的地方也請說明。',
    price: '價目表列的是參考價，乾洗柔洗及特殊污況另計；不以品牌名稱直接決定洗法或保證效果，實際方式與報價以門市檢視為準。',
    message: '你好，我想詢問精品衣物送洗。\n物件與材質（不確定可略過）：\n在意的污漬／磨損／褪色：\n是否曾自行處理：\n我會附上洗標、整體、五金飾件、內襯與污漬照片。\n想先確認處理方式、報價與可改善的界線。'
  }
});

// Frozen conversion regions from d831a4a6. Fail rather than overwrite a later edit.
export const BASE_REGION_HASHES = Object.freeze({
  'plush-doll-cleaning': 'f7bda945d308bafd5a8ae954d05be20ec28587a44e7f0e9e86bf331f91049b5e',
  'luxury-dry-cleaning': 'd81900e16df6f8c54397c9da708f8ea76af82ee61a03cb340504ed4adead4ed2'
});
const REGION = /<section class="section"(?: data-service-intake="[a-z-]+" data-service-intake-version="1")?>\s*<div class="page-shell grid two">\s*<div>\s*<h2(?: id="service-intake-heading")?>(?:對應服務|[^<]*送洗前[^<]*)<\/h2>[\s\S]*?<\/section>/g;

export const CLIENT_SCRIPT = `/* Local clipboard only: no request, storage, or analytics. */
(function () {
  document.addEventListener('click', async function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-intake-copy]') : null;
    if (!button) return;
    var section = button.closest('[data-service-intake]');
    var field = section && section.querySelector('[data-intake-message]');
    var status = section && section.querySelector('[data-intake-status]');
    if (!field || !status) return;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(field.value);
      status.textContent = '已複製。請自行貼到 LINE、補充狀況並附上照片；尚未送出訊息。';
    } catch (_) {
      field.closest('details').open = true;
      field.focus(); field.select();
      status.textContent = '請長按或按 Ctrl/Cmd+C 複製，再自行貼到 LINE；尚未送出訊息。';
    }
  });
})();
`;

function renderRegion(slug, base, aside, related) {
  const copy = COPY[slug];
  const a = (path, label, attributes = '') => `<a href="${escapeHtml(base + path)}"${attributes}>${label}</a>`;
  return `<section class="section" data-service-intake="${slug}" data-service-intake-version="1">
        <div class="page-shell grid two">
          <div>
            <h2 id="service-intake-heading">${copy.title}</h2>
            <p class="section-copy">${copy.note}</p>
            <p>${copy.price}</p>
            <div class="link-row">
              ${a('services/taichung-xitun-laundry.html', '門市與衣物洗護服務', ' data-parent-service')}
            </div>
            ${related}
            <div class="link-row" data-money-pages>
              ${a('services/taichung-laundry-price-list.html', '先看參考價與計價說明')}
              ${a('services/taichung-citywide-laundry-pickup.html', '查看台中免費收送；清潔費另計')}
            </div>
            <details>
              <summary>展開可複製的 LINE 詢問範本</summary>
              <p>可複製後自行補充，不清楚的欄位可略過。此功能不會上傳範本，也不會自動送出。</p>
              <label for="service-intake-message">詢問範本</label>
              <textarea id="service-intake-message" data-intake-message readonly rows="9" style="display:block;width:100%;max-width:100%;box-sizing:border-box;font:inherit;line-height:1.6;padding:12px">${escapeHtml(copy.message)}</textarea>
              <button type="button" class="button secondary" data-intake-copy>複製詢問範本</button>
              <p class="muted" role="status" aria-live="polite" data-intake-status></p>
            </details>
            <div class="button-row">
              ${a(`go/line.html?source=guide-${slug}-inline`, '開啟 LINE，傳照片詢問', ' class="button brand"')}
            </div>
            <p class="muted">複製範本或開啟 LINE 不代表已預約、已報價或已完成送洗；仍需自行送出訊息，並由門市確認。</p>
          </div>
          ${aside}
        </div>
      </section>`;
}

function updatePageDate(html, canonical) {
  exactlyOne(html, /<p class="last-updated">內容更新：<time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time><\/p>/g, 'Visible modification date');
  html = html.replace(/(<p class="last-updated">內容更新：<time datetime=")(\d{4}-\d{2}-\d{2})(">)(\d{4}-\d{2}-\d{2})(<\/time><\/p>)/g,
    (all, a, old, b, visible, c) => {
      if (old !== visible) throw new Error('Visible content dates disagree');
      const date = old > REVISION ? old : REVISION;
      return a + date + b + date + c;
    });
  return html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (all, open, json, close) => {
    const value = JSON.parse(json);
    let changed = false;
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      const types = [].concat(node['@type'] || []);
      if (types.includes('WebPage') && (node.url === canonical || node['@id'] === canonical + '#webpage')) {
        if (typeof node.dateModified === 'string' && node.dateModified.slice(0, 10) < REVISION) {
          node.dateModified = REVISION; changed = true;
        }
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    };
    visit(value);
    return changed ? open + JSON.stringify(value).replace(/</g, '\\u003c') + close : all;
  });
}

export function enhanceGuide(html, slug) {
  if (!SLUGS.includes(slug)) throw new Error('Guide is outside the two-page allowlist');
  const canonical = exactlyOne(html, /<link rel="canonical" href="([^"]+)"\s*\/>/g, 'Canonical')[1];
  const url = new URL(canonical);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(`/guides/${slug}.html`)) throw new Error('Unsafe or mismatched canonical');
  if (!html.includes(`data-analytics-content-id="${slug}"`)) throw new Error('Content identity mismatch');
  if (/<meta\b[^>]*(?:noindex|nofollow)/i.test(html)) throw new Error('Refusing a non-indexable guide');
  const base = canonical.slice(0, -`guides/${slug}.html`.length);
  const main = exactlyOne(html, /<main>[\s\S]*?<\/main>/g, 'Main')[0];
  const region = exactlyOne(main, REGION, 'Service conversion region')[0];
  const aside = exactlyOne(region, /<aside class="card">[\s\S]*?<\/aside>/g, 'Business card')[0];
  const relatedMatches = [...region.matchAll(/<div class="link-row" data-related-guides>[\s\S]*?<\/div>/g)];
  if (relatedMatches.length > 1) throw new Error('Ambiguous related guides');
  const related = relatedMatches[0]?.[0] || '';
  const expected = renderRegion(slug, base, aside, related);
  if (region.includes('data-service-intake=')) {
    if (region !== expected) throw new Error('Intake region changed; review instead of overwriting');
  } else if (hash(region) !== BASE_REGION_HASHES[slug]) {
    throw new Error('Source conversion region changed; review instead of overwriting');
  }
  const parent = exactlyOne(region, /<a href="([^"]+)" data-parent-service>/g, 'Parent service')[1];
  if (parent !== base + 'services/taichung-xitun-laundry.html') throw new Error('Parent service mismatch');
  html = html.replace(main, main.replace(region, expected));
  const tag = `<script defer src="${escapeHtml(base)}scripts/service-intake.js" data-service-intake-script></script>`;
  const tags = [...html.matchAll(/<script\b[^>]*data-service-intake-script[^>]*><\/script>/g)];
  if (tags.length > 1 || (tags.length === 1 && tags[0][0] !== tag)) throw new Error('Intake script mismatch');
  if (tags.length === 0) {
    exactlyOne(html, /<\/head>/g, 'Head');
    html = html.replace('</head>', `${tag}\n  </head>`);
  }
  return { html: updatePageDate(html, canonical), canonical };
}

export function updateSitemap(xml, canonicals) {
  const found = new Map(canonicals.map(c => [c, 0]));
  const result = xml.replace(/<url>[\s\S]*?<\/url>/g, block => {
    const loc = exactlyOne(block, /<loc>([^<]+)<\/loc>/g, 'Sitemap loc')[1];
    if (!found.has(loc)) return block;
    found.set(loc, found.get(loc) + 1);
    const old = exactlyOne(block, /<lastmod>([^<]+)<\/lastmod>/g, 'Sitemap lastmod')[1];
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(old)) throw new Error('Invalid sitemap date');
    return old.slice(0, 10) >= REVISION ? block : block.replace(`<lastmod>${old}</lastmod>`, `<lastmod>${REVISION}</lastmod>`);
  });
  for (const [url, count] of found) if (count !== 1) throw new Error(`Sitemap target ${url}: expected one entry, got ${count}`);
  return result;
}

async function safeFile(root, name, optional = false) {
  const file = resolve(root, name);
  const rel = relative(root, file);
  if (!rel || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Path escapes project');
  let part = root;
  for (const component of rel.split(sep)) {
    part = resolve(part, component);
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('Symlink in output path'); }
    catch (error) { if (error.code === 'ENOENT' && optional && part === file) return file; throw error; }
  }
  if (!(await lstat(file)).isFile()) throw new Error('Output is not a regular file');
  return file;
}

export async function buildPlan(root) {
  root = await realpath(root);
  const plan = []; const canonicals = [];
  for (const slug of SLUGS) {
    const path = `docs/guides/${slug}.html`;
    const file = await safeFile(root, path);
    const before = await readFile(file, 'utf8');
    const result = enhanceGuide(before, slug);
    plan.push({ path, file, before, after: result.html }); canonicals.push(result.canonical);
  }
  if (new URL(canonicals[0]).origin !== new URL(canonicals[1]).origin) throw new Error('Guide origins differ');
  for (const path of ['docs/sitemap.xml', 'docs/ai-sitemap.xml']) {
    const file = await safeFile(root, path);
    const before = await readFile(file, 'utf8');
    plan.push({ path, file, before, after: updateSitemap(before, canonicals) });
  }
  const path = 'docs/scripts/service-intake.js';
  const file = await safeFile(root, path, true);
  let before = null;
  try { before = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (before !== null && before !== CLIENT_SCRIPT) throw new Error('Existing intake script differs; review required');
  plan.push({ path, file, before, after: CLIENT_SCRIPT });
  return plan;
}

export async function run(root, check = false) {
  const plan = await buildPlan(root); // Validate every file before any write.
  const changed = plan.filter(item => item.before !== item.after);
  if (check && changed.length) throw new Error('Run npm run generate-public-site first: intake artifacts are missing or stale');
  if (!check) {
    const installed = [];
    try {
      for (const item of changed) {
        // Recheck in case another process changed the file during validation.
        let current = null;
        try { current = await readFile(item.file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current !== item.before) throw new Error('Output changed concurrently');
        const temporary = `${item.file}.intake-${process.pid}.tmp`;
        try { await writeFile(temporary, item.after, { flag: 'wx' }); await rename(temporary, item.file); }
        finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        installed.push(item);
      }
    } catch (error) {
      // Do not roll back a file that another writer has since changed.
      for (const item of installed.reverse()) {
        const current = await readFile(item.file, 'utf8').catch(() => null);
        if (current === item.after) {
          if (item.before === null) await unlink(item.file); else await writeFile(item.file, item.before);
        }
      }
      throw error;
    }
  }
  return { status: check ? 'verified' : 'built', revision: REVISION, changed: changed.map(i => i.path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--check')) throw new Error('Only --check is supported; run from the project root');
  run(process.cwd(), args.includes('--check')).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
