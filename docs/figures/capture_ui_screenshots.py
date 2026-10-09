# -*- coding: utf-8 -*-
"""从原型工程抓「界面原型图」，供 Word 版《需求规格说明书》使用。

用法：
    1) 先起原型：`npm run dev`（端口 15178）
    2) 抓图：python docs/figures/capture_ui_screenshots.py
    3) 产物：docs/figures/ui/*.png（1500px 宽、≈254dpi）
    4) 重出文档：python docs/需求规格说明书_生成脚本.py

## 为什么写成一个脚本

界面改了（按钮文案、列、弹窗结构）就得重抓，手工截一遍十几张图很难保证「同一视角、同一命名」；
脚本能一键重跑，且把「要抓哪些界面、图注写什么」固化成清单 —— 与 `docs/figures/word_figures.md`
（流程图的图源）一起构成 Word 文档的完整图源。

## v3.05 起往来与银行是**两个页面**（两条路由）

`/reply/wanglai` 与 `/reply/bank` 各是一页，列表只出现本类函证、主操作行只有一个上传入口。
因此：**列表图两张**（`ui_reply_list` / `ui_reply_list_bank`），**银行上传弹窗必须去银行页抓**
（见 `BANK_STEPS`）—— 往来页上根本没有那个按钮。

## 抓图时踩过的三个坑（都写在这里，别再踩）

1. **antd 会在「两个汉字」的按钮里插一个空格** —— `确定` 实际渲染成 `确 定`。
   用 `has_text='确定'` 永远点不到，必须用正则 `确\\s*定`。
   （行内的「查看 / 更多」是链接不是 Button，没有这个空格，按原文匹配即可。）
2. **行选择器别写 `tbody tr`** —— antd 会插一行隐藏的「测量行」（`.ant-table-measure-row`），
   它排在前面，`.first` 会落到它身上，于是行内按钮全部点不到。只用 `.ant-table-row`。
3. **每张图都重新打开页面** —— 「回函归属」是全屏界面，`Escape` 关不掉，上一张图的界面会把
   后续步骤全挡住。`goto()` 重开最省心（每张多花 2 秒，值得）。

## 两张全屏界面已经能自动抓了（v3.06 起）

- **回函切分与归属**（`ui_assign` 往来 / `ui_assign_bank` 银行）—— 此前走不通：上传弹窗点「下一步」在 headless 里没推进到
  归属界面（等文件解析），而当时的「演示数据」按钮**直接跳过归属**。**v3.06 起演示数据入口改走
  「下一步」同一条路**（`START_BATCH` 会一并置 `assignOpen`）⇒ 点一下演示数据按钮就落在归属界面，
  于是可自动抓。
- **识别工作台 · 智能识别界面**（`ui_identify`）—— 它挂在列表右下角常驻的**识别进度卡**上：
  归属界面点「确定」→ 进度卡出现 → 点「看识别过程」打开全屏界面。难点只是**要等识别推进到出结论**
  （`.insight-card__owner` 出现，最多等 60s），不是点不开。
"""
import glob
import os
import re
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:15178/reply'
# v3.05 起往来与银行是两个页面（两条路由）—— 抓图要**按类走对应的页**：
# 列表图两张（各页一张），银行上传弹窗那张必须去银行页（往来页上没有那个按钮）。
PAGE_WANGLAI = 'http://127.0.0.1:15178/reply/wanglai'
PAGE_BANK = 'http://127.0.0.1:15178/reply/bank'
HERE = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(HERE, 'ui')
RAW_DIR = os.path.join(HERE, '_raw')
MAX_W = 1500
DPR = 2


def shot(page, name, sel=None):
    """存一张图；整屏图先裁掉底部空白再降采样。"""
    os.makedirs(RAW_DIR, exist_ok=True)
    raw = os.path.join(RAW_DIR, name + '.png')
    if sel:
        page.locator(sel).first.screenshot(path=raw)
    else:
        page.screenshot(path=raw)
    im = Image.open(raw).convert('RGB')
    if sel is None:
        im = crop_blank_bottom(im)
    if im.width > MAX_W:
        im = im.resize((MAX_W, int(im.height * MAX_W / im.width)), Image.LANCZOS)
    out = os.path.join(UI_DIR, name + '.png')
    im.save(out, optimize=True)
    print('  [ok] %-28s %dx%d  %d KB' % (name, im.width, im.height, os.path.getsize(out) / 1024))


def crop_blank_bottom(im, margin=28):
    """裁掉底部整片「与页面底色相同」的空白（截图下沿常留一大片）。"""
    rgb = im.convert('RGB')
    w, h = rgb.size
    bg = rgb.getpixel((6, h - 6))
    for y in range(h - 1, 0, -40):
        if ImageChops.difference(rgb.crop((0, y, w, y + 1)),
                                Image.new('RGB', (w, 1), bg)).getbbox() is not None:
            for yy in range(y, max(0, y - 120), -8):
                if ImageChops.difference(rgb.crop((0, yy, w, yy + 1)),
                                        Image.new('RGB', (w, 1), bg)).getbbox() is not None:
                    return rgb.crop((0, 0, w, min(h, yy + margin)))
            break
    return rgb


def to_assign(page):
    """走到「回函切分与归属」全屏界面。

    **用演示数据入口进**（v3.06 起它与「下一步」同一条路：`START_BATCH` 一并置 `assignOpen`）——
    上传弹窗里选真文件点「下一步」在 headless 里等不到解析完成，这条路不需要任何文件。
    """
    page.locator('button', has_text='上传往来函证回函').first.click()
    page.locator('.ant-modal-content').wait_for(timeout=8000)
    page.locator('.ant-modal-content button',
                 has_text=re.compile('往来函证拼接回函')).first.click()
    page.locator('.assign-pane').wait_for(timeout=20000)
    page.wait_for_timeout(2500)          # 等切分缩略图渲染出来
    # 把鼠标挪到空白处：上一步点过按钮，光标还停在墙上，会触发「局部放大」挡住半面墙
    page.mouse.move(1660, 940)
    page.wait_for_timeout(800)


def to_assign_bank(page):
    """走到**银行侧**的「回函切分与归属」——4 个包裹 / 4 个面单段的初稿态（v3.24 补抓）。

    与 `to_assign` 的两点差别：① 走**银行**弹窗（两个入口各是一页，往来页上没有这个按钮）；
    ② **要等面单识别跑完** —— 面单页被预切成独立段正是这一屏的看点，而 4 张面单在演示数据里
    约 20 / 40 / 60 / 76 秒先后到达，判据是顶部状态行说出「已识别 4 张」。
    """
    page.locator('button', has_text='上传银行函证回函').first.click()
    page.locator('.ant-modal-content').wait_for(timeout=8000)
    page.locator('.ant-modal-content button',
                 has_text=re.compile('银行函证回函（')).first.click()
    page.locator('.assign-pane').wait_for(timeout=20000)
    deadline = time.time() + 180
    while time.time() < deadline:
        note = page.evaluate(
            "() => (document.querySelector('.assign-facesheet') || {}).innerText || ''")
        if '已识别 4 张' in note:
            break
        page.wait_for_timeout(1500)
    # 同上：把鼠标挪开，否则残留位置会触发悬停放大、把缩略图墙挡掉一半
    page.mouse.move(1660, 940)
    page.wait_for_timeout(1200)


def to_identify(page):
    """走到「智能识别」全屏界面（＝需求点「识别工作台」）。

    路径：归属界面点「确定」→ 列表右下角出现识别进度卡 → 点「看识别过程」。
    等到检测点卡头（`.insight-card__owner`）出现再截 —— 结论没出来时界面只有进度区。
    """
    to_assign(page)
    page.locator('button').filter(has_text=re.compile(r'^\s*确\s*定\s*$')).last.click()
    page.wait_for_timeout(1500)
    page.locator('button', has_text='看识别过程').first.click()
    page.locator('.insight-card__owner').first.wait_for(state='visible', timeout=60000)
    page.wait_for_timeout(1200)


def to_identify_card(page):
    """近景：智能识别界面里那张**结论建议卡**（风险等级标签 + 置信度 + 风险原因）。

    整屏图铺到 15cm 后界面字只剩 5pt 上下，「建议卡」又在整屏图的下半截 ——
    要看清卡头那枚风险等级标签与置信度胶囊，得单独出一张近景。
    """
    to_identify(page)
    card = page.locator('.insight-card').filter(
        has=page.locator('> .insight-card__owner')).first
    card.wait_for(state='visible', timeout=30000)
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(800)


def open_more(page, n, label):
    """点第 n 行的「更多」→ 选下拉项。"""
    page.locator('.ant-table-row').nth(n).locator('button', has_text='更多').first.click()
    page.wait_for_timeout(1200)
    item = page.locator('.ant-dropdown-menu-item:visible', has_text=label).first
    item.wait_for(state='visible', timeout=8000)
    item.click()
    page.wait_for_timeout(2800)


STEPS = [
    # (文件名, 说明, 操作, 是否只截弹窗元素)  —— 默认都在**往来页**，见 BANK_STEPS
    ('ui_reply_list', '往来函证回函列表（页面/菜单一）', lambda p: None, False),
    ('ui_reply_list_bank', '银行函证回函列表（页面/菜单二）', lambda p: None, False),
    ('ui_expand_row', '展开行：回函记录表 + 留痕',
     lambda p: p.locator('.ant-table-row').first.locator('td').first.click(), False),
    ('ui_view_file', '「查看函证」原始文件视图',
     lambda p: p.locator('.ant-table-row').first.locator('button', has_text='查看').first.click(), True),
    ('ui_view_annot', '「查看函证」AI 批注视图（点预览上方的「AI 批注」模式）', lambda p: (
        p.locator('.ant-table-row').first.locator('button', has_text='查看').first.click(),
        p.wait_for_timeout(2500),
        p.locator('button', has_text=re.compile(r'^\s*AI\s*批注\s*$')).first.click(),
    ), True),
    ('ui_upload_current', '「上传往来函证回函」弹窗',
     lambda p: p.locator('button', has_text='上传往来函证回函').first.click(), True),
    ('ui_upload_bank', '「上传银行函证回函」弹窗',
     lambda p: p.locator('button', has_text='上传银行函证回函').first.click(), True),
    # 两张**全屏界面**（多步流程，见 to_assign / to_identify）—— 整屏截，不能只截弹窗元素
    ('ui_assign', '「回函切分与归属」全屏界面 · 往来侧初稿（按二维码切分成段 → 逐段归属）', to_assign, False),
    ('ui_assign_bank', '「回函切分与归属」全屏界面 · 银行侧初稿（4 个包裹：面单页已预切成独立面单段）',
     to_assign_bank, False),
    ('ui_identify', '「智能识别」全屏界面（按函证分组的检测点卡 + 建议卡）', to_identify, False),
    # 近景（第 4 项传选择器 → 只截该元素）：建议卡在整屏图的下半截，字会糊
    ('ui_identify_card', '近景：结论建议卡（风险等级标签 + 置信度胶囊 + 风险原因）',
     to_identify_card, '.insight-card:has(> .insight-card__owner)'),
    ('ui_verify_consistency', 'AI 核验 · 一致性检测', lambda p: open_more(p, 0, 'AI 核验'), True),
    ('ui_express', '「回函快递信息」弹窗', lambda p: open_more(p, 0, '快递信息'), True),
    ('ui_result', '「填写回函结果」页', lambda p: open_more(p, 0, '回函结果'), True),
    ('ui_delete_confirm', '删除的二次确认', lambda p: open_more(p, 0, '删除'), True),
    # ⚠ 这一张**必须整屏截**：它是个抽屉 + 结果弹窗的组合，只截 `.ant-modal-content` 会超时
    ('ui_express_import', '快递数据导入结果',
     lambda p: p.locator('button', has_text='导入快递数据').first.click(), False),
]

# 需要额外点一下页内模式的（在核验页里切换）
MODES = [('ui_verify_seal', 'AI 核验 · 印章识别', '印章识别'),
         ('ui_verify_handwrite', 'AI 核验 · 手写体识别', '手写体识别')]

# 这几个文件要去**银行页**抓（其余都在往来页）—— v3.05 拆页之后必须各去各的
BANK_STEPS = {'ui_reply_list_bank', 'ui_upload_bank', 'ui_assign_bank'}


def main():
    os.makedirs(UI_DIR, exist_ok=True)
    ok, fail = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width': 1680, 'height': 1000}, device_scale_factor=DPR)
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:200]))

        for name, desc, act, only_modal in STEPS:
            try:
                page.goto(PAGE_BANK if name in BANK_STEPS else PAGE_WANGLAI,
                          wait_until='domcontentloaded')
                page.wait_for_selector('text=回函管理', timeout=30000)
                page.wait_for_timeout(1800)
                act(page)
                page.wait_for_timeout(2600)
                # 第 4 项：True = 只截弹窗元素；字符串 = 只截该选择器对应的元素（近景）；False = 整屏
                sel = '.ant-modal-content' if only_modal is True else (only_modal or None)
                shot(page, name, sel)
                ok.append(name)
            except Exception as e:
                fail.append([name, desc, str(e).split('\n')[0][:110]])
                print('  [fail]', name, desc, str(e).split('\n')[0][:70])

        for name, desc, mode in MODES:
            try:
                page.goto(BASE, wait_until='domcontentloaded')
                page.wait_for_selector('text=回函管理', timeout=30000)
                page.wait_for_timeout(1800)
                open_more(page, 0, 'AI 核验')
                ctl = page.locator('.ant-modal-content button', has_text=re.compile(mode))
                ctl.first.click()
                page.wait_for_timeout(2500)
                shot(page, name, '.ant-modal-content')
                ok.append(name)
            except Exception as e:
                fail.append([name, desc, str(e).split('\n')[0][:110]])
                print('  [fail]', name, desc, str(e).split('\n')[0][:70])
        b.close()
    print('\n成功 %d 张，失败 %d 张' % (len(ok), len(fail)))
    for f in fail:
        print('  失败:', f)
    if errs:
        print('页面报错:', errs[:3])
    print('产物目录:', UI_DIR)
    print('提示: _raw/ 是未处理的原始截图，可直接删。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
