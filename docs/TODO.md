# 實作狀態 / Implementation Status

更新日期：2026-08-21

本文件只記錄目前程式庫可驗證的能力與公開安全限制；未落實的工作不在此列出。

This document records only verifiable repository capabilities and public safety constraints; unimplemented work is omitted.

## 已驗證能力 / Verified capabilities

- [x] pnpm monorepo、嚴格 TypeScript、ESLint、Prettier、Vitest、Playwright 與 GitHub Actions；CI 會執行 unit、Worker、build 及 Chromium E2E。
- [x] React/Vite 雙語介面，支援鍵盤操作、狀態公告、錯誤提示及兩個候選結果比較。
- [x] 六個版本化風格由單一公開雙語合約驅動：柔和鋼琴、八音盒、Lo-fi 學習、木結他輕奏、慢拍舒緩電音及喫茶爵士輕拍；首頁、私人工作區、mock job 與離線 fal adapter contract tests 保持相同 preset ID，供應商提示維持 server-only。
- [x] 公開雙語產品主頁、獨立 `/login` 封閉測試登入介面、停用的日後註冊位置，以及獨立 `/app` 受邀測試工作區。
- [x] 私人登入狀態流程：成功驗證返回工作區；session 過期、拒絕或無法安全驗證時回到雙語 `/login` 告知；所有私人 AJAX 使用明確 `401` contract，返回路徑限制在同源 `/app`。
- [x] 正式 owner Access 流程已在 active deployment 完成端到端驗證：Access 驗證值及邀請雜湊 pepper 使用加密 Worker bindings，受邀身份可原子領取一次性邀請並載入 `/app` 與 deep route，登出會離開工作區；失敗路徑維持人類可讀雙語登入介面而非裸露 JSON。
- [x] 正式首頁、登入、四個法律頁及私人工作區已完成先前版本的瀏覽器排版核對；目前六種風格的繁中／英文、選擇摘要及 390×844 小螢幕斷點由本機 Chromium E2E 持續覆蓋。正式部署仍須在新版本合併後獨立核對。
- [x] 僅限本機開發的 mock HTTP job API；正式 bundle 不包含 mock 路由或測試控制標記。
- [x] Zod API contracts、加密安全 ID、job state machine 及 provider abstraction。
- [x] 瀏覽器選檔只提示 contract 明確支援的格式，不使用過度寬鬆的 `audio/*`；共用 Zod 上載 contract 會即時攔截多檔、不支援、空白、超過 500 MB 或檔名無效的選擇，清除無效狀態並提供雙語可及提示。單元及 Chromium `DataTransfer` 測試確認不會提前發出上載請求，server 仍會獨立重做權限及資料驗證。
- [x] 共用有界音訊結構檢查會在 metadata-valid 選檔後立即以 `File.slice()` 執行；成功後才懶載入 1.38 kB（gzip 0.66 kB）的瀏覽器播放元資料探測器，以短暫本機 object URL 在 8 秒內要求有限正數時長。換檔／離頁會中止舊工作，所有成功、錯誤、逾時及取消路徑均移除 listener／timer／media source 並 revoke URL；成功後以雙語顯示辨識格式與約略時長，瀏覽器 media error 或無效時長則在零法律接受、upload／job mutation、metadata／bytes 外送下 fail closed。提交上載前會再獨立核對結構，確認時則以固定 `HEAD` ETag 的 R2 range reads，分別辨識目前供應商接受的 MP3 frame、RIFF/WAVE chunks、M4A audio track、AAC ADTS frames 及 Ogg audio identification packet，全程不載入完整大檔。改副檔名的非音訊、瀏覽器不可讀的合成有效容器、stale selection、390×844 排版、Worker ownership／並發／R2 failure 均有 unit 或 Chromium 反例且不使用真實音訊或外部 AI；繞過 browser 的 MIME／container mismatch 仍由 server fail closed。這些訊號不聲稱檔案一定是歌曲、可完整解碼、品質合格或已具權利。
- [x] 通過兩層本機預檢的選檔會顯示原生裝置內音訊預聽；獨立 `blob:` URL 只在同一選檔仍顯示時存在，換檔、清除或離頁會先暫停並移除 media source，再強制 revoke。瀏覽器無法建立可選預聽時只顯示雙語降級狀態，不會使已驗證檔案失效、繞過預檢或觸發法律接受、upload／job mutation。合成 Chromium 覆蓋來源切換、所有 URL 回收、零私人 POST、可選失敗及 390×844 無水平溢出；實際本機瀏覽器亦已核對雙語桌面與手機控制，未使用真實音訊或外部服務。
- [x] `POST /api/uploads` 只接收最多 4 KiB 的 `application/json`，再以 strict Zod contract 及 runtime 大小上限驗證；Worker matrix 覆蓋錯誤 media type、malformed／超大 JSON、額外欄位、控制字元檔名、零大小、不支援 MIME 及越界大小，全部在簽名及建立 D1 upload row 前 fail closed，錯誤不回顯輸入內容。
- [x] Upload 建立以 `owner_id + idempotency_key` 唯一索引及完整 metadata SHA-256 fingerprint 綁定：相同 owner 的順序／同時重放只取得同一個仍有效的 pending row 與重新簽發指令，同 key 錯 metadata 得 409、另一 owner 可獨立使用，confirmed／expired／deleted row 不會復活；active-upload quota 仍在同一原子 INSERT predicate 下限制同時不同 key。Browser 僅在 create 網絡結果不確定時以完全相同 key 自動重試一次，並在任何 R2 PUT 前核對回應 key；錯配不會上載或誤刪未綁定資源。新增 0006 migration 目前只在本機及測試套用，未執行任何遠端 migration 或啟用正式 R2 上載。
- [x] 共用 bounded JSON reader 要求 positive safe-integer 上限及 `application/json`（可帶一般參數），先拒絕 invalid／超限 `Content-Length`，再獨立計算實際 stream chunks；空 body、malformed JSON、無效 UTF-8 與實際超限均分類明確，底層 stream cancellation 失敗亦不會掩蓋 body-too-large 結果。
- [x] 瀏覽器內所有公開法律 manifest 及私人 API JSON 回應共用 64 KiB 邊界，不直接使用無界 `Response.json()`；MIME、宣告長度、實際 stream、fatal UTF-8 與 JSON 均 fail closed，oversize session 會保持 workspace 鎖定，oversize job 會保留安全可重試錯誤，AbortError 不會被改寫。
- [x] 公開法律 manifest 只有在首個 transport／TimeoutError 後以相同 same-origin GET 重讀一次；第二次 transport failure、caller Abort、HTTP／API error 及 malformed／oversized response 均停止。法律頁以雙語 `aria-live` 分開「正在核對」與「暫時不可用」，不會在初次載入或網絡錯誤時誤稱聯絡方法未設定；server 未設定的 503 仍 fail closed。Unit matrix 與 Chromium 覆蓋 transient recovery、公開聯絡連結及 unavailable 狀態，且 route 不解析 owner。
- [x] 小型 web JSON 請求會把 caller Abort 與固定 15 秒 deadline 合併，header 或 response stream 停滯都會回到既有 unavailable／retryable 狀態；mutation／job 的 TimeoutError 轉成可重試 network error，credit aggregate 及公開法律 manifest 只在首個 transport／timeout failure 後重讀一次，session 維持原有 unavailable 行為，navigation AbortError 保持原樣，大型 direct R2 audio PUT 不套用不合理的短 timeout。
- [x] 私人音訊離開瀏覽器前會驗證短效 R2 `PUT` 指令的一致性：標準 HTTPS S3 endpoint、完整單一簽名參數、server-controlled object key／upload ID、精確且不重複的 `content-length;content-type;host;if-none-match` signed-header list、足夠大小上限，以及 credential date、嚴格 UTC 簽名時刻、TTL、宣告到期時間仍有效且互相吻合；Worker 以宣告 bytes 簽署 `Content-Length`，瀏覽器不可自行改寫該 forbidden header。任何不一致均不向該目的地傳輸，並嘗試 owner-scoped metadata cleanup；單元、Worker 及合成 Chromium 反例已覆蓋。正式 R2 仍須以實機瀏覽器 staging 流程驗證後才可啟用。
- [x] 大型 direct R2 PUT 有雙語可及取消控制及 unmount abort；若已取得 upload ID，取消會以獨立未 aborted、15 秒受限的 private API signal 嘗試 owner-scoped cleanup，不會呼叫 confirm，並保留檔案／權利／法律選項供重試；unit 及 stalled-transfer Chromium flow 已驗證，server expiry 仍是 cleanup fallback。
- [x] Direct R2 confirm 回應必須重新綁定原 upload ID、normalized filename／MIME／bytes、`confirmed` 狀態及有效時間順序，才可讓 UI 建立 job；不一致會清理原 upload、保持可重試狀態且零 job POST。Cleanup ID 會在組合 URL 前驗證，delete response 亦必須回傳同一 ID。Unit matrix 與 Chromium 錯-ID confirm 流程已覆蓋，server owner 驗證維持獨立。
- [x] Owner-scoped upload confirmation 以 guarded `pending → confirmed` transition 收斂：兩個同時通過 R2 `HEAD` 的相同請求都回傳同一 confirmed row 及 winner timestamps，不產生第二個狀態或 500；loser 只有在 upload ID、owner、實際 bytes、confirmed timestamp 及仍有效 retention lifetime 相符時才可讀回。Barrier Worker test 同時鎖定錯 bytes 與另一 owner 仍被拒絕。
- [x] Sequential confirmed-upload replay 會先核對 stored expiry：仍有效時直接回傳相同 metadata 且不重讀 R2，過期後改回 non-retryable `UPLOAD_EXPIRED`，不再把 stale success 交給 browser；confirm route 不即場刪除可能已連接 job 的 confirmed source，繼續由 guarded job／retention lifecycle 處理。Worker test 鎖定兩條路徑均為零額外 R2 `HEAD`。
- [x] Browser confirmation 只有在第一個結果為 outcome-unknown `NETWORK_ERROR` 時，以同一個 upload ID 及 `POST` 自動重試一次，不重送大型 direct R2 `PUT`；第二次 network failure、AbortError、API error、invalid／錯配 response 都直接進入既有安全錯誤與 owner-scoped cleanup 路徑。有效 server replay 會回傳同一 confirmed metadata，不建立第二個來源。
- [x] Owner-scoped upload cleanup 使用兩階段 compare-and-set：先把未連接 job 的 row 變成不可使用，再刪除 private R2 object；metadata tombstone 會保留至最長簽署 PUT 能力窗結束，排程其後再次刪除可能遲到的 object 才記錄 `deleted`。R2 delete 中斷會保留排程及同 owner replay 的恢復路徑；Worker tests 覆蓋一次刪除失敗、遲到 PUT、排程接手、重播、同時刪除與另一 owner 404，沒有啟用正式 retention flag。
- [x] Browser upload cleanup 只有在第一個 `DELETE` 得到 outcome-unknown `NETWORK_ERROR` 時，以同一已驗證 upload ID 自動重試一次；第二次 network failure、AbortError、API error、invalid／錯配 response 與 invalid ID 都不會再送出請求。這只使用既有 owner-scoped server-idempotent replay，不放寬 attached-job conflict 或私人 R2 兩階段刪除規則。
- [x] 私人輸出播放／下載指令共用 R2 signing validator，remote URL 的 endpoint、短效參數、簽名時鐘、精確單一 `host` signed header 及 object path 必須綁定所要求的 output ID；同源 local-content path 只在已驗證 loopback harness capability 且仍未到期時接受，任一候選不一致會拒絕整對來源而不插入部分音訊，unit 負向測試及合成 Chromium 兩候選流程已覆蓋。
- [x] Private output instruction 只有第一個 owner-scoped `POST` 得到 outcome-unknown `NETWORK_ERROR` 時，才以同一個已驗證 output ID 自動重試一次；第二次 network failure、AbortError、API error、invalid／錯配 response、不可信簽名與 invalid ID 均不重送，後續 local audio content `GET` 亦不自動重試。路徑只重新核對 ready／expiry／R2 metadata 並簽發短效指令，不改 job、credit、provider 或 object 狀態。Completed restore 的 Chromium flow 證明自動重試耗盡後不會顯示部分候選，會保留 job reference，並可由明確操作重新取得兩個 output；全程不重讀或重建 job。
- [x] Restored completed job 的任一播放指令若回 `OUTPUT_EXPIRED`，會丟棄整對候選並顯示不回顯 server detail／request ID 的安全雙語到期說明，而非泛化為生成失敗；non-retryable 畫面保留 job reference 並只提供 owner-scoped 刪除。390×844 Chromium 證明一次 job GET、每個 output 一次 POST、零 job POST、零部分 audio，刪除後才清除 reference。
- [x] Restored completed job 的播放指令若回 retryable `OUTPUT_NOT_READY`，會顯示安全雙語尚未準備說明並維持零部分 audio；只有明確「再試一次」才各取得一個新的 output instruction，完整 pair 驗證後才恢復結果。390×844 Chromium 證明全程一次 job GET、零 job POST、reference 保留，且不回顯 server detail／request ID。
- [x] Loopback local-content 不再直接交給無法送 browser-intent header 的 `<audio>`／下載連結；web 以 authenticated fetch 要求成功 `audio/wav`、正整數且不超過共用 64 KiB policy 的 `Content-Length`、完全相符的實際 stream bytes 及 RIFF／WAVE markers，才建立 `blob:` URL。刷新、重置、unmount 或第二候選失敗會回收舊有／部分 blob，正式 R2 HTTPS 來源仍直接播放且不在瀏覽器 buffer；unit matrix 與 Chromium 成功／部分失敗流程已覆蓋。
- [x] Owner-scoped 輸出下載 route 只為 `ready`、未過期且 R2 binding `HEAD` 的 byte size／audio MIME 與 D1 完全一致的 object 簽發短效 URL；簽名 TTL 會再夾到 D1 resource 剩餘壽命，已到期不簽發。Worker 反例已確認 pending、expired、短剩餘壽命、size mismatch 及 MIME mismatch 全部 fail closed，錯誤回應不含下載指令。
- [x] Completed 私人結果可用雙語控制捨棄並重新取得兩個短效播放／下載指令，不重建 job、不扣第二次額度亦不呼叫 provider；browser-only mock 不顯示此控制，Chromium 會核對兩個 output URL 各刷新一次而 job POST 仍只有一次。
- [x] D1 additive migrations 與 owner-scoped repositories。
- [x] `0007` additive migration 為 bounded 未連接上載保留期查詢加入 status-scoped cutoff 及 upload-to-job lookup indexes；真實 migration 集合已在 Miniflare 套用，Worker `EXPLAIN QUERY PLAN` 測試只鎖定三個 index search 及零 uploads／jobs full scan，不輸出 rows 或 production plan。遠端 D1 未遷移，正式 `RETENTION_CLEANUP_ENABLED` 仍為 `false`。
- [x] `0008` additive migration 以只包含 completed jobs 的 covering index 支援 completed-source cutoff range；真實 migration 集合與 Worker query-plan boolean test 證明不再只按 status 掃描全部已完成工作。遠端 D1 未遷移，既有 eligibility／owner 邏輯與正式 retention flag 均未改動。
- [x] `0009` additive migration 為 terminal purge 的 completed-expiry 與 failed／cancelled-completion branches 加入 partial cutoff indexes；Worker query-plan boolean test 同時鎖定兩個 range search、既有 expired-status search 及零 retention table full scan。遠端 D1、清理資格／排序／batch 與正式 flag 均未改動。
- [x] Credit summary 只 aggregate 目前 owner 的 ledger，不再 materialize all-owner balance view；`0010` additive migration 另以 owner 及 `julianday(created_at)` expression covering index 支援最新活動查詢。真實 migrations 與 Worker query-plan boolean test 證明沒有 ledger full scan 或 temporary order B-tree，timezone-offset 排序仍正確。遠端 D1 未遷移，既有 ledger、aggregate、額度授權及功能旗標均未改動。
- [x] `0011` additive partial index 只保留 active job quota 使用的五個 non-terminal 狀態；真實 migrations 與 Worker query-plan boolean test 證明 owner-scoped count 使用該索引且不 full-scan jobs，歷史 terminal rows 不再擴大這項建立前檢查。遠端 D1 未遷移，既有原子 quota、daily limit、idempotent replay、狀態機及旗標均未改動。
- [x] Active upload quota 以等價的 owner-scoped pending-expiry count 加 confirmed count 取代歷史 rows 較多的 OR scan；`0012` additive partial indexes 與 Worker query-plan boolean test 證明兩個分支均為 covering-index search 且零 uploads full scan。既有四個並發 create 只容許三個成功的 Worker 測試保持通過；遠端 D1 未遷移，quota、idempotency、expiry、retention 及 R2 規則均未改動。
- [x] `0013` additive migration 為 provider request 加入 nullable webhook signal claim timestamp；fal callback 先以原子 `UPDATE ... RETURNING` claim 一次性 wake-up，事件 type 綁定內部 provider request ID。相同有效 callback 在 request 仍為 submitted 時重播只會獲得 `202`，不會消耗另一候選的 polling 進度；polling 保持最終狀態來源，完整 callback payload 不保存。
- [x] D1 migration ledger 與實際 table／index／view 必須同時核對；正式 onboarding 前已以不輸出 row、identity 或資源識別資料的 aggregate schema 檢查確認一致。
- [x] 高頻私人 API 不再每次改寫 owner activity：workspace lookup 會沿用已讀取的 `last_seen_at`，只在相隔至少五分鐘後以 owner ID、active 狀態及舊 timestamp compare-and-set 刷新；D1 repository tests 覆蓋 4:59.999／5:00 邊界及另一 synthetic owner 不受影響，首次邀請消耗與所有 active 權限檢查維持不變。
- [x] Cloudflare Access JWT 的簽章、issuer、audience、時效及 identity claims 驗證；遠端 JWKS 維持 JOSE timeout／cache／rotation／key selection，同時以 32 KiB JSON 邊界限制實際回應；`test`／`development`／`local` 的 synthetic owner shortcut 只接受 loopback request，遠端誤設 `APP_ENV=test` 亦會在 D1 write 前以 `503` fail closed。Server-derived owner ID、active／disabled Beta 權限檢查及跨 owner 拒絕測試保持通過。
- [x] 所有私人 user API methods 強制共用的精確 `X-Requested-With: XMLHttpRequest` browser-intent contract；因 workspace boundary 會在首次讀取時消耗邀請並持續記錄 owner activity，讀取亦不豁免。缺失、錯值或合併重複值會在 workspace lookup／D1 write 前以 non-retryable `403` fail closed。Hono route-table matrix 明確盤點 19 個私人 method／path，逐一驗證 production 無身份為 `401`、無 browser intent 為 `403`，並鎖定精確 fal callback 是唯一只走供應商簽章的公開 API handler。
- [x] 通過身份、workspace 與 browser-intent 後，未知 `/api` parent／deep path、unsupported method 及 callback lookalike 一律返回不可快取的最小 JSON `404`；GET 不會落入 SPA Static Assets fallback，錯誤不回顯 path、不加入私人 R2 CSP origin，精確 fal callback 行為維持不變。
- [x] 版本化中英文法律文件、D1 接受紀錄與 fail-closed 正式環境設定。
- [x] Legal acceptance success 只有在 `current`、三份 acceptance-required document ID／version 及每份 server `acceptedAt` 全部相符時才解鎖下一步；缺漏／舊版但 schema-valid 的 success 維持雙語 blocked／retry 狀態及零 job request。5 項純函數反例與 Chromium 流程已覆蓋，Worker owner／workspace／bounded body／D1 驗證保持獨立。
- [x] Legal acceptance browser mutation 會固定序列化現行三文件 request；只有第一個結果為 outcome-unknown `NETWORK_ERROR` 時才以完全相同 body 自動重試一次。第二次 network failure、AbortError、API／version error 及 invalid／未完整 success 均不重送；6 項 client tests 與 D1 repository replay 證明同 owner 只保留三筆首次 server timestamps，另一 owner 維持隔離。
- [x] Worker Static Assets 與 API 使用同一 Worker；`/app`、`/app/*`、`/api` 及使用者 `/api/*` 先經 Access JWT 與 active D1 owner／workspace／membership 驗證。只有成功、fingerprinted 且 MIME 相符的公開 CSS／JS／PNG／WebP 使用 immutable browser cache；HTML、私人 app、API、錯誤及 SPA fallback 保持 `private, no-store`。
- [x] Landing、登入與 workspace 共用背景保持原有 1672×941 構圖，來源資產由 1.81 MB PNG 改為 96.65 kB WebP；production build、桌面及 390×844 瀏覽器畫面均已驗證。
- [x] 匿名首頁只同步載入公開 overview；登入、公開法律及私人應用使用具雙語載入狀態及安全重試的獨立 lazy chunks。production 入口 JS 由 368.53 kB 降至 282.01 kB（gzip 114.30 kB 降至 86.63 kB），精確 route tests 會把未知及 `/app` lookalike 路徑留在公開首頁，Playwright 亦覆蓋 deferred chunk failure。
- [x] CSS 跟隨 route lazy loading：production 匿名入口 CSS 由 46.74 kB 降至 15.53 kB（gzip 10.04 kB 降至 4.03 kB），登入 10.28 kB 及私人／法律 26.96 kB 樣式按需載入；四類頁面及 390×844 瀏覽器均無水平溢出或 console error。
- [x] 公開法律正文、私人 workspace runtime、工作區準備狀態、最近工作紀錄與工作結果體驗已分開：原 81.70 kB deferred chunk 改為 32.68 kB public-legal、52.29 kB private-app（gzip 16.58 kB）、session 成功後才載入的 2.88 kB access-readiness（gzip 1.25 kB）與 5.35 kB recent-job-history（gzip 2.25 kB），以及只有 job／job error 出現時才載入的 15.46 kB job-experience（gzip 5.58 kB）；另有 8.96 kB（gzip 2.96 kB）共用 job API、metadata-valid 選檔後依序載入的 6.29 kB（gzip 2.37 kB）音訊結構檢查器及 1.38 kB（gzip 0.66 kB）播放元資料探測器，以及按需載入的 1.54 kB legal-acceptance、1.65 kB local-AI helpers、0.62 kB private-API helper 及 2.97 kB 共用雙語 site chrome。Chromium 以延遲 chunk 證明初始 workspace 不會要求工作體驗；有效選檔、假副檔名及瀏覽器不可讀容器反例則證明兩層檢查只在本機預檢需要時載入，並保留可存取雙語狀態及原有結果流程。
- [x] Landing、法律頁及登入 action 會在 pointer hover／keyboard focus 時預載相應靜態 route chunk；Playwright 證明預載不導航、不 render 私人 workspace，亦不呼叫 `/api/session` 或讀取工作區資料。
- [x] Production Vite build 以 raw／gzip byte budgets fail closed：匿名入口、登入、公開法律、私人 app、瀏覽器音訊元資料、私人工作區準備狀態、私人最近工作紀錄、私人工作體驗、入口／總 CSS、總 JS 及背景 WebP 必須齊全且不超標；合成 unit tests 覆蓋正常、缺失、重複與超標輸出，錯誤不公開本機 module path。
- [x] Public build surface 只接受一個 `index.html`、fingerprinted JS／CSS 及唯一已審查背景 WebP；source map、JSON、音訊、額外圖片、unhashed 或其他意外輸出均會令 build 失敗，診斷只顯示序號與副檔名。
- [x] Production `index.html` contract 要求有效 UTF-8、唯一空內容 external module script、唯一 stylesheet、唯一 app root 及同源 fingerprinted JS／CSS；inline script／style／event handler、外部或 unhashed URL 均 fail closed，診斷不回顯 HTML 或 URL。
- [x] Production CSS contract 只接受有效 UTF-8 與已審查同源 fingerprinted 背景 WebP；`@import`、source map、data／external／unhashed 或 malformed URL 均 fail closed，Worker `img-src` 同時收緊至只接受 `'self'`。
- [x] 私密 exact-login onboarding 只接收環境輸入，以 keyed hash 儲存邀請，不保存登入地址；首次登入原子建立 active owner workspace、manual AI approval、bounded job cost 及 idempotent bounded credit grant。真實 0001–0009 migrations 與生成 SQL 的 in-memory SQLite 測試證明 pending／revoked 邀請可在使用前更新條款，而 consumed 邀請的 initial grant 保持不可變、重放仍只有一筆相同 ledger grant；bounded job cost 可更新，但不會形成 top-up。
- [x] Job 建立的 owner credit predicate 與 reserve event 位於同一個順序 D1 `batch()` transaction；並發測試證明只足夠一份 job cost 時，兩個不同 request 只建立一個 job／rights／reserve，第二個得到 insufficient credits、aggregate 不會變負，而另一 owner 的相同 key 及獨立額度不受阻擋。
- [x] Provider-neutral credit grant repository 會在 D1 batch 前後把 owner-scoped reference 綁定至 `grant` event type 及 quantity；相同 grant 可安全重放，順序或同時錯 quantity 會 conflict 且只保留一筆 ledger event，另一 owner 可獨立使用同一 reference。此能力沒有 browser grant／top-up route。
- [x] `/api/session` 只回傳 account／workspace／membership 狀態、owner role、權限、審批狀態及 capabilities，不回傳 owner／workspace identifier；disabled membership 及跨 workspace assertion 均 fail closed。
- [x] 私人 workspace 在 session 驗證後延遲載入雙語唯讀準備狀態 dashboard，以既有 approval／capability 欄位顯示私人上載、合成流程、真實 AI、測試額度、保留期清理及付款六項狀態；available、loopback local、待審批、已核准但旗標關閉及不可用會明確區分，不顯示權限、識別碼、資源映射、API key 或付款資料，亦不提供 browser mutation。5 項純函數矩陣及 390×844 Chromium 證明雙語狀態、零私人 API mutation 及無水平溢出。
- [x] 私人 session verification 只有首個 bounded `GET /api/session` 出現 outcome-unknown transport／TimeoutError 時才以相同 path、credentials 及 browser-intent header 重讀一次；caller Abort、401／403／其他 HTTP、malformed／oversized response 與 schema mismatch 均不重送。Unit matrix 與 Chromium 證明一次斷線後兩次 session GET 可留在 `/app`，並保持零 job POST；Worker 的邀請消耗／access-record replay 仍獨立原子及冪等。
- [x] `/health`、法律頁及公開法律 manifest 可匿名讀取，但不建立 owner 紀錄。
- [x] Mock provider 模式不需要付費憑證，CI 不會呼叫外部生成服務。
- [x] fal ACE-Step audio-to-audio adapter 與 provider factory：非同步 queue mapping、Zod 外部回應驗證、provider JSON 不保留、有限輸出期限、預期輸出 host 與標準 HTTPS port、最小 metadata 及全離線 contract tests。
- [x] Provider output 安全串流邊界：HTTPS host allowlist 與標準 port、禁止 redirect、逾時、identity encoding、可信 content length、音訊 MIME 與 byte limit、Cloudflare `FixedLengthStream`、私人 R2 conditional write、冪等重試及 Miniflare 測試。
- [x] Feature-gated fal Workflow 接線：嚴格 runtime 設定、已確認且未過期的私人來源檢查、短效 GET 簽名、外部 submission 不自動重送、有限 queue polling、安全錯誤 mapping、串流 R2 ingestion、最小 D1 metadata 及無付費請求測試。
- [x] `POST /api/jobs` 只接收最多 4 KiB 的 `application/json`，再以 strict Zod contract 驗證；Worker matrix 覆蓋錯誤 media type、malformed／超大 JSON、額外欄位、不支援候選數及非現行 rights declaration version，全部在建立 job／output／provider request／rights／usage rows 前 fail closed，錯誤不回顯輸入內容。
- [x] 私人 web app 共用流程：按 capability 選擇 mock 或 real、直接 R2 上載、相同狀態持續輪詢及有上限 backoff、兩個私人播放／下載連結、安全雙語錯誤及 terminal job 刪除；Playwright 以攔截 API 驗證 real 模式，不呼叫供應商。
- [x] 私人工作錯誤 presentation 以 exhaustive TypeScript switch 覆蓋 19 個 API code 及 2 個 browser-only code；每項只顯示經審閱的繁中／英文指引，不回顯 server message 或 request ID，未分類的新合約 code 會令 typecheck fail closed。`401`／`403` 仍先觸發全域登入／拒絕處理；21-code unit matrix 鎖定完整 code union，既有 Chromium 流程繼續驗證額度及 output failure 的實際互動。
- [x] 已確認私人上載若在 job 建立時遇到安全 API error，錯誤頁會以雙語控制返回原上載，而不會把 source reference 從 UI 丟棄；權利／法律確認、preset 與原 job idempotency key 保持不變，使用者可安全重試或經既有 owner-scoped DELETE 明確清理。Synthetic Chromium 流程證明返回不會自動 cleanup、兩次明確建立使用同一 key，且只在刪除控制後送出一次 cleanup。
- [x] Server-backed 私人工作只在同一分頁的 `sessionStorage` 保留一個經 schema 驗證的 opaque job ID；頁面重載後先完成 session 驗證，再以 owner-scoped、bounded 且 response-bound 的既有 GET 找回工作，期間鎖住建立表單以免重複工作。`sessionStorage` 不保存 filename、owner、upload／output ID 或 URL；無效／stale reference、network retry、browser-only mock、失敗／成功刪除、重新開始與登出清理均有 unit 或 Chromium 證據。Owner-scoped restore 確認 job 已不存在時只在 browser 實際移除 reference 後顯示可隨語言切換的非警報狀態；若移除被拒，雙語警告會準確保留，純本機重試成功後才改為已清除，全程一次 owner GET、零 job POST。Recovery write 只有讀回完全相同的 validated active job ID 才算成功；拒絕、靜默 no-op 或 mismatch 都會 best-effort 清除舊 key，當前工作繼續並顯示雙語 `alert`，明確要求完成或刪除前保持分頁開啟並避免 reload；本機重試不呼叫 API，exact read-back 後才改為雙語 status。已知 saved job 的 start-over 若未能讀回清除結果，會保留目前 job／error 畫面與雙語警告；本機重試證明清除後才重置 workspace，維持原兩次 restore GET、零 job POST。Unit 反例與 390×844 合成 Chromium 證明舊 ID 不殘留、job 只建立一次、無水平溢出及第二次本機保存新 ID。Completed restore flow 另核對通用來源名稱、兩個 owner-bound output 指令、手動刷新、server DELETE、reference 清除及全程零 job POST。
- [x] 私人最近工作紀錄以 owner-scoped `GET /api/jobs` 固定回傳最新 10 個最小摘要，只包含 opaque job ID、preset reference、status 及 lifecycle timestamps；不回傳 filename、upload／output／provider、URL、owner／workspace 或 error details，亦不改 credits、job、provider 或 output 狀態。Web 在 session 成功後才延遲載入雙語 dashboard，不顯示 ID，只有使用者選擇一筆後才用既有 bounded owner-scoped `GET /api/jobs/:jobId` 讀取完整工作；已選上載會阻止切換。列表只在首個 transport／TimeoutError 後重讀一次，caller Abort、API error、schema mismatch、超過 10 筆或 over-disclosed response 均 fail closed。另一 synthetic owner、generation flags disabled、unit 及 390×844 Chromium 成功／不可用流程已驗證 StrictMode 下單次列表讀取、只開啟所選工作、零 job mutation 及無水平溢出。
- [x] Web create success 必須重新綁定已驗證的 upload ID、preset ID／version 及候選數；poll／cancel／delete 及 output-download 成功回應亦必須識別所要求的 job／output ID，錯配不會開始追蹤、轉換狀態或清空目前結果。所有 path 在組合前重做 Zod opaque ID 驗證，錯 prefix、長度、path／query suffix 會本機 non-retryable fail closed 且零 fetch；66 項 job client tests 與兩個 Chromium mismatch 反例同時保留 caller Abort、timeout、bounded response、idempotent create 及獨立 Worker owner 驗證。
- [x] 私人 browser job create 已帶 deterministic owner-scoped key；只有 normalized `NETWORK_ERROR` 會以完全相同 validated body 自動重試一次，第二次 network failure 即停止。Optional unkeyed API request、AbortError、429／其他 API error、conflict 與 invalid／錯配 response 都不會自動重送，避免無 key duplicate 或繞過 server rate／credit 判斷。
- [x] Loopback-only job cancellation 在首個 outcome-unknown `NETWORK_ERROR` 後，只以同一個已驗證 job ID 及 `POST` method 自動重試一次；server 對已取消 job、固定 owner／job credit release reference 及 attempt 狀態更新均可安全重放，確保成功回應遺失不會重複 release。第二次 network failure、AbortError、409／其他 API error、invalid／錯配 response 及 invalid ID 都不會再送出請求，local capability、owner scope 與 terminal state 仍由 Worker 獨立強制。
- [x] Owner-scoped terminal job 刪除會在第一個請求出現 outcome-unknown `NETWORK_ERROR` 時，以同一個已驗證 job ID 及 `DELETE` method 自動重試一次，利用既有 server-idempotent deletion 收斂結果；第二次 network failure、AbortError、API error、invalid／錯配 response 及 invalid ID 都不會再送出請求，owner／terminal-state／私人 R2 規則維持在 server 獨立強制。
- [x] Pending 私人 job 只在文件可見時按既有上限 backoff 輪詢；每次 owner-scoped GET 只有在首個 outcome-unknown `NETWORK_ERROR` 後以同一 validated job ID 自動重試一次，第二次 network failure、AbortError、API error、invalid／錯配 response 均停止並交回安全 retry UI。轉 hidden 會清除未發 timer 並 abort 停滯中的讀取，期間不增加 attempt 或再讀取，回 visible 後沿用同一 job 自動完成。Chromium 實際驗證 client abort、hidden 零新增 poll 及恢復完成，不重建 job／provider request／credit reservation。
- [x] Job lifecycle 控制使用 typed cancel／delete／retry action state：pending read error 不再顯示只適用於 terminal job 的刪除控制或可能與 active job 競態的 start-over；只有 loopback local capability 可同時提供取消。執行中的真實 action 會顯示相符雙語文字並停用 sibling controls；成功取消改用非 alert 的雙語 terminal status，說明 reserved beta credits 已釋放、沒有 Retry，只保留有效刪除。Chromium 證明兩次 network read failure 後只能 retry 原 job，cancel 只送一次，刪除後回到重新要求權利／法律確認的 local 起點。
- [x] 真實生成 abuse quota 邊界：D1 rolling owner daily limit、Cloudflare Rate Limiting binding、owner key、雜湊 IP key、fail-closed capability 及無 metadata 拒絕測試。
- [x] 私人 beta 額度邊界：active entitlement、append-only D1 ledger、job creation＋reserve 同一 transaction、Workflow terminal state＋settle／release 同一 transaction、idempotent replay、owner-only aggregate API 及餘額不足零 job／零 reserve 測試。Aggregate `updatedAt` 取同 owner entitlement 或 ledger 的實際較新時刻，支援 ISO timezone offset 比較；另一 owner 的較新 event 不會影響結果。
- [x] Credit settle／release 不再提供可脫離 job state 的 standalone repository mutation，只能經 guarded completion／failure／cancellation 與終態一同提交；並發 completion-vs-failure 測試證明只保留一個相符的 settle 或 release、loser 明確失敗，另一 owner 無法 finalise 該 job。
- [x] Provider-neutral payment boundary：default-disabled adapter、strict synthetic normalized events、完整 payment／subscription lifecycle state contract，且沒有 live provider dependency、checkout、商戶 mapping 或付款憑證。
- [x] 私人 workspace 可在 server capability 開啟時顯示 owner aggregate beta 額度；雙語 badge 以 `aria-busy` 區分初次 loading／背景 refreshing、成功數值及 unavailable，不會在正常讀取期間閃出錯誤。Owner-scoped GET 只有在首個 transport／TimeoutError 後以相同 path 與 caller signal 重讀一次；第二次 transport failure、caller Abort、HTTP／API error 及 malformed／oversized response 均不再送。Chromium 證明 transient failure 兩次 request 後恢復數值，而 503 只送一次便清除舊數值並 fail closed；任何顯示狀態都無法改變 server-side job authorization。
- [x] Job create 若因最新 server aggregate 判定 `INSUFFICIENT_CREDITS`，會顯示不回顯 server detail／request ID 的安全雙語額度說明，而非泛化為生成失敗；non-retryable 畫面不自動重送 job，並保留已確認私人上載供返回。390×844 Chromium 證明一次 job POST、零 cleanup、繁中／英文及原權利／法律選擇不丟失。
- [x] fal callback 邊界：精確公開路徑、Ed25519/JWKS 原始 body 驗證、預期 fal user、五分鐘時間窗、已知 request ID、D1 一次性 signal claim、內部 request 專屬 Workflow event type、duplicate-safe 行為及 polling correctness fallback；完整 callback payload 不保存。
- [x] CSP 資料最小化：R2 API origin 只加入成功且已驗證的 `/app` 文件回應；公開頁、公開 callback、API JSON 及未授權 app 回應不攜帶該部署識別資料。
- [x] CSP inline-style hardening：固定波形高度改用有限 CSS classes，四個核心 route 及私人選檔狀態均無 `style` attribute；Worker 強制 `style-src 'self'; style-src-attr 'none'`，不再允許 `'unsafe-inline'`。
- [x] Cloudflare Workers Builds 可用的部署指令以受保護設定生成 ignored config，不把資源識別資料寫入版本庫。
- [x] 語義式 public-config gate 會盤點所有 tracked Wrangler JSON／JSONC 與 `.env.example`：canonical 及 named environment 的 provider／功能旗標保持 fail-closed，只接受已批准 variable 名稱，受保護欄位只接受不可部署佔位值，並拒絕可藏內容的 JSONC 註解、未批准 env 註解／inline comment、重複 key，或把 credential、query、fragment 藏在保留域名 URL；每份 tracked Wrangler 設定亦須停用 usage metrics 與 dependency metadata collection，診斷只輸出檔名與 key path。
- [x] Staging 與 production 可使用各自的 ignored Wrangler resource config，但生成器會固定使用唯一 `studymix-ai` Worker；staging config 只可上載 preview，不能作 production deploy。受保護設定停用 Wrangler usage metrics、dependency metadata collection 及本機 debug log 寫入，並保留輸出資料清理。
- [x] 私隱安全的 active-deployment 診斷只輸出 bindings、runtime／secret presence、migration counts、live-route booleans 及分層 readiness，不輸出資源名稱、識別碼、hostname、聯絡值或 secret。真實供應商 readiness 另要求程式內已落實 Turnstile verification；只有 secret presence 不會誤報可上線。
- [x] GitHub 存放庫已連接至 Cloudflare Workers Builds；生產與預覽命令採用加密建置設定，不在版本庫保存資源識別資料。
- [x] 獨立 staging Worker 已撤下，Cloudflare 現只保留一個 `studymix-ai` Worker。原 staging D1、私人 R2 與 Workflow 資源目前未綁定且不處理流量；如要重用，只可連到經批准的同一 Worker preview version。
- [x] Feature-gated 私人 R2 直接上載切片：server-controlled key、短效且綁定 content length／content type／不可覆寫條件的 PUT URL、R2 metadata 確認、owner 隔離、能力窗後收斂的明確刪除、不可超過 resource expiry 的短效輸出下載簽名及本機整合測試。
- [x] Feature-gated server-side mock generation 切片：嚴格 job contracts、現行法律接受及逐工作權利聲明、active-job quota、owner-scoped job API、Cloudflare Workflow、兩個無付費服務的合成 WAV 候選版本、私人 R2 輸出、短效播放連結及 Workflow introspection 測試。
- [x] Loopback-only 本機 AI harness：server-derived test principal、同一條 rights／owner／credit／Workflow／R2 流程、固定合成音訊、provider-neutral 每工作限制、獨立 attempt cost units、timeout recovery、terminal failure、cancel、owner-bound 播放及一鍵本機啟動／測試；另一 synthetic owner 的 cancel 會得到 404 且不能改動原 job／attempt／reservation，credit aggregate 亦以 403 拒絕而不回傳 balance；synthetic-source route 另以 4 KiB `application/json` 上限及 strict fixture／scenario／owner-scoped idempotency contract fail closed，success 只回傳 request-bound 的 versioned confirmed WAV metadata，browser 會核對 fixture／scenario／key，相同 request 順序重放不新增資料、同時重放收斂至一個 confirmed source／R2 object 並把 losing metadata 標成 deleted、同 key 錯 request 得 non-retryable 409、已刪除 source 的舊 key 保留 tombstone 並在新增 D1/R2 資料前拒絕、另一 owner 可獨立使用；invalid request 或 capability 缺失不增加 upload、local-source row 或 R2 object；production defaults、遠端 bindings 及真實生成均未改動。
- [x] Loopback synthetic-source browser mutation 只有在第一個結果為 outcome-unknown `NETWORK_ERROR` 時，以完全相同 validated fixture／scenario／owner-scoped idempotency key body 自動重試一次；第二次 network failure、AbortError、429／409 API error 及 invalid／錯配 success 都不重送。9 項 client tests 及既有 Worker replay／concurrency tests 覆蓋，helper 只在 local capability 實際準備 fixture 時載入。
- [x] Feature-gated 保留期與刪除切片：owner-scoped terminal job 即時使 metadata 不可用並刪 object、24 小時未附加上載／失敗 artifact 清理、完成後 72 小時來源清理、7 日輸出到期、每小時 Cron handler、可重試 metadata 狀態及另一 owner 拒絕測試。共享同一 upload 的 job 會以引用感知 predicate 保留來源，直至所有引用已 terminal／expired；PUT capability tombstone 完結前不會提早完成 metadata deletion。

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
