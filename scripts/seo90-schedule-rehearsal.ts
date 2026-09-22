/** Isolated rehearsal only. Never writes docs, public-ready, approval or live release journals. */
import {readFile, mkdir, writeFile, realpath} from 'node:fs/promises';
import {resolve, join, dirname, basename} from 'node:path';
import {strict as assert} from 'node:assert';
import {bytesDigest, digest, publicErrors, buildSeo90} from '../src/seo90/buildSeo90';
import type {Bundle} from '../src/seo90/types';

const [workspaceArg, outputArg] = process.argv.slice(2);
if (!workspaceArg || !outputArg) throw Error('Usage: rehearsal PRIVATE_WORKSPACE NEW_PRIVATE_OUTPUT');
const workspace=resolve(workspaceArg), out=resolve(outputArg);
const allowedParent=join(workspace,'notebook-seo-integration');
if(dirname(out)!==allowedParent || !/^schedule-rehearsal-[a-z0-9-]+$/.test(basename(out))) throw Error('PRIVATE_OUTPUT_REQUIRED');
if((await realpath(workspace)).toLowerCase()!==workspace.toLowerCase() || (await realpath(allowedParent)).toLowerCase()!==allowedParent.toLowerCase()) throw Error('PRIVATE_OUTPUT_REDIRECT');
// Exclusive output creation refuses an existing directory/junction. No live writer is imported.
await mkdir(out);
const raw=await readFile(join(workspace,'w10-seven-day/stores/sixiangjia/bundle.json'));
const decision=JSON.parse(await readFile(join(workspace,'notebook-seo-integration/OWNER-SCHEDULE-DECISION.json'),'utf8').then(s=>s.replace(/^\uFEFF/,'')));
assert.equal(bytesDigest(raw),decision.bundleSha256.toLowerCase(),'SOURCE_CHANGED');
assert.equal(decision.channel,'website');
const original:Bundle=JSON.parse(raw.toString('utf8'));
assert.equal(original.articles.length,7);
assert.equal(decision.entries.length,7);
assert.deepEqual(original.articles.map(a=>({contentId:a.contentId,plannedPublishAt:a.plannedPublishAt,canonicalPath:a.canonicalPath})),decision.entries);
const candidate=structuredClone(original);
candidate.registry.profileApproved=true;
candidate.assets.forEach(a=>a.review='approved');
candidate.articles.forEach(a=>a.state='approved');
const approvedAt='2026-09-22T15:00:00+08:00';
candidate.approvals=candidate.articles.map(a=>{const assets=a.assetRefs.map(id=>candidate.assets.find(x=>x.assetId===id)!);return {contentId:a.contentId,channel:'website',decision:'approved',articleSha256:digest(a),registrySha256:digest(candidate.registry),assetSha256s:assets.map(x=>x.sha256),assetManifestSha256:digest(assets),approvedBy:'SIMULATED-OWNER-SCHEDULE-REHEARSAL',approvedAt};});
// These are simulated renderer inputs, never evidence of actual publication.
candidate.releases=candidate.articles.map(a=>({contentId:a.contentId,canonicalPath:a.canonicalPath,articleSha256:digest(a),registrySha256:digest(candidate.registry),datePublished:a.plannedPublishAt,dateModified:a.plannedPublishAt,state:'published'}));
const checks=[];
for(let day=0;day<7;day++){
  const boundary=Date.parse(candidate.articles[day]!.plannedPublishAt);
  for(const [delta,expected] of [[-1,day],[0,day+1],[1,day+1]]){
    const now=new Date(boundary+delta!).toISOString();
    const eligible=candidate.articles.filter(a=>publicErrors(a,candidate,now).length===0);
    assert.equal(eligible.length,expected,now);
    checks.push({now,eligible:eligible.map(a=>a.contentId)});
  }
}
const altered=structuredClone(candidate);altered.articles[0]!.title+=' changed';
assert(publicErrors(altered.articles[0]!,altered,'2026-10-01T10:00:00+08:00').includes('WEBSITE_APPROVAL'));
const revoked=structuredClone(candidate);revoked.approvals=[];
assert.equal(revoked.articles.filter(a=>publicErrors(a,revoked,'2026-10-01T10:00:00+08:00').length===0).length,0);
const assetRoot=join(workspace,'w10-seven-day/stores/sixiangjia/assets');
const rendered=[];
for(const [label,now,expected] of [['before','2026-09-25T08:59:59+08:00',0],['first','2026-09-25T09:00:00+08:00',2],['last','2026-10-01T09:00:00+08:00',8]]){
 const result=await buildSeo90(candidate,{mode:'public',assetRoot,outputRoot:join(out,String(label)),now:String(now)});
 assert.equal(result.pages.length,expected);
 rendered.push({label,pages:result.pages.length,sitemapEntries:result.sitemapEntries.length});
}
assert.equal(bytesDigest(await readFile(join(workspace,'w10-seven-day/stores/sixiangjia/bundle.json'))),bytesDigest(raw));
const report={purpose:'ISOLATED_SIMULATION_NOT_PUBLICATION',boundaryChecks:checks.length,negativeChecks:2,checks,rendered,sourceUnchanged:true,realApprovalsCreated:0,realReleasesCreated:0,deployed:false};
await writeFile(join(out,'REPORT.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({boundaryChecks:checks.length,negativeChecks:2,rendered,deployed:false}));
