# StudyMix AI 自部署指南 / Self-hosting Guide

本指南說明如何把 StudyMix AI 部署到**你自己的 Cloudflare 帳戶**。內容只使用通用佔位符，不記錄任何正式 hostname、帳戶 ID、D1 ID、bucket 名稱、Access audience、聯絡資料或 secret。

This guide deploys StudyMix AI to infrastructure controlled by the operator. It intentionally omits all live identifiers, credentials, data and account-specific topology.

## 1. 先了解部署界線

StudyMix AI 的部署單位是一個 Cloudflare Worker：前端由 Workers Static Assets 發佈，API 由同一 Worker 執行。D1 是基線需要的 metadata service；私人 R2、Workflows、外部 AI 與排程清理屬進階能力，必須保持停用，直至隔離 staging 完成驗證。

建議分兩階段：

| 階段         | 內容                                             | 預設                                |
| ------------ | ------------------------------------------------ | ----------------------------------- |
| 安全基線     | 公開產品頁、法律頁、健康檢查、D1、受保護工作區   | 可先部署                            |
| 進階私人音訊 | 私人 R2、Workflow、外部 AI、callback、保留期排程 | 預設關閉；須另行審批及 staging 驗證 |

基線部署不需要 fal key、R2 access key 或任何付費 AI。不要為了「讓檢查變綠」而填入假 secret 或放寬 Access。

## 2. 前置要求

- 有權使用本程式庫；目前未授予開源授權，見 [`../LICENSE.md`](../LICENSE.md)。
- Cloudflare 帳戶及由該帳戶管理的網域。
- 可以設定 Cloudflare Workers、D1、Workers Builds 與 Cloudflare Access 的權限。
- Git。
- Node.js 22.12 或更新版本。
- pnpm 11 或更新版本。
- Wrangler 4.x；本專案已把 Wrangler 固定為開發依賴，不需要全域安裝。

請先閱讀：

1. [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md)
2. [`CLOUDFLARE_ACCESS.md`](CLOUDFLARE_ACCESS.md)
3. [`LEGAL_AND_DATA_USE.md`](LEGAL_AND_DATA_USE.md)
4. [`TODO.md`](TODO.md)

## 3. Clone、安裝及本機驗證

使用你獲授權的存放庫 URL；不要把含 token 的 clone URL 放進 shell script、issue 或文件。

```bash
git clone "REPLACE_WITH_AUTHORIZED_REPOSITORY_URL" "studymix-ai"
cd "studymix-ai"
pnpm install --frozen-lockfile
pnpm cf-typegen
pnpm dev
```

本機介面預設在 `http://localhost:5173/`，Worker API 在 `http://localhost:8787/`。此模式使用 mock provider 與本機 D1，不需要 Cloudflare 或 fal 憑證。

如要驗證完整但完全本機的合成流程：

```bash
pnpm dev:local-ai
```

此命令只使用 loopback、固定合成 WAV、Wrangler 本機 D1／R2／Workflow 與 mock provider。不要使用真實音訊作開發 fixture。

完成以下檢查後才繼續：

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm build` 只執行 Worker dry-run，不會部署到 Cloudflare。

## 4. 驗證 Wrangler 及登入 Cloudflare

```bash
pnpm --filter @studymix/api exec wrangler --version
pnpm --filter @studymix/api exec wrangler login
pnpm --filter @studymix/api exec wrangler whoami
```

確認終端顯示的是**你預期的 Cloudflare 帳戶**。不要把 `whoami`、Dashboard 或 CLI 的完整輸出貼到公開 issue、AI 對話、commit 或 PR。

如果 macOS 權限令 Wrangler 無法寫入全域 log，可在本專案內使用：

```bash
WRANGLER_LOG_PATH=.wrangler/logs pnpm --filter @studymix/api exec wrangler whoami
```

`.wrangler/` 已被 Git 忽略。

## 5. 建立自己的 D1

為 production 建立專用 D1；不要與其他應用或 staging 共用。

```bash
pnpm --filter @studymix/api exec wrangler d1 create "<PRIVATE_D1_NAME>"
```

Wrangler 會返回資料庫名稱及 ID。兩者只可保存於：

- Cloudflare 受保護的 build／runtime 設定；或
- 本機被 Git 忽略的 deployment config。

不要把輸出貼入 README、PR、issue、截圖、測試 fixture 或任何 AI prompt。不要匯入真實應用資料作測試。

## 6. 產生被忽略的私有 Wrangler 設定

檢入的 [`../apps/api/wrangler.jsonc`](../apps/api/wrangler.jsonc) 只供型別、dry-run 與佔位設定使用，不能直接代表正式資源。部署腳本會產生權限為 `0600`、且被 Git 忽略的 `wrangler.*.json`。

以下範例適用於 macOS／zsh，輸入不會成為命令列參數：

```bash
cd apps/api
read -r "DEPLOY_D1_NAME?Private D1 name: "
read -rs "DEPLOY_D1_ID?Private D1 ID: "
printf '\n'
export DEPLOY_D1_NAME DEPLOY_D1_ID
export DEPLOY_CONFIG_PATH="wrangler.production.json"
node scripts/create-cloudflare-config.mjs
cd ../..
git check-ignore apps/api/wrangler.production.json
```

`git check-ignore` 必須輸出該檔案路徑。若沒有輸出，立即停止，不要 deploy、stage 或 commit。

其他 shell 可用自己的安全輸入方式設定相同環境變數。不要把真實值寫入 tracked shell script、`.env.example` 或命令教學。

## 7. 檢查及套用 D1 migrations

先列出待套用 migration，再使用同一個私有 config 套用：

```bash
pnpm --filter @studymix/api exec wrangler d1 migrations list DB --remote --config wrangler.production.json
pnpm --filter @studymix/api exec wrangler d1 migrations apply DB --remote --config wrangler.production.json
pnpm --filter @studymix/api exec wrangler d1 migrations list DB --remote --config wrangler.production.json
```

規則：

- 只套用存放庫內已審查、版本化及 additive 的 migrations。
- 不在 production 執行臨時 SQL 或把 D1 dump 提交到 Git。
- 套用前確認 config 指向正確環境。
- Migration 成功不代表應用已可公開；仍須完成 Access、runtime 與瀏覽器驗證。

## 8. 第一次安全部署

第一次部署只建立安全基線。不要加入 R2、Workflow 或 rate-limit 的可選部署設定，也不要設定 fal secret。

部署腳本使用固定的專案 Worker 名稱。執行前先檢查公開的 deployment constant，確認目標帳戶沒有同名但屬於其他用途的 Worker；若有衝突，停止並先審查所有 config、build 及驗證腳本，不要直接覆寫既有服務。

在仍保留第 6 節環境變數的同一個 shell 執行：

```bash
pnpm deploy:cloudflare
unset DEPLOY_D1_NAME DEPLOY_D1_ID DEPLOY_CONFIG_PATH
```

`pnpm deploy:cloudflare` 會建置 React 前端、重新產生私有 deployment config，再由 Wrangler 部署 Worker。此命令會更改遠端 Cloudflare 狀態；請勿在錯誤帳戶或未審查分支執行。

Checked-in 設定停用 `workers.dev` 公開 hostname。部署後在 Cloudflare Dashboard 為 Worker 設定由你控制的 custom domain／route；不要把私人 hostname 記錄在公開 repo。

## 9. 設定 runtime、法律聯絡與 Access

在 Cloudflare Dashboard 的 Worker settings 內設定非秘密 runtime values。基線至少要有：

- 正式環境模式；
- Cloudflare Access team domain 與 application audience；
- 真實、受監察的法律／私隱聯絡方法；
- mock provider；
- 所有音訊傳輸、Workflow、credit accounting、retention cleanup 與 real-generation capability 均為 `false`；
- 適合你環境的非秘密上限與 TTL。

變數名稱及安全佔位值可在 [`.env.example`](../.env.example) 查看。**不要**把正式值回寫至該檔案或 `wrangler.jsonc`。

在 Cloudflare Access 建立 self-hosted application：

1. 公開首頁、登入說明、健康檢查及法律頁維持公開。
2. 私人工作區及使用者 API 必須由 exact allowlist 保護。
3. Worker 仍須驗證 Access JWT；不可只相信 header 存在。
4. 不使用 `Everyone` 或廣域 `Bypass` 讓私人路徑公開。
5. Provider callback 例外保持停用，直至真實 provider staging 獲批。

路徑設定、JWT、session 及逐項 browser test 見 [`CLOUDFLARE_ACCESS.md`](CLOUDFLARE_ACCESS.md)。不要把 team domain、AUD、測試者 email、owner ID 或 Access screenshot 放進 GitHub。

## 10. 驗證部署

使用私有 hostname 執行現成的資料最小化檢查；指令輸出只包含 readiness booleans 與 migration counts：

```bash
DEPLOY_PUBLIC_URL="https://<PRIVATE_OR_PUBLIC_CUSTOM_HOSTNAME>" \
DEPLOY_EXPECT_ENV=production \
DEPLOY_CONFIG_PATH=wrangler.production.json \
pnpm deploy:verify
```

驗證至少包括：

- 公開頁與 health 可達；
- 私人工作區及 API 在未登入時被保護；
- 法律 manifest 使用真實聯絡設定；
- D1 migrations 已是 current；
- 沒有 R2、Workflow、rate-limit 或 real-provider readiness 被意外啟用；
- 未批准身份被 Access 拒絕；
- 回應及 log 不含 owner、token、signed URL 或資源識別資料。

任何 non-zero exit 都應視為未完成，不要用「已正式上線」描述該部署。

## 11. 使用 Cloudflare Workers Builds 自動部署

手動基線驗證完成後，才連接 GitHub。Workers Builds 的 production branch push 會部署正式 Worker；preview build 不等同於 production。

在 Worker 的 **Settings → Builds**：

1. 連接獲授權的 GitHub repository。
2. Production branch 設為 `main`。
3. Root directory 設為 `/`。
4. Build command 設為 `pnpm build:web`。
5. Deploy command 設為 `pnpm --filter @studymix/api deploy:cloudflare`。
6. Non-production deploy command 設為 `pnpm --filter @studymix/api preview:cloudflare`。
7. 在 **API token** 設定審核 Workers Builds 的實際權限。Cloudflare 自動建立的預設 token
   包含 Workers Scripts、KV、R2，以及帳戶內所有 zones 的 Workers Routes 編輯權限；優先選用
   自行建立、只涵蓋本 Worker 及其已核准資源的最小權限 user token。若平台無法把所需權限
   收窄至可接受範圍，應先使用隔離帳戶／zone 或停止自動部署，不要讓 build token 存取無關資源。
8. 將 `DEPLOY_D1_NAME`、`DEPLOY_D1_ID` 設為 Cloudflare protected build settings。
9. 不設定 R2、Workflow 或 rate-limit 的可選 protected settings，直至隔離 staging 獲批。
10. GitHub branch protection 要求 CI 通過後才可合併。

Cloudflare build settings、token 和 secret 不應複製到 GitHub Actions、repository 或 log。Workers
Builds 的當前行為及預設 token 權限以
[官方設定文件](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token) 為準。

## 12. 進階私人音訊能力

以下不是安全基線的必要步驟，也不應在 production 首次部署時啟用。

### 12.1 私人 R2

- 建立 staging 與 production 分離的私人 bucket。
- 不啟用 `r2.dev` 或 public bucket custom domain。
- R2 credential 只給該 bucket 所需的 Object Read／Write 權限。
- 使用 exact-origin CORS、短效 URL、不可覆寫條件與瀏覽器直傳。
- 先驗證過期、錯誤 content type、第二次 PUT、跨 owner、刪除與 log redaction。

### 12.2 Cloudflare Workflows

- 只把 Workflow binding 接到經批准的同一 Worker preview。
- 保持 mock provider 及 real generation off。
- 驗證重試、冪等、失敗、取消、私人輸出及 owner isolation。
- Preview 成功不代表 production 可用。

### 12.3 fal.ai ACE-Step

- 先重新閱讀模型 schema、queue、webhook、retention、費用與服務條款。
- Secret 只可透過 Cloudflare Dashboard 或 Wrangler 互動式 secret prompt 設定，不能出現在命令參數、shell history、build log 或檔案。
- 只使用獲授權、非敏感、成本受限的 staging fixture。
- 必須驗證 callback signature、polling fallback、輸出串流、刪除、供應商資料使用及法律文件。
- 未完成所有 gate 時，provider 仍為 mock，real generation 仍為 `false`。

完整 staging gate 見 [`CLOUDFLARE_ACCESS.md`](CLOUDFLARE_ACCESS.md) 與 [`LEGAL_AND_DATA_USE.md`](LEGAL_AND_DATA_USE.md)。

## 13. 更新、preview 與 rollback

更新前：

1. 在本機 clean clone 或專用分支安裝 lockfile 依賴。
2. 閱讀 migration 與 runtime config diff。
3. 完成 typecheck、lint、test、build 與 E2E。
4. 先上傳 preview version，不將 production traffic 指向 preview。
5. 用合併 commit 的固定 SHA 驗證 CI 與部署來源。
6. Migration 只向前增加；不要把 Worker rollback 當成資料庫 rollback。

若 Worker 版本有問題，可使用 Cloudflare Dashboard 或目前官方支援的 Wrangler rollback 流程回到已知良好版本。涉及 D1、R2 或資料修復時，先停止寫入並制定單獨、可審查的修復程序；不要即席刪除資料或 migration。

## 14. 常見問題

### Wrangler 顯示 placeholder／binding error

確認你使用的是被忽略的 `wrangler.production.json`，而不是檢入的 placeholder config；再核對 `DEPLOY_CONFIG_PATH` 及 D1 目標。

### `/app` 回傳 401／403

這通常代表安全邊界正常工作。檢查 Access application、allowlist、team domain、AUD、session 及 D1 owner 狀態，不要改成 anonymous access。

### 法律 manifest 回傳 503

正式法律／私隱聯絡設定缺失或仍是佔位值。設定受監察的真實聯絡方法；不要硬編碼在 repo。

### Build 通過但網址不可用

確認 custom domain／route、Workers Builds production branch、active version 及 Access 路徑。Preview build 不會自動成為 production traffic。

### 想快速測試真實 AI

不要在 production 直接開啟。先使用 `pnpm dev:local-ai`；需要供應商測試時另建隔離 staging，完成費用、權利、私隱、callback、刪除與觀察性 gate。

## 15. 部署前最後檢查

- [ ] `git status --short` 沒有未理解的變更。
- [ ] 私有 deployment config 可被 `git check-ignore` 命中。
- [ ] 沒有 `.env`、`.dev.vars`、D1 dump、R2 object list、音訊或真實 screenshot 被追蹤。
- [ ] 沒有 secret、signed URL、JWT、Access assertion、帳戶／資源 ID 或私人 hostname。
- [ ] 所有 capability 預設 fail closed。
- [ ] Migration 目標已人工核對。
- [ ] CI 與本機檢查通過。
- [ ] Access 的未授權與第二 owner 情境通過。
- [ ] `pnpm deploy:verify` 通過，且沒有把輸出誤當成真實 AI 品質證明。
- [ ] 任何 push、merge、Cloudflare 變更或付費 API 使用均有明確授權。

發佈前再依 [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md) 做一次檔名級及人工差異檢查。
