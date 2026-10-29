"""Connector interface and safe lookup logic.

The connector boundary is intentionally read-only.  Every implementation
returns a normalized snapshot and a source state; callers must treat
``unreachable`` and ``unknown`` as manual handoff, never as "no order".
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from shop_config import ConfigError, ShopConfig


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_phone(value: Any) -> str:
    import unicodedata
    norm = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\D", "", norm)


def _stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class ConnectorSnapshot:
    source: str
    state: str
    read_at: str
    customers: list[dict[str, Any]]
    pieces: list[dict[str, Any]]
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        body = {
            "source": self.source,
            "state": self.state,
            "read_at": self.read_at,
            "customers": self.customers,
            "pieces": self.pieces,
        }
        body["snapshot_sha256"] = _stable_hash(body)
        if self.detail:
            body["detail"] = self.detail
        return body


class Connector:
    name = "base"

    def read_snapshot(self) -> ConnectorSnapshot:
        raise NotImplementedError

    def health(self) -> dict[str, Any]:
        snapshot = self.read_snapshot()
        result = snapshot.as_dict()
        return {
            "connector": self.name,
            "state": snapshot.state,
            "source": snapshot.source,
            "read_at": snapshot.read_at,
            "customer_count": len(snapshot.customers),
            "piece_count": len(snapshot.pieces),
            "detail": snapshot.detail,
            "snapshot_sha256": result["snapshot_sha256"],
        }


class ManualConnector(Connector):
    name = "manual"

    def read_snapshot(self) -> ConnectorSnapshot:
        return ConnectorSnapshot(
            source="manual",
            state="manual_required",
            read_at=utc_now(),
            customers=[],
            pieces=[],
            detail="未設定門市系統連接器，查件需由店員人工確認。",
        )


class FixtureConnector(Connector):
    name = "fixture"

    def __init__(self, path: Path):
        self.path = path

    def read_snapshot(self) -> ConnectorSnapshot:
        if not self.path.exists():
            return ConnectorSnapshot(
                source="fixture",
                state="unreachable",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"找不到示範快照：{self.path}",
            )
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            customers = payload["customers"]
            pieces = payload["pieces"]
            if not isinstance(customers, list) or not isinstance(pieces, list):
                raise ValueError("customers/pieces 必須是陣列")
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            return ConnectorSnapshot(
                source="fixture",
                state="unknown",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"示範快照無法讀取：{exc}",
            )
        return ConnectorSnapshot(
            source="fixture",
            state="available",
            read_at=utc_now(),
            customers=customers,
            pieces=pieces,
        )


class SqliteReadonlyConnector(Connector):
    """Read the documented normalized SQLite tables using SQLite read-only URI."""

    name = "verified-sqlite"

    def __init__(self, path: Path):
        self.path = path

    def read_snapshot(self) -> ConnectorSnapshot:
        if not self.path.exists():
            return ConnectorSnapshot(
                source="verified-sqlite",
                state="unreachable",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"找不到 SQLite：{self.path}",
            )
        try:
            uri = self.path.as_uri() + "?mode=ro"
            con = sqlite3.connect(uri, uri=True)
            con.row_factory = sqlite3.Row
            customers = [dict(row) for row in con.execute(
                "SELECT customer_id, name, phone FROM customers"
            )]
            pieces = [dict(row) for row in con.execute(
                "SELECT piece_id, customer_id, order_no, item, status, price, received_at, ready_at "
                "FROM pieces"
            )]
            con.close()
        except (OSError, sqlite3.Error) as exc:
            return ConnectorSnapshot(
                source="verified-sqlite",
                state="unknown",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"SQLite 唯讀查詢失敗：{exc}",
            )
        return ConnectorSnapshot(
            source="verified-sqlite",
            state="available",
            read_at=utc_now(),
            customers=customers,
            pieces=pieces,
        )


class EhankReadonlyConnector(Connector):
    """Adapter for the eHank installation used by the pilot store.

    The adapter imports the store's existing ``ai_engine.db_manager`` and
    issues only the two SELECT statements documented by the pilot.  It never
    updates the MDB and returns ``unknown`` if the local POS cannot be read.
    """

    name = "ehank-mdb"

    def __init__(self, root: Path):
        self.root = root

    @staticmethod
    def _truthy(value: Any) -> bool:
        return value not in (None, "", 0, False)

    @staticmethod
    def _status(row: dict[str, Any]) -> str:
        if EhankReadonlyConnector._truthy(row.get("Dater")):
            return "picked"
        if str(row.get("State") or "").strip() == "完工" or EhankReadonlyConnector._truthy(row.get("Datei")):
            return "ready"
        return "processing"

    _cached_snapshot: ConnectorSnapshot | None = None
    _cached_at: float = 0.0
    _cached_mtime: float = 0.0

    def read_snapshot(self) -> ConnectorSnapshot:
        import time
        now = time.time()
        live_mdb = Path(r"C:\FXwash\eHank.mdb")
        current_mtime = live_mdb.stat().st_mtime if live_mdb.exists() else 0.0

        # If file modification time has not changed, reuse cached snapshot for instant response
        if self._cached_snapshot is not None and self._cached_mtime == current_mtime:
            return self._cached_snapshot

        if not self.root.exists():
            return ConnectorSnapshot(
                source="ehank-mdb",
                state="unreachable",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"找不到 eHank 根目錄：{self.root}",
            )
        import sys

        root_text = str(self.root)
        if root_text not in sys.path:
            sys.path.insert(0, root_text)
        try:
            from ai_engine import db_manager  # type: ignore

            con = db_manager.get_conn()
            customer_rows = con.execute("SELECT Cid, Cname, Tel, Mtel, Overm, Svm FROM Cus").fetchall()
            piece_rows = con.execute(
                "SELECT Did, Dno, Cid, Dname, Dcolor, Price, Indate, Pdate, Datei, Timei, "
                "Loc, State, Dater, Cnote, Pic, Mode FROM Det"
            ).fetchall()
            con.close()
        except Exception as exc:  # connector boundary must fail closed
            return ConnectorSnapshot(
                source="ehank-mdb",
                state="unknown",
                read_at=utc_now(),
                customers=[],
                pieces=[],
                detail=f"eHank 唯讀連接失敗：{type(exc).__name__}: {exc}",
            )

        customers = []
        known_cids = set()
        for row in customer_rows:
            values = list(row)
            cid = str(values[0] or "").strip()
            known_cids.add(cid)
            overm = 0
            try:
                overm = int(values[4]) if values[4] is not None else 0
            except Exception:
                try:
                    overm = int(float(values[4]))
                except Exception:
                    overm = 0
            svm = 0
            try:
                svm = int(values[5]) if values[5] is not None else 0
            except Exception:
                try:
                    svm = int(float(values[5]))
                except Exception:
                    svm = 0

            customers.append({
                "customer_id": cid,
                "name": str(values[1] or "").strip(),
                "phone": str(values[2] or "").strip(),
                "mobile": str(values[3] or "").strip(),
                "overm": overm,
                "svm": svm,
            })

        pieces = []
        for row in piece_rows:
            values = list(row)
            cid_col = str(values[2] or "").strip()
            state_col = str(values[11] or "").strip()
            # In eHank POS, customer id may be stored in Cid or State (especially older records)
            if cid_col in known_cids:
                matched_cid = cid_col
            elif state_col in known_cids:
                matched_cid = state_col
            else:
                matched_cid = cid_col or state_col

            price_val = 0
            try:
                price_val = int(values[5]) if values[5] is not None else 0
            except Exception:
                try:
                    price_val = int(float(values[5]))
                except Exception:
                    price_val = 0

            # Determine piece status
            dater = values[12]
            datei = values[8]
            if self._truthy(dater):
                p_status = "picked"
            elif self._truthy(datei) or state_col == "完工":
                p_status = "ready"
            else:
                p_status = "processing"

            normalized = {
                "piece_id": str(values[0] or "").strip(),
                "order_no": str(values[1] or "").strip(),
                "customer_id": matched_cid,
                "item": str(values[3] or "").strip(),
                "color": str(values[4] or "").strip(),
                "price": price_val,
                "received_at": str(values[6] or "").strip(),
                "ready_at": str(values[7] or "").strip(),
                "pickup_at": str(datei or "").strip(),
                "time": str(values[9] or "").strip(),
                "location": str(values[10] or "").strip(),
                "state_raw": state_col,
                "picked_raw": dater,
                "note": str(values[13] or "").strip(),
                "photo": str(values[14] or "").strip(),
                "mode": str(values[15] or "").strip(),
                "status": p_status,
            }
            pieces.append(normalized)
        snapshot = ConnectorSnapshot(
            source="ehank-mdb",
            state="available",
            read_at=utc_now(),
            customers=customers,
            pieces=pieces,
        )
        self._cached_snapshot = snapshot
        self._cached_at = now
        self._cached_mtime = current_mtime
        return snapshot


def connector_from_shop(shop: ShopConfig) -> Connector:
    lookup = shop.lookup
    mode = lookup.get("mode")
    if mode == "manual":
        return ManualConnector()
    if mode == "fixture":
        path_value = lookup.get("snapshot_path", "data/snapshot.json")
        path = shop.local_path(str(path_value))
        return FixtureConnector(path)
    if mode == "verified_sqlite":
        database = str(lookup.get("database_path", ""))
        path = Path(database).expanduser()
        if not path.is_absolute():
            path = shop.local_path(database)
        return SqliteReadonlyConnector(path.resolve())
    if mode == "ehank_readonly":
        root = shop.connector_root()
        if root is None:
            raise ConfigError("eHank 連接器找不到 root_path 或 root_env")
        return EhankReadonlyConnector(root)
    raise ConfigError(f"不支援的 lookup.mode：{mode}")

