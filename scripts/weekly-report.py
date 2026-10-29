#!/usr/bin/env python3
"""Offline weekly owner report; Python 3.14 stdlib, no network or LINE calls.

Dates are ISO weeks in UTC+08:00. By default report the last completed week.
An explicit current week compares only completed calendar days with the same
weekdays last week. Publication numbers are local ledger evidence, not a live
platform check. Source directories are read-only; only --out receives output.
"""

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys


TAIPEI = timezone(timedelta(hours=8))
PLATFORMS = {"facebook": "FB", "instagram": "IG", "youtube": "YT", "tiktok": "TikTok"}
ALIASES = {"fb": "facebook", "ig": "instagram", "yt": "youtube", **{p: p for p in PLATFORMS}}
FUNNEL = {
    "view_knowledge_hub": "知識入口瀏覽", "view_search_answer": "答案頁瀏覽",
    "view_service": "服務頁瀏覽", "click_answer_from_hub": "入口至答案",
    "click_service_from_hub": "入口至服務", "click_service_from_answer": "答案至服務",
    "click_phone": "電話點擊", "click_line_cta": "LINE 按鈕點擊",
    "view_article": "文章瀏覽", "click_service_from_article": "文章至服務",
    "line_click": "LINE 事件",
}
POST_FOLDERS = ("posted-log", "scheduled-log", "feature-posted-log", "youtube-log")
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?")
ERROR = re.compile(r"\b(?:error|critical|exception|failed|traceback)\b|\w+Error:|\b5\d\d\b", re.I)


def parse_time(value):
    """Naive local logger timestamps mean Taipei; Unix timestamps mean UTC."""
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if value > 100_000_000_000:
                value /= 1000
            return datetime.fromtimestamp(value, TAIPEI)
        if isinstance(value, str) and value.strip():
            parsed = datetime.fromisoformat(value.strip().replace(",", ".").replace("Z", "+00:00"))
            return parsed.replace(tzinfo=TAIPEI) if parsed.tzinfo is None else parsed.astimezone(TAIPEI)
    except (ValueError, OverflowError, OSError):
        pass
    return None


def first_time(row, *fields):
    return next((stamp for key in fields if (stamp := parse_time(row.get(key))) is not None), None)


def iso_week(value):
    if not re.fullmatch(r"\d{4}-W\d{2}", value):
        raise ValueError("ISO 週格式須為 yyyy-Www，例如 2026-W44")
    try:
        return date.fromisocalendar(int(value[:4]), int(value[6:]), 1)
    except ValueError as exc:
        raise ValueError("無效的 ISO 週：" + value) from exc


def stamp_text(value):
    return value.strftime("%Y-%m-%d %H:%M +08:00") if value else "未知（無時間）"


def safe_label(value, limit=65):
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value))[:limit]
    return text.replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;").replace("`", "")


def count_value(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


class Reader:
    def __init__(self):
        self.warnings = set()

    def text(self, path, label):
        try:
            return path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as exc:
            self.warnings.add(f"{label} 讀取失敗（{type(exc).__name__}）")
            return None

    def json(self, path, label):
        text = self.text(path, label)
        if text is None:
            return None
        try:
            return json.loads(text)
        except (ValueError, RecursionError):
            self.warnings.add(f"{label} JSON 損壞")
            return None

    def files(self, path, pattern, label):
        try:
            if not path.is_dir():
                self.warnings.add(f"{label} 目錄不存在")
                return None
            return sorted(path.glob(pattern))
        except OSError:
            self.warnings.add(f"{label} 目錄不可讀")
            return None


@dataclass
class Metric:
    total: int
    known: int
    expected: int

    @property
    def complete(self):
        return self.expected > 0 and self.known == self.expected

    def display(self, previous=None):
        if not self.complete:
            return f"未知（已量測 {self.known}/{self.expected} 日，已知合計 {self.total}；缺日或未量測）"
        delta = f"{self.total - previous.total:+d}" if previous and previous.complete else "增減未知"
        return f"{self.total}（{delta}）"


def lead_metrics(data, days, reader, now):
    rows = {}
    for month in sorted({day.strftime("%Y-%m") for day in days}):
        obj = reader.json(data / "leads" / (month + ".json"), "leads/" + month)
        if isinstance(obj, dict) and isinstance(obj.get("days"), dict):
            rows.update(obj["days"])
        elif obj is not None:
            reader.warnings.add("leads 日期結構未知")
    totals = Counter()
    known = Counter()
    sources = Counter()
    source_days = 0
    for day in days:
        row = rows.get(day.isoformat())
        if not isinstance(row, dict):
            continue
        recorded = parse_time(row.get("line_clicks_recorded_at"))
        if recorded is None or recorded > now:
            continue
        status = row.get("source_clicks_status")
        if status in ("measured", "total_only") and count_value(row.get("line_clicks_total")):
            totals["line"] += row["line_clicks_total"]
            known["line"] += 1
        events = row.get("search_funnel_events")
        if row.get("search_funnel_status") == "measured" and isinstance(events, dict):
            for name in FUNNEL:
                if count_value(events.get(name)):
                    totals[name] += events[name]
                    known[name] += 1
        by_source = row.get("source_clicks")
        if status == "measured" and isinstance(by_source, dict) and all(count_value(v) for v in by_source.values()):
            sources.update(by_source)
            source_days += 1
    return ({k: Metric(totals[k], known[k], len(days)) for k in ("line", *FUNNEL)},
            sources, Metric(sum(sources.values()), source_days, len(days)))


def publication_metrics(data, start, end, now, reader):
    sets = {p: {k: set() for k in ("scheduled", "published", "failed", "uncertain")} for p in PLATFORMS}
    sets["youtube"].update({k: set() for k in ("uploaded", "unconfirmed")})
    known = {p: set() for p in PLATFORMS}
    broken = set()
    parents = {}
    events = []
    failed_schedules = []
    approvals = set()
    youtube_public_times = set()

    def find(key):
        parents.setdefault(key, key)
        if parents[key] != key:
            parents[key] = find(parents[key])
        return parents[key]

    for folder in (*POST_FOLDERS, "approved-log"):
        paths = reader.files(data / folder, "*.json", folder)
        if paths is None:
            broken.add(folder)
            continue
        if folder == "youtube-log":
            known["youtube"].update(("uploaded", "scheduled", "published"))
        for path in paths:
            # Approval fingerprints/digests are metadata, not publication rows.
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", path.stem):
                continue
            obj = reader.json(path, folder + "/" + path.stem)
            if not isinstance(obj, list):
                if folder == "youtube-log" or start.date().isoformat() <= path.stem < end.date().isoformat():
                    broken.add(folder)
                    reader.warnings.add(f"{folder} 週內紀錄結構未知")
                continue
            for row in obj:
                if not isinstance(row, dict):
                    broken.add(folder)
                    continue
                platform = ALIASES.get(str(row.get("platform", "youtube" if folder == "youtube-log" else "")).lower())
                if platform is None:
                    continue
                if platform == "youtube" and folder not in ("youtube-log", "approved-log"):
                    continue
                if folder == "youtube-log":
                    video_status = str(row.get("video_status", "")).lower()
                    if row.get("dry_run") is True or video_status in ("dry_run", "dry-run", "skipped", "cancelled", "canceled"):
                        continue
                    uploaded = first_time(row, "uploaded_at")
                    if uploaded and uploaded > now:
                        continue
                    identifier = str(row.get("video_id") or "")
                    if not identifier:
                        broken.add(folder)
                        reader.warnings.add("youtube-log 有無影片 ID 的紀錄")
                        continue
                    logical = f"youtube:id:{identifier}"
                    scheduled = first_time(row, "scheduled_publish_at")
                    publication = first_time(row, "published_at")
                    if uploaded and start <= uploaded < end:
                        events.append(("youtube", "uploaded", logical))
                    if scheduled and start <= scheduled < end:
                        events.append(("youtube", "scheduled", logical))
                    if video_status == "published" and publication and publication <= now:
                        youtube_public_times.add(logical)
                        if start <= publication < end:
                            events.append(("youtube", "published", logical))
                    else:
                        times = (uploaded, scheduled, publication)
                        fallback = parse_time(row.get("date", path.stem)) if not any(times) else None
                        if any(stamp and start <= stamp < end for stamp in (*times, fallback)):
                            events.append(("youtube", "unconfirmed", logical))
                    continue
                status = str(row.get("status", row.get("video_status", ""))).lower()
                if row.get("dry_run") is True or status in ("dry_run", "dry-run", "skipped", "cancelled", "canceled"):
                    continue
                day = str(row.get("date", path.stem))
                fallback = parse_time(day)
                recorded = first_time(row, "created_at", "at", "uploaded_at")
                if recorded and recorded > now:
                    continue
                scheduled = first_time(row, "scheduled_publish_at", "scheduled_publish_time")
                publication = first_time(row, "published_at", "created_at", "at", "uploaded_at") or fallback
                planned = scheduled or fallback
                if folder == "approved-log":
                    if status == "approved" and planned and start <= planned < end:
                        approvals.add((platform, day, str(row.get("slot", ""))))
                    continue
                known[platform].add("failed")
                if folder != "scheduled-log":
                    known[platform].add("published")
                if folder == "scheduled-log" or scheduled or status == "scheduled":
                    known[platform].add("scheduled")
                identifier = str(row.get("post_id") or row.get("video_id") or row.get("scheduled_post_id") or "")
                if row.get("slug"):
                    logical = f"{platform}:feature:{day}:{row['slug']}"
                elif "slot" in row:
                    logical = f"{platform}:slot:{day}:{row['slot']}"
                elif identifier:
                    logical = f"{platform}:id:{identifier}"
                else:
                    reader.warnings.add(f"{folder} 有無法去重的紀錄")
                    continue
                key = find(logical)
                if identifier:
                    parents[find(f"{platform}:id:{identifier}")] = key
                is_schedule = folder == "scheduled-log" or scheduled is not None or status == "scheduled"
                if is_schedule and planned and start <= planned < end:
                    if status in ("failed", "error", "missed"):
                        # Failures count affected items, not retries/HTTP attempts.
                        events.append((platform, "failed", logical))
                        failed_schedules.append((logical, recorded))
                    elif status not in ("", "scheduled", "success", "published") or not identifier:
                        events.append((platform, "uncertain", logical))
                    else:
                        events.append((platform, "scheduled", logical))
                if status in ("success", "published") and identifier:
                    if publication and start <= publication < end and publication <= now:
                        events.append((platform, "published", logical))
                if not is_schedule and status in ("failed", "error", "missed"):
                    if publication and start <= publication < end and publication <= now:
                        events.append((platform, "failed", logical))
    for platform, kind, key in events:
        sets[platform][kind].add(find(key))
    sets["youtube"]["unconfirmed"].difference_update(find(key) for key in youtube_public_times)
    failed_count = len({find(key) for key, _ in failed_schedules})
    latest = max((when for _, when in failed_schedules if when), default=None)
    return sets, known, broken, failed_count, latest, len(approvals)


def error_events(bot, start, end, now, reader):
    paths = reader.files(bot, "*.err", "line-bot")
    paths = [p for p in paths if "webhook" in p.name.lower()] if paths is not None else []
    if not paths:
        return "未知（缺 webhook 錯誤日誌）", "未知（無時間）"
    errors = []
    undated = False
    for path in paths:
        text = reader.text(path, "webhook.err")
        if text is None:
            undated = True
            continue
        current, is_error = None, False
        for line in text.splitlines():
            match = STAMP.search(line)
            when = parse_time(match.group()) if match else None
            if when:
                if current and is_error and start <= current < end and current <= now:
                    errors.append(current)
                current, is_error = when, bool(ERROR.search(line))
            elif line.strip():
                if current is None:
                    undated = True
                else:
                    is_error |= bool(ERROR.search(line))
        if current and is_error and start <= current < end and current <= now:
            errors.append(current)
    count = f"未知（日誌無時間；已辨識 {len(errors)}）" if undated else str(len(errors))
    return count, stamp_text(max(errors, default=None)) if errors or undated else "—"


def lock_snapshot(data, now, reader):
    stale = []
    missing = False
    for folder, minutes in (("run-locks", 45), ("publish-locks", 30)):
        paths = reader.files(data / folder, "*", folder)
        if paths is None:
            missing = True
            continue
        for path in paths:
            if not path.is_file():
                continue
            text = reader.text(path, folder)
            if text is None:
                missing = True
                continue
            try:
                obj = json.loads(text)
            except ValueError:
                obj = None
            when = first_time(obj, "started_at", "locked_at", "created_at", "at", "timestamp") if isinstance(obj, dict) else parse_time(text)
            if when is None:
                try:
                    when = datetime.fromtimestamp(path.stat().st_mtime, TAIPEI)
                except OSError:
                    missing = True
                    continue
            if now - when >= timedelta(minutes=minutes):
                stale.append(when)
    count = f"未知（鎖目錄不可讀；已見 {len(stale)}）" if missing else str(len(stale))
    return count, stamp_text(max(stale, default=None)) if stale else "—"


def tunnel_events(data, bot, start, end, now, reader):
    paths = [p for p in (data / "tunnel_events.jsonl", data.parent / "tunnel_events.jsonl", bot / "tunnel_events.jsonl") if p.is_file()]
    if not paths:
        return "未知（缺 tunnel_events.jsonl）", "未知（無時間）"
    events = set()
    unknown = False
    for path in paths:
        text = reader.text(path, "tunnel_events")
        if text is None:
            unknown = True
            continue
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError:
                unknown = True
                continue
            if not isinstance(row, dict):
                unknown = True
                continue
            when = first_time(row, "at", "timestamp", "ts", "time", "created_at")
            if when is None:
                unknown = True
                continue
            event = str(row.get("event", row.get("type", "")))
            if re.search(r"error|fail|disconnect|restart|down", event, re.I) and start <= when < end and when <= now:
                events.add((when, event))
    return (f"未知（有無時間或損壞列；已見 {len(events)}）" if unknown else str(len(events)),
            stamp_text(max((when for when, _ in events), default=None)) if events or unknown else "—")


def line_counts(data, start, end, now, reader):
    text = reader.text(data / "staff-inbox.jsonl", "staff-inbox")
    queries, unknown = set(), text is None
    for index, line in enumerate((text or "").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError:
            unknown = True
            continue
        if not isinstance(row, dict):
            unknown = True
            continue
        if row.get("kind") != "query":
            continue
        when = first_time(row, "when", "created_at", "at", "timestamp")
        if when is None:
            unknown = True
        elif start <= when < end and when <= now:
            queries.add(str(row.get("event_id") or row.get("id") or index))
    query = f"未知（缺檔／缺時間；已見 {len(queries)}）" if unknown else str(len(queries))
    obj = reader.json(data / "arrival-state.json", "arrival-state")
    sends = set()
    valid = isinstance(obj, dict) and isinstance(obj.get("last_sent"), dict)
    if valid:
        for key, value in obj["last_sent"].items():
            when = first_time(value, "sent_at", "at", "timestamp") if isinstance(value, dict) else parse_time(value)
            if when is None:
                valid = False
            elif start <= when < end and when <= now:
                sends.add(str(key))
        deliveries = obj.get("deliveries", {})
        if not isinstance(deliveries, dict):
            valid = False
        else:
            for key, value in deliveries.items():
                if not isinstance(value, dict):
                    valid = False
                    continue
                if value.get("status") not in ("sent", "success", "delivered"):
                    continue
                when = first_time(value, "sent_at", "at", "timestamp")
                if when is None:
                    valid = False
                elif start <= when < end and when <= now:
                    sends.add(str(key))
    return query, str(len(sends)) if valid else "未知（通知成功時間／結構不明）"


def inventory(data, reports, reader):
    notes = []
    for name, pattern in (("ga4-exports", "*.csv"), ("insights", "*.json"), ("conversions", "*.json")):
        paths = reader.files(data / name, "**/" + pattern, name)
        notes.append(f"{name} {len(paths)} 檔" if paths is not None else f"{name} 未知")
    text = reader.text(reports / "daily-progress.md", "daily-progress")
    dates = re.findall(r"^## (\d{4}-\d{2}-\d{2})", text or "", flags=re.M)
    notes.append("進步帳最新 " + max(dates) if dates else "進步帳未知")
    return "；".join(notes)


def build_report(data, reports, bot, week, now, llm=False):
    first = iso_week(week)
    start = datetime.combine(first, time(), TAIPEI)
    end = start + timedelta(days=7)
    reader = Reader()
    completed = max(0, min(7, (now.date() - first).days))
    days = [first + timedelta(days=i) for i in range(completed)]
    metrics, sources, source_coverage = lead_metrics(data, days, reader, now)
    previous, previous_sources, previous_coverage = lead_metrics(data, [d - timedelta(days=7) for d in days], reader, now)
    posts, known, broken, schedule_failures, last_failure, approvals = publication_metrics(data, start, end, now, reader)
    locks, last_lock = lock_snapshot(data, now, reader)
    errors, last_error = error_events(bot, start, end, now, reader)
    tunnels, last_tunnel = tunnel_events(data, bot, start, end, now, reader)
    queries, sends = line_counts(data, start, end, now, reader)
    source_note = inventory(data, reports, reader)
    failed = sum(len(items["failed"]) for items in posts.values())
    uncertain = sum(len(items["uncertain"]) for items in posts.values())
    published = sum(len(items["published"]) for items in posts.values())
    failure_summary = f"有 {failed} 篇曾失敗" + (f"、排程狀態未確認 {uncertain} 筆" if uncertain else "")
    missing_publication = bool(broken & {"posted-log", "feature-posted-log", "youtube-log"}) or not any("published" in kinds for kinds in known.values())
    conclusion = (failure_summary + "，優先修復發布流程。" if failed else
                  f"排程狀態未確認 {uncertain} 筆，先核對平台再決定是否補發。" if uncertain else
                  f"發文未知（台帳缺失／損壞）；LINE 點擊 {metrics['line'].display(previous['line'])}。" if missing_publication else
                  f"本機成功發文紀錄 {published} 篇；LINE 點擊 {metrics['line'].display(previous['line'])}。")
    status = "本週未結束" if start <= now < end else "未來週" if now < start else "已結束週"
    lines = [f"# 私享家週報 {week}", f"一句話結論：{conclusion}",
             f"期間：{first}～{(end - timedelta(days=1)).date()}（台北）；截至 {stamp_text(now)}；{status}。",
             f"成效：只計已結束的完整日 {completed}/7，與上週相同星期比較；今日不計。", "",
             "| 平台 | 排程 | 實發 | 失敗 |", "| --- | ---: | ---: | ---: |"]
    for platform, label in PLATFORMS.items():
        if platform == "youtube":
            continue
        cells = []
        for kind in ("scheduled", "published", "failed"):
            relevant = set(POST_FOLDERS) if kind == "failed" else {"scheduled-log", "feature-posted-log", "youtube-log"} if kind == "scheduled" else {"posted-log", "feature-posted-log", "youtube-log"}
            if broken & relevant:
                cell = "未知（發布來源缺檔／損壞）"
            elif kind not in known[platform]:
                cell = "未知（無該平台台帳）"
            else:
                cell = str(len(posts[platform][kind]))
            if kind == "scheduled" and posts[platform]["uncertain"]:
                cell += f"（另 {len(posts[platform]['uncertain'])} 未確認）"
            cells.append(cell)
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    youtube = posts["youtube"]
    if "youtube-log" in broken:
        youtube_cells = ["未知（youtube-log 缺檔／損壞）"] * 3
    else:
        confirmed = str(len(youtube["published"]))
        if youtube["unconfirmed"]:
            confirmed = f"未知（已確認 {confirmed}；{len(youtube['unconfirmed'])} 筆待確認）"
        youtube_cells = [str(len(youtube["uploaded"])), str(len(youtube["scheduled"])), confirmed]
    lines.extend(["", "| 平台 | 上傳 | 預定公開 | 已確認公開 |", "| --- | ---: | ---: | ---: |",
                  "| YT | " + " | ".join(youtube_cells) + " |"])
    lines.extend(["", "| 成效／來源 | 本期（較上週） |", "| --- | ---: |",
                  f"| LINE 點擊 | {metrics['line'].display(previous['line'])} |"])
    for name, label in FUNNEL.items():
        lines.append(f"| 搜尋：{label} | {metrics[name].display(previous[name])} |")
    if source_coverage.complete:
        top = sorted(sources, key=lambda key: (-sources[key], key))[:5]
        if not top:
            lines.append("| 來源前 5 | 0（已量測，無來源點擊） |")
        for source in top:
            delta = f"{sources[source] - previous_sources[source]:+d}" if previous_coverage.complete else "增減未知"
            lines.append(f"| 來源：{safe_label(source)} | {sources[source]}（{delta}） |")
    else:
        lines.append(f"| 來源前 5 | {source_coverage.display()} |")
    schedule_count = str(schedule_failures) if not (broken & {"scheduled-log", "feature-posted-log", "youtube-log"}) else "未知（排程來源不完整）"
    lines.extend(["", "| 異常 | 次數／筆數 | 最後一次時間 |", "| --- | ---: | --- |",
                  f"| 失敗排程 | {schedule_count} | {stamp_text(last_failure) if schedule_failures else '—'} |",
                  f"| 鎖檔殘留（目前快照） | {locks} | {last_lock} |",
                  f"| webhook 錯誤 | {errors} | {last_error} |",
                  f"| 隧道異常 | {tunnels} | {last_tunnel} |", "", "下週建議三件事（規則）："])
    suggestions = []
    if failed:
        suggestions.append(f"核對 {failed} 篇失敗紀錄，修復後先驗證成功狀態再補發。")
    if uncertain:
        suggestions.append(f"核對 {uncertain} 筆未確認排程，確認平台狀態與貼文 ID 後再處理。")
    if locks != "0":
        suggestions.append("查明鎖檔是否仍由工作持有，再決定殘留鎖的處理方式。")
    if errors != "0":
        suggestions.append("檢查 webhook，補齊含時間的錯誤記錄後再統計本週異常。")
    if not metrics["line"].complete or not source_coverage.complete:
        suggestions.append("補齊 leads 日帳的量測狀態、點擊與來源，避免以缺資料判斷成效。")
    if source_coverage.complete and previous_coverage.complete:
        for source, platform in (("yt", "youtube"), ("fb", "facebook"), ("ig", "instagram"), ("tiktok", "tiktok")):
            delta = sources[source] - previous_sources[source]
            if delta > 0 and "published" in known[platform] and not posts[platform]["published"] and not posts[platform].get("unconfirmed"):
                suggestions.append(f"來源 {source} 點擊增加 {delta}、該平台成功紀錄 0；核對歸因後安排一篇相關內容。")
    suggestions.extend(["核對已到期排程的實發證據，補齊 FB／IG／YT／TikTok 的記錄。",
                        "以來源前五的有效點擊決定一項內容測試，下週比較同口徑數字。",
                        "在 B4 工時表填入實際人工時間，對照本週產出。"])
    lines.extend(f"{i}. {item}" for i, item in enumerate(suggestions[:3], 1))
    warnings = "；".join(sorted(reader.warnings))
    lines.extend(["", "資料口徑與未知欄位：",
                  "發文為本機台帳去重筆數；0＝無該類記錄，不代表線上無發文。實發須成功＋ID；排程到期不自動視為實發。",
                  f"排程按預定日、實發按成功時間歸週；失敗為曾失敗項目，重試不重複；核准 {approvals} 筆僅供核對，不算排程。",
                  "YT 只讀 youtube-log：上傳按 uploaded_at、預定公開按 scheduled_publish_at；已確認公開須 video_status=published＋published_at；缺確認／公開時間為未知。",
                  "鎖檔為產報時快照（run 超過 45 分、publish 超過 30 分），非每週發生次數；webhook 按含時間錯誤區塊計數。",
                  f"AI 端 LINE：查件 {queries}；通知成功記錄 {sends}；店機通知／查件：未知（無店機資料）。",
                  f"來源盤點：{source_note}。insights／匯出只盤點，不把重疊期間資料再加進 leads。",
                  "未知說明：缺日、未量測、無時間或無台帳均不補 0；LINE 點擊不等於詢問／訂單，轉換成效未知（無已驗證日帳）。",
                  "讀取問題：" + (safe_label(warnings, 480) if warnings else "無。"),
                  "工時:見 B4 工時表"])
    if llm:
        lines.append("--llm：預留開關，未呼叫 API；仍使用規則建議。")
    if len(lines) > 60:
        raise ValueError("週報超過 60 行")
    return "\n".join(lines) + "\n"


def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="離線產生繁體中文週報（唯讀來源，最多 60 行）")
    parser.add_argument("--week", help="ISO 週，例如 2026-W44；預設上一個完整週")
    parser.add_argument("--data-root", type=Path, default=root / "data", help="唯讀 data 目錄")
    parser.add_argument("--reports-root", type=Path, help="唯讀既有 reports 目錄；預設 data 同層 reports")
    parser.add_argument("--line-bot-dir", type=Path, default=Path(os.environ.get("LOCALAPPDATA", str(root))) / "line-bot", help="唯讀 LINE 日誌目錄")
    parser.add_argument("--as-of", help="固定資料截止時間，ISO 8601；預設現在（台北）")
    parser.add_argument("--dry-run", action="store_true", help="只印週報，不建立或寫入檔案")
    parser.add_argument("--out", type=Path, default=root / "reports" / "weekly", help="輸出目錄")
    parser.add_argument("--llm", action="store_true", help="預留開關；不實作 API 呼叫")
    args = parser.parse_args(argv)
    now = parse_time(args.as_of) if args.as_of else datetime.now(TAIPEI)
    if now is None:
        parser.error("無效的 --as-of 時間")
    prior_monday = now.date() - timedelta(days=now.weekday() + 7)
    iso = prior_monday.isocalendar()
    week = args.week or f"{iso.year}-W{iso.week:02}"
    data, bot = args.data_root.resolve(), args.line_bot_dir.resolve()
    reports = (args.reports_root or data.parent / "reports").resolve()
    try:
        iso_week(week)
        if not args.dry_run:
            target = (args.out / (week + ".md")).resolve()
            if target.is_relative_to(data) or target.is_relative_to(bot):
                parser.error("--out 不得指向唯讀資料（data／line-bot）內部")
        report = build_report(data, reports, bot, week, now, args.llm)
        if args.dry_run:
            sys.stdout.write(report)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Atomic replacement; no partial report after an interrupted write.
            temporary = target.with_name(target.name + ".tmp-" + str(os.getpid()))
            created = False
            try:
                with temporary.open("x", encoding="utf-8", newline="\n") as handle:
                    created = True
                    handle.write(report)
                temporary.replace(target)
            finally:
                if created:
                    temporary.unlink(missing_ok=True)
            print(str(target))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
