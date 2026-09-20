#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回函管理智能化原型 —— 一键启动开发服务（Vite dev server）。

用法
----
    python scripts/start_dev.py                  # 启动并在就绪后自动打开浏览器
    python scripts/start_dev.py --no-open        # 只启动，不打开浏览器
    python scripts/start_dev.py --port 5179      # 换端口
    python scripts/start_dev.py --install        # 缺 node_modules 时自动 npm install
    python scripts/start_dev.py --build          # 先生产构建，再用静态服务预览 dist/

运行环境（重要）
----------------
本脚本**只使用 Python 标准库**（subprocess / socket / shutil / webbrowser 等），
因此**任何 Python 3.8+ 环境都能运行 —— 不需要特定的 conda 环境**：
conda base 可以、系统 Python 也可以、项目无关的其他环境同样可以。

真正的前置条件是 **Node.js（本机 v24.18.0）与 npm 在 PATH 中**。
脚本会先自检，缺失时给出明确提示；若某个 conda 环境改写过 PATH 导致找不到 node，
按提示换一个环境（推荐 base）或把 Node 安装目录加回 PATH 即可。
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

# 项目根目录 = 本脚本所在目录（scripts/）的上一级
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 5178
DEFAULT_HOST = "127.0.0.1"
READY_TIMEOUT = 90  # 等待服务就绪的最长秒数（首次启动 vite 需要预构建依赖）


# --------------------------------------------------------------------------- #
# 终端输出与自检
# --------------------------------------------------------------------------- #

def setup_stdout() -> None:
    """
    处理 Windows 中文输出的两种相反情况：

    · **交互式终端**：Python 3.6+ 走 Windows 控制台原生 Unicode 接口，中文本来正常 ——
      此处**不要**改写编码，否则控制台是 GBK 时反而变乱码。
    · **输出被重定向**（写日志文件 / 管道）：默认按系统 locale（cp936）编码，
      改写为 UTF-8 后文件内容才是规整的 UTF-8，读日志时需要对应地用 UTF-8 打开。

    因此只在「非交互式」时强制 UTF-8。
    """
    if os.name != "nt":
        return
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure") and not stream.isatty():
            try:
                stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
            except Exception:
                pass


def say(msg: str) -> None:
    print(msg, flush=True)


def find_npm() -> str:
    """定位 npm —— Windows 上是 npm.cmd，直接调 `npm` 会 FileNotFoundError。"""
    for name in ("npm.cmd", "npm"):
        path = shutil.which(name)
        if path:
            return path
    say("[×] 找不到 npm —— 请确认已安装 Node.js 且其目录在 PATH 中（终端里执行 `node -v` 应能输出版本号）。")
    say("    如果你在某个 conda 环境中执行本脚本，可换用 conda base 再试，或把 Node 安装目录加入 PATH。")
    raise SystemExit(1)


def assert_node_available() -> str:
    """启动前自检：node 与 npm 都必须可用。"""
    if not shutil.which("node"):
        say("[×] 找不到 node —— 请先安装 Node.js ≥ 18。")
        raise SystemExit(1)
    npm = find_npm()
    node_ver = subprocess.run(
        ["node", "--version"], capture_output=True, text=True, check=False
    ).stdout.strip()
    say(f"[i] Node {node_ver} · npm {npm}")
    return npm


def ensure_dependencies(npm: str, auto_install: bool) -> None:
    """node_modules 不存在时提示（或自动）安装依赖。"""
    if (ROOT / "node_modules").is_dir():
        return
    say("[!] 未检测到 node_modules —— 依赖尚未安装。")
    if not auto_install:
        say("    请先执行：npm install   （或加 --install 参数让本脚本自动安装）")
        raise SystemExit(1)
    say("[i] 正在执行 npm install（首次可能较慢）…")
    result = subprocess.run([npm, "install"], cwd=ROOT, check=False)
    if result.returncode != 0:
        say("[×] npm install 失败，请查看上方输出。")
        raise SystemExit(1)


# --------------------------------------------------------------------------- #
# 端口探测
# --------------------------------------------------------------------------- #

def is_port_open(host: str, port: int) -> bool:
    """端口是否已可连接 —— 用它判断「服务是否就绪 / 端口是否被占用」。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.6)
        return sock.connect_ex((host, port)) == 0


def wait_until_ready(host: str, port: int, timeout: int) -> bool:
    """轮询等待服务就绪，期间打印进度点。"""
    say(f"[i] 等待服务就绪（{host}:{port}，最多 {timeout}s）", )
    deadline = time.time() + timeout
    dots = 0
    while time.time() < deadline:
        if is_port_open(host, port):
            say("")
            return True
        print(".", end="", flush=True)
        dots += 1
        time.sleep(0.8)
    say("")
    return False


# --------------------------------------------------------------------------- #
# 进程管理
# --------------------------------------------------------------------------- #

def spawn(cmd: list[str]) -> subprocess.Popen:
    """启动子进程 —— 继承当前终端输出，便于直接看到 Vite 日志。"""
    return subprocess.Popen(cmd, cwd=ROOT)


def shutdown(proc: subprocess.Popen) -> None:
    """
    结束服务。

    Windows 上 npm 会派生子进程（node → vite），只结束 npm 本身会留下占用端口的孤儿进程，
    因此用 taskkill /T 连同整棵进程树一起结束。
    """
    if proc.poll() is not None:
        return
    say("\n[i] 正在停止服务…")
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    say("[i] 服务已停止。")


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="启动回函管理智能化原型的开发服务",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"服务端口（默认 {DEFAULT_PORT}）")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址（默认 {DEFAULT_HOST}）")
    parser.add_argument("--no-open", action="store_true", help="就绪后不自动打开浏览器")
    parser.add_argument("--install", action="store_true", help="缺少 node_modules 时自动执行 npm install")
    parser.add_argument("--build", action="store_true", help="改用生产方式：先构建再用 vite preview 预览 dist/")
    return parser.parse_args()


def main() -> int:
    setup_stdout()
    args = parse_args()

    say("=" * 62)
    say("  函证系统 · 回函管理智能化原型 —— 开发服务启动器")
    say("=" * 62)
    say(f"[i] 项目目录：{ROOT}")

    if not (ROOT / "package.json").is_file():
        say("[×] 该目录下没有 package.json，请确认脚本放在项目的 scripts/ 目录内。")
        return 1

    npm = assert_node_available()
    ensure_dependencies(npm, args.install)

    # 端口已被占用：多半是上次的服务还在跑，直接复用而不是报错
    if is_port_open(args.host, args.port):
        url = f"http://{args.host}:{args.port}"
        say(f"[!] {args.host}:{args.port} 已有服务在监听 —— 直接复用，不再重复启动。")
        if not args.no_open:
            webbrowser.open(url)
        say(f"[√] 访问地址：{url}")
        return 0

    if args.build:
        say("[i] 生产构建中…")
        if subprocess.run([npm, "run", "build"], cwd=ROOT, check=False).returncode != 0:
            say("[×] 构建失败，请查看上方输出。")
            return 1
        cmd = [npm, "run", "preview", "--", "--port", str(args.port), "--host", args.host]
    else:
        cmd = [npm, "run", "dev", "--", "--port", str(args.port), "--host", args.host]

    say(f"[i] 启动命令：{' '.join(cmd)}")
    proc = spawn(cmd)

    try:
        if not wait_until_ready(args.host, args.port, READY_TIMEOUT):
            say("[×] 服务在预期时间内没有就绪 —— 请检查上方 Vite 日志（常见原因：端口被占用、依赖损坏）。")
            shutdown(proc)
            return 1

        url = f"http://{args.host}:{args.port}"
        say(f"[√] 服务已就绪：{url}")
        if not args.no_open:
            webbrowser.open(url)
            say("[i] 已自动打开浏览器（如需关闭该行为，加 --no-open）。")
        say("[i] 按 Ctrl + C 停止服务。")

        proc.wait()  # 前台驻留，直到用户中断或进程退出
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        shutdown(proc)


if __name__ == "__main__":
    raise SystemExit(main())
