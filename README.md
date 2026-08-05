# StudyMix AI — 私人音訊風格重塑 / Private Audio Restyling

StudyMix AI 是一個以繁體中文為主、英文為輔的私人音訊風格重塑 MVP。使用者只可處理自己擁有或已獲授權的錄音；產品不提供公開作品頁、任意遠端音訊擷取或藝人名稱模仿功能。

StudyMix AI is a bilingual, security-first MVP for privately restyling audio that the user owns or is authorized to process.

> **部署方式 / Deployment:** 本專案以 **Cloudflare Workers** 作為正式執行環境。React 前端經 Workers Static Assets 發佈，Hono API 在同一個 Worker 內執行；D1、私人 R2、Workflows 與 Access 按部署能力接入。公開程式庫不包含任何實際 Cloudflare 識別資料、正式資料或 secret。

## 專案狀態 / Project status

- 私人封閉測試階段；沒有公開註冊或公開使用者內容。
- 本機預設使用 mock／合成音訊，不需要付費憑證，也不會呼叫外部 AI。
- fal.ai ACE-Step audio-to-audio adapter 已包含在程式庫，但真實供應商路徑預設停用。
- 正式音訊上載、外部生成與自動清理必須在擁有者自己的隔離環境完成安全、法律及瀏覽器驗證後才可啟用。
- 本存放庫尚未選定開源授權；請先閱讀 [`LICENSE.md`](LICENSE.md)。

程式庫狀態不等同於目前線上環境狀態；以 [`docs/TODO.md`](docs/TODO.md) 的已驗證項目及部署後檢查結果為準。

## 技術棧 / Technology stack

| 層面                     | 使用技術                                                           | 用途                                                |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------- |
| Cloud runtime            | Cloudflare Workers、Workers Static Assets                          | 發佈單一全端 Worker、SPA 與 API                     |
| Data services            | Cloudflare D1、私人 Cloudflare R2                                  | 擁有者範圍的 metadata，以及受旗標保護的私人音訊物件 |
| Orchestration and access | Cloudflare Workflows、Cloudflare Access                            | 可恢復的長時間工作與受邀工作區存取                  |
| Frontend                 | React、Vite、TypeScript                                            | 雙語 Web 介面與靜態產物                             |
| API and validation       | Hono、Zod、JOSE、aws4fetch                                         | Worker API、外部輸入驗證、JWT 驗證與簽署請求        |
| AI provider boundary     | Credential-free mock、fal.ai ACE-Step adapter                      | 本機／CI 合成流程，以及預設關閉的外部音訊模型接線   |
| Tooling                  | pnpm workspaces、Wrangler                                          | Monorepo、Cloudflare 型別、開發與部署               |
| Quality                  | Vitest、Cloudflare Workers test pool、Playwright、ESLint、Prettier | 單元、Worker、瀏覽器與靜態檢查                      |
| Delivery                 | GitHub Actions、Cloudflare Workers Builds                          | 合併前驗證與受保護的 Cloudflare 部署流程            |

實際套件版本以 [`package.json`](package.json) 及 [`pnpm-lock.yaml`](pnpm-lock.yaml) 為準。更完整而不包含正式環境識別資料的說明見 [`docs/TECH_STACK.md`](docs/TECH_STACK.md)。

## 安全與私隱界線 / Security and privacy boundary

公開程式庫只應包含可審查的程式、合成 fixtures、佔位值及通用操作說明：

- 不提交真實使用者資料、音訊、檔名、D1 匯出、R2 object key、日誌、截圖或分析資料。
- 不提交 API key、token、cookie、JWT、signed URL、Access assertion、帳戶／資料庫／bucket／Workflow 識別資料或私人 hostname。
- 不在公開文件重述實際資料庫結構、內部拓撲、事故資料、容量資料或正式環境設定。
- `.env*`、`.dev.vars*` 及產生的 `wrangler.*.json` 私有部署檔不進入版本控制。
- 所有外部輸入使用 Zod 驗證；自動測試與 CI 不使用付費 API。
- R2 必須維持私人；短效簽署 URL 應視為 bearer credential，不得寫入日誌或 issue。
- AI 產生的文件、commit 或 PR 必須先由人手檢查差異；沒有明確授權時不得推送、部署或更改 Cloudflare 設定。

完整公開發佈規則與檢查清單見 [`docs/PUBLICATION_SAFETY.md`](docs/PUBLICATION_SAFETY.md)。

## 本機開發 / Local development

需要：

- Node.js 22.12 或更新版本
- pnpm 11 或更新版本

從存放庫根目錄執行：

```bash
pnpm install --frozen-lockfile
pnpm cf-typegen
pnpm dev
```

預設本機入口：

- 產品介面：`http://localhost:5173/`
- Worker API：`http://localhost:8787/`

`pnpm dev` 使用本機 D1 狀態與 mock provider；不需要 Cloudflare 帳戶、fal key 或付費 API。

正式 Worker 會先處理 `/app`、`/app/*`、`/api` 及使用者 `/api/*`，再提供 Static Assets；JWT 驗證後仍須通過 active owner、workspace 及 membership。公開首頁、`/login`、法律頁、`/health` 與公開法律 manifest 不建立 owner。真實供應商停用時不需要新增 Access 例外；既有精確 callback 仍由供應商簽章驗證。
如要驗證完全本機、loopback-only 的 D1／R2／Workflow 合成流程：

```bash
pnpm dev:local-ai
```

然後開啟 `http://127.0.0.1:8787/app`。此模式使用固定合成 WAV、Wrangler 本機資源與 mock provider，不讀取真實使用者音訊，不使用遠端 binding，也不呼叫外部 AI。

快速驗證本機合成流程：

```bash
pnpm test:local-ai
```

完整品質檢查：

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## 自部署 / Self-hosting

自部署會使用部署者自己的 Cloudflare 帳戶、網域及隔離資源。建議先完成預設安全部署，再逐項評估私人 R2、Workflow 或外部 AI；不要把範例佔位值直接用於正式環境。

高層步驟：

1. Clone 後安裝依賴，完成本機 mock 與品質檢查。
2. 使用 Wrangler 登入自己的 Cloudflare 帳戶。
3. 建立自己的 D1，將名稱及 ID 只放在受保護設定或被忽略的本機部署檔。
4. 檢查並套用版本化 migration；不要上傳資料庫 dump 或真實資料。
5. 先部署所有音訊傳輸、外部 AI 及清理能力均停用的 Worker 基線。
6. 在 Cloudflare 設定自訂 hostname、精確 Access allowlist、正式聯絡方法與非秘密 runtime 設定，再以私密 onboarding 工具建立 owner workspace。
7. 執行不輸出識別資料的部署驗證，再決定是否在隔離 staging 開啟進階能力。

可直接跟隨的命令、Cloudflare Dashboard 設定、Workers Builds、自動部署、更新與故障排查，請閱讀 [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)。私人 beta 的 Access 安全檢查另見 [`docs/CLOUDFLARE_ACCESS.md`](docs/CLOUDFLARE_ACCESS.md)。

> `pnpm deploy:cloudflare` 會寫入遠端 Cloudflare。執行前請確認目標帳戶、私有設定檔、migration 與部署權限；本機開發不需要執行此命令。

## 存放庫結構 / Repository layout

```text
apps/
  web/          React / Vite frontend
  api/          Cloudflare Worker API and Workflow entrypoint
packages/       Shared contracts, domain logic, providers and presets
docs/           Product, operations, legal and public-safe documentation
e2e/            Browser tests
```

此處只顯示公共模組責任，不列出正式環境拓撲、資料庫組織或資源識別資料。

## 文件索引 / Documentation

- [`docs/README.md`](docs/README.md) — 文件導覽與閱讀次序
- [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) — 公開安全的完整自部署指南
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md) — 技術棧、執行環境與 AI 邊界
- [`docs/PUBLICATION_SAFETY.md`](docs/PUBLICATION_SAFETY.md) — AI／GitHub 公開發佈安全規範
- [`docs/PRD.md`](docs/PRD.md) — 產品需求與界線
- [`docs/TODO.md`](docs/TODO.md) — 目前可驗證能力與停用項目
- [`docs/LEGAL_AND_DATA_USE.md`](docs/LEGAL_AND_DATA_USE.md) — 法律及資料使用啟用條件（非法律意見）
- [`docs/design/README.md`](docs/design/README.md) — 設計方向與測試畫面

## 授權 / Licence

本存放庫目前沒有授予開源授權。自部署、修改或再散佈前，請閱讀 [`LICENSE.md`](LICENSE.md) 並取得所需許可。第三方套件及模型服務各自受其授權、服務條款、私隱政策與使用限制約束。

## 參考與使用技術 / References and acknowledgements

Cloudflare 平台：

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) 與 [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Cloudflare Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) 與 [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

應用與測試技術：

- [React](https://react.dev/)、[Vite](https://vite.dev/)、[TypeScript](https://www.typescriptlang.org/)
- [Hono for Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Zod](https://zod.dev/)、[JOSE](https://github.com/panva/jose)、[pnpm](https://pnpm.io/)
- [Vitest](https://vitest.dev/) 與 [Playwright](https://playwright.dev/)

AI 模型與供應商資料：

- 本機及 CI 的 `mock`／合成音訊是測試工具，**不是 AI 模型**，也不代表模型品質。
- 可選外部 adapter 參考 [fal.ai ACE-Step audio-to-audio API](https://fal.ai/models/fal-ai/ace-step/audio-to-audio/api)、[asynchronous queue](https://fal.ai/docs/documentation/model-apis/inference/queue)、[webhook verification](https://fal.ai/docs/documentation/model-apis/inference/webhooks) 與 [platform headers / retention controls](https://fal.ai/docs/documentation/model-apis/common-parameters)。此路徑預設停用，程式庫不包含模型權重、訓練資料或付費憑證，也不對第三方模型的資料來源、權利或輸出作額外保證。

全球性法律與資料治理參考（不構成法律意見）：

- [OECD：私隱保障及個人資料跨境流動指引](https://legalinstruments.oecd.org/public/doc/114/body-text.en.html)
- [世界知識產權組織（WIPO）：版權](https://www.wipo.int/zh/web/copyright/)
