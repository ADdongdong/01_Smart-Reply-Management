#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回函管理智能化原型 —— 一键启动开发服务（Vite dev server）。

用法
----
    python scripts/start_dev.py                  # 启动并在就绪后自动打开浏览器
    python scripts/start_dev.py --no-open        # 只启动，不打开浏览器
    python scripts/start_dev.py --port 15179     # 换端口
    python scripts/start_dev.py --strict-port    # 端口不可用时直接报错，不自动顺延
    python scripts/start_dev.py --install        # 缺 node_modules 时自动 npm install
    python scripts/start_dev.py --build          # 先生产构建，再用静态服务预览 dist/

端口（重要 —— 别再用 5178 那个段）
----------------------------------
本机 Windows 动态端口范围是 **1024–15000**，而 **Hyper-V / WSL 会在每次开机从这段里
划走若干「保留区间」**（实测 2314-2413、3698-3997、5095-5194、5355-5454… **且每天漂移**）。
落在保留区间里的端口 `bind` 会抛 `EACCES`（`listen EACCES: permission denied`）——
**这不是「端口被占用」**（那才是 `EADDRINUSE`），报错信息极易误导。
历史上 8012、5178 都栽在这上面（5178 现落在 5095-5194 里）。

因此默认端口取 **15178** —— **刻意选在动态范围之外**，不会被 Hyper-V 抽走。
即便如此，脚本仍不假设它一定可用：启动前会**先试探性 bind**，
若发现端口被保留区间吞掉或已被占用，就**自动顺延找下一个能绑的端口**（`--strict-port` 可关掉）。
另可用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看当前保留区间。

⚠️ **自动顺延会改变访问端口**，而 KKFileView 备用链路里写死了 `host.docker.internal:<端口>`
—— 换端口时需同步改 `src/config/preview.ts` 的 `DEV_SERVER_PORT`（脚本会在换端口时提示）。

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
# 默认端口刻意取在 Windows 动态端口范围（本机 1024–15000）**之外** —— 见文件头「端口」一节
DEFAULT_PORT = 15178
# 端口不可用时往后顺延试探的个数 —— 够跨过一整段保留区间（实测最长约 300 个，故另配 --port 兜底）
PORT_SCAN_TRIES = 40
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


# 端口状态四态 —— 区分「被保留区间吞掉」与「被人占用」是本文件存在的关键，
# 因为两者在 Vite 里的报错长得很像（都起不来），但处置完全不同（换端口 vs 找占用进程）。
PORT_OPEN = "open"          # 已有服务在监听 ⇒ 直接复用
PORT_FREE = "free"          # 可绑定 ⇒ 可用
PORT_RESERVED = "reserved"  # 被 Windows 保留端口区间占用 ⇒ 只能换端口
PORT_USED = "used"          # 被其他进程占用（但未在该地址监听）


def probe_port(host: str, port: int) -> str:
    """
    判断端口的真实状态。

    为什么不能只看 `connect_ex`：**被保留区间吞掉的端口没有任何人监听**，
    连接探测会得出「空闲」这个错误结论，于是脚本高高兴兴去启动、再被 Vite 的
    `EACCES` 打回来。因此这里**真的试着 bind 一次** —— 这是唯一能区分二者的办法：
        · bind 成功       ⇒ 空闲
        · PermissionError ⇒ WinError 10013，端口落在系统保留区间
        · OSError 其他    ⇒ 已被别的进程占用
    """
    if is_port_open(host, port):
        return PORT_OPEN
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            # 绑到「脚本将要交给 vite 的那个监听地址」上，探测结论才与 vite 的实际遭遇一致
            # （不绑 0.0.0.0：那会把「别人占了别的网卡」也算成自己不可用，且 Windows 上
            #  0.0.0.0 与具体地址的冲突判定受 SO_EXCLUSIVEADDRUSE 影响，容易误判）
            sock.bind((host, port))
        except PermissionError:
            # Windows 上的「端口被保留」就长这样：WSAEACCES(10013) → PermissionError
            return PORT_RESERVED if os.name == "nt" else PORT_USED
        except OSError as exc:
            if getattr(exc, "winerror", None) == 10013:
                return PORT_RESERVED
            return PORT_USED
    return PORT_FREE


def find_free_port(host: str, start: int, tries: int = PORT_SCAN_TRIES) -> int | None:
    """从 start 起顺序找一个能绑定的端口 —— 用来绕开被保留区间吞掉的那一段。"""
    for offset in range(tries):
        port = start + offset
        if port > 65535:
            break
        if probe_port(host, port) == PORT_FREE:
            return port
    return None


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
    parser.add_argument(
        "--strict-port",
        action="store_true",
        help="端口不可用时直接报错退出，不自动顺延到下一个可用端口",
    )
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

    # 端口先探明状态再启动 —— 直接跑 vite 只会拿到一句 `listen EACCES`，看不出真因
    state = probe_port(args.host, args.port)

    # 端口已被占用：多半是上次的服务还在跑，直接复用而不是报错
    if state == PORT_OPEN:
        url = f"http://{args.host}:{args.port}"
        say(f"[!] {args.host}:{args.port} 已有服务在监听 —— 直接复用，不再重复启动。")
        if not args.no_open:
            webbrowser.open(url)
        say(f"[√] 访问地址：{url}")
        return 0

    if state != PORT_FREE:
        if state == PORT_RESERVED:
            say(f"[!] {args.host}:{args.port} 落在 Windows **保留端口区间**里 —— 不是被占用。")
            say("    Hyper-V / WSL 每次开机都会从动态端口范围里划走若干区间，且每天漂移。")
            say("    查看当前区间：netsh interface ipv4 show excludedportrange protocol=tcp")
        else:
            say(f"[!] {args.host}:{args.port} 已被其他进程占用。")
            say(f"    查看占用者：netstat -ano | findstr :{args.port}")

        if args.strict_port:
            say("[×] 已指定 --strict-port，不自动顺延 —— 请用 --port 指定另一个端口。")
            return 1

        picked = find_free_port(args.host, args.port + 1)
        if picked is None:
            say(f"[×] {args.port + 1} 往后 {PORT_SCAN_TRIES} 个端口都不可用，请用 --port 指定一个。")
            return 1
        say(f"[i] 已自动顺延到可用端口 {picked}（仅本次生效，下次仍从 {DEFAULT_PORT} 试起）。")
        args.port = picked

    if args.port != DEFAULT_PORT:
        say(f"[!] 本次端口 {args.port} ≠ 默认 {DEFAULT_PORT} —— KKFileView 备用链路里写死了")
        say(f"    host.docker.internal:{args.port}，若要长期用该端口，请把 src/config/preview.ts")
        say(f"    的 DEV_SERVER_PORT 一并改成 {args.port}。")

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
            say("[×] 服务在预期时间内没有就绪 —— 请检查上方 Vite 日志。")
            say("    常见原因：① 端口被 Windows 保留区间吞掉 —— Vite 会报 `listen EACCES: permission denied`")
            say("    （本脚本已提前探测端口，若仍出现请用 --port 换一个）；② node_modules 依赖损坏（加 --install 重装）。")
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
