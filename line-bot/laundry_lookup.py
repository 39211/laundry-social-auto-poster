# -*- coding: utf-8 -*-
"""查私享家洗衣系統：入庫可取 / 還沒好。只讀 eHank/fixture，不寫 POS。"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

REPO = Path(os.environ.get("LAUNDRY_REPO_ROOT", r"C:/Users/cyc39/laundry-repo"))
BIND = REPO / "data" / "line-customer-bind.json"
FIXTURE = REPO / "data" / "laundry-fixture.json"
EHANK_JSON = REPO / "secrets" / "ehank-0626" / "lookup.json"
DB_HINT = REPO / "data" / "laundry-db-path.txt"
WATCH = REPO / "data" / "laundry-watch.json"
# 預設字串必須維持 C:/FXwash；現役不設 LAUNDRY_EHANK_ROOT，行為不變。
EHANK_ROOT = Path(os.environ.get("LAUNDRY_EHANK_ROOT", r"C:/FXwash"))
_TAIPEI = timezone(timedelta(hours=8))
_METHOD_RANK = {"phone": 3, "wash_no": 2, "customer_no": 1}
EHANK_SOURCE = "ehank-mdb"

READY = {"stock", "paid", "shelved", "ready"}
WAIT = {"wash", "factory", "done", "received", "at_factory", "returned"}
GONE = {"picked"}
LABEL = {
    "wash": "待送洗",
    "factory": "洗廠中",
    "done": "回廠待入庫",
    "stock": "已入庫可取",
    "paid": "已付未取",
    "picked": "已取走",
}


@dataclass
class Piece:
    wash_no: str
    name: str
    status: str
    customer_no: str
    price: int | None = None

    @property
    def ready(self) -> bool:
        return self.status in READY

    @property
    def waiting(self) -> bool:
        return self.status in WAIT or (self.status not in READY and self.status not in GONE)

    @property
    def picked(self) -> bool:
        return self.status in GONE


@dataclass
class Lookup:
    query: str
    customer_no: str = ""
    name: str = ""
    phone: str = ""
    source: str = "none"
    pieces: list[Piece] = field(default_factory=list)
    ambiguous: bool = False
    # eHank Cus.Overm: negative means unpaid; positive means account credit.
    # Keep None when the source did not provide a trustworthy amount.
    balance: int | None = None
    # phone / customer_no / wash_no；沒比中則空白。不改變 lookup 的比對規則。
    matched_by: str = ""

    @property
    def found(self) -> bool:
        return bool(self.customer_no) and not self.ambiguous

    @property
    def total_price(self) -> int | None:
        """Return the itemized total only when every returned item has a price."""
        if not self.pieces or any(piece.price is None for piece in self.pieces):
            return None
        return sum(piece.price or 0 for piece in self.pieces)


def db_path() -> Path | None:
    if DB_HINT.exists():
        p = Path(DB_HINT.read_text(encoding="utf-8").strip())
        if p.is_file():
            return p
    p = REPO / "data" / "私享家.db"
    if p.is_file():
        return p
    return None


def _digits(s: str) -> str:
    return "".join(ch for ch in s if ch.isdigit())


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("mbcs", errors="replace").strip()
    return str(value).strip()


def _money(value, *, signed: bool = False) -> int | None:
    """Normalize a POS amount without silently inventing a number."""
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or (not signed and amount < 0):
        return None
    if amount != amount.to_integral_value():
        return None
    return int(amount)


def _mobile(s: str) -> str:
    """Normalize a Taiwan mobile number; partial suffixes are deliberately invalid."""
    d = _digits(s)
    if d.startswith("8869") and len(d) == 12:
        d = "0" + d[3:]
    elif d.startswith("9") and len(d) == 9:
        d = "0" + d
    return d if len(d) == 10 and d.startswith("09") else ""


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _normalize_method(method: str) -> str:
    text = str(method or "").strip()
    return text if text in _METHOD_RANK else "unknown"


def _method_rank(method: str) -> int:
    """舊記錄沒有 method 時視為 unknown（0）。"""
    return _METHOD_RANK.get(str(method or "").strip(), 0)


def _keep_stronger_method(old_method: str, new_method: str) -> bool:
    """同客重綁時，舊方法較強或同等就保留，不得降級。"""
    return _method_rank(old_method) >= _method_rank(new_method)


def _bound_at_now() -> str:
    return datetime.now(_TAIPEI).isoformat(timespec="seconds")


def _atomic_bind_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


_BIND_LOCK = threading.Lock()


def bind_uid(uid: str, customer_no: str, phone: str = "", method: str = "") -> None:
    """記下客號，以及怎麼綁上的。同客不降級；換客號則整筆換掉。"""
    with _BIND_LOCK:
        data = _load_json(BIND)
        previous = data.get(uid) if isinstance(data.get(uid), dict) else {}
        new_method = _normalize_method(method)
        same_customer = bool(previous) and str(previous.get("customer_no") or "") == str(customer_no or "")
        if same_customer and _keep_stronger_method(str(previous.get("method") or ""), new_method):
            return
        data[uid] = {
            "customer_no": customer_no,
            "phone": phone,
            "method": new_method,
            "bound_at": _bound_at_now(),
        }
        _atomic_bind_write(BIND, json.dumps(data, ensure_ascii=False, indent=2))


def bound_customer(uid: str) -> str:
    return (_load_json(BIND).get(uid) or {}).get("customer_no") or ""


def uid_for_customer(customer_no: str) -> str:
    for uid, row in _load_json(BIND).items():
        if (row or {}).get("customer_no") == customer_no:
            return uid
    return ""


def _from_fixture() -> tuple[list[dict], list[dict]]:
    data = _load_json(FIXTURE)
    garments = []
    for raw in data.get("garments") or []:
        row = dict(raw)
        # 到件需要的欄位；fixture 沒給就當空白。
        row["donly"] = _text(row.get("donly"))
        row["datei"] = _text(row.get("datei"))
        row["loc"] = _text(row.get("loc"))
        row["dater"] = _text(row.get("dater"))
        garments.append(row)
    return list(data.get("customers") or []), garments


def _from_sqlite(path: Path) -> tuple[list[dict], list[dict]]:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        try:
            cust = [dict(r) for r in con.execute("SELECT no, name, phone, balance FROM customers")]
        except sqlite3.OperationalError:
            cust = [dict(r) for r in con.execute("SELECT no, name, phone FROM customers")]
        pieces = []
        for r in con.execute(
            "SELECT id, customer_no, wash_no, status, payload_json FROM garments"
        ):
            name = ""
            try:
                payload = json.loads(r["payload_json"] or "{}")
                name = str(payload.get("name") or payload.get("nm") or payload.get("item") or "")
            except json.JSONDecodeError:
                payload = {}
            pieces.append(
                {
                    "id": r["id"],
                    "customer_no": r["customer_no"],
                    "wash_no": r["wash_no"] or "",
                    "name": name,
                    "status": (r["status"] or "").lower(),
                    "price": _money(payload.get("price") or payload.get("Price")),
                }
            )
        return cust, pieces
    finally:
        con.close()


# 欄位順序就是 SELECT 順序。金額只讀 Tpay，不重算 Price*Qty。
_DET_COLUMNS = (
    "Did",
    "Dno",
    "Cid",
    "Dname",
    "Dcolor",
    "Price",
    "Indate",
    "Pdate",
    "Datei",
    "Timei",
    "Loc",
    "State",
    "Dater",
    "Cnote",
    "Pic",
    "Tpay",
    "Donly",
)


def _amount_column_name() -> str:
    return "Tpay"


def _det_sql() -> str:
    return "SELECT " + ", ".join(_DET_COLUMNS) + " FROM Det"


def _cell(row, name: str):
    return row[_DET_COLUMNS.index(name)]


def _from_ehank() -> tuple[list[dict], list[dict]]:
    """Read the live eHank MDB through its existing read-only connector.

    This adapter only executes SELECT statements.  It never calls the connector's
    write helpers and never writes the MDB.  An unavailable or malformed source
    returns an empty result so the caller fails closed to manual handling.
    """
    if not EHANK_ROOT.is_dir():
        return [], []
    root = str(EHANK_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from ai_engine import db_manager

        con = db_manager.get_conn()
    except Exception:
        return [], []
    customers: list[dict] = []
    garments: list[dict] = []
    try:
        cur = con.cursor()
        cur.execute("SELECT Cid, Cname, Tel, Mtel, Overm FROM Cus")
        for row in cur.fetchall():
            customers.append(
                {
                    "no": _text(row[0]),
                    "name": _text(row[1]),
                    "phone": _text(row[3]) or _text(row[2]),
                    "balance": _money(row[4], signed=True),
                }
            )

        cur.execute(_det_sql())
        amount_at = _DET_COLUMNS.index(_amount_column_name())
        for row in cur.fetchall():
            state = _text(_cell(row, "State"))
            date_in = _text(_cell(row, "Datei"))
            date_out = _text(_cell(row, "Dater"))
            if date_out:
                status = "picked"
            elif state == "完工" or date_in:
                status = "stock"
            else:
                status = "wash"
            garments.append(
                {
                    "id": _text(_cell(row, "Did")),
                    "customer_no": _text(_cell(row, "Cid")),
                    "wash_no": _text(_cell(row, "Dno")),
                    "name": _text(_cell(row, "Dname")) or "衣物",
                    "status": status,
                    "price": _money(row[amount_at]),
                    "donly": _text(_cell(row, "Donly")),
                    "datei": date_in,
                    "loc": _text(_cell(row, "Loc")),
                    "dater": date_out,
                }
            )
        return customers, garments
    except Exception:
        return [], []
    finally:
        try:
            con.close()
        except Exception:
            pass


def _cid_key(s: str) -> str:
    d = _digits(s).lstrip("0")
    return d or "0"


def inventory() -> tuple[list[dict], list[dict], str]:
    if os.environ.get("LAUNDRY_LOOKUP_FIXTURE") == "1":
        cust, pieces = _from_fixture()
        return cust, pieces, "fixture"
    cust, pieces = _from_ehank()
    if cust or pieces:
        return cust, pieces, EHANK_SOURCE
    path = db_path()
    if path:
        try:
            cust, pieces = _from_sqlite(path)
            if pieces or cust:
                return cust, pieces, f"sqlite:{path}"
        except sqlite3.Error:
            pass
    # 0626 eHank zip is not the live shop book. Do not serve it as 客人資料.
    return [], [], "none"


def lookup(query: str) -> Lookup:
    q = (query or "").strip()
    if not q:
        return Lookup(query=q)
    cust, pieces, source = inventory()
    d = _digits(q)
    cid_hits: list[dict] = []
    phone_hits: list[dict] = []
    for c in cust:
        no = _text(c.get("no"))
        phone = _mobile(c.get("phone"))
        if q == no or (d and d == _digits(no)) or (d and _cid_key(d) == _cid_key(no) and len(d) <= 6):
            cid_hits.append(c)
        elif _mobile(q) and _mobile(q) == phone:
            phone_hits.append(c)
    matched_by = ""
    if cid_hits:
        matched_by = "customer_no"
    elif phone_hits:
        matched_by = "phone"
    matches = cid_hits or phone_hits
    wash_hits = [g for g in pieces if str(g.get("wash_no") or "") == q]
    if not matches and wash_hits:
        matched_by = "wash_no"
        no = wash_hits[0]["customer_no"]
        matches = [c for c in cust if str(c.get("no")) == no] or [{"no": no, "name": "", "phone": ""}]
    uniq = []
    seen = set()
    for c in matches:
        no = str(c.get("no") or "")
        if no in seen:
            continue
        seen.add(no)
        uniq.append(c)
    if len(uniq) > 1:
        return Lookup(query=q, source=source, ambiguous=True, matched_by=matched_by)
    if not uniq:
        return Lookup(query=q, source=source)
    c = uniq[0]
    no = str(c.get("no") or "")
    mine = [g for g in pieces if _cid_key(str(g.get("customer_no") or "")) == _cid_key(no)]
    return Lookup(
        query=q,
        customer_no=no,
        name=str(c.get("name") or ""),
        phone=str(c.get("phone") or ""),
        source=source,
        balance=_money(c.get("balance"), signed=True),
        matched_by=matched_by,
        pieces=[
            Piece(
                wash_no=str(g.get("wash_no") or ""),
                name=str(g.get("name") or "衣物"),
                status=str(g.get("status") or "").lower(),
                price=_money(g.get("price")),
                customer_no=no,
            )
            for g in mine
        ],
    )


def guest_copy(row: Lookup) -> str:
    if row.source == "none":
        return "店裡的洗衣系統正本這台還沒接上，我先幫您問櫃台。"
    if row.ambiguous:
        return "這組號碼對到不只一位，您把客號跟我說就好。"
    if not row.found:
        return "店裡這組還沒對到。您再給我客號，或收據上的洗號。"
    if not row.pieces:
        lines = [f"客號 {row.customer_no} 我對到了，店裡現在沒有在店的衣服。"]
        balance = _balance_copy(row.balance)
        if balance:
            lines.append(balance)
        return "\n".join(lines)
    ready = [p for p in row.pieces if p.ready]
    wait = [p for p in row.pieces if p.waiting]
    gone = [p for p in row.pieces if p.picked]
    lines = []
    if ready:
        bits = "、".join(_piece_copy(p) for p in ready)
        lines.append(f"可以取了：{bits}。")
    if wait:
        bits = "、".join(
            f"{_piece_copy(p)}，還在{LABEL.get(p.status, p.status)}" for p in wait
        )
        lines.append(f"還沒好：{bits}。")
    if gone and not ready and not wait:
        bits = "、".join(_piece_copy(p) for p in gone)
        lines.append(f"這幾件已經取走了：{bits}。")
    if row.total_price is not None:
        lines.append(f"品項合計：{row.total_price:,} 元。")
    elif any(piece.price is None for piece in row.pieces):
        lines.append("部分品項尚未有價格，金額請以門市確認。")
    balance = _balance_copy(row.balance)
    if balance:
        lines.append(balance)
    lines.append("金額先供您查閱，最後仍以門市實際結帳為準。")
    return "\n".join(lines)


def _piece_copy(piece: Piece) -> str:
    label = f"{piece.name}（{piece.wash_no or '無洗號'}）"
    if piece.price is not None:
        return f"{label}｜{piece.price:,} 元"
    return label


def _balance_copy(balance: int | None) -> str:
    if balance is None:
        return ""
    if balance < 0:
        return f"帳務狀態：目前尚欠款 {abs(balance):,} 元。"
    if balance > 0:
        return f"帳戶餘額：{balance:,} 元。"
    return "帳務狀態：餘額 0 元。"


def guest_ready_flag(row: Lookup) -> str:
    if not row.found or not row.pieces:
        return "unknown"
    if any(p.ready for p in row.pieces):
        return "ready" if not any(p.waiting for p in row.pieces) else "mixed"
    if any(p.waiting for p in row.pieces):
        return "not_ready"
    return "picked"


def snapshot_ready_keys() -> set[str]:
    _, pieces, _ = inventory()
    return {f"{g.get('customer_no')}:{g.get('wash_no')}:{g.get('id')}" for g in pieces if str(g.get("status") or "").lower() in READY}


def newly_ready() -> list[str]:
    now = snapshot_ready_keys()
    prev = set(_load_json(WATCH).get("ready") or [])
    WATCH.parent.mkdir(parents=True, exist_ok=True)
    WATCH.write_text(json.dumps({"ready": sorted(now)}, ensure_ascii=False), encoding="utf-8")
    return sorted(now - prev)
