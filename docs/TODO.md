# 實作狀態 / Implementation Status

更新日期：2026-07-26

本文件只記錄目前程式庫可驗證的能力與公開安全限制；未落實的工作不在此列出。

This document records only verifiable repository capabilities and public safety constraints; unimplemented work is omitted.

## 已驗證能力 / Verified capabilities

- [x] pnpm monorepo、嚴格 TypeScript、ESLint、Prettier、Vitest、Playwright 與 GitHub Actions；CI 會執行 unit、Worker、build 及 Chromium E2E。
- [x] React/Vite 雙語介面，支援鍵盤操作、狀態公告、錯誤提示及兩個候選結果比較。
- [x] 公開雙語產品主頁、封閉測試狀態、無註冊入口，以及獨立 `/app` 受邀測試工作區。
- [x] 僅限本機開發的 mock HTTP job API；正式 bundle 不包含 mock 路由或測試控制標記。
- [x] Zod API contracts、加密安全 ID、job state machine 及 provider abstraction。
- [x] D1 additive migrations 與 owner-scoped repositories。
- [x] Cloudflare Access JWT 驗證、server-derived owner ID 及跨 owner 拒絕測試。
- [x] 版本化中英文法律文件、D1 接受紀錄與 fail-closed 正式環境設定。
- [x] Worker Static Assets 與 API 使用同一 Worker；`/app*` 及 `/api/*` 先經 Access 與 Worker JWT 驗證。
- [x] `/health`、法律頁及公開法律 manifest 可匿名讀取，但不建立 owner 紀錄。
- [x] Mock provider 模式不需要付費憑證，CI 不會呼叫外部生成服務。
- [x] fal ACE-Step audio-to-audio adapter 與 provider factory：非同步 queue mapping、Zod 外部回應驗證、provider JSON 不保留、有限輸出期限、預期輸出 host、最小 metadata 及全離線 contract tests。
- [x] Provider output 安全串流邊界：HTTPS host allowlist、禁止 redirect、逾時、identity encoding、可信 content length、音訊 MIME 與 byte limit、Cloudflare `FixedLengthStream`、私人 R2 conditional write、冪等重試及 Miniflare 測試。
- [x] Feature-gated fal Workflow 接線：嚴格 runtime 設定、已確認且未過期的私人來源檢查、短效 GET 簽名、外部 submission 不自動重送、有限 queue polling、安全錯誤 mapping、串流 R2 ingestion、最小 D1 metadata 及無付費請求測試。
- [x] 私人 web app 共用流程：按 capability 選擇 mock 或 real、直接 R2 上載、相同狀態持續輪詢及有上限 backoff、兩個私人播放／下載連結、安全雙語錯誤及 terminal job 刪除；Playwright 以攔截 API 驗證 real 模式，不呼叫供應商。
- [x] 真實生成 abuse quota 邊界：D1 rolling owner daily limit、Cloudflare Rate Limiting binding、owner key、雜湊 IP key、fail-closed capability 及無 metadata 拒絕測試。
- [x] fal callback 邊界：精確公開路徑、Ed25519/JWKS 原始 body 驗證、預期 fal user、五分鐘時間窗、已知 request ID、最小 Workflow wake-up signal、duplicate-safe 行為及 polling correctness fallback；完整 callback payload 不保存。
- [x] CSP 資料最小化：R2 API origin 只加入成功且已驗證的 `/app` 文件回應；公開頁、公開 callback、API JSON 及未授權 app 回應不攜帶該部署識別資料。
- [x] Cloudflare Workers Builds 可用的部署指令以受保護設定生成 ignored config，不把資源識別資料寫入版本庫。
- [x] GitHub 存放庫已連接至 Cloudflare Workers Builds；生產與預覽命令採用加密建置設定，不在版本庫保存資源識別資料。
- [x] Feature-gated 私人 R2 直接上載切片：server-controlled key、短效且綁定 content type／不可覆寫條件的 PUT URL、R2 metadata 確認、owner 隔離、明確刪除、短效輸出下載簽名及本機整合測試。
- [x] Feature-gated server-side mock generation 切片：嚴格 job contracts、現行法律接受及逐工作權利聲明、active-job quota、owner-scoped job API、Cloudflare Workflow、兩個無付費服務的合成 WAV 候選版本、私人 R2 輸出、短效播放連結及 Workflow introspection 測試。
- [x] Feature-gated 保留期與刪除切片：owner-scoped terminal job 即時刪除、24 小時未附加上載／失敗 artifact 清理、完成後 72 小時來源清理、7 日輸出到期、每小時 Cron handler、可重試 metadata 狀態及另一 owner 拒絕測試。

## 目前未啟用 / Currently disabled

- 正式環境的瀏覽器私人 R2 上載；`R2_TRANSFER_ENABLED` 預設及正式環境仍須保持 `false`，直至私人 staging bucket、CORS、到期失效及監察完成實測。
- 正式環境的 server-side mock Workflow；`JOB_WORKFLOW_ENABLED` 預設保持 `false`，且未批准的部署不加入 Workflow binding。
- 真實 AI 音訊生成、Turnstile、callback 的精確 Access 路徑例外與正式輸出交付；fal Workflow、已簽 callback/polling fallback、私人 web 流程及兩層 quota 已完成本機接線與離線測試，但 production 仍保持 `REAL_GENERATION_ENABLED=false`，亦未作任何付費或真實音訊測試。
- 正式環境的自動保留期執行；`RETENTION_CLEANUP_ENABLED` 預設保持 `false`，直至 staging Cron、R2 刪除重試及監察完成實測。程式與本機 Worker 測試已覆蓋清理及 terminal job 即時刪除。
- 公開註冊、非受邀帳戶及公開使用者內容。

介面可用本機 mock 或受旗標保護的 server-side 合成音調完整示範狀態流程，但不會把任何 mock 結果描述為真實 AI 生成。

The interface demonstrates the state flow, but local mock results are never represented as live cloud generation.

## 正式環境安全條件 / Production safety conditions

- Cloudflare Account、D1、Worker、Access 及其他資源識別資料只可保存在 Cloudflare 或未納入版本控制的本機部署設定。
- 檢入的 Wrangler 設定只可包含明確的非真實佔位值。
- Cloudflare Access 必須保護 `/app*` 及使用者 `/api/*`；唯一例外是精確的 fal callback 路徑，並由 Worker 驗證供應商簽名。公開主頁不得繞過任何私人 API 的驗證。
- 法律聯絡方法必須在部署環境設定；佔位值會令相關 API fail closed。
- 未完成私人 R2、刪除及供應商資料控制前，真實音訊生成保持停用。
- R2 bucket 必須保持私人；staging 與 production 分離，且 CORS 只容許確切 web origins、`PUT/GET/HEAD`、`Content-Type` 及 `If-None-Match`。
- `FAL_KEY`、signed URLs、Access assertions、音訊內容、檔名及完整 provider payload 不得寫入日誌或版本庫。

## 驗證指令 / Validation commands

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

完成狀態只能在上述相關檢查通過，且沒有引入 secret、私人識別資料或跨 owner 存取問題後更新。

Status may be updated only after the relevant checks pass and no secret, private identifier, or cross-owner access issue is introduced.
