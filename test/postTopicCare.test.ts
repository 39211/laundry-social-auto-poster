import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolvePostTopicCare } from '../src/postTopicCare';

describe('topic-specific post care', () => {
  const cases = [
    ['外套有悶味？先分開看表面與內裡', '外套異味與內裡', '內裡'],
    ['冷氣房外套的味道累積', '外套異味與內裡', '內裡'],
    ['毛衣起球，一區一區處理給你看', '毛衣起球', '纖維'],
    ['羽絨外套袖口黑一圈，刷一半給你看', '羽絨袖口油污', '袖口'],
    ['白 T 沾到巧克力冰淇淋，先別急著搓', '冰淇淋衣漬', '熱水'],
    ['送洗後衣物的收納方式', '洗後衣物收納', '乾燥'],
    ['高領毛衣領口沾到粉底和口紅', '毛衣領口彩妝漬', '領口'],
    ['羊毛大衣沾到羊肉爐湯汁', '羊毛大衣湯汁漬', '湯汁'],
    ['雪靴清洗前後對比：水痕別只擦一處', '雪靴水痕與內層', '水痕'],
    ['天絲床組能直接丟洗衣機？', '天絲床組', '洗標'],
    ['雨天機車族外套袖口與鞋面', '雨後外套與鞋面', '鞋面'],
    ['餐聚後外套與包包的味道', '餐聚後外套與包款', '包'],
    ['約會前包包與白鞋的邊角整理', '鞋包分件檢查', '鞋'],
    ['冬衣預約收送服務要備什麼', '收送預約準備', '件數'],
    ['搬家後寢具與窗簾的灰塵', '搬家寢具與窗簾', '窗簾'],
    ['牛津皮鞋做防水除味前，鞋面接縫和鞋口先看什麼？', '皮鞋與靴款', '皮面'],
    ['帆布鞋泥點滲進布紋後的處理', '帆布鞋泥點', '泥'],
    ['Gucci Jackie 精品肩背包五金邊有磨痕？先查扣件和包角', '精品包五金與包角', '鍍層'],
    ['雨傘滴水後包底被弄濕', '包底受潮', '內裡'],
    ['亮片禮服髒了？先看亮片怎麼縫', '亮片禮服配件', '亮片']
  ];
  it.each(cases)('%s has the correct specific subject', (topic, family, word) => {
    const result = resolvePostTopicCare(topic)!;
    expect(result.family).toBe(family);
    expect(result.summary).toContain(word);
    expect(result.description.length).toBeGreaterThan(20);
    expect(result.checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(result.paragraphs.every(p => p.length > 40 && p !== result.summary && !result.checkpoints.includes(p))).toBe(true);
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.faqs.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/NT\$|\$\d|免費|沒有低消|一件也收|每季一到兩次|洗壞的機率/);
  });
  it('keeps unknown topics unknown, including misleading caption keywords', () => {
    expect(resolvePostTopicCare('')).toBeUndefined();
    expect(resolvePostTopicCare('孩子看著你笑，你也回個微笑')).toBeUndefined();
    expect(resolvePostTopicCare({ topic: '未知主題', title: '白鞋' })).toBeUndefined();
  });
  it('resolves object inputs and returns independent mutable arrays', () => {
    const a = resolvePostTopicCare({ topic: '毛衣起球' })!;
    a.keywords.length = 0; a.paragraphs.length = 0; a.faqs[0]!.answer = 'changed';
    const b = resolvePostTopicCare('毛衣起球')!;
    expect(b.keywords.length).toBeGreaterThan(0);
    expect(b.paragraphs.length).toBe(2);
    expect(b.faqs[0]!.answer).not.toBe('changed');
  });
  it('uses only guide and service slugs present in the generator', () => {
    const source = readFileSync(new URL('../src/generatePublicSite.ts', import.meta.url), 'utf8');
    for (const [topic] of cases) {
      const care = resolvePostTopicCare(topic!)!;
      for (const slug of [care.serviceSlug, ...care.guideSlugs]) expect(source).toContain(`slug: "${slug}"`);
    }
  });
  it('does not route generic shoes to white shoe de-yellowing or coats to suit frequency advice', () => {
    expect(resolvePostTopicCare('換季收鞋前的鞋底邊緣清潔')!.family).toBe('鞋面與鞋內檢查');
    expect(JSON.stringify(resolvePostTopicCare('外套悶味'))).not.toContain('西裝');
    expect(resolvePostTopicCare('羽絨被發黃')!.family).toBe('寢具內外層');
    expect(resolvePostTopicCare('床包被套送洗')!.family).toBe('寢具內外層');
    expect(resolvePostTopicCare('西裝外套肩線與袖口')!.family).toBe('襯衫西裝與制服');
    expect(resolvePostTopicCare('羊毛大衣領口油痕')!.family).toBe('外套與大衣');
  });
});
