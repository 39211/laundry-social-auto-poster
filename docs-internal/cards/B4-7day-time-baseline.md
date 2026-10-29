# 任務卡 B4:7 日行政工時基線(店主每天 1 分鐘)

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 前置:A1 完成(開 `feat/b4-time-baseline`)
repo:C:\Users\cyc39\Documents\New project 5

## 目的
之後要說「自動化省了多少時間」必須有對照組。店主每天花 1 分鐘回四個數字,連續 7 天。

## 做法(最省事的版本)
- 新增 `scripts/time-baseline-prompt.ps1`:每晚 21:30 用現役 LINE channel 的 push,發一則訊息給**店主自己的 LINE userId**(從 `data/staff-target.json` 或既有設定讀;找不到就停,不要猜):
  「今天四個數字(分鐘):回覆客人 / 查件 / 看稿改稿 / 返工重做,用空白隔開回我,例:15 5 20 0」
- `line-bot/conversation.py` 或新模組 `time_baseline.py`:店主 userId 回「四個數字」格式的訊息時,寫進 `data/time-baseline.jsonl`(date, reply, lookup, review, rework, ts),回「收到,第 N/7 天」;其他人發同格式不處理
- 新增排程註冊腳本 `scripts/register-time-baseline-task.ps1`(比照既有 register-*-task.ps1 寫法),**只寫腳本,不執行註冊**;註冊與第一次發送由總指揮排
- 7 天後產一行摘要進 `reports/time-baseline-2026-11.md`

## 驗收
- 單元測試:格式解析(正確/缺數字/非店主)三案例,先紅後綠
- 模擬一則店主訊息寫入 jsonl 並回「第 1/7 天」
- push 腳本以 `-DryRun` 跑時只印出訊息內容、不發送

## 禁止
- 不發任何真 LINE 訊息(DryRun 以外)、不註冊排程、不改其他對話流程

## 交付(docs-internal/cards/B4-RESULT.md)
- diff 摘要、測試輸出、註冊指令與第一次真發送的指令(給總指揮)
