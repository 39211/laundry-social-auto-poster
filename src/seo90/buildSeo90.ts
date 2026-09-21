import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, copyFile, realpath} from 'node:fs/promises';
import {resolve, relative, dirname, sep, isAbsolute} from 'node:path';
import {PNG} from 'pngjs';
import type {Article, Asset, Bundle, Registry, Release} from './types';

export function digest(value: unknown): string {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(ordered(value)) ?? 'undefined').digest('hex');
}
export const bytesDigest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const timeValid = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(s) && Number.isFinite(Date.parse(s))
  && new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0,19) === s.slice(0,19);
const safePath = (s: unknown): s is string => typeof s === 'string' && /^\/[a-z0-9][a-z0-9/_.-]*$/.test(s)
  && !s.includes('..') && !s.includes('//');
const record=(x:unknown):x is Record<string,any>=>!!x && typeof x==='object' && !Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string' && x.trim().length>0;
const strings=(x:unknown):x is string[]=>Array.isArray(x) && x.every(text);
function registryErrors(r: Registry): string[] {
  const errors: string[] = [];
  if(!record(r)||!text(r.storeId)||!text(r.brand)||typeof r.profileApproved!=='boolean'||!record(r.cta)
    ||!text(r.cta.id)||!text(r.cta.label)||!record(r.services)||!record(r.clusters)
    ||Object.values(r.services).some(x=>!record(x)||typeof x.confirmed!=='boolean'||!strings(x.assertions))
    ||Object.values(r.clusters).some(x=>!record(x)||!text(x.label)))return ['REGISTRY_SCHEMA'];
  try { const u = new URL(r.baseUrl); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) errors.push('BASE_URL'); }
  catch { errors.push('BASE_URL'); }
  if (!r.storeId || !r.brand || !safePath(r.cta?.path)) errors.push('REGISTRY');
  if (Object.values(r.services ?? {}).some(x => !safePath(x.path))) errors.push('SERVICE_PATH');
  if (Object.values(r.clusters ?? {}).some(x => !safePath(x.path))) errors.push('CLUSTER_PATH');
  return errors;
}
export function articleErrors(a: Article, r: Registry): string[] {
  const e = registryErrors(r);
  if(e.length)return e;
  if(!record(a)||!['schemaVersion','contentId','seriesId','storeId','title','slug','summary','directAnswer','clusterId','serviceId','plannedPublishAt','canonicalPath','author','ctaId','state'].every(k=>text((a as any)[k]))
    ||!['draft','preview','approved','publish_ready','published','withdrawn'].includes(a.state)
    ||!Array.isArray(a.sections)||a.sections.some(s=>!record(s)||!text(s.heading)||!text(s.body))
    ||!Array.isArray(a.faq)||a.faq.some(f=>!record(f)||!text(f.question)||!text(f.answer))
    ||!strings(a.assetRefs)||!strings(a.serviceAssertions)
    ||!Array.isArray(a.sourceRefs)||a.sourceRefs.some(s=>!record(s)||!['p4-concept','public-fact','owner-note'].includes(s.type)||!text(s.ref))
    ||(a.video!==undefined&&(!record(a.video)||!['sha256','fullDecode','visual','semantic','audio','owner'].every(k=>text((a.video as any)[k])))))return ['ARTICLE_SCHEMA'];
  if (a.schemaVersion !== 'sxj.seo90.article.v1' || !/^[a-z0-9-]+$/.test(a.contentId) || !a.seriesId
    || !Number.isInteger(a.dayNumber) || a.dayNumber < 1 || a.dayNumber > 90) e.push('SCHEMA');
  if (a.storeId !== r.storeId) e.push('STORE_MISMATCH');
  if (!/^[a-z0-9-]+$/.test(a.slug) || !/^\/posts\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.html$/.test(a.canonicalPath)
    || !a.canonicalPath.endsWith('-'+a.slug+'.html')
    || !timeValid(a.canonicalPath.slice(7,17)+'T00:00:00+08:00')) e.push('CANONICAL');
  if (!timeValid(a.plannedPublishAt)) e.push('PLANNED_TIME');
  if (!Object.hasOwn(r.clusters,a.clusterId) || !Object.hasOwn(r.services,a.serviceId)) e.push('UNKNOWN_REGISTRY_ID');
  if (a.ctaId !== r.cta.id || a.author !== r.brand) e.push('BRAND_CTA');
  const sections = Array.isArray(a.sections) ? a.sections : [];
  const faqs = Array.isArray(a.faq) ? a.faq : [];
  // Minimum completeness is a mechanical floor, not an editorial approval.
  if (!a.title || !a.summary || !a.directAnswer || a.directAnswer.length < 45 || sections.length < 4 || faqs.length < 2
    || sections.some(s => !s.heading || s.body.length < 45)
    || faqs.some(s => !s.question || s.answer.length < 15)
    || sections.map(s=>s.body).join('').length < 500) e.push('ARTICLE_INCOMPLETE');
  if (!Array.isArray(a.sourceRefs) || a.sourceRefs.length === 0) e.push('SOURCE_REQUIRED');
  if (!Array.isArray(a.assetRefs) || a.assetRefs.length !== 4 || new Set(a.assetRefs).size !== 4) e.push('FOUR_IMAGES_REQUIRED');
  return [...new Set(e)];
}
export async function assetErrors(asset: Asset, assetRoot: string, contentId: string): Promise<string[]> {
  const e: string[] = [];
  if (!record(asset) || asset.contentId !== contentId) return ['ASSET_MAPPING'];
  if(!['assetId','path','sha256','mime','provider','alt','caption','review'].every(k=>text((asset as any)[k]))
    ||!Number.isInteger(asset.width)||!Number.isInteger(asset.height))return ['ASSET_SCHEMA'];
  if (asset.mime !== 'image/png' || !asset.path.toLowerCase().endsWith('.png') || !['imagegen','authorized_photo'].includes(asset.provider)) e.push('PHOTO_SOURCE');
  if (!asset.alt || !asset.caption) e.push('ASSET_LABEL');
  try {
    const root = await realpath(assetRoot), path = await realpath(resolve(root, asset.path));
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel.startsWith('..'+sep) || rel === '..' || resolve(root, rel) !== path || !rel) return ['ASSET_PATH_ESCAPE'];
    const bytes = await readFile(path);
    if (bytesDigest(bytes) !== asset.sha256) e.push('ASSET_HASH');
    const png = PNG.sync.read(bytes, {checkCRC: true});
    if (png.width !== asset.width || png.height !== asset.height || png.width < 1000 || png.height < 1000) e.push('ASSET_DIMENSIONS');
  } catch { e.push('ASSET_UNREADABLE'); }
  return e;
}
export function publicErrors(a: Article, bundle: Bundle, now: string): string[] {
  const r=bundle.registry, e=articleErrors(a,r), hash=digest(a);
  if(e.length)return e;
  const approval=bundle.approvals.find(x=>x?.contentId===a.contentId);
  if((a.sections.map(s=>s.body).join('').match(/\p{Script=Han}/gu)??[]).length<900)e.push('FULL_ARTICLE_REQUIRED');
  if (!['approved','publish_ready','published'].includes(a.state)) e.push('NOT_APPROVED_STATE');
  if (r.profileApproved!==true) e.push('PROFILE_UNAPPROVED');
  if (!Number.isFinite(Date.parse(now)) || !timeValid(a.plannedPublishAt) || Date.parse(a.plannedPublishAt)>Date.parse(now)) e.push('FUTURE');
  if (!approval || approval.channel !== 'website' || approval.decision !== 'approved' || approval.articleSha256 !== hash
    || approval.registrySha256 !== digest(r) || !text(approval.approvedBy) || !timeValid(approval.approvedAt)
    || Date.parse(approval.approvedAt)>Date.parse(now)) e.push('WEBSITE_APPROVAL');
  const assets=a.assetRefs.map(id=>bundle.assets.find(x=>x.assetId===id));
  if (assets.some(x=>!x || x.review!=='approved') || digest(approval?.assetSha256s) !== digest(assets.map(x=>x?.sha256))
    || approval?.assetManifestSha256!==digest(assets)) e.push('ASSET_APPROVAL');
  const service=r.services[a.serviceId]!;
  if (service?.confirmed!==true || !Array.isArray(a.serviceAssertions) || a.serviceAssertions.some(x=>!service.assertions.includes(x))) e.push('SERVICE_UNCONFIRMED');
  if (a.video && (a.video.fullDecode!=='pass' || a.video.visual!=='pass' || a.video.semantic!=='pass' || a.video.audio!=='pass' || a.video.owner!=='approved')) e.push('VIDEO_EDITORIAL');
  const releases=bundle.releases.filter(x=>x.contentId===a.contentId || x.canonicalPath===a.canonicalPath);
  if (releases.length!==1) e.push('RELEASE_JOURNAL');
  else {
    const release=releases[0]!;
    if (release.contentId!==a.contentId || release.canonicalPath!==a.canonicalPath || release.state!=='published'
      || release.articleSha256!==hash || release.registrySha256!==digest(r)) e.push('RELEASE_MISMATCH');
    if (!timeValid(release.datePublished) || !timeValid(release.dateModified) || Date.parse(release.datePublished)>Date.parse(now)
      || Date.parse(release.datePublished)<Date.parse(a.plannedPublishAt) || Date.parse(release.dateModified)<Date.parse(release.datePublished)
      || Date.parse(release.dateModified)>Date.parse(now)
      || (approval && Date.parse(release.dateModified)<Date.parse(approval.approvedAt))) e.push('RELEASE_DATE');
  }
  return [...new Set(e)];
}

const style=`:root{--ink:#103f38;--paper:#f5f0e7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.85 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1040px;margin:auto;padding:32px 22px 80px}h1{font-family:serif;font-size:clamp(32px,5vw,56px);line-height:1.35}h2{margin-top:2em;font-size:24px}a{color:inherit}header{border-bottom:1px solid #ccd3c9;padding:18px 0}figure{margin:0}img{width:100%;height:auto;display:block;border-radius:8px}figcaption{font-size:13px;color:#58655d;margin:8px 0 20px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:center}.answer{background:#fffaf3;padding:24px;border-left:3px solid #ae643b}.body{max-width:750px;margin:auto}.gallery,.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}.card{border:1px solid #d5d9cf;border-radius:12px;overflow:hidden;background:#fffcf6;text-decoration:none}.card .copy{padding:20px}.card img{aspect-ratio:4/5;object-fit:cover}.tag{font-size:13px;letter-spacing:.12em}.cta{display:block;background:var(--ink);color:white;text-align:center;padding:16px;border-radius:8px;margin-top:30px}.notice{border:1px solid #ae643b;padding:12px;font-size:14px}p{white-space:pre-line}@media(max-width:640px){.hero,.cards{grid-template-columns:1fr}.gallery{gap:12px}main{padding:20px 16px}.body{width:100%}}`;
const absolute=(path:string,r:Registry)=>r.baseUrl.replace(/\/$/,'')+path;
function shell(title:string,body:string,r:Registry,preview:boolean,head=''):string{
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}｜${esc(r.brand)}</title>${preview?'<meta name="robots" content="noindex,nofollow">':''}${head}<style>${style}</style></head><body><main><header>${esc(r.brand)} · 洗衣筆記</header>${preview?'<p class="notice">本機核稿預覽｜短版內容仍待編輯驗收，尚未公開或完成網站核准；AI 示意圖片不代表實際洗護成果。</p>':''}${body}</main></body></html>`;
}
export function renderArticle(a:Article,assets:Asset[],r:Registry,preview:boolean,release?:Release):string{
  const image=(x:Asset)=>`<figure><img src="../seo90-assets/${esc(x.sha256)}.png" alt="${esc(x.alt)}" loading="lazy"><figcaption>${esc(x.caption)}</figcaption></figure>`;
  const schema=preview?'':`<link rel="canonical" href="${esc(absolute(a.canonicalPath,r))}"><meta name="description" content="${esc(a.summary)}"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:a.title,description:a.summary,url:absolute(a.canonicalPath,r),mainEntityOfPage:absolute(a.canonicalPath,r),datePublished:release!.datePublished,dateModified:release!.dateModified,author:{'@type':'Organization',name:r.brand},image:assets.map(x=>absolute('/seo90-assets/'+x.sha256+'.png',r))}).replace(/</g,'\\u003c')}</script>`;
  return shell(a.title,`<p><a href="../daily/">← 洗衣筆記</a></p><div class="hero"><div><p class="tag">DAY ${a.dayNumber} · ${esc(r.clusters[a.clusterId]!.label)}</p><h1>${esc(a.title)}</h1><p>${esc(a.summary)}</p></div>${image(assets[0]!)}</div><div class="body"><p class="answer">${esc(a.directAnswer)}</p>${a.sections.map(s=>`<section><h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p></section>`).join('')}<h2>常見問題</h2>${a.faq.map(f=>`<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join('')}<p>相關服務：<a href="${esc(absolute(r.services[a.serviceId]!.path,r))}">${esc(r.clusters[a.clusterId]!.label)}</a></p><p>圖片均為 AI 示意或有授權素材；實際收件、處理方式與費用由門市確認。</p><div class="gallery">${assets.slice(1).map(image).join('')}</div>${preview?'<p class="notice">正式版本會在此提供「LINE 傳照片詢問」；核稿頁不發出服務請求。</p>':`<a class="cta" data-cta="${esc(r.cta.id)}" href="${esc(absolute(r.cta.path,r))}">${esc(r.cta.label)}</a>`}</div>`,r,preview,schema);
}
async function physicalDestination(path:string):Promise<string>{
  let current=resolve(path);const missing:string[]=[];
  for(;;){try{return resolve(await realpath(current),...missing);}catch(error:any){if(error.code!=='ENOENT')throw error;const parent=dirname(current);if(parent===current)throw error;missing.unshift(relative(parent,current));current=parent;}}
}
export async function prepareSeo90(bundle:Bundle,options:{mode:'preview'|'public';assetRoot:string;now:string}) {
  const {mode,assetRoot,now}=options, preview=mode==='preview';
  if(!record(bundle))throw Error('INVALID_BUNDLE');
  const r=bundle.registry;
  if(!['preview','public'].includes(mode)||!record(bundle)||!['articles','assets','approvals','releases'].every(k=>Array.isArray((bundle as any)[k])))throw Error('INVALID_BUNDLE');
  if(registryErrors(r).length) throw Error('INVALID_REGISTRY');
  if(bundle.articles.some(a=>!record(a)||!text(a.contentId)||!text(a.canonicalPath)||!strings(a.assetRefs))||bundle.assets.some(a=>!record(a)||!text(a.assetId)))throw Error('INVALID_BUNDLE');
  if(new Set(bundle.articles.map(a=>a.contentId)).size!==bundle.articles.length || new Set(bundle.articles.map(a=>a.canonicalPath)).size!==bundle.articles.length) throw Error('DUPLICATE_ARTICLE');
  if(new Set(bundle.assets.map(a=>a.assetId)).size!==bundle.assets.length) throw Error('DUPLICATE_ASSET');
  const eligible:{article:Article;assets:Asset[]}[]=[], held:{contentId:string;reasons:string[]}[]=[], frozen=new Map<string,Buffer>();
  for(const a of bundle.articles){
    const errors=preview?articleErrors(a,r):publicErrors(a,bundle,now);
    const assets=a.assetRefs.map(id=>bundle.assets.find(x=>x.assetId===id));
    const pixels=new Set<string>();
    for(const x of assets){
      const ae=await assetErrors(x!,assetRoot,a.contentId);errors.push(...ae);
      if(ae.length===0){
        const bytes=await readFile(resolve(assetRoot,x!.path));
        if(bytesDigest(bytes)!==x!.sha256){errors.push('ASSET_CHANGED_DURING_BUILD');continue;}
        const png=PNG.sync.read(bytes,{checkCRC:true});const pixel=digest([png.width,png.height,bytesDigest(png.data)]);
        if(pixels.has(pixel))errors.push('DUPLICATE_PHOTO');pixels.add(pixel);frozen.set(x!.assetId,bytes);
      }
    }
    if(errors.length){held.push({contentId:a.contentId,reasons:[...new Set(errors)]});continue;}
    eligible.push({article:a,assets:assets as Asset[]});
  }
  return {eligible,held,frozen};
}
export async function buildSeo90(bundle:Bundle,options:{mode:'preview'|'public';assetRoot:string;outputRoot:string;now:string}):Promise<{pages:string[];sitemapEntries:string[];held:{contentId:string;reasons:string[]}[]}> {
  const {mode,outputRoot}=options, preview=mode==='preview', r=bundle.registry;
  if(preview && (await physicalDestination(outputRoot)).split(sep).some(x=>x.toLowerCase()==='docs')) throw Error('PREVIEW_IN_PUBLIC_ROOT');
  const {eligible,held,frozen}=await prepareSeo90(bundle,options);
  // Validate all inputs first. New generations go to an empty directory; no stale public/preview pages survive a rebuild.
  const {readdir}=await import('node:fs/promises');
  let entries:string[]=[];try{entries=await readdir(outputRoot);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(entries.length)throw Error('OUTPUT_MUST_BE_EMPTY');
  await mkdir(outputRoot,{recursive:true});
  const pages:string[]=[], sitemapEntries:string[]=[];
  for(const {article:a,assets} of eligible){
    for(const asset of assets){const target=resolve(outputRoot,'seo90-assets',asset.sha256+'.png');await mkdir(dirname(target),{recursive:true});await writeFile(target,frozen.get(asset.assetId)!);}
    const path=resolve(outputRoot,'.'+a.canonicalPath);await mkdir(dirname(path),{recursive:true});
    const release=bundle.releases.find(x=>x.contentId===a.contentId);
    await writeFile(path,renderArticle(a,assets,r,preview,release),'utf8');pages.push(path);
    if(!preview)sitemapEntries.push(`<url><loc>${esc(absolute(a.canonicalPath,r))}</loc><lastmod>${esc(release!.dateModified)}</lastmod></url>`);
  }
  if(preview || eligible.length){
    const path=resolve(outputRoot,'daily/index.html');await mkdir(dirname(path),{recursive:true});
    await writeFile(path,renderDailyIndex(eligible,r,preview),'utf8');pages.push(path);
    if(!preview)sitemapEntries.unshift(`<url><loc>${esc(absolute('/daily/',r))}</loc></url>`);
  }
  await writeFile(resolve(outputRoot,'seo90-build.json'),JSON.stringify({mode,rendered:eligible.length,held,deployed:false},null,2));
  return {pages,sitemapEntries,held};
}

/** Missing measurements stay unknown; service outcomes cannot be inferred from traffic. */
export function measurementSummary(input:{gscClicks?:number|null;lineClicks?:number|null;inquiries?:number|null;bookings?:number|null}){
  const metric=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
  return {gscClicks:metric(input.gscClicks),lineClicks:metric(input.lineClicks),inquiries:metric(input.inquiries),bookings:metric(input.bookings)};
}

export function renderDailyIndex(eligible:{article:Article;assets:Asset[]}[],r:Registry,preview:boolean):string {
  const cards=eligible.map(({article:a,assets})=>`<a class="card" href="..${esc(a.canonicalPath)}"><img src="../seo90-assets/${esc(assets[0]!.sha256)}.png" alt="${esc(assets[0]!.alt)}"><div class="copy"><span class="tag">DAY ${a.dayNumber} · ${esc(r.clusters[a.clusterId]!.label)}</span><h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p><span>${preview ? "閱讀預覽稿 →" : "閱讀完整筆記 →"}</span></div></a>`).join('');
  const body=`<p class="tag">${esc(r.brand)}・送洗前的實用筆記</p><h1>先看懂衣物的狀況，<br>再一起決定怎麼照顧。</h1><p>從照片怎麼拍、材質怎麼看，到與門市確認處理範圍。每篇回答一個具體問題，讓送洗溝通更清楚。</p><p>${preview?'本次預覽':'目前公開'} ${eligible.length} 篇</p><div class="cards">${cards}</div>`;
  return shell('洗衣筆記',body,r,preview,preview?'':`<link rel="canonical" href="${esc(absolute('/daily/',r))}">`);
}
