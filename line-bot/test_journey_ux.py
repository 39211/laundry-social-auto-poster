"""Customer journeys through signed webhook events; reuse strict temporary-data/network isolation."""
import json, unittest
import test_estimate as t
EVIDENCE = []

def text_of(messages):
    if isinstance(messages, dict):
        return ([messages['text']] if messages.get('type') == 'text' else []) + sum((text_of(v) for k,v in messages.items() if k != 'action'), [])
    if isinstance(messages, list): return sum((text_of(v) for v in messages), [])
    return []

class JourneyTests(t.FlowTests):
    def tearDown(self):
        EVIDENCE.append({'case': self._testMethodName, 'events': self.events})
        super().tearDown()

    def setUp(self):
        super().setUp()
        t.conv.auto_query_available = lambda: False

    def reply_text(self):
        return '\n'.join(text_of(self.events[-1]['replies']))

    def action(self,label):
        def find(value):
            if isinstance(value,dict):
                action=value.get('action',{})
                if action.get('label')==label and 'data' in action: return action['data']
                for child in value.values():
                    found=find(child)
                    if found: return found
            elif isinstance(value,list):
                for child in value:
                    found=find(child)
                    if found: return found
        result=find(self.events[-1]['replies'])
        self.assertIsNotNone(result,label)
        return result

    def prepare_pickup(self):
        for s in ['外收送預約','明天下午','台中市西屯區測試路100號','0900000000','鞋子']:
            self.send(s)

    def test_every_menu_during_pending_steps(self):
        for wait in ('photo_need','pickup_when','pickup_addr','pickup_phone','pickup_confirm','query_item'):
            for text in ('拍照問價','外收送預約','價目表','物件查詢','店址','門市資訊','電話','LINE Pay'):
                t.conv.set_sess(self.uid,wait=wait,pickup_item='',pickup_addr='',pickup_phone='')
                self.send(text)
                body=self.reply_text()
                if text in ('店址','門市資訊'): self.assertIn(t.conv.ADDR,body)
                if text=='電話': self.assertIn(t.conv.PHONE,body)
                if text=='LINE Pay': self.assertIn('LINE Pay',body)
                self.assertNotEqual(t.conv.get_sess(self.uid).get('pickup_item'),text)

    def test_ack_keeps_pickup_and_cancel_clears_draft(self):
        self.send('外收送預約');self.send('明天下午');self.send('好')
        self.assertEqual(t.conv.get_sess(self.uid)['wait'],'pickup_loc')
        self.send('我用打字的');self.send('先不用了')
        self.assertIsNone(t.conv.get_sess(self.uid).get('wait'))
        self.send(kind='postback',data='action=pickup_confirm')
        self.assertFalse(t.conv.BOOK.exists())

    def test_query_accepts_customer_description(self):
        self.send('物件查詢');self.send('0900000000');self.send('上禮拜送洗的白色運動鞋')
        self.assertEqual(len(self.pushes()),1)
        self.assertIn('上禮拜送洗的白色運動鞋',self.pushes()[0]['messages'][0]['text'])
        self.assertIn('0900000000',self.pushes()[0]['messages'][0]['text'])
        self.assertIsNone(t.conv.get_sess(self.uid).get('wait'))

    def test_photo_help_not_same_prompt(self):
        self.send('拍照問價');self.send('我不會傳照片')
        self.assertIn('選好照片',self.reply_text())
        self.assertIn('傳送',self.reply_text())

    def test_complaint_goes_to_staff_not_price(self):
        self.send('衣服洗壞了怎麼辦')
        self.assertEqual(len(self.pushes()),1)
        self.assertIn('衣服洗壞了怎麼辦',self.pushes()[0]['messages'][0]['text'])
        self.assertNotIn('襯衫長褲',self.reply_text())

    def test_no_appointment_push_in_store_and_hours(self):
        for message in ('店址','營業時間','不用預約直接拿去可以嗎'):
            self.send(message)
            self.assertNotIn('留時間',self.reply_text())
            if message.startswith('不用'): self.assertIn('不用預約',self.reply_text())

    def test_confirm_is_not_dispatch_and_duplicate_is_one_order(self):
        self.prepare_pickup()
        self.assertNotIn('排好了',self.reply_text())
        self.assertNotIn('師傅會在這段時間過去',self.reply_text())
        data=self.action('確認送出')
        self.send(kind='postback',data=data,eid='confirm-a')
        self.send(kind='postback',data=data,eid='confirm-b')
        rows=[json.loads(x) for x in t.conv.BOOK.read_text(encoding='utf-8').splitlines()]
        self.assertEqual(len([x for x in rows if x.get('kind')=='pickup']),1)
        self.assertEqual(len(self.pushes()),1)

    def test_old_confirm_does_not_submit_new_values(self):
        self.prepare_pickup();old=self.action('確認送出')
        self.send('0900000001')
        self.send(kind='postback',data=old)
        self.assertFalse(t.conv.BOOK.exists())
        self.assertIn('更新',self.reply_text())

    def test_photo_and_phone_privacy_alternative(self):
        self.send('物件查詢');self.send('我不想留電話')
        self.assertIn(t.conv.PHONE,self.reply_text())
        self.assertIsNone(t.conv.get_sess(self.uid).get('wait'))

    def test_spoken_time_and_pay_text_agree_with_menu(self):
        self.send('外收送預約');self.send('明天下午三點可以嗎')
        self.assertEqual(t.conv.get_sess(self.uid)['pickup_when'],'2026-09-09T15:00')
        self.assertEqual(t.conv.get_sess(self.uid)['wait'],'pickup_loc')
        self.send('LINE Pay')
        self.assertIn('自行輸入',self.reply_text())
        self.assertNotIn('還在開通',self.reply_text())

    def test_previous_form_button_cannot_submit_new_form(self):
        self.prepare_pickup();old=self.action('確認送出')
        self.send('取消');self.prepare_pickup()
        self.send(kind='postback',data=old)
        self.assertFalse(t.conv.BOOK.exists())
        self.assertIn('更新',self.reply_text())

    def test_edit_one_field_preserves_other_fields(self):
        self.prepare_pickup()
        original=dict(t.conv.get_sess(self.uid))
        self.send('修改收送資料');self.send('修改收送電話');self.send('0900000001')
        revised=t.conv.get_sess(self.uid)
        self.assertEqual(revised['pickup_phone'],'0900000001')
        for key in ('pickup_when','pickup_addr','pickup_item'):
            self.assertEqual(revised[key],original[key])
        self.assertEqual(revised['wait'],'pickup_confirm')

    def test_reschedule_carries_original_order_and_keeps_booking(self):
        self.prepare_pickup();self.send(kind='postback',data=self.action('確認送出'))
        before=t.conv.BOOK.read_bytes()
        original=t.conv.last_active_booking(self.uid)['id']
        count=len(self.pushes())
        self.send('我要改時間');self.send('好');self.send('後天下午四點')
        self.assertEqual(t.conv.BOOK.read_bytes(),before)
        self.assertEqual(len(self.pushes()),count+1)
        notice=self.pushes()[-1]['messages'][0]['text']
        self.assertIn(original,notice)
        self.assertIn('後天下午四點',notice)
        self.assertIn('還沒有改動',self.reply_text())

if __name__=='__main__':
    names=[name for name in JourneyTests.__dict__ if name.startswith('test_')]
    suite=unittest.TestSuite(JourneyTests(n) for n in names)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (t.TEMP / 'journey-evidence.json').write_text(json.dumps(EVIDENCE, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    print('EVIDENCE', t.TEMP / 'journey-evidence.json')
    raise SystemExit(not result.wasSuccessful())
