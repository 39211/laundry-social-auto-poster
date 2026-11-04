import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPendingFacebookAlerts } from "../src/facebookLostAlert";
const DATE = "2026-09-21";
describe("A7-4 existing staff-group alert delivery", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "a74-staff-")); await mkdir(join(root,"output","alerts"),{recursive:true}); });
  afterEach(async () => { if (root && root.includes("a74-staff-")) await rm(root,{recursive:true,force:true}); });
  async function seed() { await writeFile(join(root,"output","alerts",`fb-lost-${DATE}-slot1.json`),JSON.stringify({alert:"FB_LOST",date:DATE,slot:1})); }
  it("delivers once and persists a receipt without exposing post text or customer ids", async () => {
    await seed(); const sender=vi.fn(async(_message: string, _key: string)=>true);
    expect(await deliverPendingFacebookAlerts({root,date:DATE,sender})).toEqual({delivered:1,pending:0});
    expect(await deliverPendingFacebookAlerts({root,date:DATE,sender})).toEqual({delivered:0,pending:0});
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[1]).toBe(`sxj:fb-lost:${DATE}:slot1`);
  });
  it("persists failed notification and retries using the same idempotency key",async()=>{
    await seed(); const sender=vi.fn(async(_message: string, _key: string)=>false);
    expect((await deliverPendingFacebookAlerts({root,date:DATE,sender})).pending).toBe(1);
    const second=vi.fn(async(_message: string, _key: string)=>true); await deliverPendingFacebookAlerts({root,date:DATE,sender:second});
    expect(sender).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]?.[1]).toBe(sender.mock.calls[0]?.[1]);
  });
  it("does not notify an old loss alert once Page reconciliation confirmed the post",async()=>{
    await seed(); await mkdir(join(root,"data","scheduled-log"),{recursive:true});
    await writeFile(join(root,"data","scheduled-log",`${DATE}.json`),JSON.stringify([{date:DATE,slot:1,platform:"facebook",scheduled_post_id:"confirmed-public-post"}]));
    await mkdir(join(root,"output","alerts","notifications"),{recursive:true});
    await writeFile(join(root,"output","alerts","notifications",`fb-lost-${DATE}-slot1.json`),JSON.stringify({status:"delivered"}));
    const sender=vi.fn(async(_message: string,_key: string)=>true);
    expect(await deliverPendingFacebookAlerts({root,date:DATE,sender})).toEqual({delivered:0,pending:0});
    expect(sender).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root,"output","alerts","notifications",`fb-lost-${DATE}-slot1.json`),"utf8")).status).toBe("resolved");
  });
  it("rejects mismatched payloads without contacting a recipient",async()=>{
    await seed(); await writeFile(join(root,"output","alerts",`fb-lost-${DATE}-slot1.json`),JSON.stringify({alert:"FB_LOST",date:DATE,slot:2}));
    const sender=vi.fn(async(_message: string, _key: string)=>true); expect((await deliverPendingFacebookAlerts({root,date:DATE,sender})).pending).toBe(1); expect(sender).not.toHaveBeenCalled();
  });
});
