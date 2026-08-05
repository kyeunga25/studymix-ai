# 公開發佈安全規範 / Public Publication Safety

本規範適用於 README、docs、程式碼、fixtures、測試、commit、PR、issue、release、CI log、截圖，以及由 AI 助手產生或整理的任何內容。

目標是讓 StudyMix AI 可審查及可自部署，同時避免把私隱資料、真實應用資料、憑證、帳戶專屬架構、資料庫組織及營運細節公開。

## 1. 核心原則

1. 公開內容只使用合成資料、佔位值及通用描述。
2. 自部署文件說明「如何建立自己的資源」，不記錄現有資源。
3. 技術棧可公開；帳戶專屬拓撲、資料庫組織、識別資料及 live evidence 不公開。
4. 程式庫中的 migration 是可自部署所需的 source code，不代表可以把 production schema diagram、dump 或 row sample 加入文件。
5. CI、preview、本機 mock 或 historical evidence 不可描述成目前 production 狀態。
6. 發現不確定內容時先停止 stage／commit／push，由 repository owner 決定。

## 2. 永不公開的資料

### 個人及使用者資料

- 姓名、email、電話、地址、帳戶資料或 identity-provider claim。
- 不從介面語言、locale、拼寫、時區、網域或工具環境推斷並公開營運者的所在地、國籍、居住地、適用法律或目標市場。
- Tester allowlist、owner ID、session、Access assertion 或 authentication screenshot。
- 使用者音訊、生成輸出、原始檔名、metadata、rights evidence 或支援個案。
- 真實使用情況、analytics、IP、成本、流量、配額、錯誤樣本或 operational log。

### Secret 及 bearer credential

- API key、token、password、cookie、JWT、private key、certificate 或 recovery code。
- Cloudflare API token、R2 access credential、AI provider key 或 webhook secret／identity value。
- Signed URL、完整 authorization header、query string 或 callback body。
- Secret manager、Dashboard 或 shell 的 screenshot／copy-paste output。

只公開 secret 的用途分類；如 source code 必須引用環境變數名稱，值只留空白或明確不可部署的佔位值。

### Cloudflare 及 deployment 識別資料

- Account、zone、database、bucket、Workflow、rate-limit namespace、Access application、deployment 或 version ID。
- 私人 hostname、team domain、application audience、route mapping 或未公開 origin。
- 實際 resource name、binding inventory dump、Dashboard URL 或 Workers Builds protected value。

### 架構及資料庫細節

- Account-specific service map、trust relationship、bypass path、network diagram 或 incident attack path。
- Production 資料庫完整 table／column map、索引清單、query plan、row count、backup、export 或 sample rows。
- Object-key convention、內部 correlation format、retention queue inventory 或 recovery runbook 的敏感部分。
- 未公開供應商、合約、商戶、付款、成本、容量或 roadmap 細節。

公共文件可描述 Cloudflare Workers、D1、R2、Workflows、Access 等高層技術角色，但不可把它們連結到實際帳戶值或 live topology。

## 3. 可公開內容

- React、Vite、TypeScript、Hono、Zod、Wrangler、Vitest、Playwright 等技術棧。
- 使用 `<PLACEHOLDER>`、`example.test`、固定合成 ID 與非版權 fixture 的操作範例。
- 官方產品文件連結及公開服務條款。
- 安全控制目標，例如 owner isolation、private object storage、short-lived URL、fail-closed flags。
- 本機 mock／synthetic 測試方法，但要清楚標示它不是 AI 模型或 production 證明。
- 自部署者建立**自己**資源的步驟，不包括現有資源值。

## 4. AI 助手規則

任何 AI 助手處理本專案時必須：

- 先讀 repository instructions 及本文件。
- 只讀取完成任務必要的檔案；避免把完整 private config、Dashboard output 或資料 dump 放入 prompt／tool output。
- 終端輸出可能含識別資料時，只返回布林結果、計數或檔名；不要回傳值。
- 產生範例時使用 synthetic data 與保留網域（例如 `example.test`）。
- 不把對話內容、使用者偏好、個人資料、local absolute path 或 Codex state 寫進 repo。
- 不因繁中或其他語言介面，自動加入某一地區的政策、監管機構、法律或營運者所在地聲明。
- 不臆測或補寫 model provenance、授權、production readiness、資料位置或法律結論。
- 沒有使用者明確授權時，不執行 commit、push、PR、merge、migration、deployment、Access policy 或 secret 變更。
- 即使獲准推送，也要先完成人工 diff、secret、identifier 與 data exposure 檢查。

AI 產生的內容必須由人手負責最終審閱；「AI 沒有發現」不等於沒有 secret 或私隱風險。

## 5. 檔案及設定規則

以下檔案只能保留在本機或 Cloudflare，不可加入 Git：

- `.env`、`.env.*`（明確公開的 `.env.example` 除外）；
- `.dev.vars`、`.dev.vars.*`；
- 產生的 `wrangler.*.json` deployment config；
- D1 export／backup、SQLite file、R2 object list 或 production log；
- secret JSON、private key、certificate、audio fixture 或 screenshot containing live data。

`.env.example` 只可包含空值、local-only sample 或明確佔位值，不得被當作 production config。

新增圖片、PDF、錄影、音訊或 binary 前必須人工檢查：

- EXIF／metadata；
- browser address bar、account name、email、file path；
- terminal、Dashboard、Network panel 或 Developer Tools 中的 token／ID；
- 真實使用者內容或第三方受限制資料。

## 6. 發佈前檢查

以下命令只顯示狀態、檔名或格式錯誤，避免把疑似 secret 值複製到公開 log：

```bash
git status --short
git diff --check
git diff --name-only
git diff --cached --name-only
git ls-files | rg '(^|/)(\.env|\.dev\.vars)(\.|$)|(^|/)wrangler\..*\.json$'
git check-ignore --no-index apps/api/wrangler.production.json
```

預期：

- 所有變更檔案都能解釋。
- `git diff --check` 沒有錯誤。
- 私有設定不在 tracked file list。
- `git check-ignore` 能命中 private deployment filename。

再做只返回檔名的關鍵字掃描：

```bash
rg -l --hidden \
  -g '!node_modules/**' \
  -g '!.git/**' \
  -g '!pnpm-lock.yaml' \
  '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|secret|token|password|account[_-]?id|database[_-]?id|signed[_-]?url)' .
```

這個掃描會因安全文件與佔位值產生 false positives。只在受信任的本機環境逐一人工檢查命中的**檔名**；不要把包含真實值的行貼給 AI 或公開服務。

如果本機已安裝 gitleaks，可額外執行有 redaction 的掃描：

```bash
gitleaks detect --redact --no-banner --source .
```

之後人工檢查 staged diff，但不要把完整 diff 貼到公開 issue 或第三方 AI。審查要確認：

- 所有值都是 placeholder／synthetic。
- 沒有新增 production schema、topology 或 operational data。
- AI／provider 描述有區分 mock、adapter、staging、production 與 unknown。
- README、self-hosting、code 與 current verified status 一致。
- Commit／PR 只描述實作本身，不包含對話、個人資訊或私人動機。

## 7. GitHub 及 CI 規則

- GitHub Actions 只使用最小 `contents: read` 權限，除非獨立審查證明需要更多權限。
- Cloudflare deployment 由 Workers Builds 的 protected settings 處理，不把 deploy token 放入 repository 或 Actions log。
- Production branch 必須受 CI 保護；preview 結果不可宣稱為 live production。
- PR screenshot、test artifact 及 Playwright trace 不可包含真實帳戶或正式資料。
- 不公開貼出 `wrangler whoami`、deployment detail、binding dump、secret list 或 D1 query output。
- 未經授權不建立 release、tag、PR、push 或 public issue。

## 8. 發現敏感資料時

### 尚未 commit／push

1. 立即停止 stage、commit、push 及 deployment。
2. 記錄受影響的明確檔名，不複製敏感值。
3. 從該檔案移除值，改用 placeholder 或 ignored private config。
4. 若值曾交給不受信任工具或服務，視為已洩露並輪換。
5. 重新做檔名、secret、format 及測試檢查。

### 已 commit 或 push

1. 立即輪換／撤銷 credential；不要先等待 Git history cleanup。
2. 暫停相關 deployment 或 access path，範圍只限受影響資源。
3. 通知 repository owner，保留最少且私密的 incident evidence。
4. Git history rewrite、force push、資料刪除或 public disclosure 必須另行批准及協調；不要由 AI 自行執行。
5. 檢查 forks、Actions artifacts、release assets、issues、PR comments 及 caches。

Repository 更新不能令既有 Git history 中的內容自動消失。若歷史版本曾包含敏感資料，必須以 incident response 處理，而不是只改最新 README。

## 9. Pull request checklist

- [ ] 變更只使用 synthetic／placeholder data。
- [ ] 沒有 personal data、real app data、secret、signed URL 或 private hostname。
- [ ] 沒有由語言、locale、時區、網域或環境推斷出的營運者地域資訊。
- [ ] 沒有 account-specific architecture、production schema 或 database export。
- [ ] 新增 binary 已檢查 metadata 與畫面內容。
- [ ] Mock、staging、production 與 planned status 標示準確。
- [ ] `git diff --check`、相關測試及 build 通過。
- [ ] Private deployment config 仍被 Git 忽略。
- [ ] Commit／PR 內容沒有使用者對話、個人偏好、私人動機或本機路徑。
- [ ] Push／PR／deployment 已取得明確授權。
