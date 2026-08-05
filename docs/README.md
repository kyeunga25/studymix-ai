# StudyMix AI 文件索引 / Documentation Index

本目錄分開「公開使用者／自部署文件」與「維護者工程規格」。所有文件均不得包含真實使用者資料、正式資源識別資料、secret、私人 hostname、資料庫 dump 或帳戶專屬拓撲。

## 建議閱讀次序

### 使用、評估及自部署

1. [`../README.md`](../README.md) — 專案簡介、Cloudflare Worker 部署方式、快速開始與參考資料
2. [`TECH_STACK.md`](TECH_STACK.md) — 公開安全的技術棧與 AI 邊界
3. [`SELF_HOSTING.md`](SELF_HOSTING.md) — 由本機 mock 到 Cloudflare 安全部署的完整步驟
4. [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md) — AI、Git、GitHub 與公開內容檢查規範
5. [`TODO.md`](TODO.md) — 目前已驗證能力及仍停用項目

### 產品、營運及維護

- [`PRD.md`](PRD.md) — 產品需求、範圍及 acceptance criteria
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 工程設計規格；不可加入 live identifiers、正式資料或 account-specific topology
- [`DECISIONS.md`](DECISIONS.md) — 主要工程決策紀錄
- [`CLOUDFLARE_ACCESS.md`](CLOUDFLARE_ACCESS.md) — 私人 beta 的 Cloudflare Access／deployment gate
- [`LEGAL_AND_DATA_USE.md`](LEGAL_AND_DATA_USE.md) — 法律及資料使用的工程控制（非法律意見）
- [`design/README.md`](design/README.md) — 設計方向與合成測試畫面

## 文件狀態用語

請一致使用：

- **Local / 本機**：只在 loopback 或本機 Wrangler 資源驗證。
- **Mock / Synthetic**：不使用真實 AI 或付費 API；不能代表模型品質。
- **Preview / Staging**：非 production traffic 的隔離驗證。
- **Released / Production**：必須有 reviewed commit、CI、active deployment 及獨立 live check 證據。
- **Planned / Disabled**：程式可能存在，但 runtime 未啟用或 acceptance gate 未完成。

不要用 build、CI、preview、歷史紀錄或本機 screenshot 代替目前 production 證明。

## 編輯規則

- 繁體中文為主，英文為輔。
- 先核對程式、測試及當前官方文件，再更新技術或部署說明。
- 自部署範例只使用 `<PLACEHOLDER>`、`example.test` 及 synthetic data。
- 不把 internal data map、production schema、resource inventory、secret name/value pair 或 private route evidence 複製到公開說明。
- 只有 demonstrably verified 的狀態才可寫入 [`TODO.md`](TODO.md)。
- 發佈前完成 [`PUBLICATION_SAFETY.md`](PUBLICATION_SAFETY.md) 的檢查清單。
