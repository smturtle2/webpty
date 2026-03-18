#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PORT = 4123
READY_MARKER = "webpty ready on"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture repository screenshots for docs")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--settings",
        default="./config/webpty.settings.json",
        help="settings file passed to `webpty up`",
    )
    parser.add_argument(
        "--out-dir",
        default="./docs/assets",
        help="output directory for generated screenshots",
    )
    return parser.parse_args()


def start_server(port: int, settings: str) -> subprocess.Popen[str]:
    command = [
        "cargo",
        "run",
        "--manifest-path",
        "apps/server/Cargo.toml",
        "--",
        "up",
        "--port",
        str(port),
        "--settings",
        settings,
    ]
    process = subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert process.stdout is not None
    started = False
    started_at = time.time()
    while time.time() - started_at < 90:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                raise RuntimeError("webpty server exited before becoming ready")
            time.sleep(0.1)
            continue
        sys.stdout.write(line)
        if READY_MARKER in line:
            started = True
            break

    if not started:
        stop_server(process)
        raise RuntimeError("timed out while waiting for the server to become ready")

    return process


def stop_server(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return

    if os.name == "nt":
        process.terminate()
    else:
        process.send_signal(signal.SIGINT)

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def capture(base_url: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
        page.goto(base_url, wait_until="networkidle")

        page.screenshot(path=str(out_dir / "webpty-preview.png"), full_page=True)

        page.get_by_role("button", name="Open settings").click()
        page.wait_for_timeout(200)

        page.screenshot(path=str(out_dir / "webpty-studio.png"), full_page=True)

        page.get_by_role("button", name="Profile Studio").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / "webpty-profile-studio.png"), full_page=True)

        page.get_by_role("button", name="Language").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / "webpty-language-studio.png"), full_page=True)

        page.locator(".drawer-nav-item").filter(has_text="settings.json").first.click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / "webpty-settings-json.png"), full_page=True)

        page.get_by_role("button", name="Hide session rail").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / "webpty-collapsed-rail.png"), full_page=True)
        browser.close()


def main() -> int:
    args = parse_args()
    out_dir = (REPO_ROOT / args.out_dir).resolve()
    base_url = f"http://127.0.0.1:{args.port}"
    process = start_server(args.port, args.settings)
    try:
        capture(base_url, out_dir)
    finally:
        stop_server(process)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
