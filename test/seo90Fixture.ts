import {mkdtemp,writeFile,readFile,readdir,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {articleErrors,assetErrors,buildSeo90,bytesDigest,digest,measurementSummary,publicErrors} from '../src/seo90/buildSeo90';
import type {Bundle} from '../src/seo90/types';
export async function makeSeo90Fixture(){
let root:string,b:Bundle;
const renew=()=>{const a=b.articles[0]!;b.approvals=[{contentId:a.contentId,channel:'website',decision:'approved',articleSha256:digest(a),registrySha256:digest(b.registry),assetSha256s:b.assets.map(x=>x.sha256),assetManifestSha256:digest(b.assets),approvedBy:'fixture-owner',approvedAt:'2026-09-24T10:00:00+08:00'}];b.releases=[{contentId:a.contentId,canonicalPath:a.canonicalPath,articleSha256:digest(a),registrySha256:digest(b.registry),datePublished:'2026-09-25T09:00:00+08:00',dateModified:'2026-09-25T09:00:00+08:00',state:'published'}];};

  root=await mkdtemp(join(tmpdir(),'seo90-'));
  b={registry:{storeId:'sxj',brand:'私享家洗衣店',baseUrl:'https://sixiangjialaundry.com',profileApproved:true,cta:{id:'line-photo-assessment',path:'/go/line.html',label:'LINE 傳照片詢問'},services:{wash:{confirmed:true,path:'/services/shoe-bag-care.html',assertions:['photo-assessment']}},clusters:{shoes:{label:'鞋包照顧',path:'/services/shoe-bag-care.html'}}},assets:[],approvals:[],releases:[],articles:[{schemaVersion:'sxj.seo90.article.v1',contentId:'rain-shoes',seriesId:'sxj90',dayNumber:1,storeId:'sxj',title:'皮鞋遇雨，送洗前要拍哪些位置？',slug:'rain-shoes',summary:'用清楚的照片與描述協助門市評估。',directAnswer:'先拍整雙、雨痕邊緣、鞋內材質，再說明何時遇雨、是否自行擦拭；照片協助初步溝通，實際處理方式與費用仍由門市確認。',sections:['全貌','雨痕','材質','交接'].map(heading=>({heading,body:(heading+'：說明衣物原先的狀況、發生時間及曾做的處理；不確定的材質不要猜測，門市看照片後仍可能需要現場檢查。').repeat(8)})),faq:[{question:'照片能保證結果嗎？',answer:'不能，實際處理仍須由門市檢查材質與現況。'},{question:'先拍哪裡？',answer:'先拍完整外觀與有疑慮的細節，保留自然色彩。'}],clusterId:'shoes',serviceId:'wash',serviceAssertions:['photo-assessment'],plannedPublishAt:'2026-09-25T09:00:00+08:00',canonicalPath:'/posts/2026-09-25-rain-shoes.html',author:'私享家洗衣店',sourceRefs:[{type:'public-fact',ref:'https://sixiangjialaundry.com/'}],assetRefs:['a0','a1','a2','a3'],ctaId:'line-photo-assessment',state:'approved'}]};
  for(let i=0;i<4;i++){const png=new PNG({width:1000,height:1250});png.data.fill(180+i);const data=PNG.sync.write(png);await writeFile(join(root,i+'.png'),data);b.assets.push({assetId:'a'+i,contentId:'rain-shoes',path:i+'.png',sha256:bytesDigest(data),width:1000,height:1250,mime:'image/png',provider:'imagegen',alt:'測試圖 '+i,caption:'合成測試，非真素材',review:'approved'});}
  renew();
return {root,b};
}
