/** Local review factory. A trusted caller pins store + policy SHA independently
 * of the candidate. This is not a publishing or tenant authorization endpoint. */
import {readFile, writeFile, lstat, realpath, mkdir} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, join} from 'node:path';
import {buildSeo90, prepareSeo90, bytesDigest, digest} from './buildSeo90';
import type {Bundle} from './types';

export type ReviewPolicy = {
  schema: 'seo90.store-review.v1'; storeId:string; purpose:'private-preview';
  bundleSha256:string; registrySha256:string; assetManifestSha256:string;
};
export type ReviewTicket = {storeId:string; policySha256:string};
const id=(v:string)=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
const hash=(v:string)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function reviewPolicy(bundle:Bundle):ReviewPolicy {
  return {schema:'seo90.store-review.v1',storeId:bundle.registry.storeId,purpose:'private-preview',
    bundleSha256:digest(bundle),registrySha256:digest(bundle.registry),assetManifestSha256:digest(bundle.assets)};
}
// Disallow junction/symlink components even when they still resolve inside the
// workspace. The workspace itself is the caller's trusted local boundary.
async function physicalChild(root:string, target:string, missing=false) {
  const rel=relative(root,target);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('REVIEW_PATH_ESCAPE');
  let current=root;
  for(const part of rel.split(sep)){
    current=join(current,part);
    try {if((await lstat(current)).isSymbolicLink())throw Error('REVIEW_LINK_REJECTED');}
    catch(e:any){if(missing&&e.code==='ENOENT')break;throw e;}
  }
  return target;
}
export async function rebuildStoreReview(workspace:string,ticket:ReviewTicket,run:string,now:string){
  if(!id(ticket.storeId)||!id(run)||!hash(ticket.policySha256))throw Error('REVIEW_BAD_TICKET');
  if(!Number.isFinite(Date.parse(now)))throw Error('REVIEW_BAD_TIME');
  const root=await realpath(workspace);
  const store=await physicalChild(root,resolve(root,'stores',ticket.storeId));
  const policyPath=await physicalChild(root,join(store,'policy.json'));
  const policy:ReviewPolicy=JSON.parse(await readFile(policyPath,'utf8'));
  if(digest(policy)!==ticket.policySha256)throw Error('REVIEW_POLICY_PIN');
  if(policy.schema!=='seo90.store-review.v1'||policy.purpose!=='private-preview'||policy.storeId!==ticket.storeId)throw Error('REVIEW_POLICY_STORE');
  const bundlePath=await physicalChild(root,join(store,'bundle.json'));
  const b:Bundle=JSON.parse(await readFile(bundlePath,'utf8'));
  if(b.registry?.storeId!==ticket.storeId||b.articles?.some(a=>a.storeId!==ticket.storeId))throw Error('REVIEW_STORE_MISMATCH');
  if(digest(b.registry)!==policy.registrySha256)throw Error('REVIEW_REGISTRY_PIN');
  if(digest(b.assets)!==policy.assetManifestSha256)throw Error('REVIEW_ASSET_PIN');
  if(digest(b)!==policy.bundleSha256)throw Error('REVIEW_BUNDLE_PIN');
  if(!b.articles.length||b.assets.length!==b.articles.length*4)throw Error('REVIEW_EMPTY_OR_EXTRA_ASSETS');
  const refs=b.articles.flatMap(a=>a.assetRefs);
  if(new Set(refs).size!==refs.length||b.assets.some(a=>!refs.includes(a.assetId)))throw Error('REVIEW_ASSET_OWNERSHIP');
  // No approval or release is consumed by a private preview. Pinning the entire
  // input still prevents accidentally copying foreign approval data into it.
  const assets=await physicalChild(root,join(store,'assets'));
  for(const x of b.assets){
    const p=await physicalChild(assets,resolve(assets,x.path));
    if(bytesDigest(await readFile(p))!==x.sha256)throw Error('REVIEW_ASSET_BYTES');
  }
  const prepared=await prepareSeo90(b,{mode:'preview',assetRoot:assets,now});
  if(prepared.held.length||prepared.eligible.length!==b.articles.length)throw Error('REVIEW_CONTENT_INVALID:'+JSON.stringify(prepared.held));
  const parent=await physicalChild(root,join(root,'builds',ticket.storeId),true);
  await mkdir(parent,{recursive:true});
  await physicalChild(root,parent);
  const out=await physicalChild(root,join(parent,run),true);
  // Exclusive reservation: a second run cannot reuse or overwrite another tree.
  try{await mkdir(out);}catch(e:any){if(e.code==='EEXIST')throw Error('REVIEW_OUTPUT_EXISTS');throw e;}
  const result=await buildSeo90(b,{mode:'preview',assetRoot:assets,outputRoot:out,now});
  if(result.held.length||result.pages.length!==b.articles.length+1)throw Error('REVIEW_BUILD_FAILED');
  for(const file of result.pages){
    await physicalChild(out,file);
    let html=await readFile(file,'utf8');
    html=html.replace('短版內容仍待編輯驗收，','內容待店主核稿，');
    html=html.replaceAll('href="../daily/"','href="../daily/index.html"');
    html=html.replace('</style>','@media(max-width:600px){.gallery{grid-template-columns:1fr!important}}\n</style>');
    await writeFile(file,html,'utf8');
  }
  const report={schema:'seo90.store-review-result.v1',storeId:ticket.storeId,policySha256:ticket.policySha256,bundleSha256:digest(b),articles:b.articles.length,pages:result.pages.length,assets:b.assets.length,mode:'private-preview',publicEligibilityChecked:false,approvalsCreated:0,deployments:0,now};
  await writeFile(join(out,'REBUILD-REPORT.json'),JSON.stringify(report,null,2)+'\n','utf8');
  return {out,report};
}
