#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PORT = 4123
READY_MARKER = "webpty ready on"
SCREENSHOT_FILENAMES = (
    "webpty-preview.png",
    "webpty-studio.png",
    "webpty-profile-studio.png",
    "webpty-language-studio.png",
    "webpty-settings-json.png",
    "webpty-collapsed-rail.png",
    "webpty-mobile-settings.png",
)

TEXT_BOUND_SELECTORS = (
    ".drawer-nav-item strong",
    ".drawer-nav-item-copy span",
    ".drawer-status-card span",
    ".studio-list-copy strong",
    ".studio-list-copy span",
    ".profile-preview-copy strong",
    ".profile-preview-copy span",
    ".prompt-preview-label",
    ".field-help",
    ".summary-card strong",
    ".summary-card span",
    ".language-card strong",
    ".language-card span",
    ".shortcut-row strong",
    ".shortcut-pill",
    ".rail-tab-copy",
)


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
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="render screenshots into a temporary directory and only verify that capture succeeds",
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


def assert_no_text_overflow(page, context: str) -> None:
    result = page.evaluate(
        """
        (selectors) => {
          const failures = [];
          for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) {
                continue;
              }

              const parent = element.parentElement ?? element;
              const parentRect = parent.getBoundingClientRect();
              const overflow =
                rect.left < parentRect.left - 1 ||
                rect.right > parentRect.right + 1 ||
                rect.top < parentRect.top - 1 ||
                rect.bottom > parentRect.bottom + 1;

              if (!overflow) {
                continue;
              }

              failures.push({
                selector,
                text: (element.textContent || "").trim().slice(0, 140),
              });
            }
          }

          return {
            failures,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        }
        """,
        list(TEXT_BOUND_SELECTORS),
    )

    if result["scrollWidth"] > result["innerWidth"] + 1:
        raise RuntimeError(
            f"{context}: page width overflow ({result['scrollWidth']} > {result['innerWidth']})"
        )

    failures = result["failures"]
    if failures:
        first = failures[0]
        raise RuntimeError(
            f"{context}: text escaped its container for selector "
            f"{first['selector']!r} with content {first['text']!r}"
        )


def exercise_overflow_states(page) -> None:
    page.get_by_role("button", name="Profile Studio").click()
    page.wait_for_timeout(120)
    page.get_by_label("Profile name").fill(
        "Operations Sandbox Profile For Overflow Verification"
    )
    page.get_by_label("Command line").fill(
        "/usr/bin/env bash --login --init-file /opt/company/tooling/shell/bootstrap-long-command.sh"
    )
    page.get_by_label("Prompt template").fill(
        "[{profile}] {user}@{host}:{cwd}{symbol} workspace/sandbox/environment "
    )
    assert_no_text_overflow(page, "profile studio overflow check")

    page.get_by_role("button", name="Theme Studio").click()
    page.wait_for_timeout(120)
    page.get_by_label("Theme name").fill("Surface Validation Theme With Extended Naming")
    assert_no_text_overflow(page, "theme studio overflow check")

    page.get_by_role("button", name="Language").click()
    page.wait_for_timeout(120)
    assert_no_text_overflow(page, "language studio overflow check")


def capture(base_url: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
        page.goto(base_url, wait_until="networkidle")

        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[0]), full_page=True)

        page.get_by_role("tab", name="Settings").click()
        page.wait_for_timeout(200)

        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[1]), full_page=True)

        page.get_by_role("button", name="Profile Studio").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[2]), full_page=True)

        page.get_by_role("button", name="Language").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[3]), full_page=True)

        page.locator(".drawer-nav-item").filter(has_text="settings.json").first.click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[4]), full_page=True)

        page.get_by_role("button", name="Hide session rail").click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(out_dir / SCREENSHOT_FILENAMES[5]), full_page=True)
        page.get_by_role("button", name="Show session rail").click()
        page.wait_for_timeout(120)
        exercise_overflow_states(page)

        mobile_page = browser.new_page(
            viewport={"width": 480, "height": 900}, device_scale_factor=1
        )
        mobile_page.goto(base_url, wait_until="networkidle")
        mobile_page.get_by_role("tab", name="Settings").click()
        mobile_page.wait_for_timeout(200)
        assert_no_text_overflow(mobile_page, "mobile settings layout")
        mobile_page.screenshot(
            path=str(out_dir / SCREENSHOT_FILENAMES[6]), full_page=True
        )
        mobile_page.close()
        browser.close()


def verify_capture_outputs(out_dir: Path) -> None:
    missing = []
    empty = []
    for filename in SCREENSHOT_FILENAMES:
        path = out_dir / filename
        if not path.exists():
            missing.append(filename)
            continue
        if path.stat().st_size == 0:
            empty.append(filename)

    if missing or empty:
        failures = []
        if missing:
            failures.append(f"missing: {', '.join(missing)}")
        if empty:
            failures.append(f"empty: {', '.join(empty)}")
        raise RuntimeError(f"docs capture verification failed ({'; '.join(failures)})")


def main() -> int:
    args = parse_args()
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    if args.check_only:
        temp_dir = tempfile.TemporaryDirectory(prefix="webpty-docs-check-")
        out_dir = Path(temp_dir.name)
    else:
        out_dir = (REPO_ROOT / args.out_dir).resolve()
    base_url = f"http://127.0.0.1:{args.port}"
    process = start_server(args.port, args.settings)
    try:
        capture(base_url, out_dir)
        verify_capture_outputs(out_dir)
        if args.check_only:
            print("docs capture smoke check passed")
    finally:
        stop_server(process)
        if temp_dir is not None:
            temp_dir.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
