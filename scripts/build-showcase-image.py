from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

ROOT = Path("/Users/zhouzuo/Documents/xiaofeixaing")
CAP = ROOT / "outputs/showcase-captures"
OUT = ROOT / "outputs/xiaofeixiang-ai-showcase.png"
FONT = "/System/Library/Fonts/STHeiti Light.ttc"

W, H = 2160, 1440
bg = Image.new("RGB", (W, H), "#F5F6FA")
draw = ImageDraw.Draw(bg)

def font(size):
    return ImageFont.truetype(FONT, size)

def rounded_card(box, radius=28, fill="#FFFFFF", shadow=True):
    x1, y1, x2, y2 = box
    if shadow:
        layer = Image.new("RGBA", (W, H), (0,0,0,0))
        sd = ImageDraw.Draw(layer)
        sd.rounded_rectangle((x1+2,y1+12,x2+2,y2+12), radius, fill=(28,31,44,28))
        layer = layer.filter(ImageFilter.GaussianBlur(16))
        bg.paste(layer, (0,0), layer)
    draw.rounded_rectangle(box, radius, fill=fill)

def place_screen(path, box, crop=(0,0,1,1), radius=20):
    im = Image.open(path).convert("RGB")
    w,h = im.size
    l,t,r,b = crop
    im = im.crop((int(w*l), int(h*t), int(w*r), int(h*b)))
    bw,bh = box[2]-box[0], box[3]-box[1]
    ratio=max(bw/im.width,bh/im.height)
    im=im.resize((int(im.width*ratio),int(im.height*ratio)),Image.Resampling.LANCZOS)
    left=(im.width-bw)//2; top=(im.height-bh)//2
    im=im.crop((left,top,left+bw,top+bh))
    mask=Image.new("L",(bw,bh),0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,bw,bh),radius,fill=255)
    bg.paste(im,(box[0],box[1]),mask)

# Brand header
draw.rounded_rectangle((72,58,142,128),18,fill="#6C72F2")
draw.text((92,72),"象",font=font(34),fill="white")
draw.text((166,54),"小飞象",font=font(56),fill="#191B24")
draw.text((166,119),"AI 短剧一站式创作工作台",font=font(26),fill="#777C8D")
draw.rounded_rectangle((1570,68,2088,126),29,fill="#ECEEFF")
draw.text((1605,83),"一个想法，完成一部短剧",font=font(26),fill="#5962DE")

# Workflow strip
steps=["创意 / 剧本","剧本大纲","全剧资产","分镜片段","生成成片"]
x=78
for i,s in enumerate(steps):
    tw=draw.textbbox((0,0),s,font=font(25))[2]
    draw.rounded_rectangle((x,165,x+tw+42,215),25,fill="#FFFFFF",outline="#E0E3ED",width=2)
    draw.text((x+21,176),s,font=font(25),fill="#343745")
    x += tw+70
    if i < len(steps)-1:
        draw.text((x-22,174),"→",font=font(25),fill="#8E94A7")

# Upper cards
rounded_card((72,250,1312,900))
draw.text((104,278),"01  剧本驱动创作",font=font(30),fill="#1D2030")
draw.text((104,323),"从创意、摘要到分集正文，创作过程可编辑、可确认",font=font(22),fill="#777C8D")
place_screen(CAP/"02-script.png",(104,370,1280,868),crop=(.12,.06,.98,.92),radius=18)

rounded_card((1340,250,2088,900))
draw.text((1372,278),"02  全剧资产一致性",font=font(30),fill="#1D2030")
draw.text((1372,323),"角色形态、场景与道具统一管理",font=font(22),fill="#777C8D")
place_screen(CAP/"03-assets.png",(1372,370,2056,868),crop=(.14,.12,.99,.90),radius=18)

# Bottom canvas
rounded_card((72,930,1600,1372))
draw.text((104,956),"03  可视化自由画布",font=font(30),fill="#1D2030")
draw.text((104,1000),"节点与连线组织剧本、资产和片段生产，支持创作者自由编排",font=font(22),fill="#777C8D")
place_screen(CAP/"04-canvas.png",(104,1045,1568,1340),crop=(.15,.23,.86,.78),radius=18)

# Feature summary card
rounded_card((1628,930,2088,1372),fill="#252833")
draw.text((1666,966),"核心亮点",font=font(31),fill="#FFFFFF")
features=[
    ("8 位角色 · 29 个形态","跨镜头保持角色一致"),
    ("5 场景 · 6 道具 · 31 素材","全剧资产统一复用"),
    ("ComfyUI 工作流接入","生成节点进度可追踪"),
    ("剧本 / 画布双路径","兼顾效率与创作自由"),
]
y=1026
for title,desc in features:
    draw.ellipse((1667,y+5,1685,y+23),fill="#7D83FF")
    draw.text((1703,y),title,font=font(23),fill="#FFFFFF")
    draw.text((1703,y+35),desc,font=font(19),fill="#AEB2C2")
    y += 80

bg.save(OUT,quality=96)
print(OUT)
