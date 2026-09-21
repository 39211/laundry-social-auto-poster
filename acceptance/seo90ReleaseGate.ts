/**
 * Synthetic-only black-box contract for the actual public generator.
 * Exit 0: contract passed; 1: product gap; 2: harness/setup error.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,copyFile,writeFile,readFile,readdir,realpath,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {preparePublicSeo90} from '../src/seo90/publicBundle';
import {digest} from '../src/seo90/buildSeo90';
import {makeSeo90Fixture} from '../test/seo90Fixture';
import type {Bundle} from '../src/seo90/types';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseUrl='https://sixiangjialaundry.com',now='2026-09-26T09:00:00+08:00';
const sentinelPath='unrelated-owner-sentinel.txt',sentinel='Unrelated owner content must remain intact.\n';
const marker='新版已核准內容標記';
type Row={id:string;passed:boolean;observed:Record<string,unknown>};
type Fixture={root:string;b:Bundle};
const allocated=new Set<string>();
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,500);
async function exists(path:string){
 try{await access(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
}
async function text(root:string,path:string){
 const p=join(root,'docs',path);return await exists(p)?readFile(p,'utf8'):'';
}
async function snapshot(root:string){
 const result:Record<string,string>={};
 async function visit(path:string,prefix=''){
  for(const e of await readdir(path,{withFileTypes:true})){
   assert(!e.isSymbolicLink(),'Unexpected symlink in synthetic output');
   const rel=prefix+e.name;
   if(e.isDirectory())await visit(join(path,e.name),rel+'/');
   else if(e.isFile())result[rel]=createHash('sha256').update(await readFile(join(path,e.name))).digest('hex');
  }
 }
 await visit(join(root,'docs'));return result;
}
const differences=(a:Record<string,string>,b:Record<string,string>)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(p=>a[p]!==b[p]).sort();
function articleDates(html:string):Record<string,unknown>|null{
 const nodes:Record<string,unknown>[]=[];
 for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)){
  try{
   const parsed=JSON.parse(match[1]!) as Record<string,unknown>;
   const items=Array.isArray(parsed)?parsed:Array.isArray(parsed['@graph'])?parsed['@graph']:[parsed];
   for(const item of items)if(item&&['Article','BlogPosting'].includes(item['@type']))nodes.push(item);
  }catch{/* Invalid/missing Article metadata cannot pass the date checks. */}
 }
 return nodes.length===1?nodes[0]!:null;
}
function sitemapDate(xml:string,url:string):string|null{
 const matches=[...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].filter(m=>m[1]!.includes('<loc>'+url+'</loc>'));
 return matches.length===1?matches[0]![1]!.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]??null:null;
}
const sameTime=(actual:unknown,expected:string)=>typeof actual==='string'&&Number.isFinite(Date.parse(actual))&&Date.parse(actual)===Date.parse(expected);
const sitemapUrls=(xml:string)=>[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]!).sort();
function serviceCore(html:string):string|null{
 const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
 if(main===undefined)return null;
 return main.replace(/<section\b[^>]*>\s*<h2>送洗前實用筆記<\/h2>[\s\S]*?<\/section>/g,'').trim();
}
async function saveSource({root,b}:Fixture){
 const folder=join(root,'content','seo90');await mkdir(join(folder,'public-assets'),{recursive:true});
 for(const path of new Set(b.assets.map(x=>x.path)))await copyFile(join(root,path),join(folder,'public-assets',path));
 await writeFile(join(folder,'public-ready.json'),JSON.stringify({schemaVersion:'sxj.seo90.public-source.v1',bundle:b}));
}
const generate=async(root:string)=>(await import('../src/generatePublicSite')).generatePublicSite({root,siteBaseUrl:baseUrl,now});
const prepare=(f:Fixture)=>preparePublicSeo90(f.b,{assetRoot:f.root,now,baseUrl,existingPaths:new Set(),existingIds:new Set()});
async function addProtectedArticle(f:Fixture){
 const other=structuredClone(f.b.articles[0]!);other.contentId='protected-other-article';other.title='需保留的另一篇文章';other.slug='protected-other-article';other.canonicalPath='/posts/2026-09-26-protected-other-article.html';other.dayNumber=2;other.plannedPublishAt='2026-09-26T08:00:00+08:00';other.assetRefs=[];
 const assets=[];
 for(let i=0;i<4;i++){
  const original=f.b.assets[i]!,png=new PNG({width:original.width,height:original.height});png.data.fill(90+i);
  const data=PNG.sync.write(png),path='protected-'+i+'.png';await writeFile(join(f.root,path),data);
  const asset={...original,assetId:'protected-'+i,contentId:other.contentId,path,sha256:createHash('sha256').update(data).digest('hex')};assets.push(asset);other.assetRefs.push(asset.assetId);
 }
 f.b.articles.push(other);f.b.assets.push(...assets);
 f.b.approvals.push({...f.b.approvals[0]!,contentId:other.contentId,articleSha256:digest(other),assetSha256s:assets.map(x=>x.sha256),assetManifestSha256:digest(assets),approvedAt:'2026-09-26T07:00:00+08:00'});
 f.b.releases.push({...f.b.releases[0]!,contentId:other.contentId,canonicalPath:other.canonicalPath,articleSha256:digest(other),datePublished:other.plannedPublishAt,dateModified:other.plannedPublishAt});
}
async function initial(f:Fixture){
 const a=f.b.articles[0]!,p=await prepare(f);
 assert(p.pages.some(x=>x.path===a.canonicalPath),'Initial fixture must be eligible');
 await saveSource(f);await generate(f.root);
 assert((await text(f.root,a.canonicalPath.slice(1))).includes(a.title),'Initial article missing');
 assert((await text(f.root,'daily/index.html')).includes(a.canonicalPath),'Initial daily link missing');
 assert((await text(f.root,'sitemap.xml')).includes(baseUrl+a.canonicalPath),'Initial sitemap entry missing');
 const dates=articleDates(await text(f.root,a.canonicalPath.slice(1)));
 assert(sameTime(dates?.datePublished,f.b.releases[0]!.datePublished)&&sameTime(dates?.dateModified,f.b.releases[0]!.dateModified),'Initial Article metadata missing');
 for(const x of f.b.assets)assert(await exists(join(f.root,'docs','seo90-assets',x.sha256+'.png')),'Initial asset missing');
 assert.equal(await text(f.root,sentinelPath),sentinel,'Unrelated content changed');
}
async function fixture<T>(run:(f:Fixture)=>Promise<T>):Promise<T>{
 const f=await makeSeo90Fixture(),absolute=await realpath(f.root),oldCwd=process.cwd();allocated.add(absolute);
 try{
  assert.equal(dirname(absolute).toLowerCase(),(await realpath(tmpdir())).toLowerCase(),'Fixture outside temp root');
  assert(basename(absolute).startsWith('seo90-'),'Unexpected fixture directory');
  await mkdir(join(f.root,'data'),{recursive:true});
  await copyFile(join(repo,'data','business-profile.json'),join(f.root,'data','business-profile.json'));
  await mkdir(join(f.root,'docs'),{recursive:true});await writeFile(join(f.root,'docs',sentinelPath),sentinel);
  process.chdir(f.root);return await run(f);
 }finally{
  process.chdir(oldCwd);
  // Confirm exact task-owned absolute target before recursive Windows cleanup.
  const current=await realpath(f.root);
  assert(allocated.has(current)&&current===absolute&&dirname(current).toLowerCase()===(await realpath(tmpdir())).toLowerCase(),'Cleanup target changed');
  await rm(current,{recursive:true,force:false});allocated.delete(current);
 }
}
async function attempt(root:string){try{await generate(root);return null;}catch(e){return errorText(e);}}
async function run():Promise<Row[]>{
 const rows:Row[]=[];
 await fixture(async f=>{
  await initial(f);
  rows.push({id:'R0_APPROVED_INITIAL_RELEASE',passed:true,observed:{article:true,daily:true,sitemap:true,assets:4,unrelatedPreserved:true}});
  const before=await snapshot(f.root),error=await attempt(f.root),after=await snapshot(f.root),changed=differences(before,after);
  rows.push({id:'R1_REPEAT_IS_NOOP',passed:error===null&&changed.length===0,observed:{error,changed}});
 });
 await fixture(async f=>{
  await initial(f);const a=f.b.articles[0]!,originalPublished=f.b.releases[0]!.datePublished;
  a.title=marker;f.b.approvals[0]!.articleSha256=digest(a);f.b.approvals[0]!.approvedAt='2026-09-26T08:00:00+08:00';
  f.b.releases[0]!.articleSha256=digest(a);f.b.releases[0]!.dateModified='2026-09-26T08:30:00+08:00';
  const proof=await prepare(f);assert(proof.pages.some(x=>x.path===a.canonicalPath&&x.bytes.toString().includes(marker)),'Update fixture is invalid');
  await saveSource(f);const error=await attempt(f.root);
  const html=await text(f.root,a.canonicalPath.slice(1)),dates=articleDates(html),service=await text(f.root,'services/shoe-bag-care.html');
  const articleUpdated=html.includes(marker),dailyUpdated=(await text(f.root,'daily/index.html')).includes(marker),unrelatedPreserved=await text(f.root,sentinelPath)===sentinel;
  const datePublishedPreserved=sameTime(dates?.datePublished,originalPublished),dateModifiedUpdated=sameTime(dates?.dateModified,f.b.releases[0]!.dateModified);
  const sitemapUpdated=sameTime(sitemapDate(await text(f.root,'sitemap.xml'),baseUrl+a.canonicalPath),f.b.releases[0]!.dateModified),serviceUpdated=service.includes(marker)&&service.includes(a.canonicalPath);
  rows.push({id:'R2_APPROVED_UPDATE',passed:!error&&articleUpdated&&dailyUpdated&&unrelatedPreserved&&datePublishedPreserved&&dateModifiedUpdated&&sitemapUpdated&&serviceUpdated,observed:{error,articleUpdated,dailyUpdated,unrelatedPreserved,datePublishedPreserved,dateModifiedUpdated,sitemapUpdated,serviceUpdated}});
 });
 await fixture(async f=>{
  await addProtectedArticle(f);await initial(f);const a=f.b.articles[0]!,other=f.b.articles[1]!;
  const prior=await snapshot(f.root),urlsBefore=sitemapUrls(await text(f.root,'sitemap.xml')),coreBefore=serviceCore(await text(f.root,'services/shoe-bag-care.html'));
  const targetAssets=f.b.assets.filter(x=>a.assetRefs.includes(x.assetId)),protectedPaths=[other.canonicalPath.slice(1),...f.b.assets.filter(x=>other.assetRefs.includes(x.assetId)).map(x=>'seo90-assets/'+x.sha256+'.png')];
  assert(protectedPaths.every(p=>prior[p]),'Protected article/assets missing before withdrawal');
  assert(coreBefore&&coreBefore.length>100,'Service core precondition missing');
  assert((await text(f.root,'daily/index.html')).includes(other.canonicalPath)&&urlsBefore.includes(baseUrl+other.canonicalPath),'Protected aggregate entries missing before withdrawal');
  a.state='withdrawn';f.b.releases[0]!.state='withdrawn';
  await saveSource(f);const error=await attempt(f.root);
  const articleRemoved=!(await exists(join(f.root,'docs',a.canonicalPath.slice(1)))),dailyUnlinked=!(await text(f.root,'daily/index.html')).includes(a.canonicalPath),sitemapUnlinked=!(await text(f.root,'sitemap.xml')).includes(baseUrl+a.canonicalPath),serviceUnlinked=!(await text(f.root,'services/shoe-bag-care.html')).includes(a.canonicalPath);
  const remainingAssets=(await Promise.all(targetAssets.map(x=>exists(join(f.root,'docs','seo90-assets',x.sha256+'.png'))))).filter(Boolean).length,unrelatedPreserved=await text(f.root,sentinelPath)===sentinel;
  const after=await snapshot(f.root),protectedArticleAssetsPreserved=protectedPaths.every(p=>after[p]===prior[p]);
  const dailyProtectedEntry=(await text(f.root,'daily/index.html')).includes(other.canonicalPath),serviceProtectedEntry=(await text(f.root,'services/shoe-bag-care.html')).includes(other.canonicalPath);
  const sitemapOthersPreserved=JSON.stringify(sitemapUrls(await text(f.root,'sitemap.xml')))===JSON.stringify(urlsBefore.filter(url=>url!==baseUrl+a.canonicalPath));
  const serviceCorePreserved=serviceCore(await text(f.root,'services/shoe-bag-care.html'))===coreBefore;
  rows.push({id:'R3_WITHDRAW_OWN_RELEASE',passed:!error&&articleRemoved&&dailyUnlinked&&sitemapUnlinked&&serviceUnlinked&&remainingAssets===0&&unrelatedPreserved&&protectedArticleAssetsPreserved&&dailyProtectedEntry&&serviceProtectedEntry&&sitemapOthersPreserved&&serviceCorePreserved,observed:{error,articleRemoved,dailyUnlinked,sitemapUnlinked,serviceUnlinked,remainingAssets,unrelatedPreserved,protectedArticleAssetsPreserved,dailyProtectedEntry,serviceProtectedEntry,sitemapOthersPreserved,serviceCorePreserved}});
 });
 await fixture(async f=>{
  await initial(f);const before=await snapshot(f.root);
  f.b.articles[0]!.title='未重新核准的新內容'; // Deliberately retain old approval/release hashes.
  assert.equal((await prepare(f)).pages.length,0,'Stale-approval fixture unexpectedly eligible');
  await saveSource(f);const error=await attempt(f.root),after=await snapshot(f.root),changed=differences(before,after);
  rows.push({id:'R4_STALE_APPROVAL_PRESERVES_PUBLIC_TREE',passed:changed.length===0,observed:{error,changed}});
 });
 await fixture(async f=>{
  await initial(f);const a=f.b.articles[0]!,urlsBefore=sitemapUrls(await text(f.root,'sitemap.xml')),coreBefore=serviceCore(await text(f.root,'services/shoe-bag-care.html'));
  assert(coreBefore&&coreBefore.length>100,'Last-withdrawal service core precondition missing');
  a.state='withdrawn';f.b.releases[0]!.state='withdrawn';await saveSource(f);const error=await attempt(f.root);
  const articleRemoved=!(await exists(join(f.root,'docs',a.canonicalPath.slice(1)))),dailyRemoved=!(await exists(join(f.root,'docs','daily/index.html')));
  const remainingAssets=(await Promise.all(f.b.assets.map(x=>exists(join(f.root,'docs','seo90-assets',x.sha256+'.png'))))).filter(Boolean).length;
  const wanted=urlsBefore.filter(url=>url!==baseUrl+a.canonicalPath&&url!==baseUrl+'/daily/');
  const sitemapOthersPreserved=JSON.stringify(sitemapUrls(await text(f.root,'sitemap.xml')))===JSON.stringify(wanted);
  const service=await text(f.root,'services/shoe-bag-care.html'),serviceCorePreserved=serviceCore(service)===coreBefore,serviceUnlinked=!service.includes(a.canonicalPath);
  const tree=await snapshot(f.root),danglingDailyLinks:string[]=[];
  for(const path of Object.keys(tree).filter(p=>p.endsWith('.html')))if((await text(f.root,path)).includes('href="/daily/"'))danglingDailyLinks.push(path);
  const unrelatedPreserved=await text(f.root,sentinelPath)===sentinel;
  rows.push({id:'R5_LAST_WITHDRAWAL',passed:!error&&articleRemoved&&dailyRemoved&&remainingAssets===0&&sitemapOthersPreserved&&serviceCorePreserved&&serviceUnlinked&&danglingDailyLinks.length===0&&unrelatedPreserved,observed:{error,articleRemoved,dailyRemoved,remainingAssets,sitemapOthersPreserved,serviceCorePreserved,serviceUnlinked,danglingDailyLinks,unrelatedPreserved}});
 });
 return rows;
}
async function main(){
 const args=process.argv.slice(2);
 assert(args.length===2&&args[0]==='--report'&&/^[a-zA-Z0-9_.-]+\.json$/.test(args[1]!),'Usage: tsx acceptance/seo90ReleaseGate.ts --report NAME.json');
 const path=join(repo,'..','evidence',args[1]!);await mkdir(dirname(path),{recursive:true});assert(!(await exists(path)),'Evidence exists; use a new report name');
 for(const key of Object.keys(process.env))if(key.endsWith('API_KEY'))delete process.env[key];
 process.env.PUBLIC_SITE_BASE_URL=baseUrl;
 globalThis.fetch=async()=>{throw new Error('Network forbidden in release contract probe');};
 let result:Record<string,unknown>,exit:number;
 try{
  const rows=await run();
  assert.deepEqual(rows.map(x=>x.id),['R0_APPROVED_INITIAL_RELEASE','R1_REPEAT_IS_NOOP','R2_APPROVED_UPDATE','R3_WITHDRAW_OWN_RELEASE','R4_STALE_APPROVAL_PRESERVES_PUBLIC_TREE','R5_LAST_WITHDRAWAL'],'Missing or duplicate contract cases');
  const passed=rows.filter(x=>x.passed).length;
  const sourceFiles=await Promise.all(['src/generatePublicSite.ts','src/seo90/publicBundle.ts','src/seo90/buildSeo90.ts','test/seo90Fixture.ts'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(join(repo,path))).digest('hex')})));
  result={schemaVersion:'sxj.seo90.release-contract.v1',generatedAt:new Date().toISOString(),evaluationNow:now,syntheticOnly:true,sourceFiles,verdict:passed===rows.length?'GO_CONTRACT_ONLY':'NO_GO_RELEASE_RECONCILIATION',passed,total:rows.length,rows,remainingTempRoots:allocated.size,notCovered:['crash recovery','concurrent release writers','shared assets across multiple articles','deployment','real owner approval']};exit=passed===rows.length?0:1;
 }catch(e){result={verdict:'HARNESS_ERROR',error:errorText(e),remainingTempRoots:allocated.size};exit=2;}
 await writeFile(path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({verdict:result.verdict,passed:result.passed,total:result.total,report:path,remainingTempRoots:allocated.size}));process.exitCode=exit;
}
main().catch(e=>{console.error(errorText(e));process.exitCode=2;});
