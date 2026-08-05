# 技術棧與執行界線 / Technology Stack and Runtime Boundaries

本文件提供可公開的技術清單及責任分工。它不記錄正式環境資源、帳戶識別資料、內部網絡拓撲、資料庫 schema、真實資料、容量、成本或 secret。

## 1. 部署模型

StudyMix AI 建置及部署為一個 full-stack Cloudflare Worker：

- React／Vite 產生的前端由 Workers Static Assets 發佈。
- Hono API 在同一 Cloudflare Worker runtime 執行。
- Worker bindings 接入需要的 Cloudflare managed services。
- Checked-in Wrangler 設定只包含可公開佔位值；實際資源由受保護設定產生至 ignored config。
- `workers.dev` 預設關閉，正式流量使用部署者控制的 hostname。

這是部署契約，不是當前 production 狀態證明。每次 release 仍須以 CI、固定 commit、active deployment 及 live route 檢查確認。

## 2. Cloudflare 平台

| 服務                  | 公開責任                                             | 啟用界線                             |
| --------------------- | ---------------------------------------------------- | ------------------------------------ |
| Cloudflare Workers    | API、存取邊界、metadata 操作及靜態資產入口           | 基線部署                             |
| Workers Static Assets | 發佈 React SPA build                                 | 基線部署                             |
| D1                    | 應用 metadata；所有擁有者資料均須 owner-scoped       | 基線部署；不公開 schema 或資料 dump  |
| R2                    | 私人來源及輸出物件                                   | Feature-gated；不使用 public bucket  |
| Workflows             | 可重試、可恢復的長時間生成流程                       | Feature-gated；先在隔離 staging 驗證 |
| Cloudflare Access     | 受邀工作區與私人 API 的 identity-aware proxy         | 私人 beta 必需                       |
| Rate Limiting binding | 真實供應商工作前的粗粒度 abuse signal                | 真實生成時才需要                     |
| Workers Builds        | Git 來源的 production／preview build                 | 手動基線驗證後才連接                 |
| Wrangler              | 型別生成、本機模擬、migration、preview 與 deployment | 專案固定 4.x 版本                    |

重要界線：

- R2 物件不經公共 bucket 或永久公開 URL 發佈。
- 大型音訊不應由 Worker 完整 buffer 或 proxy。
- D1 migration 是版本化、additive 及可審查的；公開文件不重述 production schema。
- Access 不是 Worker 內部授權的替代；Worker 仍驗證 JWT 及 owner scope。
- Preview、CI 或 dry-run 成功不等於 production 已啟用。

## 3. Web 與 API

| 技術               | 目前用途                                                         |
| ------------------ | ---------------------------------------------------------------- |
| React 19           | 雙語產品介面、私人工作區與結果狀態                               |
| Vite 8             | 前端開發伺服器與 production bundle                               |
| TypeScript 6       | Web、Worker、shared packages 及 scripts 的嚴格型別               |
| Hono 4             | Cloudflare Worker HTTP routing／middleware                       |
| Zod 4              | 所有外部輸入、provider 回應與共用 contract 的 runtime validation |
| JOSE 6             | Cloudflare Access JWT signature／claim validation                |
| aws4fetch          | 私人 R2 S3 簽署請求邊界                                          |
| pnpm 11 workspaces | Monorepo dependency 與 script orchestration                      |

版本會隨 lockfile 更新；以上 major version 只描述目前 repository snapshot。準確版本以根目錄及各 workspace 的 `package.json`、`pnpm-lock.yaml` 為準。

## 4. Monorepo 公共責任

```text
apps/web        browser UI and static build
apps/api        Cloudflare Worker entrypoint and Cloudflare integration
packages/*      shared contracts, domain rules, presets and provider boundaries
e2e             browser-level tests
docs            product, operations, legal and public-safe guidance
```

這個目錄清單只說明模組責任，不公開實際 production service map、資料庫表格、object-key convention、私人 route inventory 或 incident topology。

## 5. AI 模型與 provider boundary

### Mock／synthetic provider

- 預設本機及 CI 使用。
- 產生固定、非版權、可重現的合成音訊。
- 不需要 key，不使用 GPU 或付費 API。
- 它是流程測試 adapter，**不是 AI 模型**，亦不能證明外部模型品質。

### fal.ai ACE-Step audio-to-audio

- 程式庫包含 provider adapter 與離線 contract tests。
- 參考 endpoint 是 `fal-ai/ace-step/audio-to-audio`。
- 使用非同步 queue model；外部回應先經 Zod 驗證。
- Secret 只存在 Worker secret store；browser bundle 不可取得。
- 真實 provider、callback 及輸出交付預設停用。
- 自動測試及 CI 不作付費或真實音訊請求。

本存放庫沒有：

- 自行訓練的 StudyMix AI 模型；
- model weights、checkpoint 或 training dataset；
- Workers AI inference binding；
- 對第三方模型訓練來源、版權、唯一性、品質或適用性的額外保證。

任何 operator 開啟外部 AI 前，都要重新核對當前 model schema、費用、input／output retention、subprocessors、資料使用、webhook signature、輸出權利及適用法律。參考連結集中在根目錄 [`../README.md`](../README.md) 最後一節。

## 6. 資料與私隱技術界線

公開技術文件只描述控制目標：

- 身份由已驗證的 Cloudflare Access claim 派生，browser 不能指定 owner。
- 所有擁有者資料讀寫需要 owner scope 及另一 owner 的拒絕測試。
- 使用者音訊及輸出保持私人，且有明確到期／刪除控制。
- Signed URL、token、完整 callback payload、檔名及音訊內容不進入 log。
- 不接受使用者提供的任意遠端 URL，也不抓取網站或公開資料庫的音訊。
- 真實應用資料、D1 dump、R2 object list、Access identity 及 operational metrics 不進入 repository。

資料類別、法律啟用條件與仍未核實的聲明見 [`LEGAL_AND_DATA_USE.md`](LEGAL_AND_DATA_USE.md)。該文件是 engineering control，不是法律意見。

## 7. 測試與品質

| 技術                              | 覆蓋範圍                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| Vitest                            | shared packages、UI clients、provider contracts 及 domain rules |
| `@cloudflare/vitest-pool-workers` | Worker、D1／R2／Workflow binding integration                    |
| Playwright                        | Chromium 使用者流程、Access／API 邊界及響應式介面               |
| ESLint                            | TypeScript、Promise handling 與 repository rules                |
| Prettier                          | Markdown、JSON、TypeScript 等格式一致性                         |
| Wrangler dry-run                  | Worker bundle、binding types 及 Cloudflare build compatibility  |

標準檢查：

```bash
pnpm cf-typegen
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:local-ai` 另外覆蓋 loopback-only 的合成 orchestration。測試通過只證明被測 contract，不代表外部模型品質、production traffic、Access policy 或 live retention 已驗證。

## 8. CI/CD

GitHub Actions 只做讀取原始碼、安裝依賴、型別、lint、unit／Worker tests、build 與 E2E；不保存 Cloudflare deployment token，也不呼叫付費 AI。

Cloudflare Workers Builds 負責已授權的 deployment：

- Production branch 產生 production deployment。
- 其他分支只上傳 preview version。
- D1 及可選 bindings 只從 Cloudflare protected build settings 產生到 ignored config。
- Runtime variables 與 secrets 保留在 Cloudflare，不寫入 repository。

完整操作見 [`SELF_HOSTING.md`](SELF_HOSTING.md)。

## 9. 公開文件不應包含的內容

- 真實 Cloudflare account、zone、Worker、D1、R2、Workflow、Access、rate-limit 或 deployment identifiers。
- 私人 hostname、tester allowlist、identity、owner ID、email、contact value 或 JWT claim sample。
- Secret name 與實際值的配對、signed URL、cookie、header、private key 或 API response dump。
- Production database schema diagram、table／column inventory、query plan、row sample、backup 或 export。
- Account-specific network／security topology、incident path、capacity、cost、traffic 或 vendor contract details。
- 使用者音訊、輸出、檔名、metadata、log、analytics、screenshot 或錄影。

發佈前依 [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md) 檢查。
