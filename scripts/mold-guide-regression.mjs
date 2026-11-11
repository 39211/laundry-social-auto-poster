import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function moldGuideChecks(root) {
  const names = ['suit-mold-cleaning', 'down-jacket-mold-cleaning', 'plush-doll-mold-cleaning', 'wool-coat-mold-cleaning', 'sweater-mold-cleaning', 'leather-belt-mold', 'suede-shoe-mold', 'shirt-collar-mold-spots'];
  const read = p => readFileSync(resolve(root, 'seo-overrides', p), 'utf8');
  const html = Object.fromEntries(names.map(n => [n, read(`guides/${n}.html`)]));
  const answers = JSON.parse(read('answers.json')).answers;
  const summary = n => answers.find(x => x.id === `${n}-page-summary`).answer;
  const main = n => html[n].match(/<main>([\s\S]*?)<\/main>/)[1];
  const checks = [];
  const add = (name, run) => checks.push({ name, run });
  const prices = [['70','80'], ['200','280'], [], ['200','250','300'], ['150','180'], ['400'], ['400'], ['70']];
  for (const [i,n] of names.entries()) {
    add(`${n}: schema, metadata, price, date and safeguards`, () => {
      const h = html[n], m = main(n);
      const graph = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
      const page = graph.find(x => x['@type'] === 'WebPage');
      const desc = h.match(/<meta name="description" content="([^"]*)"/)[1];
      assert.equal(page.description, desc);
      for (const attr of ['property="og:description"', 'name="twitter:description"']) assert.equal(h.match(new RegExp(`<meta ${attr} content="([^"]*)"`))[1], desc);
      assert.equal(page.dateModified, '2026-11-11');
      assert.equal(page.url, `https://sixiangjialaundry.com/guides/${n}.html`);
      assert(h.includes(`<link rel="canonical" href="${page.url}"`));
      const found = [...m.matchAll(/\$(\d+)/g)].map(x => x[1]);
      assert.deepEqual([...new Set(found)].sort(), [...prices[i]].sort());
      assert.equal([...m.matchAll(/\$\d+，參考價，看過實品再報價/g)].length, found.length);
      assert(m.includes('只能淡化')); assert(!m.includes('上色覆蓋'));
      for (const token of ['參考價，看過實品再報價','免費收送','沒有最低消費','東海只有收送','以下做法先不要做']) assert(m.includes(token), token);
      assert(!/殺菌|除臭|消毒|保證|全新/.test(m));
      assert(summary(n).includes('參考價，看過實品再報價'));
      assert(!/纖維變脆[^。；]*只能淡化|硬塊[^。；]*只能淡化|硬化[^。；]*只能淡化|縮絨[^。；]*只能淡化|墊肩位移[^。；]*只能淡化/.test(m));
    });
  }
  add('suede: no brushing instructions in body, FAQ or answer feed', () => {
    const n='suede-shoe-mold', m=main(n), s=summary(n);
    for (const text of [m,s]) { assert(text.includes('先不要自行刷拭')); assert(!/軟刷只能順著毛輕刷|用軟刷順著毛輕刷|先乾刷看方向|硬塊只能淡化/.test(text)); }
    assert(m.includes('以免霉屑散開')); assert(m.includes('硬化能否改善需看實物評估'));
  });
  add('sweater: lead agrees with flat airing step', () => {
    const m=main('sweater-mold-cleaning'); assert(m.includes('先攤平於通風處')); assert(m.includes('不要掛著拉長')); assert(!m.includes('先掛通風'));
  });
  add('down jacket: separate vest price and drying uncertainty', () => {
    const m=main('down-jacket-mold-cleaning');
    assert(/<tr><td>羽絨背心<\/td><td>水洗參考價 \$200，參考價，看過實品再報價/.test(m));
    assert(/<tr><td>羽絨外套<\/td><td>水洗參考價 \$280，參考價，看過實品再報價/.test(m));
    assert(m.includes('價目表未單列羽絨褲')); assert(!m.includes('價目表沒有按這份指南單列'));
    assert(m.includes('外表乾燥不代表內部已乾透')); assert(!m.includes('裡面也不會因此變乾'));
  });
  add('shirt: no scraping diagnosis or ironing-only option on any surface', () => {
    const h=html['shirt-collar-mold-spots'], s=summary('shirt-collar-mold-spots');
    for (const text of [h,s]) assert(!/輕刮有白粉|只燙|再決定洗或燙/.test(text));
    assert(h.includes('清潔後再確認整燙')); assert(h.includes('不要自行刮擦判斷')); assert(s.includes('不要自行濕擦、刮擦或先燙'));
  });
  add('linings: no seam opening instructions', () => {
    for (const n of ['suit-mold-cleaning','wool-coat-mold-cleaning']) { const m=main(n); assert(m.includes('不拆縫')); assert(m.includes('不拉扯')); assert(!/把內襯翻出來拍|翻出裡布拍|內襯內側的霉容易漏看，請翻出來拍/.test(m)); }
    assert(!main('suit-mold-cleaning').includes('先用濕布或酒精擦霉點'));
  });
  add('plush: no guaranteed damage or unsupported fixed shop process', () => {
    const h=html['plush-doll-mold-cleaning'];
    assert(!/結死的潮味|脫水會讓|填充會結塊|五官會掉|門市做法是先固定五官再手洗/.test(h));
    assert(h.includes('脫水可能讓填充結塊')); assert(!summary('plush-doll-mold-cleaning').includes('結死的潮味'));
  });
  add('coat: storage and transport distinguished across metadata and feed', () => {
    const h=html['wool-coat-mold-cleaning'], s=summary('wool-coat-mold-cleaning');
    for(const text of [h,s]) { assert(!/不要密封|別密封|送洗送洗/.test(text)); assert(text.includes('送件包裝先向門市確認')); }
    assert(h.includes('不拆縫、不拉扯裡布'));
  });
  add('belt: material cause and hole wording remain conditional', () => {
    const m=main('leather-belt-mold'); assert(!/多半是鍍層|孔位近照能不能改善/.test(m)); assert(m.includes('可能與污垢、氧化或鍍層受損有關')); assert(m.includes('孔位的裂痕或變黑能否改善'));
  });
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = moldGuideChecks(resolve(process.argv[2] || '.')).map(({name,run}) => { try { run(); return {name,passed:true}; } catch(error) { return {name,passed:false,error:error.message}; } });
  console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,results},null,2));
  process.exitCode=results.some(x=>!x.passed)?1:0;
}
