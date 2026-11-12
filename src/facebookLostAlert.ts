import { execFile } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./logging";
import { slotRetirement } from "./slotRetirements";

export type StaffAlertSender = (message: string, key: string) => Promise<boolean>;

export function existingStaffGroup(root: string): StaffAlertSender {
  return (message, key) => new Promise((resolve) => {
    const python = process.env.SXJ_ALERT_PYTHON ?? "C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe";
    const code = "import os,sys,uuid; os.environ['LAUNDRY_REPO_ROOT']=sys.argv[1]; sys.path.insert(0,os.path.join(sys.argv[1],'line-bot')); import staff_notify as s; g=s.group_id(); ok=False if not g else s._post_to_group(g,sys.argv[2],str(uuid.uuid5(uuid.NAMESPACE_URL,sys.argv[3])))[0]; sys.exit(0 if ok else 1)";
    execFile(python, ["-B", "-c", code, root, message, key], { timeout: 15000, windowsHide: true, maxBuffer: 16384 }, (error) => resolve(!error));
  });
}

export async function deliverPendingFacebookAlerts(input: { root: string; date: string; sender?: StaffAlertSender }): Promise<{ delivered: number; pending: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("invalid alert date");
  const folder = join(input.root, "output", "alerts");
  let names: string[];
  try { names = await readdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { delivered: 0, pending: 0 }; throw error; }
  const receipts = join(folder, "notifications");
  await mkdir(receipts, { recursive: true });
  const send = input.sender ?? existingStaffGroup(input.root);
  let delivered = 0, pending = 0;
  for (const name of names.sort()) {
    const match = new RegExp(`^fb-lost-${input.date}-slot(\\d+)\\.json$`).exec(name);
    if (!match) continue;
    const slot = Number(match[1]);
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > 99) continue;
    if (slotRetirement(input.date, slot, input.root).retired) continue;
    const path = join(receipts, name);
    let alreadyDelivered = false;
    try { alreadyDelivered = JSON.parse(await readFile(path, "utf8")).status === "delivered"; } catch { /* missing receipt retries with the same idempotency key */ }
    let alert: { alert?: string; date?: string; slot?: number };
    try { alert = JSON.parse(await readFile(join(folder, name), "utf8")); } catch { pending += 1; continue; }
    if (alert.alert !== "FB_LOST" || alert.date !== input.date || alert.slot !== slot) { pending += 1; continue; }
    // The same incident may also be handled by the same-day recovery path.
    try {
      const recovery = JSON.parse(await readFile(join(input.root, "data", "gates", `publish-recovery-${input.date}-slot${slot}-facebook.json`), "utf8"));
      if (recovery.date === input.date && recovery.slot === slot && recovery.platform === "facebook" &&
        (recovery.status === "resolved" || (recovery.status === "needs_manual" && recovery.notification === "delivered"))) {
        await writeJsonAtomic(path, { date: input.date, slot, status: recovery.status === "resolved" ? "resolved" : "delivered", checked_at: new Date().toISOString() });
        continue;
      }
    } catch { /* preserve the existing alert when the recovery evidence is unavailable */ }
    let scheduled: Array<{ date?: string; slot?: number; platform?: string; status?: string; scheduled_post_id?: string }> = [];
    try { const value = JSON.parse(await readFile(join(input.root, "data", "scheduled-log", `${input.date}.json`), "utf8")); if (Array.isArray(value)) scheduled = value; } catch { /* preserve pending alert when evidence cannot be read */ }
    if (scheduled.some(row => row.date === input.date && row.slot === slot && row.platform === "facebook" && row.status !== "uncertain" && typeof row.scheduled_post_id === "string" && row.scheduled_post_id.trim())) {
      await writeJsonAtomic(path, { date: input.date, slot, status: "resolved", checked_at: new Date().toISOString() });
      continue;
    }
    if (alreadyDelivered) continue;
    const key = `sxj:fb-lost:${input.date}:slot${slot}`;
    const message = `FB 排程待人工確認：${input.date} 第 ${slot} 槽沒有確認發布紀錄。請到粉專核對；系統沒有自動補發。`;
    let ok = false;
    try { ok = await send(message, key); } catch { ok = false; }
    await writeJsonAtomic(path, { date: input.date, slot, status: ok ? "delivered" : "pending", checked_at: new Date().toISOString() });
    if (ok) delivered += 1; else pending += 1;
  }
  return { delivered, pending };
}
