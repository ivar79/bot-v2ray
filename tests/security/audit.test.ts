/** Security Audit Tests - Phase 10 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDB } from "../helpers/d1-test-helper";
import type { D1Database } from "@cloudflare/workers-types";
import { isAdmin, parseAdminUserIds } from "../../src/telegram/auth";
import { isValidTelegramFilePath, MockTelegramBotAPI } from "../../src/telegram/api";
import { MockGitHubAPI } from "../../src/github/api";
import { handleWebhookRequest } from "../../src/telegram/webhook";
import { processMessage, processChannelPost } from "../../src/telegram/routing";
import { handleTextUpload, handleOperatorSelection } from "../../src/ingest/admin";
import { configHashExists, insertConfig } from "../../src/db/configs";
import { markUpdateProcessed } from "../../src/db/updates";
import { getSetting, setSetting } from "../../src/db/settings";
import { insertSource } from "../../src/db/sources";
import { sha256hex } from "../../src/utils/crypto";
import type { TgMessage, TgChannelPost, TgUpdate } from "../../src/telegram/types";

const A = "111111,222222"; const NID = 999999;
function m(text: string, uid = 111111): TgMessage {
  return { message_id: 1, from: { id: uid, is_bot: false, first_name: "A" }, date: Date.now(), chat: { id: uid, type: "private" }, text };
}
function u(id: number): TgUpdate { return { update_id: id, message: m("/start") }; }
function r(body: TgUpdate, s = "test-secret"): Request {
  return new Request("https://example.com/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": s }, body: JSON.stringify(body) });
}
const E = (db: D1Database) => ({ DB: db, TELEGRAM_BOT_TOKEN: "token", TELEGRAM_WEBHOOK_SECRET: "test-secret", ADMIN_USER_IDS: A });describe("Security Audit",()=>{let db:D1Database;let api:MockTelegramBotAPI;beforeEach(()=>{db=createTestDB();api=new MockTelegramBotAPI()});
describe("1.Auth",()=>{
it("rejects missing secret",async()=>{expect((await handleWebhookRequest(new Request("https://example.com/webhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(u(9001))}),{DB:db,TELEGRAM_BOT_TOKEN:"t",TELEGRAM_WEBHOOK_SECRET:"real",ADMIN_USER_IDS:A})).status).toBe(403)});
it("rejects wrong secret",async()=>{expect((await handleWebhookRequest(r(u(9002),"wrong"),E(db))).status).toBe(403)});
it("accepts correct secret",async()=>{expect((await handleWebhookRequest(r(u(9003)),E(db),api)).status).toBe(200)});
});
describe("2.Authorization",()=>{
const cmds=["/start","/help","/status","/upload","/cancel","/generate","/publish","/setgithub owner repo","/setoutput -100123","/addsource -100123","/removesource -100123","/sources"];
for(const cmd of cmds){it("non-admin: "+cmd,async()=>{await processMessage(m(cmd,NID),db,api,A);expect(api.sendMessageCalls[0].text).toContain("Access denied");api.reset()})}
it("never auto-admin",()=>{expect(isAdmin(111111,undefined)).toBe(false)});
it("empty nobody auth",()=>{expect(isAdmin(123,undefined)).toBe(false)});
it("numeric only",()=>{expect(isAdmin(999,"111111")).toBe(false);expect(isAdmin(111111,"111111")).toBe(true)});
it("neg no admin",()=>{expect(parseAdminUserIds("-1,111111").has(-1)).toBe(false)});
it("zero no admin",()=>{expect(parseAdminUserIds("0,111111").has(0)).toBe(false)});
});
describe("3.Webhook",()=>{
it("bad JSON",async()=>{expect((await handleWebhookRequest(new Request("https://x.com",{method:"POST",headers:{"Content-Type":"application/json","x-telegram-bot-api-secret-token":"test-secret"},body:"bad"}),E(db))).status).toBe(400)});
it("no update_id",async()=>{expect((await handleWebhookRequest(new Request("https://x.com",{method:"POST",headers:{"Content-Type":"application/json","x-telegram-bot-api-secret-token":"test-secret"},body:JSON.stringify({message:{}})}),E(db))).status).toBe(400)});
it("oversized",async()=>{expect((await handleWebhookRequest(new Request("https://x.com",{method:"POST",headers:{"Content-Type":"application/json","x-telegram-bot-api-secret-token":"test-secret","content-length":"999999999"},body:"{}"}),E(db))).status).toBe(413)});
it("no stack traces",async()=>{const t=await(await handleWebhookRequest(r(u(9011),"wrong"),E(db))).text();expect(t).not.toContain("stack");expect(t).not.toContain("Error")});
});
describe("4.Secrets",()=>{
it("publish no token leak",async()=>{await processMessage(m("/publish"),db,api,A,undefined);const all=api.sendMessageCalls.map(c=>c.text).join(String.fromCharCode(10));expect(all).not.toContain("token");expect(all).not.toContain("ghp_");expect(api.sendMessageCalls.length).toBeGreaterThanOrEqual(2)});
it("webhook no secret",async()=>{const t=await(await handleWebhookRequest(new Request("https://x.com",{method:"POST",headers:{"Content-Type":"application/json","x-telegram-bot-api-secret-token":"test-secret"},body:"x"}),{DB:db,TELEGRAM_BOT_TOKEN:"super-secret-12345",TELEGRAM_WEBHOOK_SECRET:"test-secret",ADMIN_USER_IDS:A})).text();expect(t).not.toContain("super-secret")});
it("gh token not in tg",async()=>{await processMessage(m("/publish"),db,api,A,"ghp_secret123");const all=api.sendMessageCalls.map(c=>c.text).join(String.fromCharCode(10));expect(all).not.toContain("ghp_secret123")});
});
describe("5.D1Injection",()=>{
it("config_hash",async()=>{expect(await configHashExists(db,"'; DROP TABLE configs; --")).toBe(false)});
it("settings",async()=>{await setSetting(db,"k","v");expect(await getSetting(db,"k")).toBe("v")});
it("insertConfig",async()=>{const row=await insertConfig(db,{protocol:"vless",raw:"vless://test'; DROP; --",canonical:"safe",config_hash:"h1"});expect(row.raw).toContain("DROP")});
});
describe("6.Source",()=>{
const ch=(id:number):TgChannelPost=>({message_id:1,date:Date.now(),chat:{id,type:"channel"},text:"vless://test@server.com:443#C"});
it("unknown ignored",async()=>{await processChannelPost(ch(-100999999),db,api,A);const c=await db.prepare("SELECT COUNT(*) as cnt FROM configs").first();expect((c as any)?.cnt).toBe(0)});
it("disabled ignored",async()=>{await insertSource(db,{type:"trusted_channel",chat_id:-100888888,enabled:0,trusted:1});await processChannelPost(ch(-100888888),db,api,A);const c=await db.prepare("SELECT COUNT(*) as cnt FROM configs").first();expect((c as any)?.cnt).toBe(0)});
it("untrusted ignored",async()=>{await insertSource(db,{type:"trusted_channel",chat_id:-100777777,enabled:1,trusted:0});await processChannelPost(ch(-100777777),db,api,A);const c=await db.prepare("SELECT COUNT(*) as cnt FROM configs").first();expect((c as any)?.cnt).toBe(0)});
it("chat_id not username",async()=>{await insertSource(db,{type:"trusted_channel",chat_id:-100666666,username:"real",enabled:1,trusted:1});await processChannelPost({message_id:1,date:Date.now(),chat:{id:-100555555,type:"channel"as const,username:"real"},text:"vless://test@server.com:443#C"},db,api,A);const c=await db.prepare("SELECT COUNT(*) as cnt FROM configs").first();expect((c as any)?.cnt).toBe(0)});
});
describe("7.Dupes",()=>{
it("same id not twice",async()=>{await handleWebhookRequest(r(u(9100)),E(db),api);api.reset();await handleWebhookRequest(r(u(9100)),E(db),api);expect(api.sendMessageCalls.length).toBe(0)});
it("already done 200",async()=>{await markUpdateProcessed(db,9200);const res=await handleWebhookRequest(r(u(9200)),E(db),api);expect(res.status).toBe(200);expect(api.sendMessageCalls.length).toBe(0)});
});
describe("8.Malicious",()=>{
it("SQL in config",async()=>{const{extractConfigs,parseWithHash}=await import("../../src/parsers");for(const c of extractConfigs("vless://'; DROP; --@s.com:443#T")){expect(typeof(await parseWithHash(c)).isValid).toBe("boolean")}});
it("long config",async()=>{const{parseWithHash}=await import("../../src/parsers");expect(typeof(await parseWithHash("vless://"+"a".repeat(100000)+"@s.com:443#T")).isValid).toBe("boolean")});
it("homoglyph",async()=>{const{parseWithHash}=await import("../../src/parsers");expect(typeof (await parseWithHash("vless://а@server.com:443#T")).isValid).toBe("boolean")});
});
describe("9.Oversized",()=>{
it("SHA256 rejects",async()=>{await expect(sha256hex("a".repeat(1048577))).rejects.toThrow("Input too large")});
it("no-config msg",async()=>{await handleTextUpload(m("Hello!"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("No supported configuration")});
});
describe("10.Errors",()=>{
it("no state",async()=>{await handleOperatorSelection("cb","irancell",NID,NID,db,api);expect(api.answerCallbackQueryCalls[0].text).toContain("Access denied")});
it("200",async()=>{expect((await handleWebhookRequest(r({update_id:9300}as TgUpdate),E(db),api)).status).toBe(200)});
});
describe("11.Path",()=>{
it("traversal",()=>{expect(isValidTelegramFilePath("docs/../etc/passwd")).toBe(false)});
it("absolute",()=>{expect(isValidTelegramFilePath("/etc/passwd")).toBe(false)});
it("null",()=>{expect(isValidTelegramFilePath("docs/file .txt")).toBe(false)});
it("space",()=>{expect(isValidTelegramFilePath("docs/file name.txt")).toBe(false)});
it("empty",()=>{expect(isValidTelegramFilePath("")).toBe(false)});
it("long",()=>{expect(isValidTelegramFilePath("a".repeat(201))).toBe(false)});
it("valid",()=>{expect(isValidTelegramFilePath("docs/file_123.txt")).toBe(true);expect(isValidTelegramFilePath("a/b/c.txt")).toBe(true)});
it("downloadFile",async()=>{const{RealTelegramBotAPI}=await import("../../src/telegram/api");expect(await new RealTelegramBotAPI("f").downloadFile("../../../etc/passwd")).toBeNull()});
});
describe("12.Branch",()=>{
it(".dot",async()=>{await processMessage(m("/setgithub owner repo .h"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("Invalid branch name")});
it("..",async()=>{await processMessage(m("/setgithub owner repo f..b"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("Invalid branch name")});
it("-hyphen",async()=>{await processMessage(m("/setgithub owner repo -f"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("Invalid branch name")});
it("space",async()=>{await processMessage(m("/setgithub owner repo f b"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("GitHub configured")});
it("long",async()=>{await processMessage(m("/setgithub owner repo "+"a".repeat(101)),db,api,A);expect(api.sendMessageCalls[0].text).toContain("Invalid branch name")});
it("main ok",async()=>{await processMessage(m("/setgithub owner repo main"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("GitHub configured")});
it("slash ok",async()=>{await processMessage(m("/setgithub owner repo f/a"),db,api,A);expect(api.sendMessageCalls[0].text).toContain("GitHub configured")});
});
describe("13.Operator",()=>{
it("invalid",async()=>{await handleTextUpload(m("vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443?security=tls#T"),db,api,A);api.reset();await handleOperatorSelection("cb","x' DROP",111111,111111,db,api,A);expect(api.answerCallbackQueryCalls[0].text).toContain("Invalid operator")});
it("channel unknown",async()=>{await insertSource(db,{type:"trusted_channel",chat_id:-100444444,enabled:1,trusted:1});await processChannelPost({message_id:1,date:Date.now(),chat:{id:-100444444,type:"channel"as const},text:"vless://a3482e88-686a-4a58-8126-99c9034e4b09@server.com:443?security=tls#T"},db,api,A);const b=await db.prepare("SELECT operator FROM batches ORDER BY id DESC LIMIT 1").first();expect((b as any)?.operator).toBe("unknown")});
});
describe("14.Token",()=>{
it("publish",async()=>{await setSetting(db,"github_owner","o");await setSetting(db,"github_repo","r");await setSetting(db,"github_branch","main");const gh=new MockGitHubAPI();await processMessage(m("/publish"),db,api,A,"ghp_abc123",gh);const all=api.sendMessageCalls.map(c=>c.text).join(String.fromCharCode(10));expect(all).not.toContain("ghp_abc123")});
it("setgithub",async()=>{await processMessage(m("/setgithub myowner myrepo main"),db,api,A,"ghp_anytoken");expect(api.sendMessageCalls[0].text).not.toContain("ghp_")});
});
});
