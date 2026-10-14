"""把交付好的 Archify HTML 渲成文档配图 PNG（整体框架图）。

为什么单独一个脚本、而不是用 `archify visual-check` 的截图：
那个命令的截图是**视口截图**（1440×900 等），而这页内容比视口高（图 + 三张结论卡 ≈ 1350px），
直接截会把下半截切掉。这里用 Playwright 的 `full_page=True` 整页截图，
再按项目口径**降采样到 1500px 宽**（15cm 宽里 ≈ 254dpi，肉眼无差别、docx 体积小得多）。

用法（在仓库根目录）：
    python docs/figures/framework/capture_framework_png.py
"""

from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
HTML = HERE / "overall-framework.html"
OUT = HERE / "overall-framework.png"
TARGET_WIDTH = 1500
SCALE = 2  # 设备像素比：2 倍抓、再降采样，字更实


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1440, "height": 1000}, device_scale_factor=SCALE
        )
        page.goto(HTML.as_uri(), wait_until="networkidle")
        page.wait_for_timeout(600)  # 等字体与动效首帧落定
        page.screenshot(path=str(OUT), full_page=True)
        browser.close()

    im = Image.open(OUT)
    if im.width > TARGET_WIDTH:
        im = im.resize(
            (TARGET_WIDTH, round(im.height * TARGET_WIDTH / im.width)), Image.LANCZOS
        )
        im.save(OUT)
    print("saved ->", OUT, im.size)


if __name__ == "__main__":
    main()
