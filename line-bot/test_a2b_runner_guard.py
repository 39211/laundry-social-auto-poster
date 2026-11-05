# -*- coding: utf-8 -*-
"""T-3b：run_a2b_tests.py 的隔離護欄還在（只放行本機迴路、仍擋外網與正式資料夾）。

只在 A2b 隔離 runner 底下才有意義：這支沒有 unittest 類別，`python -m unittest` 會回「沒有測試」，
run_linebot_tests.py 因此改用 run_a2b_tests.py 跑；直接 `python test_a2b_runner_guard.py` 會被拒絕，
避免在沒有護欄的環境真的去連線。
"""
from __future__ import annotations

import os
import socket
import sys


def _under_runner() -> bool:
    main_file = getattr(sys.modules.get("__main__"), "__file__", "") or ""
    return os.path.basename(main_file) == "run_a2b_tests.py"


def test_loopback_connect_is_allowed() -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        client = socket.create_connection(("127.0.0.1", port), timeout=2)
        client.close()
    finally:
        server.close()


def test_external_connect_is_blocked() -> None:
    # 直接對 IP 位址 connect（不經名稱查詢），單獨驗證 socket.connect 這道護欄。
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.3)
    try:
        probe.connect(("192.0.2.1", 9))  # RFC 5737 TEST-NET-1，不會有人回應
    except PermissionError as exc:
        assert "A2b: network forbidden" in str(exc), str(exc)
        return
    except OSError as exc:  # 沒被護欄擋住：連線被真的送出去、自己逾時
        raise AssertionError(f"外網連線沒被 A2b 擋下: {type(exc).__name__}") from exc
    finally:
        probe.close()
    raise AssertionError("外網連線竟然成功")


def test_external_name_lookup_is_blocked() -> None:
    try:
        socket.getaddrinfo("example.invalid", 80)
    except PermissionError as exc:
        assert "A2b: network forbidden" in str(exc), str(exc)
        return
    except OSError as exc:
        raise AssertionError(f"外部名稱查詢沒被 A2b 擋下: {type(exc).__name__}") from exc
    raise AssertionError("外部名稱查詢竟然成功")


def test_production_folder_is_still_forbidden() -> None:
    try:
        open(r"C:\Users\cyc39\laundry-repo\data\prices.json", "rb").close()
    except PermissionError as exc:
        assert "A2b: production filesystem access forbidden" in str(exc), str(exc)
        return
    raise AssertionError("正式資料夾竟然讀得到")


if __name__ == "__main__":
    if not _under_runner():
        print("test_a2b_runner_guard 只能經由 run_a2b_tests.py 執行: python run_a2b_tests.py test_a2b_runner_guard")
        sys.exit(2)
