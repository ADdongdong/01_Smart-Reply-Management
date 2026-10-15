# -*- coding: utf-8 -*-
"""把「需求规格说明书」的 SPEC 渲染成 Markdown。

为什么要有它：**SPEC 是唯一内容源** —— `需求规格说明书_生成脚本.py` 用它出 docx，
本模块用它出 `需求文档.md`。两份内容因此逐字一致（同一个 dict 的两个渲染器），
不会再出现"Word 改了、md 没跟上"这类漂移。

用法：
    from render_spec_md import render_md
    render_md(SPEC, r'docs\需求文档.md')
"""
import os
import re

HISTORY_HEADER = ['版本号', '修改日期', '编写人', '评审人', '批准人', '修改内容']
IO_IN_HEADER = ['数据项', '来源', '说明']
IO_OUT_HEADER = ['数据项', '去向', '说明']


def _cell(s):
    """表格单元格：换行压成 <br>、竖线转义（否则 md 表格会被截断）。"""
    return str(s).replace('\r', ' ').replace('\n', '<br>').replace('|', '\\|').strip()


def _table(rows, header=None):
    rows = [list(r) for r in rows if r is not None]
    if not rows:
        return []
    if header:
        head = list(header)
    else:
        head, rows = rows[0], rows[1:]
    out = ['| ' + ' | '.join(_cell(c) for c in head) + ' |',
           '|' + '|'.join(['---'] * len(head)) + '|']
    for r in rows:
        cells = [_cell(c) for c in r]
        if len(cells) < len(head):
            cells += [''] * (len(head) - len(cells))
        out.append('| ' + ' | '.join(cells[:len(head)]) + ' |')
    out.append('')
    return out


def _bullets(items):
    if isinstance(items, str):      # 单条写成裸字符串时别被逐字拆开
        items = [items]
    out = []
    for it in items:
        # 生成器脚本会自动去掉手写序号（"1、…"），md 侧保持一致
        txt = re.sub(r'^\d+[、.]\s*', '', str(it)).strip()
        out.append('- ' + txt)
    out.append('')
    return out


def _paras(items):
    if isinstance(items, str):
        items = [items]
    out = []
    for it in items:
        out.append(str(it).strip())
        out.append('')
    return out


def _fig(fig, out_dir):
    """插图：路径转成相对 docs/ 的形式，图注作为 alt。"""
    if isinstance(fig, dict):
        caption = fig.get('图注', '')
        path = fig.get('图片', '')
    else:
        caption, path = '', fig
    if isinstance(path, (list, tuple)):
        path = path[0] if path else ''
    rel = os.path.relpath(str(path), out_dir).replace('\\', '/') if path else ''
    if not os.path.exists(str(path)):
        return ['> [图表未找到：%s]' % (rel or path), '']
    out = []
    if caption:
        out.append('**%s：**' % caption)
        out.append('')
    out.append('![%s](%s)' % (caption, rel))
    out.append('')
    return out


def render_md(spec, out_path):
    out_dir = os.path.dirname(os.path.abspath(out_path))
    L = []

    cov = spec.get('封面') or {}
    L.append('# %s' % cov.get('系统名', '需求规格说明书'))
    L.append('')
    L += _table([[cov.get('版本', ''), cov.get('公司', ''), cov.get('日期', '')]],
                header=['版本', '编制单位', '日期'])

    hist = spec.get('文档修改历史')
    if hist:
        L.append('## 文档修改历史')
        L.append('')
        rows = [list(r) for r in hist]
        if rows and rows[0][0] != '版本号':
            L += _table(rows, header=HISTORY_HEADER)
        else:
            L += _table(rows[1:], header=rows[0])

    menu = spec.get('菜单目录')
    if menu:
        L.append('## 菜单目录')
        L.append('')
        L += _table(menu[1:] if menu and menu[0][0] == '一级菜单' else menu,
                    header=['一级菜单', '二级菜单', '三级菜单'])

    for blk in spec.get('body', []):
        kind = blk[0]
        if kind.startswith('h') and kind[1:].isdigit():
            L.append('#' * int(kind[1]) + ' ' + str(blk[1]))
            L.append('')
        elif kind == 'p':
            L += _paras(blk[1])
        elif kind == 'bullets':
            L += _bullets(blk[1])
        elif kind == 'fig':
            L += _fig(blk[1], out_dir)
        elif kind == 'table':
            L += _table(blk[1], blk[2] if len(blk) > 2 else None)
        elif kind == 'req':
            L += _req(blk[1], out_dir)
        else:
            raise ValueError('unknown block: %r' % (kind,))

    text = '\n'.join(L).rstrip() + '\n'
    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text)
    return out_path


def _req(r, out_dir):
    level = r.get('level', 3)
    L = ['#' * level + ' ' + r.get('title', ''), '']
    sec = level + 1

    def h(name):
        return ['#' * sec + ' ' + name, '']

    if r.get('业务说明') is not None:
        L += h('业务说明') + _paras(r['业务说明'])
    if r.get('业务规则') is not None:
        v = r['业务规则']
        L += h('业务规则')
        L += _table(v) if v and isinstance(v[0], (list, tuple)) else _bullets(v)
    if r.get('使用角色') is not None:
        v = r['使用角色']
        L += h('使用角色')
        L += _table(v) if v and isinstance(v[0], (list, tuple)) else _bullets(v)
    if r.get('权限说明') is not None:
        L += h('权限说明') + _bullets(r['权限说明'])

    func = r.get('功能说明')
    if func is not None:
        L += h('功能说明')
        if isinstance(func, dict):
            if func.get('功能概述') is not None:
                L += _paras(func['功能概述'])
            if func.get('二级页面') is not None:
                L += _bullets(func['二级页面'])
            if func.get('操作说明') is not None:
                rows = [list(x) for x in func['操作说明']]
                L += _table(rows[1:], header=rows[0]) if rows[0][0] == '名称' else _table(rows)
            for g in func.get('界面原型图') or []:
                L += _fig(g, out_dir)
        else:
            L += _paras(func)

    if r.get('页面字段说明') is not None:
        v = r['页面字段说明']
        L += h('页面字段说明')
        L += _table(v) if v and isinstance(v[0], (list, tuple)) else _bullets(v)

    io = r.get('输入输出')
    if io is not None:
        L += h('输入、输出')
        if isinstance(io, dict):
            if io.get('输入'):
                rows = [list(x) for x in io['输入']]
                L.append('**输入：**')
                L.append('')
                L += _table(rows[1:], header=rows[0]) if rows[0][0] == '数据项' else _table(rows, header=IO_IN_HEADER)
            if io.get('输出'):
                rows = [list(x) for x in io['输出']]
                L.append('**输出：**')
                L.append('')
                L += _table(rows[1:], header=rows[0]) if rows[0][0] == '数据项' else _table(rows, header=IO_OUT_HEADER)
        else:
            L += _paras(io)
    return L
