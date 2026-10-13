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

## 几个多步界面怎么走到的

- **回函切分与归属**（`ui_assign` 往来 / `ui_assign_bank` 银行 / `ui_assign_bank_smart` 智能初稿）—— 此前走不通：上传弹窗点「下一步」在 headless 里没推进到
  归属界面（等文件解析），而当时的「演示数据」按钮**直接跳过归属**。**v3.06 起演示数据入口改走
  「下一步」同一条路**（`START_BATCH` 会一并置 `assignOpen`）⇒ 点一下演示数据按钮就落在归属界面；
  智能初稿那条约 v3.26 起走弹窗里的「智能识别」按钮。
- **列表页的「正在智能识别」区**（`ui_recog_board`）—— v3.28 起识别过程就在列表页上，
  v3.29 起它**独立成块、位于输入卡与列表之间**：银行页 → 弹窗点「智能识别」→ 归属界面点「确定」→
  回列表，等到「识别区还有行 **且** 表格已有行」再截（那一对照就是这张图的要点）。
- **⚠️ 已退役的入口**：右下角识别进度卡与它点开的**全屏「智能识别」界面**在 v3.28 **不再挂载**
  （识别过程搬到了列表页），故原 `ui_identify` / `ui_identify_card` 两张图**下线**；
  识别依据现由「AI 核验事项」列的事项详情承担（`ui_verify_actions` / `ui_verify_consistency` /
  `ui_verify_seal` / `ui_verify_handwrite`，入口都是 `open_chip`）。
- **「更多」下拉已移除**（v3.28）——「回函快递信息 / 回函结果」改点**进度列的步骤条**（`open_step`），
  「AI 核验」改点**事项文字链**（`open_chip`），删除入口不复存在（原 `ui_delete_confirm` 下线）。
- **事项详情截"已采纳留痕"要走两步**（v3.29）—— 点「采纳识别数据」后弹窗**自动关闭**，
  故先采纳、再点同一条事项重新打开，才拍得到页脚那行留痕。
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


def to_assign_bank_smart(page):
    """走到**银行侧「智能识别」初稿态**（v3.26 新路，与 `to_assign_bank` 的手动态对照）。

    差别只有一处：**不从演示数据入口进**，而是点弹窗里的「智能识别」按钮 ——
    它跑完约 5 秒（`SmartSplitAction` 的固定演示节奏）后进归属界面，**初稿即识别结果**
    （8 段已切好、归属与快递单号已带入、顶部写「✦ 智能识别已应用」）。
    判据用 `.assign-draftsrc` 的文案，比"干等 6 秒"稳。
    """
    page.locator('button', has_text='上传银行函证回函').first.click()
    page.locator('.ant-modal-content').wait_for(timeout=8000)
    page.locator('.ant-modal-content button', has_text='智能识别').first.click()
    page.locator('.assign-pane').wait_for(timeout=20000)
    page.locator('.assign-draftsrc', has_text='智能识别已应用').wait_for(timeout=20000)
    page.wait_for_timeout(2000)          # 等切分缩略图渲染出来
    page.mouse.move(1660, 940)
    page.wait_for_timeout(800)


def to_recog_board(page):
    """走到**列表页的「正在智能识别」区**（v3.28，取代原右下角悬浮卡 + 全屏识别界面；v3.29 起独立成块、位于输入卡与列表之间）。

    路径：银行页 → 上传弹窗点「智能识别」→ 归属界面点「确定」→ 回列表，
    此时识别区逐封列出 20 个任务、下方表格里是**已经跑完的那些**。
    本图的要点正是这个对照，故**不能等它跑完**：等到"识别区还有行、表格已有行"就截。
    """
    page.locator('button', has_text='上传银行函证回函').first.click()
    page.locator('.ant-modal-content').wait_for(timeout=8000)
    page.locator('.ant-modal-content button', has_text='智能识别').first.click()
    page.locator('.assign-draftsrc', has_text='智能识别已应用').wait_for(timeout=20000)
    page.locator('button').filter(has_text=re.compile(r'^\s*确\s*定\s*$')).last.click()
    page.locator('.recog-board').wait_for(timeout=15000)
    # 等"上面还在认、下面已入表"同时成立再截（最多 90s）——
    # 太早表格还是空的、太晚识别区已经收起来了，两个极端都拍不到这个对照。
    deadline = time.time() + 90
    while time.time() < deadline:
        board = page.locator('.recog-board__row').count()
        rows = page.locator('.ant-table-row').count()
        if 0 < board and rows > 1:
            break
        page.wait_for_timeout(1500)
    # 把鼠标挪开再截：点过「确定」后光标常停在识别区某一行上，
    # 触发检测项的悬停说明（一把浮层压在识别区上，图就废了）
    page.mouse.move(1660, 940)
    page.wait_for_timeout(800)

# 原 `to_identify` / `to_identify_card`（全屏「智能识别」界面与它的近景）已于 v3.28 移除 ——
# 该界面**不再挂载**（识别过程搬到了列表页顶部的识别区，见 `to_recog_board`），
# 组件本身保留备用；若将来恢复那个入口，把这两个函数按原实现加回来即可。


def open_step(page, n, label):
    """点第 n 行「回函进度」列的步骤条（v3.28：这是「回函快递信息 / 回函结果」的**唯一**入口）。

    「更多」下拉在 v3.28 被移除，那两项改由进度列的步骤条承担（v2.51 起步骤名就可点）。
    """
    page.locator('.ant-table-row').nth(n).locator('.progress-steps__step', has_text=label).first.click()
    page.wait_for_timeout(2800)


def open_chip(page, n, label):
    """点第 n 行「AI 核验事项」列的某一项 → 打开该项的识别详情（v3.28）。

    这是「AI 核验」的唯一入口：打开即**定位到被点的那一项**，页脚给「采纳 / 不采纳识别数据」。
    v3.29 起事项是**一行文字链**（类名由 `.ai-review__chip` 改为 `.ai-review__link`）。
    """
    page.locator('.ant-table-row').nth(n).locator('.ai-review__link', has_text=label).first.click()
    page.locator('.vw-right').first.wait_for(state='visible', timeout=12000)
    page.wait_for_timeout(1800)


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
    # 三张**全屏界面**（多步流程，见 to_assign / to_assign_bank*）—— 整屏截，不能只截弹窗元素
    ('ui_assign', '「回函切分与归属」全屏界面 · 往来侧初稿（按二维码切分成段 → 逐段归属）', to_assign, False),
    ('ui_assign_bank', '「回函切分与归属」全屏界面 · 银行侧初稿（4 个包裹：面单页已预切成独立面单段）',
     to_assign_bank, False),
    ('ui_assign_bank_smart', '「回函切分与归属」全屏界面 · 银行侧「智能识别」初稿态（初稿即切分结果：20 段 / 4 包裹 / 归属与单号已带入）',
     to_assign_bank_smart, False),
    # v3.28：识别过程搬上列表页（`to_recog_board`）—— v3.29 起独立成块、位于输入卡与列表之间；
    # 整屏截，要看"上面在认、下面已入表"的对照
    ('ui_recog_board', '「正在智能识别」区（独立成块、位于输入卡与列表之间；逐封一行 + 与下方表格同屏对照）',
     to_recog_board, False),
    # v3.28：事项详情 = 点列表「AI 核验事项」某一项打开，页签落在该项、页脚给采纳 / 不采纳
    # v3.29：点「采纳」后弹窗**自动关闭**，故采纳完再点一次同一项，才能拍到页脚那行留痕
    ('ui_verify_actions', 'AI 核验事项详情（打开即定位被点项 + 页脚采纳 / 不采纳；截**已采纳**后的留痕态）',
     lambda p: (open_chip(p, 0, '印章识别'),
                p.locator('.ant-modal-wrap:visible .ant-modal-footer button',
                          has_text=re.compile('^采纳识别数据$')).first.click(),
                p.wait_for_timeout(1200),
                open_chip(p, 0, '印章识别')), True),
    ('ui_verify_consistency', 'AI 核验 · 发函回函一致性检测', lambda p: open_chip(p, 0, '发函回函一致性检测'), True),
    ('ui_express', '「回函快递信息」弹窗', lambda p: open_step(p, 0, '快递信息'), True),
    ('ui_result', '「填写回函结果」页', lambda p: open_step(p, 0, '回函结果'), True),
    # ⚠ 这一张**必须整屏截**：它是个抽屉 + 结果弹窗的组合，只截 `.ant-modal-content` 会超时
    ('ui_express_import', '快递数据导入结果',
     lambda p: p.locator('button', has_text='导入快递数据').first.click(), False),
]

# 需要额外点一下页内模式的（在核验页里切换）—— v3.28 起入口是「AI 核验事项」列的事项
MODES = [('ui_verify_seal', 'AI 核验 · 印章识别', '印章识别'),
         ('ui_verify_handwrite', 'AI 核验 · 手写体识别', '手写体识别')]

# 这几个文件要去**银行页**抓（其余都在往来页）—— v3.05 拆页之后必须各去各的
BANK_STEPS = {'ui_reply_list_bank', 'ui_upload_bank', 'ui_assign_bank', 'ui_assign_bank_smart',
              'ui_recog_board'}


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
                # 页面就绪判据用**页面头标题元素**，不用文字「回函管理」——
                # v3.29 起那三截面包屑（函证系统 / 回函管理 / …）已从页面头移除，
                # 拿它当判据会让每一张都 30s 超时（本轮踩到过）。
                page.wait_for_selector('.page-head__title', timeout=30000)
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
                page.wait_for_selector('.page-head__title', timeout=30000)
                page.wait_for_timeout(1800)
                # v3.28：直接点「AI 核验事项」列里那一项（打开即定位到它），不必再切页签
                open_chip(page, 0, mode)
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
