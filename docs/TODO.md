# 實作狀態 / Implementation Status

更新日期：2026-08-09

本文件只記錄目前程式庫可驗證的能力與公開安全限制；未落實的工作不在此列出。

This document records only verifiable repository capabilities and public safety constraints; unimplemented work is omitted.

## 已驗證能力 / Verified capabilities

- [x] pnpm monorepo、嚴格 TypeScript、ESLint、Prettier、Vitest、Playwright 與 GitHub Actions；CI 會執行 unit、Worker、build 及 Chromium E2E。
- [x] React/Vite 雙語介面，支援鍵盤操作、狀態公告、錯誤提示及兩個候選結果比較。
- [x] 五個版本化風格由單一公開雙語合約驅動：柔和鋼琴、八音盒、Lo-fi 學習、木結他輕奏及慢拍舒緩電音；首頁、私人工作區、mock job 與離線 fal adapter contract tests 保持相同 preset ID，供應商提示維持 server-only。
- [x] 公開雙語產品主頁、獨立 `/login` 封閉測試登入介面、停用的日後註冊位置，以及獨立 `/app` 受邀測試工作區。
- [x] 私人登入狀態流程：成功驗證返回工作區；session 過期、拒絕或無法安全驗證時回到雙語 `/login` 告知；所有私人 AJAX 使用明確 `401` contract，返回路徑限制在同源 `/app`。
- [x] 僅限本機開發的 mock HTTP job API；正式 bundle 不包含 mock 路由或測試控制標記。
- [x] Zod API contracts、加密安全 ID、job state machine 及 provider abstraction。
- [x] D1 additive migrations 與 owner-scoped repositories。
- [x] Cloudflare Access JWT 的簽章、issuer、audience、時效及 identity claims 驗證；server-derived owner ID、active／disabled Beta 權限檢查及跨 owner 拒絕測試。
- [x] 版本化中英文法律文件、D1 接受紀錄與 fail-closed 正式環境設定。
- [x] Worker Static Assets 與 API 使用同一 Worker；`/app`、`/app/*`、`/api` 及使用者 `/api/*` 先經 Access JWT 與 active D1 owner／workspace／membership 驗證。
- [x] 私密 exact-login onboarding 只接收環境輸入，以 keyed hash 儲存邀請，不保存登入地址；首次登入原子建立 active owner workspace、manual AI approval、bounded job cost 及 idempotent bounded credit grant。
- [x] `/api/session` 只回傳 account／workspace／membership 狀態、owner role、權限、審批狀態及 capabilities，不回傳 owner／workspace identifier；disabled membership 及跨 workspace assertion 均 fail closed。
- [x] `/health`、法律頁及公開法律 manifest 可匿名讀取，但不建立 owner 紀錄。
- [x] Mock provider 模式不需要付費憑證，CI 不會呼叫外部生成服務。
- [x] fal ACE-Step audio-to-audio adapter 與 provider factory：非同步 queue mapping、Zod 外部回應驗證、provider JSON 不保留、有限輸出期限、預期輸出 host、最小 metadata 及全離線 contract tests。
- [x] Provider output 安全串流邊界：HTTPS host allowlist、禁止 redirect、逾時、identity encoding、可信 content length、音訊 MIME 與 byte limit、Cloudflare `FixedLengthStream`、私人 R2 conditional write、冪等重試及 Miniflare 測試。
- [x] Feature-gated fal Workflow 接線：嚴格 runtime 設定、已確認且未過期的私人來源檢查、短效 GET 簽名、外部 submission 不自動重送、有限 queue polling、安全錯誤 mapping、串流 R2 ingestion、最小 D1 metadata 及無付費請求測試。
- [x] 私人 web app 共用流程：按 capability 選擇 mock 或 real、直接 R2 上載、相同狀態持續輪詢及有上限 backoff、兩個私人播放／下載連結、安全雙語錯誤及 terminal job 刪除；Playwright 以攔截 API 驗證 real 模式，不呼叫供應商。
- [x] 真實生成 abuse quota 邊界：D1 rolling owner daily limit、Cloudflare Rate Limiting binding、owner key、雜湊 IP key、fail-closed capability 及無 metadata 拒絕測試。
- [x] 私人 beta 額度邊界：active entitlement、append-only D1 ledger、job creation＋reserve 同一 transaction、Workflow terminal state＋settle／release 同一 transaction、idempotent replay、owner-only aggregate API 及餘額不足零 job／零 reserve 測試。
- [x] Provider-neutral payment boundary：default-disabled adapter、strict synthetic normalized events、完整 payment／subscription lifecycle state contract，且沒有 live provider dependency、checkout、商戶 mapping 或付款憑證。
- [x] 私人 workspace 可在 server capability 開啟時顯示 owner aggregate beta 額度；malformed、denied 或 unavailable response 會 fail closed，無法改變 server-side job authorization。
- [x] fal callback 邊界：精確公開路徑、Ed25519/JWKS 原始 body 驗證、預期 fal user、五分鐘時間窗、已知 request ID、最小 Workflow wake-up signal、duplicate-safe 行為及 polling correctness fallback；完整 callback payload 不保存。
- [x] CSP 資料最小化：R2 API origin 只加入成功且已驗證的 `/app` 文件回應；公開頁、公開 callback、API JSON 及未授權 app 回應不攜帶該部署識別資料。
- [x] Cloudflare Workers Builds 可用的部署指令以受保護設定生成 ignored config，不把資源識別資料寫入版本庫。
- [x] Staging 與 production 可使用各自的 ignored Wrangler resource config，但生成器會固定使用唯一 `studymix-ai` Worker；staging config 只可上載 preview，不能作 production deploy。Wrangler 指令停用本機 debug log 寫入並保留輸出資料清理。
- [x] 私隱安全的 active-deployment 診斷只輸出 bindings、runtime／secret presence、migration counts、live-route booleans 及分層 readiness，不輸出資源名稱、識別碼、hostname、聯絡值或 secret。
- [x] GitHub 存放庫已連接至 Cloudflare Workers Builds；生產與預覽命令採用加密建置設定，不在版本庫保存資源識別資料。
- [x] 獨立 staging Worker 已撤下，Cloudflare 現只保留一個 `studymix-ai` Worker。原 staging D1、私人 R2 與 Workflow 資源目前未綁定且不處理流量；如要重用，只可連到經批准的同一 Worker preview version。
- [x] Feature-gated 私人 R2 直接上載切片：server-controlled key、短效且綁定 content type／不可覆寫條件的 PUT URL、R2 metadata 確認、owner 隔離、明確刪除、短效輸出下載簽名及本機整合測試。
- [x] Feature-gated server-side mock generation 切片：嚴格 job contracts、現行法律接受及逐工作權利聲明、active-job quota、owner-scoped job API、Cloudflare Workflow、兩個無付費服務的合成 WAV 候選版本、私人 R2 輸出、短效播放連結及 Workflow introspection 測試。
- [x] Loopback-only 本機 AI harness：server-derived test principal、同一條 rights／owner／credit／Workflow／R2 流程、固定合成音訊、provider-neutral 每工作限制、獨立 attempt cost units、timeout recovery、terminal failure、cancel、owner-bound 播放及一鍵本機啟動／測試；production defaults、遠端 bindings 及真實生成均未改動。
- [x] Feature-gated 保留期與刪除切片：owner-scoped terminal job 即時刪除、24 小時未附加上載／失敗 artifact 清理、完成後 72 小時來源清理、7 日輸出到期、每小時 Cron handler、可重試 metadata 狀態及另一 owner 拒絕測試。

## 目前未啟用 / Currently disabled

- 正式環境的瀏覽器私人 R2 上載；`R2_TRANSFER_ENABLED` 預設及正式環境仍須保持 `false`，直至私人 staging bucket、CORS、到期失效及監察完成實測。
- 正式環境的 server-side mock Workflow；`JOB_WORKFLOW_ENABLED` 預設保持 `false`，且未批准的部署不加入 Workflow binding。
- 真實 AI 音訊生成、Turnstile、callback 的精確 Access 路徑例外與正式輸出交付；fal Workflow、已簽 callback/polling fallback、私人 web 流程及兩層 quota 已完成本機接線與離線測試，但 production 仍保持 `REAL_GENERATION_ENABLED=false`，亦未作任何付費或真實音訊測試。
- 正式環境的自動保留期執行；`RETENTION_CLEANUP_ENABLED` 預設保持 `false`，直至 staging Cron、R2 刪除重試及監察完成實測。程式與本機 Worker 測試已覆蓋清理及 terminal job 即時刪除。
- 公開註冊、非受邀帳戶及公開使用者內容。
- 公開價格、checkout、subscription、top-up 或任何真實付款供應商連接；目前只有 disabled／synthetic provider-neutral contract tests。
- Staging 資料資源雖仍存在，但沒有獨立 Worker 或公開 route；在 Access、法律聯絡設定、私人 R2 簽名憑證、精確 CORS、受保護 preview 與實機瀏覽器流程通過前，不會綁定或開啟任何處理音訊的旗標。

介面可用本機 mock 或受旗標保護的 server-side 合成音調完整示範狀態流程，但不會把任何 mock 結果描述為真實 AI 生成。

The interface demonstrates the state flow, but local mock results are never represented as live cloud generation.

## 正式環境安全條件 / Production safety conditions

- Cloudflare Account、D1、Worker、Access 及其他資源識別資料只可保存在 Cloudflare 或未納入版本控制的本機部署設定。
- 檢入的 Wrangler 設定只可包含明確的非真實佔位值。
- Cloudflare Access 必須同時保護 `/app`、`/app/*`、`/api` 及使用者 `/api/*`；唯一例外是精確的 fal callback 路徑，並由 Worker 驗證供應商簽名。公開主頁不得繞過任何私人 API 的驗證。
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
