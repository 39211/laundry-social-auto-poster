import {describe,it,expect,beforeEach} from 'vitest';
import {mkdir,writeFile,readFile,copyFile,readdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {generatePublicSite} from '../src/generatePublicSite';
import {loadPublicSeo90,preparePublicSeo90} from '../src/seo90/publicBundle';
import {makeSeo90Fixture} from './seo90Fixture';
import {writeCalendar,writeApprovalLog} from './seo90LegacyFixture';
import type {Bundle} from '../src/seo90/types';

let root:string,b:Bundle;
const baseUrl='https://sixiangjialaundry.com',now='2026-09-26T09:00:00+08:00';
const options=()=>({now,baseUrl,assetRoot:root,existingPaths:new Set<string>(),existingIds:new Set<string>()});
const generate=()=>generatePublicSite({root,siteBaseUrl:baseUrl,now});
async function source(bundle:Bundle|null){
  const folder=join(root,'content','seo90');await mkdir(join(folder,'public-assets'),{recursive:true});
  for(let i=0;i<4;i++)await copyFile(join(root,`${i}.png`),join(folder,'public-assets',`${i}.png`));
  await writeFile(join(folder,'public-ready.json'),JSON.stringify({schemaVersion:'sxj.seo90.public-source.v1',bundle}));
}
async function file(path:string){return readFile(join(root,'docs',path),'utf8');}
beforeEach(async()=>{
  ({root,b}=await makeSeo90Fixture());
  await mkdir(join(root,'data'),{recursive:true});
  await copyFile(join(process.cwd(),'data','business-profile.json'),join(root,'data','business-profile.json'));
});

describe('SEO90 formal generator integration, isolated roots only',()=>{
  it('real_current_public_source_produces_zero_public_pages',async()=>{
    const result=await loadPublicSeo90(process.cwd(),options());
    expect(result.pages).toEqual([]);expect(result.sitemapEntries).toEqual([]);
    expect(result.relatedByService).toEqual({});expect(result.dailyIndexPath).toBeUndefined();
  });
  it('zero_public_preserves_existing_posts_and_sitemap_bytes',async()=>{
    await writeCalendar(root,'2026-09-24');await writeApprovalLog(root,'2026-09-24');
    await generate();
    const postNames=await readdir(join(root,'docs','posts'));
    expect(postNames.filter(n=>n!=='index.html').length).toBeGreaterThan(0);
    const before=await Promise.all(postNames.map(n=>file('posts/'+n)));
    const sitemap=await file('sitemap.xml'),service=await file('services/shoe-bag-care.html');
    await source(null);await generate();
    expect(await readdir(join(root,'docs','posts'))).toEqual(postNames);
    expect(await Promise.all(postNames.map(n=>file('posts/'+n)))).toEqual(before);
    expect(await file('sitemap.xml')).toBe(sitemap);
    expect(await file('services/shoe-bag-care.html')).toBe(service);
  });
  it('daily_navigation_absent_without_emitted_index',async()=>{
    await source(null);await generate();
    expect(await file('index.html')).not.toContain('href="/daily/"');
    await expect(file('daily/index.html')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('valid_synthetic_release_emits_one_article_and_one_index_via_formal_writer',async()=>{
    await source(b);const outputs=await generate();
    expect(outputs).toContain(join(root,'docs',b.articles[0]!.canonicalPath.slice(1)));
    const article=await file(b.articles[0]!.canonicalPath.slice(1));
    expect(article).toContain(b.articles[0]!.title);expect(article).not.toContain('noindex');
    expect(await file('daily/index.html')).toContain(b.articles[0]!.title);
    expect(await file('index.html')).toContain('href="/daily/"');
    expect(await readdir(join(root,'docs','seo90-assets'))).toHaveLength(4);
  });
  it('existing_article_path_collision_fails_before_formal_writes',async()=>{
    await source(b);await mkdir(join(root,'docs','posts'),{recursive:true});
    await writeFile(join(root,'docs',b.articles[0]!.canonicalPath.slice(1)),'legacy sentinel');
    await expect(generate()).rejects.toThrow('SEO90_EXISTING_ARTICLE_COLLISION');
    expect(await file(b.articles[0]!.canonicalPath.slice(1))).toBe('legacy sentinel');
  });
  it('existing_content_id_collision_is_not_a_new_article',async()=>{
    await expect(preparePublicSeo90(b,{...options(),existingIds:new Set([b.articles[0]!.contentId])})).rejects.toThrow('COLLISION');
  });
  it('same_slug_on_another_date_is_still_an_existing_article_collision',async()=>{
    await expect(preparePublicSeo90(b,{...options(),existingPaths:new Set(['/posts/2026-09-24-rain-shoes.html'])})).rejects.toThrow('SEO90_EXISTING_ARTICLE_COLLISION');
  });
  it('held_private_source_never_enters_public_bytes',async()=>{
    b.approvals=[];b.releases=[];b.articles[0]!.title='PRIVATE_SENTINEL_未核准';
    await source(b);const outputs=await generate();
    for(const p of outputs)expect(await readFile(p,'utf8')).not.toContain('PRIVATE_SENTINEL');
    await expect(file('seo90-build.json')).rejects.toMatchObject({code:'ENOENT'});
    expect(await file('sitemap.xml')).not.toContain('/daily/');
  });
  it('vault_and_social_logs_cannot_grant_website_authority',async()=>{
    await mkdir(join(root,'Obsidian'),{recursive:true});await writeFile(join(root,'Obsidian','approved.json'),JSON.stringify(b));
    await mkdir(join(root,'data','posted-log'),{recursive:true});await writeFile(join(root,'data','posted-log','2099-01-01.json'),JSON.stringify(b));
    const result=await loadPublicSeo90(root,options());expect(result.pages).toEqual([]);
    b.approvals=[];await source(b);expect((await loadPublicSeo90(root,options())).pages).toEqual([]);
  });
  it('existing_sitemap_canonical_and_lastmod_stay_unchanged_when_adding_a_fixture',async()=>{
    await generate();const before=(await file('sitemap.xml')).match(/<url>[\s\S]*?<\/url>/g)!;
    await source(b);await generate();const after=await file('sitemap.xml');
    for(const entry of before)expect(after).toContain(entry);
    expect(after).toContain('<lastmod>2026-09-25T09:00:00+08:00</lastmod>');
  });
  it('service_related_links_include_only_actually_published_articles',async()=>{
    await source(b);await generate();
    expect(await file('services/shoe-bag-care.html')).toContain(`href="${b.articles[0]!.canonicalPath}"`);
    expect(await file('services/fabric-storage.html')).not.toContain(`href="${b.articles[0]!.canonicalPath}"`);
    b.approvals=[];const result=await preparePublicSeo90(b,options());expect(result.relatedByService).toEqual({});
  });
  it('rebuild_is_held_until_release_reconciliation_without_destroying_previous_pages',async()=>{
    await source(b);await generate();
    const article=await file(b.articles[0]!.canonicalPath.slice(1)),sitemap=await file('sitemap.xml');
    await expect(generate()).rejects.toThrow('SEO90_EXISTING_ARTICLE_COLLISION');
    expect(await file(b.articles[0]!.canonicalPath.slice(1))).toBe(article);expect(await file('sitemap.xml')).toBe(sitemap);
    await source(null);await expect(generate()).rejects.toThrow('SEO90_RELEASE_RECONCILIATION_REQUIRED');
    expect(await file(b.articles[0]!.canonicalPath.slice(1))).toBe(article);expect(await file('sitemap.xml')).toBe(sitemap);
  });
  it('public_asset_directory_alias_is_rejected_before_writing',async()=>{
    await source(b);await mkdir(join(root,'docs'),{recursive:true});await mkdir(join(root,'outside'));
    await symlink(join(root,'outside'),join(root,'docs','seo90-assets'),process.platform==='win32'?'junction':'dir');
    await expect(generate()).rejects.toThrow('SEO90_OUTPUT_ALIAS');
    expect(await readdir(join(root,'outside'))).toEqual([]);
  });
});
