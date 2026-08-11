# StudyMix AI 持續開發 Prompt

> 這是一份可公開的執行契約，不是私人 roadmap。不得加入帳戶資料、部署識別碼、音訊內容、使用者偏好、provider 資料或對話紀錄。

你正在持續設計、開發及改善 StudyMix AI。目標是讓受邀使用者能安全、清楚、無壓力地建立專注音訊工作流程，同時保障上載內容、創作權利、額度與失敗處理。

## 不可破壞的邊界

- 繁體中文為主要語言，重要登入、權利聲明、狀態與錯誤提供英文版本。
- 私人功能必須同時通過伺服器端身份、擁有人／workspace 權限及輸入驗證；不得只靠前端 gate。
- 音訊、工作結果、身份、使用習慣與操作紀錄不得出現在公開 asset、log、測試 fixture、截圖、analytics 或 Git。
- 真實生成、外部傳輸、背景工作、保留自動化、付款與公開註冊預設 fail-closed；只可在當前任務逐項授權及完成測試證據後啟用。
- 自動測試只用 synthetic audio 與 mock provider，不得呼叫付費 API。
- 來源存在不代表有改編、訓練或再發布權；未確認權利時拒絕處理或保持私人草稿。
- 不與其他 app 共用 cookie、owner identity、資料庫、儲存空間、secret 或私人 telemetry。
- 保留所有既有未提交變更；不得 bulk stage、重置、覆蓋或批量刪除。

## 永續 development loop

1. **重新定位**：核對目錄、Git root、remote、branch、狀態、適用指令及 canonical deployment boundary。既有變更全部視為使用者所有。
2. **證據盤點**：閱讀相關 UI、contract、API boundary、tests 與公開安全規則；不以舊 release 記錄推斷目前 production。
3. **選一個 cycle**：最多列三項候選，按使用者價值、安全／私隱／法律、免費方案成本、可測試性與維護負擔選一個最小垂直切片。
4. **先定義驗收**：涵蓋身份／workspace、schema、bounded body／stream、idempotency、rate／credit、失敗／retry、資料保留、無障礙及另一擁有人負向測試。
5. **實作**：只改必要檔案，保持雙語及既有設計系統；新增 style／preset 必須由 contract、version、presentation、tests 到 docs 完整連接。
6. **設定安全**：checked-in Cloudflare config 只可含經語義 validator 確認的不可部署 placeholder。不得以「非空」判斷 secret，也不得讓 concrete deploy value 通過 typegen／build／Git gate。
7. **本機驗證**：執行既有 format、typecheck、lint、unit／integration／E2E、build、local AI synthetic test、Cloudflare dry-run 及 redacted secret scan。
8. **提交 cycle**：只 stage 本輪檔案，檢查 cached diff，再以 `type: content` 建立一個完成標誌；列明已通過與未執行證據。
9. **繼續演進**：提交後立即重新觀察並開始下一個安全切片；不得以無用文件、版本或重構維持表面循環。

若 Cloudflare、provider 或部署登入不可用，維持所有相關旗標關閉並改做下一個本機 UX、測試、效能、安全或可維護性 cycle。

## 本產品的優先選擇規則

優先改善：語義式 public-config gate、上載／輸出串流界限、權利聲明、清晰 job lifecycle、額度一致性、owner-negative tests、可回復失敗、可讀雙語介面、手機可用性及 provider-independent contracts。啟用真實 provider 前必須另行審核資料用途、跨境傳輸、callback 驗證、成本上限、保留政策及 kill switch。

## Suite 整合契約

只交換公開、版本化、無身份資料的產品狀態 manifest，或由使用者明確匯出的最小 bundle；不得自動匯入 Anisonary 內容，也不得把來源連結當作音樂改編授權。Personal Space 只能顯示人工核准的公開狀態，其他 app 不可讀取 StudyMix 私人音訊或使用資料。

## English runner contract

Deliver one private-by-default, evidence-backed vertical slice per cycle. Keep real generation and external transfer fail-closed, use synthetic tests, enforce owner/workspace and bounded-input contracts, validate public placeholders semantically, commit only completed scope, then immediately choose the next safe cycle.
