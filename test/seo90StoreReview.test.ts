import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,readdir,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {makeSeo90Fixture} from './seo90Fixture';
import {buildSeo90,digest,bytesDigest,publicErrors} from '../src/seo90/buildSeo90';
import {rebuildStoreReview,reviewPolicy,ReviewTicket} from '../src/seo90/storeReview';
import type {Bundle} from '../src/seo90/types';
const now='2026-10-01T10:00:00+08:00';
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'seo90-two-stores-'));
  const stores:Record<string,{b:Bundle,t:ReviewTicket,dir:string}>={};
  for(const [n,id] of ['test-a','test-b'].entries()){
    const f=await makeSeo90Fixture();const b=f.b,dir=join(root,'stores',id);await mkdir(join(dir,'assets'),{recursive:true});
    b.registry.storeId=id;b.registry.brand='Synthetic '+id;b.registry.baseUrl=`https://${id}.invalid`;b.registry.cta={id:id+'-cta',path:'/inquiry/'+id,label:'Synthetic '+id};
    const a=b.articles[0]!;a.storeId=id;a.contentId=id+'-article';a.author=b.registry.brand;a.ctaId=b.registry.cta.id;a.sourceRefs=[{type:'owner-note',ref:'SYNTHETIC_TEST_ONLY'}];a.assetRefs=[];
    for(const [i,x] of b.assets.entries()){
      x.contentId=a.contentId;x.assetId=id+'-asset-'+i;a.assetRefs.push(x.assetId);
      const png=new PNG({width:1000,height:1250});png.data.fill(160+n*10+i);const data=PNG.sync.write(png);x.sha256=bytesDigest(data);await writeFile(join(dir,'assets',x.path),data);
    }
    b.approvals=[];b.releases=[];a.state='preview';
    const policy=reviewPolicy(b);await writeFile(join(dir,'bundle.json'),JSON.stringify(b));await writeFile(join(dir,'policy.json'),JSON.stringify(policy));
    stores[id]={b,t:{storeId:id,policySha256:digest(policy)},dir};
    await rm(f.root,{recursive:true,force:true}); // task-owned temp fixture only
  }
  return {root,stores};
}
async function tree(root:string):Promise<Record<string,string>>{
  const out:Record<string,string>={};
  async function walk(dir:string,prefix:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name),rel=prefix+e.name;if(e.isDirectory())await walk(p,rel+'/');else if(e.isFile())out[rel]=bytesDigest(await readFile(p));else out[rel]='link';}}
  await walk(root,'');return out;
}
async function withFixture(fn:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){const f=await setup();try{await fn(f);}finally{await rm(f.root,{recursive:true,force:true});}}
describe('trusted two-store private rebuild',()=>{
  it('both stores build with distinct bytes, brands and inquiry targets; deterministic relocation',()=>withFixture(async f=>{
    for(const [id,s] of Object.entries(f.stores)){
      const r=await rebuildStoreReview(f.root,s.t,'first',now);expect(r.report).toMatchObject({articles:1,pages:2,assets:4,publicEligibilityChecked:false,approvalsCreated:0});
      const html=await readFile(join(r.out,s.b.articles[0]!.canonicalPath),'utf8');expect(html).toContain(s.b.registry.brand);expect(html).toContain('noindex,nofollow');expect(html).not.toContain(id==='test-a'?'Synthetic test-b':'Synthetic test-a');
      expect(html).toContain('href="../daily/index.html"');
    }
    const relocated=join(f.root,'中文 空白路徑');await mkdir(relocated);await cp(join(f.root,'stores'),join(relocated,'stores'),{recursive:true});
    for(const s of Object.values(f.stores)){const r=await rebuildStoreReview(relocated,s.t,'relocated',now);expect(await tree(r.out)).toEqual(await tree(join(f.root,'builds',s.t.storeId,'first')));}
  }));
  const attacks:[string,(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>,string][]=[
    ['whole foreign bundle',async f=>{f.stores['test-b']!.b=structuredClone(f.stores['test-a']!.b);},'REVIEW_STORE_MISMATCH'],
    ['foreign article store',async f=>{f.stores['test-b']!.b.articles[0]!.storeId='test-a';},'REVIEW_STORE_MISMATCH'],
    ['foreign CTA path',async f=>{f.stores['test-b']!.b.registry.cta.path=f.stores['test-a']!.b.registry.cta.path;},'REVIEW_REGISTRY_PIN'],
    ['foreign base URL',async f=>{f.stores['test-b']!.b.registry.baseUrl=f.stores['test-a']!.b.registry.baseUrl;},'REVIEW_REGISTRY_PIN'],
    ['rebound foreign image bytes',async f=>{const a=f.stores['test-a']!,b=f.stores['test-b']!;await cp(join(a.dir,'assets','0.png'),join(b.dir,'assets','0.png'));b.b.assets[0]!.sha256=a.b.assets[0]!.sha256;},'REVIEW_ASSET_PIN'],
    ['foreign approval',async f=>{f.stores['test-b']!.b.approvals=[{contentId:'test-a-article',channel:'website',decision:'approved',articleSha256:'a'.repeat(64),registrySha256:'a'.repeat(64),assetSha256s:[],assetManifestSha256:'a'.repeat(64),approvedBy:'synthetic-test-a',approvedAt:now}];},'REVIEW_BUNDLE_PIN'],
    ['content edit after policy',async f=>{f.stores['test-b']!.b.articles[0]!.title='Changed';},'REVIEW_BUNDLE_PIN'],
    ['asset file corruption',async f=>{await writeFile(join(f.stores['test-b']!.dir,'assets','0.png'),'not png');},'REVIEW_ASSET_BYTES'],
    ['policy swapped',async f=>{await cp(join(f.stores['test-a']!.dir,'policy.json'),join(f.stores['test-b']!.dir,'policy.json'));},'REVIEW_POLICY_PIN'],
  ];
  for(const [name,attack,error] of attacks)it('rejects '+name+' before output without touching the other store',()=>withFixture(async f=>{
    const a=f.stores['test-a']!,b=f.stores['test-b']!;await rebuildStoreReview(f.root,a.t,'baseline',now);const before=await tree(join(f.root,'builds','test-a'));const aInputs=await tree(a.dir);
    await attack(f);await writeFile(join(b.dir,'bundle.json'),JSON.stringify(b.b));
    await expect(rebuildStoreReview(f.root,b.t,'rejected',now)).rejects.toThrow(error);
    expect(await tree(a.dir)).toEqual(aInputs);expect(await tree(join(f.root,'builds','test-a'))).toEqual(before);expect((await readdir(join(f.root,'builds')))).not.toContain('test-b');
  }));
  it('documents original preview accepting cross-brand reassigned bytes',()=>withFixture(async f=>{
    const a=f.stores['test-a']!,b=f.stores['test-b']!;await cp(join(a.dir,'assets','0.png'),join(b.dir,'assets','0.png'));b.b.assets[0]!.sha256=a.b.assets[0]!.sha256;
    const r=await buildSeo90(b.b,{mode:'preview',assetRoot:join(b.dir,'assets'),outputRoot:join(f.root,'baseline-gap'),now});expect(r.held).toEqual([]);expect(r.pages).toHaveLength(2);
  }));
  it('rejects foreign policy even when caller pins its hash under the wrong store',()=>withFixture(async f=>{
    const a=f.stores['test-a']!,b=f.stores['test-b']!;await cp(join(a.dir,'policy.json'),join(b.dir,'policy.json'));
    await expect(rebuildStoreReview(f.root,{storeId:'test-b',policySha256:a.t.policySha256},'bad',now)).rejects.toThrow('REVIEW_POLICY_STORE');
  }));
  it('rejects traversal and existing output; preserves sentinel files',()=>withFixture(async f=>{
    const s=f.stores['test-a']!;await expect(rebuildStoreReview(f.root,s.t,'../test-b',now)).rejects.toThrow('REVIEW_BAD_TICKET');
    const r=await rebuildStoreReview(f.root,s.t,'first',now);await writeFile(join(r.out,'sentinel.txt'),'keep');const old=await tree(r.out);
    await expect(rebuildStoreReview(f.root,s.t,'first',now)).rejects.toThrow('REVIEW_OUTPUT_EXISTS');expect(await tree(r.out)).toEqual(old);
  }));
  it('rejects real Windows junction or Unix symlink at output and assets roots',()=>withFixture(async f=>{
    const b=f.stores['test-b']!,a=f.stores['test-a']!;await mkdir(join(f.root,'builds'));
    await symlink(a.dir,join(f.root,'builds','test-b'),process.platform==='win32'?'junction':'dir');
    await expect(rebuildStoreReview(f.root,b.t,'bad',now)).rejects.toThrow('REVIEW_LINK_REJECTED');
    await rm(join(f.root,'builds','test-b'));await rm(join(b.dir,'assets'),{recursive:true});await symlink(join(a.dir,'assets'),join(b.dir,'assets'),process.platform==='win32'?'junction':'dir');
    await expect(rebuildStoreReview(f.root,b.t,'bad',now)).rejects.toThrow('REVIEW_LINK_REJECTED');
  }));
  it('synthetic B public approval genuinely passes first, then rejects an approval from A',()=>withFixture(async f=>{
    const b=f.stores['test-b']!.b,a=b.articles[0]!;a.state='approved';b.registry.profileApproved=true;
    b.approvals=[{contentId:a.contentId,channel:'website',decision:'approved',articleSha256:digest(a),registrySha256:digest(b.registry),assetSha256s:b.assets.map(x=>x.sha256),assetManifestSha256:digest(b.assets),approvedBy:'SYNTHETIC-TEST-ONLY',approvedAt:'2026-09-24T10:00:00+08:00'}];
    b.releases=[{contentId:a.contentId,canonicalPath:a.canonicalPath,articleSha256:digest(a),registrySha256:digest(b.registry),datePublished:'2026-09-25T09:00:00+08:00',dateModified:'2026-09-25T09:00:00+08:00',state:'published'}];
    expect(publicErrors(a,b,now)).toEqual([]);
    const r=await buildSeo90(b,{mode:'public',assetRoot:join(f.stores['test-b']!.dir,'assets'),outputRoot:join(f.root,'synthetic-public-only'),now});expect(r.pages).toHaveLength(2);expect(r.sitemapEntries).toHaveLength(2);
    b.approvals[0]!.registrySha256=digest(f.stores['test-a']!.b.registry);expect(publicErrors(a,b,now)).toContain('WEBSITE_APPROVAL');
  }));
});
