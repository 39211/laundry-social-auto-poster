import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { enhanceGuide, updateSitemap, buildPlan, run, SLUGS, REVISION, CLIENT_SCRIPT } from './service-intake-guides.mjs';
import { BASE, ASIDE, RELATED, originalRegion, fixture, sitemap } from './service-intake-fixtures.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const slug = SLUGS[0];
const before = fixture(slug);
const regionOf = html => html.match(/<section class="section" data-service-intake=[\s\S]*?<\/section>/)[0];
const graph = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'service-intake-'));
  for (const path of ['docs/guides','docs/scripts']) await mkdir(join(dir,path),{recursive:true});
  for (const s of SLUGS) await writeFile(join(dir,`docs/guides/${s}.html`),fixture(s));
  for (const path of ['docs/sitemap.xml','docs/ai-sitemap.xml']) await writeFile(join(dir,path),sitemap(SLUGS));
  return dir;
}
for (const s of SLUGS) {
  test(`${s}: static contact panel renders`, () => {
    const html=enhanceGuide(fixture(s),s).html;
    assert.match(html,/data-intake-message readonly/); assert.match(html,/data-intake-copy/);
    assert.match(html,/不代表已預約/); assert.match(html,/data-service-intake-script/);
    assert.ok(html.includes(`go/line.html?source=guide-${s}-inline`));
  });
  test(`${s}: repeated generation is byte-identical`, () => {
    const first=enhanceGuide(fixture(s),s).html;
    assert.equal(enhanceGuide(first,s).html,first);
  });
  test(`${s}: CRLF source and re-checked-out enhancement remain idempotent`, () => {
    const source=fixture(s).replace(/\n/g,'\r\n');
    const first=enhanceGuide(source,s).html;
    assert.equal(enhanceGuide(first,s).html,first);
    const checkedOut=first.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n');
    assert.equal(enhanceGuide(checkedOut,s).html,checkedOut);
  });
  test(`${s}: business facts and parent service preserved`, () => {
    const html=enhanceGuide(fixture(s),s).html;
    assert.ok(html.includes(ASIDE)); assert.equal((html.match(/data-parent-service/g)||[]).length,1);
    assert.ok(html.includes('services/taichung-xitun-laundry.html'));
  });
  test(`${s}: only related commercial links remain in contact panel`, () => {
    const region=regionOf(enhanceGuide(fixture(s),s).html);
    for (const path of ['business-bulk-laundry','fengjia-laundry-pickup','qinghai-road-shoe-cleaning','taichung-laundry-service-search']) assert.ok(!region.includes(path));
    assert.ok(region.includes('taichung-laundry-price-list')); assert.ok(region.includes('taichung-citywide-laundry-pickup'));
    if (s === 'luxury-dry-cleaning') assert.ok(region.includes(RELATED));
  });
}
test('unknown or protected page is rejected',()=>assert.throws(()=>enhanceGuide(before,'donghai-laundry-pickup'),/allowlist/));
test('missing canonical rejected',()=>assert.throws(()=>enhanceGuide(before.replace(/<link rel="canonical"[^>]+>/,''),slug),/Canonical/));
test('duplicate canonical rejected',()=>assert.throws(()=>enhanceGuide(before.replace('</head>',`<link rel="canonical" href="${BASE}guides/${slug}.html" /></head>`),slug),/Canonical/));
test('wrong canonical path rejected',()=>assert.throws(()=>enhanceGuide(before.replace(`${BASE}guides/${slug}.html`,`${BASE}other.html`),slug),/canonical/));
test('unsafe canonical protocol rejected',()=>assert.throws(()=>enhanceGuide(before.replace(`href="${BASE}guides`, 'href="javascript:guides'),slug),/canonical/));
test('mismatched page identity rejected',()=>assert.throws(()=>enhanceGuide(before.replace(`data-analytics-content-id="${slug}"`,'data-analytics-content-id="other"'),slug),/identity/));
test('noindex is not removed',()=>assert.throws(()=>enhanceGuide(before.replace('index, follow','noindex, follow'),slug),/non-indexable/));
test('nofollow is not removed',()=>assert.throws(()=>enhanceGuide(before.replace('index, follow','index, nofollow'),slug),/non-indexable/));
test('missing conversion block rejected',()=>assert.throws(()=>enhanceGuide(before.replace(originalRegion(slug),''),slug),/region/));
test('duplicate conversion block rejected',()=>assert.throws(()=>enhanceGuide(before.replace('</main>',originalRegion(slug)+'</main>'),slug),/region/));
test('later owner edit is never silently overwritten',()=>assert.throws(()=>enhanceGuide(before.replace('台中洗衣價目表','門市新核准標題'),slug),/Source conversion/));
test('changed enrichment is rejected',()=>{
  const first=enhanceGuide(before,slug).html;
  assert.throws(()=>enhanceGuide(first.replace('大小約：','新的大小規則：'),slug),/Intake region changed/);
});
test('duplicate or replaced clipboard script rejected',()=>{
  const first=enhanceGuide(before,slug).html;
  assert.throws(()=>enhanceGuide(first.replace('scripts/service-intake.js','scripts/other.js'),slug),/script mismatch/);
});
test('content title, H1, FAQ and footer are unchanged',()=>{
  const after=enhanceGuide(before,slug).html;
  for(const re of [/<title>[\s\S]*?<\/title>/,/<h1>[\s\S]*?<\/h1>/,/<section id="faq">[\s\S]*?<\/section>/,/<footer>[\s\S]*?<\/footer>/])assert.equal(after.match(re)[0],before.match(re)[0]);
  assert.deepEqual(graph(after)[1],graph(before)[1]);assert.deepEqual(graph(after)[2],graph(before)[2]);
});
test('visible and WebPage modification date advance; published date preserved',()=>{
  const after=enhanceGuide(before,slug).html;
  assert.ok(after.includes(`<time datetime="${REVISION}">${REVISION}</time>`));
  assert.equal(graph(after)[0].dateModified,REVISION);assert.equal(graph(after)[0].datePublished,'2026-08-23');
});
test('missing visible modification date is rejected',()=>assert.throws(()=>enhanceGuide(before.replace(/<p class="last-updated">[\s\S]*?<\/p>/,''),slug),/Visible modification date/));
test('duplicate visible modification dates are rejected',()=>{
  const date=before.match(/<p class="last-updated">[\s\S]*?<\/p>/)[0];
  assert.throws(()=>enhanceGuide(before.replace('</main>',date+'</main>'),slug),/Visible modification date/);
});
test('later content dates are not moved backwards',()=>{
  const html=before.replaceAll('2026-08-29','2026-09-15');
  const after=enhanceGuide(html,slug).html;
  assert.equal(graph(after)[0].dateModified,'2026-09-15');assert.ok(after.includes('datetime="2026-09-15"'));
});
test('malformed JSON-LD is rejected',()=>assert.throws(()=>enhanceGuide(before.replace('"@graph":','"@graph":oops'),slug)));
test('only two sitemap entries change',()=>{
  const xml=sitemap(SLUGS);const urls=SLUGS.map(s=>BASE+`guides/${s}.html`);
  const changed=updateSitemap(xml,urls);
  assert.equal((changed.match(new RegExp(REVISION,'g'))||[]).length,2);
  assert.ok(changed.includes('<lastmod>2026-09-10</lastmod>'));
  assert.equal(updateSitemap(changed,urls),changed);
});
test('missing sitemap target rejected',()=>assert.throws(()=>updateSitemap(sitemap([slug]),SLUGS.map(s=>BASE+`guides/${s}.html`)),/expected one entry/));
test('duplicate sitemap target rejected',()=>assert.throws(()=>updateSitemap(sitemap([slug,slug,SLUGS[1]]),SLUGS.map(s=>BASE+`guides/${s}.html`)),/expected one entry/));
test('invalid target lastmod rejected',()=>assert.throws(()=>updateSitemap(sitemap(SLUGS).replace('2026-08-29','yesterday'),SLUGS.map(s=>BASE+`guides/${s}.html`)),/Invalid sitemap/));
test('prepublish check is read-only and fails before generation',async()=>{
  const dir=await sandbox();try{
    await assert.rejects(run(dir,true),/missing or stale/);
    assert.equal(await readFile(join(dir,`docs/guides/${slug}.html`),'utf8'),before);
    await assert.rejects(access(join(dir,'docs/scripts/service-intake.js')));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('normal generation then read-only prepublish check succeeds',async()=>{
  const dir=await sandbox();try{
    const first=await run(dir);assert.equal(first.changed.length,5);
    assert.equal((await run(dir,true)).status,'verified');assert.deepEqual((await run(dir)).changed,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('CRLF clipboard artifact is accepted without rewriting it',async()=>{
  const dir=await sandbox();try{
    await run(dir);
    await writeFile(join(dir,'docs/scripts/service-intake.js'),CLIENT_SCRIPT.replace(/\n/g,'\r\n'));
    assert.equal((await run(dir,true)).status,'verified');
    assert.deepEqual((await run(dir)).changed,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('all files validate before any writes',async()=>{
  const dir=await sandbox();try{
    await writeFile(join(dir,'docs/ai-sitemap.xml'),'<invalid/>');
    await assert.rejects(run(dir));
    assert.equal(await readFile(join(dir,`docs/guides/${slug}.html`),'utf8'),before);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('existing unrelated script is not overwritten',async()=>{
  const dir=await sandbox();try{
    await writeFile(join(dir,'docs/scripts/service-intake.js'),'owner code');
    await assert.rejects(run(dir),/script differs/);
    assert.equal(await readFile(join(dir,'docs/scripts/service-intake.js'),'utf8'),'owner code');
    assert.equal(await readFile(join(dir,`docs/guides/${slug}.html`),'utf8'),before);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('symlinked output is rejected',{skip:process.platform==='win32'?'requires POSIX symlink permissions':false},async()=>{
  const dir=await sandbox();const outside=await mkdtemp(join(tmpdir(),'intake-outside-'));try{
    const file=join(dir,`docs/guides/${slug}.html`);await rm(file);await writeFile(join(outside,'page.html'),before);
    await symlink(join(outside,'page.html'),file);await assert.rejects(run(dir),/Symlink/);
    assert.equal(await readFile(join(outside,'page.html'),'utf8'),before);
  } finally {await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
function clientHarness(clipboard) {
  let listener;const status={textContent:''};const details={open:false};
  const field={value:'public fixed template',focus(){this.focused=true;},select(){this.selected=true;},closest(){return details;}};
  const section={querySelector(s){return s==='[data-intake-message]'?field:status;}};
  const button={closest(){return section;}};
  const context={document:{addEventListener(type,fn){assert.equal(type,'click');listener=fn;}},navigator:{clipboard}};
  runInNewContext(CLIENT_SCRIPT,context);
  return {listener,status,details,field,event:{target:{closest(){return button;}}}};
}
test('clipboard copies only on explicit click; says not sent',async()=>{
  let copied=null;const h=clientHarness({async writeText(value){copied=value;}});
  assert.equal(copied,null);await h.listener(h.event);
  assert.equal(copied,'public fixed template');assert.match(h.status.textContent,/尚未送出/);
});
test('clipboard denial selects text without fake success',async()=>{
  const h=clientHarness({async writeText(){throw new Error('denied');}});await h.listener(h.event);
  assert.equal(h.details.open,true);assert.equal(h.field.selected,true);assert.match(h.status.textContent,/請長按/);
});
test('missing clipboard API has a manual-copy fallback',async()=>{
  const h=clientHarness(undefined);await h.listener(h.event);assert.equal(h.field.selected,true);
});
test('unrelated click does nothing',async()=>{
  const h=clientHarness(undefined);await h.listener({target:{closest(){return null;}}});assert.equal(h.status.textContent,'');
});
test('client has no network, storage, tracking or automatic navigation APIs',()=>{
  assert.doesNotMatch(CLIENT_SCRIPT,/\b(fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|gtag|dataLayer|location|window\.open)\b/);
});
// These read actual checked-in artifacts in repository CI; local excerpt-only runs skip explicitly.
let hasRepo=false;try{await access(join(root,`docs/guides/${slug}.html`));hasRepo=true;}catch{}
test('repository artifacts: both full HTML files and sitemaps satisfy the contract',{skip:!hasRepo?'full repository artifacts not mounted; excerpt tests only':false},async()=>{
  // CI uses sparse checkout: copy the real checked-in source into a disposable
  // build root, including docs/scripts, instead of mutating or depending on a
  // generated script directory in the source checkout.
  const dir=await sandbox();
  try {
    for (const path of [...SLUGS.map(s=>`docs/guides/${s}.html`),'docs/sitemap.xml','docs/ai-sitemap.xml']) {
      await writeFile(join(dir,path),await readFile(join(root,path)));
    }
    const plan=await buildPlan(dir);assert.equal(plan.length,5);
    for(const item of plan.filter(x=>x.path.endsWith('.html')))assert.match(item.after,/data-intake-copy/);
    await run(dir);assert.equal((await run(dir,true)).status,'verified');
  } finally {await rm(dir,{recursive:true,force:true});}
});
