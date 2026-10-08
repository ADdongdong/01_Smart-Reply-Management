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

## 抓图时踩过的三个坑（都写在这里，别再踩）

1. **antd 会在「两个汉字」的按钮里插一个空格** —— `确定` 实际渲染成 `确 定`。
   用 `has_text='确定'` 永远点不到，必须用正则 `确\\s*定`。
   （行内的「查看 / 更多」是链接不是 Button，没有这个空格，按原文匹配即可。）
2. **行选择器别写 `tbody tr`** —— antd 会插一行隐藏的「测量行」（`.ant-table-measure-row`），
   它排在前面，`.first` 会落到它身上，于是行内按钮全部点不到。只用 `.ant-table-row`。
3. **每张图都重新打开页面** —— 「回函归属」是全屏界面，`Escape` 关不掉，上一张图的界面会把
   后续步骤全挡住。`goto()` 重开最省心（每张多花 2 秒，值得）。

## 还没抓到的两张（本轮试过，走不通）

- **回函切分与归属**：上传弹窗点「下一步」在 headless 里没推进到归属界面；
  而弹窗里的「演示数据」按钮**设计上就跳过归属**（直接进「识别中」并自动归属）。
- **识别工作台**：它挂在右下角常驻的识别进度卡上，本轮没能在 headless 里点开。
这两处建议人工截（或先在原型里手工走到那个界面再截）。
"""
import glob
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:15178/reply'
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


def open_more(page, n, label):
    """点第 n 行的「更多」→ 选下拉项。"""
    page.locator('.ant-table-row').nth(n).locator('button', has_text='更多').first.click()
    page.wait_for_timeout(1200)
    item = page.locator('.ant-dropdown-menu-item:visible', has_text=label).first
    item.wait_for(state='visible', timeout=8000)
    item.click()
    page.wait_for_timeout(2800)


STEPS = [
    # (文件名, 说明, 操作, 是否只截弹窗元素)
    ('ui_reply_list', '回函列表（总览）', lambda p: None, False),
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
                page.goto(BASE, wait_until='domcontentloaded')
                page.wait_for_selector('text=回函管理', timeout=30000)
                page.wait_for_timeout(1800)
                act(page)
                page.wait_for_timeout(2600)
                shot(page, name, '.ant-modal-content' if only_modal else None)
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
