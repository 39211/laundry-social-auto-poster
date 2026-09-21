import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, dirname } from 'node:path';
import type { Bundle } from './types';
import { prepareSeo90, renderArticle, renderDailyIndex } from './buildSeo90';

export interface PublicPage { path: string; bytes: Buffer; contentId?: string }
export interface PublicSeo90 {
  pages: PublicPage[];
  sitemapEntries: string[];
  relatedByService: Record<string, {title: string; path: string}[]>;
  dailyIndexPath?: string;
  diagnostics: {contentId: string; reasons: string[]}[];
}
const empty = ():PublicSeo90 => ({pages:[],sitemapEntries:[],relatedByService:{},diagnostics:[]});
const xml = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));

/** Reads and validates assets, returns immutable bytes; never writes docs or private reports. */
export async function preparePublicSeo90(bundle:Bundle, options:{
  assetRoot:string; now:string; baseUrl:string;
  existingPaths:ReadonlySet<string>; existingIds:ReadonlySet<string>;
}):Promise<PublicSeo90> {
  if (!bundle?.registry || bundle.registry.baseUrl.replace(/\/$/,'') !== options.baseUrl.replace(/\/$/,'')) throw Error('SEO90_ORIGIN_MISMATCH');
  const {eligible,held,frozen}=await prepareSeo90(bundle,{mode:'public',assetRoot:options.assetRoot,now:options.now});
  const output=empty();output.diagnostics=held;
  if(!eligible.length)return output;
  const paths=new Set([...options.existingPaths].map(p=>p.toLowerCase()));
  const slugs=new Set([...paths].filter(p=>p.startsWith('/posts/')).map(p=>p.split('/').pop()!.replace(/\.html$/,'').replace(/^\d{4}-\d{2}-\d{2}-/,'')));
  for(const {article:a} of eligible){
    if(paths.has(a.canonicalPath.toLowerCase()) || slugs.has(a.slug.toLowerCase()) || options.existingIds.has(a.contentId)) throw Error('SEO90_EXISTING_ARTICLE_COLLISION');
  }
  if(paths.has('/daily/')||paths.has('/daily/index.html'))throw Error('SEO90_EXISTING_INDEX_COLLISION');
  const addedAssets=new Set<string>();
  for(const {article:a,assets} of eligible){
    for(const asset of assets){
      const path=`/seo90-assets/${asset.sha256}.png`;
      if(!addedAssets.has(path)){output.pages.push({path,bytes:Buffer.from(frozen.get(asset.assetId)!)});addedAssets.add(path);}
    }
    const release=bundle.releases.find(r=>r.contentId===a.contentId)!;
    output.pages.push({path:a.canonicalPath,contentId:a.contentId,bytes:Buffer.from(renderArticle(a,assets,bundle.registry,false,release))});
    output.sitemapEntries.push(`<url><loc>${xml(bundle.registry.baseUrl+a.canonicalPath)}</loc><lastmod>${xml(release.dateModified)}</lastmod></url>`);
    const servicePath=bundle.registry.services[a.serviceId]!.path;
    (output.relatedByService[servicePath]??=[]).push({title:a.title,path:a.canonicalPath});
  }
  output.dailyIndexPath='/daily/';
  output.pages.push({path:'/daily/index.html',bytes:Buffer.from(renderDailyIndex(eligible,bundle.registry,false))});
  output.sitemapEntries.unshift(`<url><loc>${xml(bundle.registry.baseUrl+'/daily/')}</loc></url>`);
  return output;
}

async function contained(root:string,path:string):Promise<string>{
  const resolved=await realpath(path), rel=relative(await realpath(root),resolved);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('SEO90_SOURCE_ESCAPE');
  return resolved;
}

/** Only this checked-in allowlist can feed the formal generator. No Vault/social-log discovery. */
export async function loadPublicSeo90(root:string, options:{now:string;baseUrl:string;existingPaths:ReadonlySet<string>;existingIds:ReadonlySet<string>}):Promise<PublicSeo90>{
  const source=join(root,'content','seo90','public-ready.json');
  let document:any;
  try{document=JSON.parse(await readFile(await contained(root,source),'utf8'));}
  catch(error:any){if(error.code==='ENOENT')return empty();throw error;}
  if(!document||document.schemaVersion!=='sxj.seo90.public-source.v1')throw Error('SEO90_INVALID_PUBLIC_SOURCE');
  if(document.bundle===null)return empty();
  const assetRoot=await contained(root,join(root,'content','seo90','public-assets'));
  return preparePublicSeo90(document.bundle,{...options,assetRoot});
}

/** Existing published post paths are reserved, including files not present in today's index. */
export async function existingSeo90Paths(docsRoot:string):Promise<Set<string>>{
  const result=new Set<string>();
  async function collect(directory:string,prefix:string):Promise<void>{
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error:any){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      const path=prefix+'/'+entry.name;
      if(entry.isSymbolicLink())throw Error('SEO90_EXISTING_PATH_SYMLINK');
      if(entry.isDirectory())await collect(join(directory,entry.name),path);else result.add(path);
    }
  }
  await collect(join(docsRoot,'posts'),'/posts');
  await collect(join(docsRoot,'daily'),'/daily');
  return result;
}

/** Check the whole write set before the sole writer starts; reject reparse-point aliases. */
export async function assertSeo90Destinations(root:string,pages:PublicPage[]):Promise<void>{
  const physicalRoot=await realpath(root);
  const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  for(const page of pages){
    let target=join(physicalRoot,'docs',page.path.slice(1));
    for(;;){
      try{if(!same(await realpath(target),target))throw Error('SEO90_OUTPUT_ALIAS');break;}
      catch(error:any){if(error.code!=='ENOENT')throw error;const parent=dirname(target);if(parent===target)throw error;target=parent;}
    }
  }
}
