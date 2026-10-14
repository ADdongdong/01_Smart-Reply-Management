# -*- coding: utf-8 -*-
"""生成「已脱敏」占位样例 PDF（覆盖原样例）。

背景（用户口径，2026-10-14）：「前端原型里，和整个项目里，都要删除未脱敏的原始函证文件，
也就是有红色印章的文件，快递面单和无印章的函证文件可以保留。」

做法：把 `public/samples/` 下**5 份带红色印章的函证样例**换成占位件 ——
页数与纸张尺寸与原文件一致（页区间元数据 1-3 / 4-6 / 7-9 等因此不失效），
内容只剩一页纸的说明与页码，**不含任何真实函证信息与印章**。
快递面单（`public/samples/faceSheets/`）按用户口径保留，不动。

用法：python docs/figures/make_redacted_samples.py
"""

from __future__ import annotations

import os
import sys

import fitz

sys.stdout.reconfigure(encoding='utf-8')

SAMPLES = 'public/samples'
# 文件 → （页数, 一句话说明），页数取自原文件真实页数
PLACEHOLDERS: dict[str, tuple[int, str]] = {
    'huihan-cswl0526.pdf': (9, '往来函证回函件样例（拼接件）'),
    'fahan-cswl0526.pdf': (6, '往来函证发函用印件样例'),
    'huihan-0813.pdf': (9, '往来函证回函件样例'),
    'wanglai-1-SJ01YF001.pdf': (2, '往来函证回函件样例（单封印章件）'),
    'bank-qishang-20240331.pdf': (4, '银行函证回函件样例'),
}

GREY = (0.55, 0.56, 0.62)
LIGHT = (0.78, 0.80, 0.86)


def make(name: str, pages: int, note: str, out_dir: str) -> str:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)          # A4，与原样例一致
        page.draw_rect(fitz.Rect(28, 28, 567, 814), color=LIGHT, width=0.7)
        page.insert_text((64, 116), '样例已脱敏', fontsize=22,
                         fontname='china-s', color=GREY)
        page.insert_text((64, 152), f'原标题：{note}', fontsize=10.5,
                         fontname='china-s', color=LIGHT)
        for k, line in enumerate([
            '原件含真实单位信息与红色印章，已按合规要求从本项目移除。',
            '本页为占位样例：仅保留原文件的页数与版式，供界面演示使用。',
            '快递面单样例未受影响（按约定保留）。',
        ]):
            page.insert_text((64, 196 + k * 22), line, fontsize=11,
                             fontname='china-s', color=GREY)
        # 几行「版式示意」的浅色横条，避免整页全白
        for k in range(7):
            y = 300 + k * 60
            page.draw_rect(fitz.Rect(64, y, 511, y + 26), color=LIGHT,
                           fill=(0.965, 0.97, 0.98), width=0.5)
        page.insert_text((64, 792), f'{name} · 第 {i + 1} / {pages} 页',
                         fontsize=9.5, fontname='china-s', color=LIGHT)
    path = os.path.join(out_dir, name)
    doc.save(path, deflate=True, garbage=3)
    doc.close()
    return path


def main() -> int:
    for name, (pages, note) in PLACEHOLDERS.items():
        p = make(name, pages, note, SAMPLES)
        print('已替换 %-30s %d 页  %6.1f KB' % (name, pages, os.path.getsize(p) / 1024))
    print('面单样例保持原样:', len(os.listdir(os.path.join(SAMPLES, 'faceSheets'))), '份')
    return 0


if __name__ == '__main__':
    sys.exit(main())
