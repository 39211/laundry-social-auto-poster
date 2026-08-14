# -*- coding: utf-8 -*-
import qrcode, sys, random
from PIL import Image, ImageDraw, ImageFont
sys.stdout.reconfigure(encoding='utf-8')
MM=300/25.4
def mm(v): return int(round(v*MM))
def dist(m): return round(m*25.4/3.048,1)
PAPER=(250,247,241); INK=(26,34,30); GREEN=(15,76,58); GREEN_L=(96,126,112)
GOLD=(176,138,58); HAIR=(214,206,192); PANEL=(243,239,231)
OK=(46,110,72); PART=(176,138,58); NO=(140,138,130)
def F(s,b=True): return ImageFont.truetype("C:/Windows/Fonts/msjhbd.ttc" if b else "C:/Windows/Fonts/msjh.ttc", mm(s))
W,H=mm(216),mm(303); M=mm(17)
S={k:dist(v) for k,v in {"title":2.6,"sub":1.5,"th":0.75,"cell":1.0,"cellsub":0.75,
                          "offer":1.5,"phone":1.35,"addr":1.05,"small":0.72}.items()}
def adv(s): return mm(s*1.24)
def width_of(dd,text,size,tk,bold=True):
    f=F(size,bold); t=mm(tk)
    return sum(dd.textlength(c,font=f)+t for c in text)-t
ROWS=[(OK,"布面一整圈泛黃","洗劑殘留","洗得回來"),
      (PART,"鞋帶孔周圍發深","汗漬滲入","多半能淡化"),
      (NO,"鞋邊膠條轉黃","橡膠氧化","刷不掉,只能淡化")]
FOOT="越用力刷,布面越起毛,只會更舊。分不出來先別動它。"
ROW_H=mm(13)
panel_h=mm(6)+adv(S["th"])+mm(4)+len(ROWS)*ROW_H+mm(5)+adv(S["cellsub"])+mm(6)
below=(mm(9)+adv(S["title"]*0.9)+mm(3)+mm(6)+adv(S["sub"]*0.9)+mm(7)+panel_h+mm(8)
       +(mm(5)+adv(S["offer"]*0.92)+mm(1.5)+adv(S["small"])+mm(5))
       +mm(7)+(mm(6)+mm(34)+mm(2.5)+adv(S["small"])+mm(2)+adv(S["small"]))+mm(4))
hero_mm=(H-mm(10)-below)/MM
img=Image.new("RGB",(W,H),PAPER)
px=img.load(); rnd=random.Random(7)
for _ in range(int(W*H*0.02)):
    x=rnd.randrange(W); y=rnd.randrange(H); v=rnd.randint(-4,3)
    r,g,b=px[x,y]; px[x,y]=(max(0,min(255,r+v)),max(0,min(255,g+v)),max(0,min(255,b+v)))
d=ImageDraw.Draw(img)
def track(x,y,text,size,fill,tk=0.0,bold=True,left=True,draw=None,maxw=None,label=""):
    dd=draw or d
    if maxw is not None:
        w=width_of(dd,text,size,tk,bold)
        assert w<=maxw, f"{label} 超寬 {(w-maxw)/MM:.1f}mm:{text[:18]}"
    f=F(size,bold); t=mm(tk); cx=x
    if not left: cx=x-width_of(dd,text,size,tk,bold)
    for c in text: dd.text((cx,y),c,font=f,fill=fill); cx+=dd.textlength(c,font=f)+t
    return y+mm(size*1.24)
ph=mm(hero_mm); half=W//2
src=Image.open("data/reference-photos/poster-hero-diptych-grok.png")
bt=int(src.height*0.40); bh=int(src.height*0.50)
img.paste(src.crop((0,bt,src.width,bt+bh)).resize((W,ph),Image.LANCZOS),(0,0))
d.rectangle([half-mm(0.7),0,half+mm(0.7),ph],fill=PAPER)
sh=mm(12); sc=Image.new("L",(1,sh))
for i in range(sh): sc.putpixel((0,i),int(150*(i/sh)**1.6))
img.paste(Image.new("RGB",(W,sh),(18,26,22)),(0,ph-sh),sc.resize((W,sh)))
for x0,txt in ((M,"洗前"),(half+mm(10),"洗後")):
    d.line([x0,ph-mm(8),x0+mm(6),ph-mm(8)],fill=GOLD,width=mm(0.55))
    track(x0,ph-mm(6.3),txt,5,(252,250,246),tk=1.2)
sh2=Image.new("L",(1,mm(3)))
for i in range(mm(3)): sh2.putpixel((0,i),int(75*(1-i/mm(3))**1.4))
img.paste(Image.new("RGB",(W,mm(3)),(60,60,55)),(0,ph),sh2.resize((W,mm(3))))
y=ph+mm(9)
y=track(M,y,"白鞋的黃,有三種",S["title"]*0.9,GREEN,tk=-0.3,maxw=W-2*M,label="主標")
y+=mm(3); d.line([M,y,M+mm(40),y],fill=GOLD,width=mm(0.9)); y+=mm(6)
y=track(M,y,"只有一種,刷得掉",S["sub"]*0.9,GREEN_L,tk=0.2,bold=False)
y+=mm(7)
pt=y; d.rectangle([M,pt,W-M,pt+panel_h],fill=PANEL)
C1=M+mm(9); C2=M+mm(78); C3=W-M-mm(9)
iy=pt+mm(6)
track(C1,iy,"看哪裡",S["th"],GREEN_L,tk=0.9)
track(C2,iy,"為什麼黃",S["th"],GREEN_L,tk=0.9)
track(C3,iy,"救不救得回",S["th"],GREEN_L,tk=0.9,left=False)
iy+=adv(S["th"])+mm(4)
for i,(col,where,why,verdict) in enumerate(ROWS):
    if i: d.line([C1,iy-mm(2),C3,iy-mm(2)],fill=(224,219,207),width=mm(0.3))
    d.ellipse([M+mm(4),iy+mm(2.2),M+mm(4)+mm(3),iy+mm(2.2)+mm(3)],fill=col)
    track(C1,iy+mm(1.5),where,S["cell"],INK,tk=0.1,maxw=C2-C1-mm(3),label="欄1")
    track(C2,iy+mm(1.8),why,S["cellsub"],GREEN_L,tk=0.2,bold=False)
    track(C3,iy+mm(1.5),verdict,S["cell"]*0.9,col,tk=0.1,left=False)
    iy+=ROW_H
iy+=mm(3); d.line([C1,iy,C3,iy],fill=(224,219,207),width=mm(0.3)); iy+=mm(4)
track(C1,iy,FOOT,S["cellsub"],INK,tk=0.1,bold=False,maxw=C3-C1,label="註腳")
y=pt+panel_h+mm(8)
CARD_W=W-2*M; PAD=mm(8)
tmp=Image.new("RGB",(CARD_W,mm(60)),GREEN); td=ImageDraw.Draw(tmp)
jy=mm(5)
jy=track(PAD,jy,"拍一張,我告訴你是哪一種",S["offer"]*0.92,GOLD,tk=-0.1,draw=td,maxw=CARD_W-2*PAD,label="優惠主句")
jy+=mm(1.5)
LONG="運動鞋 250・皮鞋 400・名牌鞋 600 起｜台中免費到府收送"
SHORT="運動鞋 250・皮鞋 400・名牌鞋 600 起｜免費收送"
line=LONG if width_of(td,LONG,S["small"],0.15,False)<=CARD_W-2*PAD else SHORT
jy=track(PAD,jy,line,S["small"],(206,220,212),tk=0.15,bold=False,draw=td,maxw=CARD_W-2*PAD,label="價格行")
th_=jy+mm(5)
card=tmp.crop((0,0,CARD_W,th_)); cd=ImageDraw.Draw(card); n=mm(5)
for p in ([(0,0),(n,0),(0,n)],[(0,th_),(n,th_),(0,th_-n)],
          [(CARD_W,0),(CARD_W-n,0),(CARD_W,n)],[(CARD_W,th_),(CARD_W-n,th_),(CARD_W,th_-n)]):
    cd.polygon(p,fill=PAPER)
img.paste(card,(M,y)); d=ImageDraw.Draw(img); y+=th_+mm(7)
d.line([M,y,W-M,y],fill=HAIR,width=mm(0.4)); y+=mm(6)
side=mm(34)
img.paste(qrcode.make("https://39211.github.io/go/line.html?source=poster-front").resize((side,side)),(M,y))
qlab=track(M,y+side+mm(2.5),"掃碼加 LINE・傳照片估價",S["small"],INK,tk=0.15,bold=False)
brand=track(M,qlab+mm(2),"私享家洗衣店",S["small"],GREEN,tk=0.9)
rx=W-M; ry=y
ry=track(rx,ry,"打電話",S["small"],GREEN_L,tk=0.5,bold=False,left=False)
ry=track(rx,ry,"0968-327-653",S["phone"]*0.95,INK,tk=-0.25,left=False); ry+=mm(3)
ry=track(rx,ry,"西屯區青海路二段365號",S["addr"]*0.9,INK,tk=0.1,bold=False,left=False)
ry=track(rx,ry,"至善國中對面",S["addr"]*0.9,GREEN_L,tk=0.1,bold=False,left=False); ry+=mm(1.5)
ry=track(rx,ry,"10:00-20:00・週日公休",S["small"],GREEN_L,tk=0.15,bold=False,left=False)
bottom=max(brand,ry)+mm(3)
assert bottom<=H-mm(10), f"越界 {bottom/MM:.1f}mm"
img.save("output/print/poster-A4-shoes-knowledge-v8.png",dpi=(300,300))
print(f"v8 完成|底部 {bottom/MM:.1f}mm|主圖 {hero_mm:.0f}mm|價格行用{'長'if line is LONG else '短'}版|全部文字通過寬度檢查")
