# 實作狀態 / Implementation Status

更新日期：2026-07-25

本文件只記錄目前程式庫可驗證的能力與公開安全限制；未落實的工作不在此列出。

This document records only verifiable repository capabilities and public safety constraints; unimplemented work is omitted.

## 已驗證能力 / Verified capabilities

- [x] pnpm monorepo、嚴格 TypeScript、ESLint、Prettier、Vitest、Playwright 與 GitHub Actions。
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
- [x] Cloudflare Workers Builds 可用的部署指令以受保護設定生成 ignored config，不把資源識別資料寫入版本庫。
- [x] GitHub 存放庫已連接至 Cloudflare Workers Builds；生產與預覽命令採用加密建置設定，不在版本庫保存資源識別資料。

## 目前未啟用 / Currently disabled

- 瀏覽器直接上傳音訊至私人 R2。
- 真實 AI 音訊生成、外部 callback 與輸出下載。
- 自動清理、使用者刪除及正式保留期執行。
- 公開註冊、非受邀帳戶及公開使用者內容。

介面可完整示範狀態流程，但不會把本機 mock 結果描述為正式雲端生成。

The interface demonstrates the state flow, but local mock results are never represented as live cloud generation.

## 正式環境安全條件 / Production safety conditions

- Cloudflare Account、D1、Worker、Access 及其他資源識別資料只可保存在 Cloudflare 或未納入版本控制的本機部署設定。
- 檢入的 Wrangler 設定只可包含明確的非真實佔位值。
- Cloudflare Access 必須保護 `/app*` 及 `/api/*`；Worker 亦會再次驗證 Access JWT。公開主頁不得繞過任何私人 API 的驗證。
- 法律聯絡方法必須在部署環境設定；佔位值會令相關 API fail closed。
- 未完成私人 R2、刪除及供應商資料控制前，真實音訊生成保持停用。
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
