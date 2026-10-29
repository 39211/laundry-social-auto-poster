"""Small conversational detours before field collection; no external model or pricing guesses."""
import re
from datetime import timedelta

NAVIGATION = {'店址','門市資訊','位置','地址','地圖','怎麼去','在哪','電話','打電話','致電',
              'LINEPay','linepay','價目表','服務價目','常見問題','送洗前必看','找真人'}

def spoken_datetime(conv, n):
    match=re.fullmatch(r'(今天|明天|後天)(早上|上午|中午|下午|晚上)?([一二兩三四五六七八九十\d]+)(?:點|:)(半|[0-5]?\d分?)?(?:可以嗎|方便嗎|左右)?',n)
    if not match: return None
    hour=conv.quote_flow.estimate.number(match[3])
    if hour is None: return None
    minute=30 if match[4]=='半' else int((match[4] or '0').rstrip('分'))
    if match[2] in ('下午','晚上') and hour<12: hour+=12
    if match[2] in ('上午','早上') and hour==12: hour=0
    if hour>23 or minute>59: return None
    return (conv.now_tw()+timedelta(days={'今天':0,'明天':1,'後天':2}[match[1]])).replace(hour=hour,minute=minute,second=0,microsecond=0)

def handle(conv, uid, text):
    n=re.sub(r'\s+','',text or '').strip('？?！!。')
    sess=conv.get_sess(uid)
    wait=sess.get('wait') or ''
    if n in NAVIGATION:
        conv.set_sess(uid,wait=None)
        return None
    if re.search(r'(不會|怎麼|如何|不能|沒辦法).*(傳照片|拍照|上傳照片)',n):
        conv.set_sess(uid,wait='photo',photo_wait_ts=conv.now_tw().isoformat(),photo_nudged=False)
        return conv._pack(conv.say('按下面「從相簿選」，選好照片後，再按 LINE 的「傳送」。也可以按「拍照」直接拍。',
            '不用急，整件拍清楚就好；想加強的地方再補一張。',actions=list(conv._PHOTO_CAMERA_ACTIONS)), 'photo_help',False)
    if any(k in n for k in ('不想留電話','不方便留電話','不想給電話','不想留手機','不想給手機')):
        conv.set_sess(uid,wait=None)
        return conv._pack(conv.say(f'沒關係，也可以直接打店裡 {conv.PHONE}，跟櫃台說要查件或安排收送。',
            actions=[{'type':'uri','label':'打給店裡','uri':'tel:'+conv.PHONE}]),'privacy',False)
    if any(k in n for k in ('洗壞了','洗破了','洗完縮水','洗完掉色','洗完褪色','沒洗乾淨','少了一件','少一件')):
        conv.set_sess(uid,wait=None)
        sent=conv._push_ask(uid,'客人反映洗後狀況：'+text)
        return conv._pack(conv.say('這個要請店裡查清楚，我先把你說的情況交給櫃台。',
            '方便的話補一張有問題的地方，收據也先留著，讓店員一起核對。',actions=list(conv._PHOTO_CAMERA_ACTIONS)), 'complaint',sent)
    if any(k in n for k in ('一直重複','答非所問','沒回答我的問題','回覆太制式')):
        conv.set_sess(uid,wait=None)
        conv._push_ask(uid,'客人反映回覆沒有接到問題：'+text)
        return conv._pack(conv.say('抱歉，剛剛沒有接到你的意思。我把這個問題交給店員接著回。'), 'human',True)
    if any(k in n for k in ('不用預約','直接拿去','直接到店','直接送去')):
        conv.set_sess(uid,wait=None)
        return conv._pack(conv.say('可以，送洗不用預約，營業時間直接帶來就好。',conv.HOURS,
            buttons=[('門市資訊','店址'),('打電話','電話')]),'walk_in',False)
    if wait == 'reschedule_note':
        if conv._is_cancel_text(n) or n in ('先不用了','算了'):
            conv.set_sess(uid,wait=None)
            return conv._pack(conv.say('好，先不改時間，原來那筆收送保留。'),'cancel',False)
        if conv._query_should_leave(text,n):
            if conv.intents.is_ack(text):
                return conv._pack(conv.say('想改的日期、時間再告訴我就好。'),'reschedule',False)
            conv.set_sess(uid,wait=None)
            return None
        if len(n) < 3:
            return conv._pack(conv.say('想改到哪一天、幾點？一起告訴我，店員比較好安排。'),'reschedule',False)
        sent=conv._push_ask(uid,'客人申請改收送時間；原單號 '+str(sess.get('reschedule_booking_id',''))+'；希望改為：'+text+'；待店員確認，原單保留')
        conv.set_sess(uid,wait=None)
        return conv._pack(conv.say('改時間的需求已記下，請店員核對後在這裡回覆你。原來那筆先保留，還沒有改動。'),'reschedule',sent)
    if wait.startswith('pickup_') and not sess.get('pickup_id'):
        if n == '修改收送資料':
            return conv._pack(conv.say('想改哪一項？其他資料會保留。',buttons=[('時間','修改收送時間'),('地址','修改收送地址'),('電話','修改收送電話'),('品項','修改收送品項')]),'pickup',False)
        if n in ('修改收送時間','修改收送地址','修改收送電話','修改收送品項'):
            if n.endswith('時間'):
                conv.set_sess(uid,wait='pickup_when',pickup_when='',pickup_slot='')
                return conv._pack(conv.say('選新的時間，其他資料不用重填。',actions=conv._pickup_when_actions(uid)),'pickup',False)
            if n.endswith('地址'):
                conv.set_sess(uid,pickup_addr='')
                return conv._pack(conv._ask_pickup_address(uid),'pickup',False)
            if n.endswith('電話'):
                conv.set_sess(uid,pickup_phone='')
                return conv._pack(conv._ask_pickup_phone(uid),'pickup',False)
            conv.set_sess(uid,pickup_item='')
            return conv._pack(conv._ask_pickup_item(uid),'pickup',False)
        if conv._is_cancel_text(n) or n in ('先不用了','先不要了','不用了','算了','先不約','不收了'):
            conv.set_sess(uid,wait=None,pickup_when='',pickup_slot='',pickup_addr='',pickup_phone='',pickup_item='',pickup_confirm_key='')
            return conv._pack(conv.say('好，這次先不安排收送。有需要再按「到府收送」就好。'), 'cancel',False)
        if conv.intents.is_ack(text):
            if wait == 'pickup_addr':
                return conv._pack(conv.say('好，地址方便的時候再給我，門牌號碼也一起寫上。'),'pickup',False)
            return conv._pack(conv._pickup_next_missing(uid),'pickup',False)
    if n in ('我要改時間','改時間','改收送時間'):
        last=conv.last_active_booking(uid)
        if last:
            conv.set_sess(uid,wait='reschedule_note',reschedule_booking_id=last.get('id'))
            return conv._pack(conv.say('可以，把想改的日期、時間告訴我，我請店裡核對。原來那筆先保留。'), 'reschedule',False)
        return conv._pack(conv.say('目前沒有已成立的預約。你是要安排到府收送嗎？',buttons=[('安排收送','外收送預約')]), 'pickup',False)
    return None
