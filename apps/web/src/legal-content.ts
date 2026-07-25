import { currentLegalDocumentVersions, type LegalDocumentId } from "@studymix/contracts";

export type Language = "en" | "zh-HK";

type LocalizedText = Record<Language, string>;

export type LegalSection = {
  heading: LocalizedText;
  paragraphs?: Record<Language, readonly string[]>;
  items?: Record<Language, readonly string[]>;
};

export type LegalPageContent = {
  documentId: LegalDocumentId;
  title: LocalizedText;
  introduction: LocalizedText;
  sections: readonly LegalSection[];
  version: string;
};

export const legalPageContent: Record<LegalDocumentId, LegalPageContent> = {
  "terms-of-use": {
    documentId: "terms-of-use",
    title: { en: "Terms of Use", "zh-HK": "使用條款" },
    introduction: {
      en: "These draft terms govern the authenticated StudyMix AI private beta. The operator is the person or entity identified in your beta invitation and at the configured contact address. A legal name and service address must be added before any public launch.",
      "zh-HK":
        "本條款草案適用於須登入的 StudyMix AI 私密測試。營運者為測試邀請及已設定聯絡地址所列的人士或實體；在任何公開推出前，必須補上法定名稱及送達地址。",
    },
    version: currentLegalDocumentVersions["terms-of-use"],
    sections: [
      {
        heading: { en: "1. Eligibility and acceptance", "zh-HK": "1. 使用資格及接受條款" },
        paragraphs: {
          en: [
            "You must be at least 18, have authority to bind any organization you represent, use only your own permitted account, and accept the current Terms, Acceptable Use Policy, and AI and Output Notice before using generation features. The Privacy Notice describes necessary processing; it is not converted into optional consent merely by using a checkbox.",
          ],
          "zh-HK": [
            "你必須年滿 18 歲、獲授權代表相關機構、只使用自己獲准的帳戶，並在使用生成功能前接受現行《使用條款》、《可接受使用政策》及《AI 及輸出聲明》。私隱通知說明必要的資料處理，不會僅因剔選方格而被包裝成可選擇的同意。",
          ],
        },
      },
      {
        heading: { en: "2. Limited private-beta service", "zh-HK": "2. 有限度私密測試服務" },
        paragraphs: {
          en: [
            "StudyMix AI is a pre-release, private audio-restyling service for authorized recordings. Access may be restricted, changed, suspended, or withdrawn while security, quality, cost, provider, and legal controls are evaluated. No public hosting, marketplace, streaming, or distribution licence is provided.",
          ],
          "zh-HK": [
            "StudyMix AI 是尚未正式推出的私密音訊風格轉換服務，只供處理已獲授權的錄音。安全、質素、成本、供應商及法律控制仍在評估期間，存取權可被限制、更改、暫停或撤回。本服務不提供公開寄存、市集、串流或發佈授權。",
          ],
        },
      },
      {
        heading: { en: "3. Your recordings and permissions", "zh-HK": "3. 你的錄音及權限" },
        paragraphs: {
          en: [
            "You retain your rights in content you lawfully provide. You grant the operator and disclosed service providers only the limited, temporary rights needed to authenticate you, transfer, process, secure, troubleshoot, and delete that content for the requested private service.",
            "You represent that you own or have all permissions needed for the recording, composition, performance, voice, personal data, confidential information, adaptation, and intended output use. Public availability, a download link, or a claim that material is public domain does not by itself prove permission.",
          ],
          "zh-HK": [
            "你保留對合法提供內容所擁有的權利。你只授予營運者及已披露服務供應商為提供所要求的私密服務而必需、有限及暫時的權利，包括驗證身份、傳送、處理、保安、排解問題及刪除內容。",
            "你聲明已就錄音、樂曲、演出、聲音、個人資料、機密資料、改編及預定輸出用途取得全部所需權利或許可。內容可在網上找到、有下載連結，或聲稱屬公有領域，均不等於已證明獲得許可。",
          ],
        },
      },
      {
        heading: {
          en: "4. AI output and no rights clearance",
          "zh-HK": "4. AI 輸出及不代辦權利審查",
        },
        paragraphs: {
          en: [
            "Outputs may be inaccurate, defective, non-unique, unexpectedly similar to other material, or unsuitable for your intended use. StudyMix AI does not guarantee melody preservation, originality, copyright ownership, non-infringement, commercial usability, or any particular quality. You must review and clear an output before any use beyond private evaluation.",
          ],
          "zh-HK": [
            "輸出可能不準確、有缺陷、並非獨有、意外地與其他素材相似，或不適合你的預定用途。StudyMix AI 不保證旋律得以保留、原創性、版權擁有權、不侵權、商業可用性或任何指定質素。除私下評估外，你必須先自行審查輸出及處理所需權利。",
          ],
        },
      },
      {
        heading: { en: "5. Third-party services", "zh-HK": "5. 第三方服務" },
        paragraphs: {
          en: [
            "Cloudflare is used for identity, Worker execution, metadata, and planned private object storage. A separately disclosed AI provider may process audio only after the real-provider path is expressly activated. Third-party terms and availability may change; the operator must update the notice and technical controls before relying on a materially changed service.",
          ],
          "zh-HK": [
            "Cloudflare 用於身份驗證、Worker 執行、元數據及計劃中的私密物件儲存。只有在真實 AI 供應商流程被明確啟用後，另行披露的 AI 供應商才可處理音訊。第三方條款及可用性可能改變；如服務有重大改變，營運者必須先更新通知及技術控制。",
          ],
        },
      },
      {
        heading: { en: "6. Suspension and complaints", "zh-HK": "6. 暫停及投訴" },
        paragraphs: {
          en: [
            "The operator may block a request or suspend an account where reasonably necessary for security, rights complaints, legal compliance, provider policy, abuse prevention, or service integrity. Rights, privacy, security, and takedown concerns should be sent to the configured contact address with enough detail to investigate, but not with passwords, Access tokens, or unnecessary audio.",
          ],
          "zh-HK": [
            "如為保安、權利投訴、法律合規、供應商政策、防止濫用或服務完整性而合理所需，營運者可拒絕要求或暫停帳戶。版權、私隱、保安及下架問題應送往已設定的聯絡地址，並提供足夠調查資料，但不要提交密碼、Access token 或不必要的音訊。",
          ],
        },
      },
      {
        heading: {
          en: "7. Beta warranty and liability limits",
          "zh-HK": "7. 測試版保證及責任限制",
        },
        paragraphs: {
          en: [
            "The beta is provided on an as-available basis. To the maximum extent permitted by law, no implied guarantee is given for uninterrupted availability, fitness for a particular purpose, output accuracy, or non-infringement. The operator is not responsible for indirect or consequential loss that was not reasonably foreseeable. Nothing excludes liability that applicable law does not permit to be excluded or limited. A Hong Kong lawyer must review these limits before public launch.",
          ],
          "zh-HK": [
            "測試服務按可用情況提供。在法律允許的最大範圍內，不就不間斷可用性、特定用途適用性、輸出準確性或不侵權作出默示保證。營運者不對並非合理可預見的間接或後果性損失負責。本條款不排除或限制適用法律不容排除或限制的責任。公開推出前，必須由香港律師審閱這些限制。",
          ],
        },
      },
      {
        heading: { en: "8. Law, changes, and records", "zh-HK": "8. 法律、更新及紀錄" },
        paragraphs: {
          en: [
            "These draft terms are governed by Hong Kong law, subject to mandatory rights that apply elsewhere. Material changes receive a new dated version and require fresh acceptance before generation. The service stores the authenticated owner identifier, accepted document versions, and server timestamp as evidence; it does not accept a browser-supplied owner identity or acceptance time.",
          ],
          "zh-HK": [
            "本條款草案受香港法律管限，但不影響其他地區適用的強制性權利。重大更新會使用新的日期版本，並在再次生成前要求重新接受。服務會保存經驗證的擁有人識別碼、已接受文件版本及伺服器時間作為證據；不會接受瀏覽器自行提供的擁有人身份或接受時間。",
          ],
        },
      },
    ],
  },
  "privacy-notice": {
    documentId: "privacy-notice",
    title: { en: "Privacy Notice", "zh-HK": "私隱通知" },
    introduction: {
      en: "This Personal Information Collection and Privacy Notice explains the authenticated private beta. It distinguishes the current interface from audio and AI processing that remains disabled until the stated safeguards are implemented and verified.",
      "zh-HK":
        "本收集個人資料聲明及私隱通知說明須登入的私密測試，並清楚區分現有介面與尚未啟用的音訊及 AI 處理；後者只會在指定保障已實作及驗證後啟用。",
    },
    version: currentLegalDocumentVersions["privacy-notice"],
    sections: [
      {
        heading: { en: "1. Controller and contact", "zh-HK": "1. 資料使用者及聯絡方法" },
        paragraphs: {
          en: [
            "The private-beta operator identified in your invitation controls application data. The configured contact address below handles access, correction, deletion, privacy, security, rights, and complaint requests. A formal legal identity and service address remain a public-launch requirement.",
          ],
          "zh-HK": [
            "測試邀請所列的私密測試營運者控制應用程式資料。下方已設定聯絡地址處理查閱、更正、刪除、私隱、保安、權利及投訴要求。正式法定身份及送達地址仍是公開推出前的必要條件。",
          ],
        },
      },
      {
        heading: { en: "2. Data collected now", "zh-HK": "2. 現時收集的資料" },
        items: {
          en: [
            "Cloudflare Access session and identity data needed to allow an approved user to sign in. The application stores a one-way subject hash and derived owner ID, not the Access JWT, password, or email address in D1.",
            "Legal document IDs, versions, the derived owner ID, and a server timestamp when you accept the required documents.",
            "Minimal request, error-name, route, security, and service-health data. Audio, filenames, signed URLs, Access assertions, and full provider payloads must not be logged.",
            "The current web shell lets you select a local file for interface testing, but no upload or generation API is active in this release, so selecting a file does not send its bytes to StudyMix AI.",
          ],
          "zh-HK": [
            "Cloudflare Access 為准許已核准用戶登入而需要的工作階段及身份資料。應用程式在 D1 只保存單向 subject 雜湊及衍生擁有人 ID，不保存 Access JWT、密碼或電郵地址。",
            "你接受所需文件時保存的法律文件 ID、版本、衍生擁有人 ID 及伺服器時間。",
            "最少量的要求、錯誤名稱、路由、保安及服務健康資料。日誌不得包含音訊、檔案名稱、簽署 URL、Access assertion 或完整供應商 payload。",
            "現有網頁介面只讓你選擇本機檔案作介面測試；本版本尚未啟用上載或生成 API，因此選擇檔案不會把檔案位元組傳送至 StudyMix AI。",
          ],
        },
      },
      {
        heading: {
          en: "3. Data planned for audio processing",
          "zh-HK": "3. 計劃用於音訊處理的資料",
        },
        items: {
          en: [
            "If activated: filename, declared media type, byte size, server-generated object key, upload/job/output status, selected preset, rights declaration, usage and cost metadata, expiry state, source audio, and generated audio.",
            "StudyMix AI will not accept arbitrary source URLs, scrape public websites or APIs for your track, create public result pages, or use uploads to train its own models.",
            "A promise about an external model provider not training on inputs will be made only if the signed provider terms or DPA support it. Real-provider processing remains disabled until that point.",
          ],
          "zh-HK": [
            "如日後啟用：檔案名稱、聲稱媒體類型、位元組大小、伺服器產生的物件 key、上載／工作／輸出狀態、所選風格、權利聲明、用量及成本元數據、到期狀態、來源音訊及生成音訊。",
            "StudyMix AI 不會接受任意來源 URL、不會從公開網站或 API 抓取你的歌曲、不會建立公開結果頁，亦不會以你的上載訓練自己的模型。",
            "只有已簽署的供應商條款或資料處理協議支持時，才會就外部模型供應商不以輸入作訓練作出承諾。在此之前，真實供應商處理會維持關閉。",
          ],
        },
      },
      {
        heading: { en: "4. Purposes and necessity", "zh-HK": "4. 用途及必要性" },
        paragraphs: {
          en: [
            "Data is used only as reasonably necessary to authenticate approved users, provide the requested private service, enforce ownership and current legal versions, secure and troubleshoot the system, prevent abuse and duplicate paid work, comply with law, handle complaints, and perform configured deletion. Required fields are marked; if they are not provided, the relevant service cannot be supplied.",
          ],
          "zh-HK": [
            "資料只會在合理必要的範圍內，用於驗證已核准用戶、提供所要求的私密服務、執行擁有權及現行法律版本要求、保障及排解系統問題、防止濫用及重複付費工作、遵守法律、處理投訴及執行已設定刪除。必填資料會被標示；如不提供，便無法提供相關服務。",
          ],
        },
      },
      {
        heading: {
          en: "5. Recipients and international processing",
          "zh-HK": "5. 接收方及跨境處理",
        },
        paragraphs: {
          en: [
            "Cloudflare processes identity, Worker traffic, D1 metadata, and planned R2 objects as a service provider. Its automatic data placement and location hints do not guarantee a Hong Kong storage location; traffic and data may be processed in other jurisdictions under configured platform and contractual controls.",
            "fal.ai is the planned initial AI provider, but real processing is disabled. Its published documentation currently describes default request input/output retention and media CDN behavior. StudyMix AI requires no-payload storage where supported, the shortest verified media expiry, restrictive access controls, and a suitable provider agreement before activation. The notice will be updated with the exact verified configuration before audio is sent.",
            "Data is not sold. It may be disclosed where required by law, to protect users and the service, or to vetted service providers under confidentiality, security, deletion, and subprocessor obligations.",
          ],
          "zh-HK": [
            "Cloudflare 以服務供應商身份處理身份資料、Worker 流量、D1 元數據及計劃中的 R2 物件。其自動資料放置及位置提示不保證資料儲存於香港；在已設定的平台及合約控制下，流量及資料可能在其他司法管轄區處理。",
            "fal.ai 是計劃中的首個 AI 供應商，但真實處理仍未啟用。其現行公開文件說明預設要求輸入／輸出保留及媒體 CDN 行為。StudyMix AI 會在啟用前要求在支援時不儲存 payload、採用經驗證的最短媒體到期時間、限制存取，並簽訂合適供應商協議；在音訊傳送前，本通知會更新實際已驗證設定。",
            "資料不會被出售。只有在法律要求、保障用戶及服務，或向受保密、保安、刪除及次處理者義務約束的已審核服務供應商時，才會披露資料。",
          ],
        },
      },
      {
        heading: { en: "6. Retention and deletion status", "zh-HK": "6. 保留及刪除狀態" },
        paragraphs: {
          en: [
            "The intended policy after storage activation is: abandoned uploads and failed-job artifacts within 24 hours; source audio no later than 72 hours after completion; generated outputs after 7 days; and longer retention only for minimal metadata needed for security, cost, legal evidence, or disputes. These automatic object-deletion jobs and user deletion routes are not implemented in the current release, so audio upload and real generation must remain disabled. Legal acceptance records may be retained while needed to prove the governing version and resolve a dispute, then securely deleted or de-identified according to the final retention schedule.",
          ],
          "zh-HK": [
            "儲存功能啟用後的預定政策為：放棄的上載及失敗工作產物於 24 小時內、來源音訊不遲於完成後 72 小時、生成輸出於 7 日後刪除；只有保安、成本、法律證據或爭議所需的最少元數據才可保留較久。現版本尚未實作自動物件刪除工作及用戶刪除路由，因此音訊上載及真實生成必須維持關閉。法律接受紀錄只會在證明適用版本及處理爭議所需期間保留，其後按最終保留表安全刪除或去識別化。",
          ],
        },
      },
      {
        heading: { en: "7. Security", "zh-HK": "7. 保安" },
        paragraphs: {
          en: [
            "Controls include Cloudflare Access plus independent Worker JWT verification, private no-store responses, server-derived owner IDs, owner-scoped D1 queries, private planned R2 storage, short-lived signed URLs, secret isolation, strict input validation, and bounded logging. No system is risk-free; a suspected incident should be reported promptly without sending credentials.",
          ],
          "zh-HK": [
            "控制包括 Cloudflare Access 加上 Worker 獨立驗證 JWT、私密 no-store 回應、由伺服器衍生擁有人 ID、按擁有人限制 D1 查詢、計劃中的私密 R2 儲存、短效簽署 URL、秘密隔離、嚴格輸入驗證及受限制日誌。沒有系統可完全消除風險；如懷疑事故，應盡快報告但不要傳送憑證。",
          ],
        },
      },
      {
        heading: { en: "8. Your choices and rights", "zh-HK": "8. 你的選擇及權利" },
        paragraphs: {
          en: [
            "You may request access to and correction of personal data, ask how it was used, request deletion where applicable, withdraw from the beta, or complain through the configured contact. The operator may need to verify the request through the authenticated account and retain narrowly required evidence where law or a live dispute requires it. You may also complain to the Office of the Privacy Commissioner for Personal Data in Hong Kong.",
          ],
          "zh-HK": [
            "你可透過已設定聯絡方法要求查閱及更正個人資料、查詢使用方式、在適用情況要求刪除、退出測試或提出投訴。營運者可能需要透過已驗證帳戶核實要求，並在法律或現存爭議要求時保留極少量必要證據。你亦可向香港個人資料私隱專員公署投訴。",
          ],
        },
      },
      {
        heading: { en: "9. Updates", "zh-HK": "9. 更新" },
        paragraphs: {
          en: [
            "The dated version identifies this notice. It must be updated before a new data category, recipient, provider, analytics tool, location commitment, retention rule, public feature, or materially different purpose is introduced.",
          ],
          "zh-HK": [
            "本通知以日期版本識別。在引入新的資料類別、接收方、供應商、分析工具、資料位置承諾、保留規則、公開功能或重大不同用途前，必須先更新本通知。",
          ],
        },
      },
    ],
  },
  "acceptable-use": {
    documentId: "acceptable-use",
    title: { en: "Acceptable Use Policy", "zh-HK": "可接受使用政策" },
    introduction: {
      en: "This policy protects rights holders, people whose data or voices may appear in recordings, other beta users, providers, and the service. It applies in addition to the Terms of Use.",
      "zh-HK":
        "本政策保障權利持有人、錄音中可能出現其資料或聲音的人士、其他測試用戶、供應商及服務，並與《使用條款》一併適用。",
    },
    version: currentLegalDocumentVersions["acceptable-use"],
    sections: [
      {
        heading: { en: "1. Use only authorized material", "zh-HK": "1. 只使用已獲授權素材" },
        items: {
          en: [
            "Do not upload or adapt recordings, compositions, performances, voices, personal data, confidential material, or trade secrets unless you have every permission needed for the processing and intended output use.",
            "Do not rely only on public availability, a third-party download, an API response, a social-media post, or an unsupported public-domain or licence label.",
            "Do not use artist names or request imitation of a living or identifiable artist, performer, or person's voice or style.",
          ],
          "zh-HK": [
            "除非已取得處理及預定輸出用途所需的全部許可，否則不得上載或改編錄音、樂曲、演出、聲音、個人資料、機密素材或商業秘密。",
            "不得只依賴網上公開可見、第三方下載、API 回應、社交媒體貼文，或未有證據支持的公有領域／授權標籤。",
            "不得使用藝人姓名，或要求模仿在世或可識別的藝人、表演者、個人聲音或風格。",
          ],
        },
      },
      {
        heading: { en: "2. No harmful or unlawful use", "zh-HK": "2. 不得作有害或違法用途" },
        items: {
          en: [
            "No illegal, deceptive, defamatory, hateful, harassing, exploitative, non-consensual intimate, child sexual abuse, or violent-extremist content or activity.",
            "No impersonation, misleading attribution, fabricated endorsement, fraud, voice deception, rights-management removal, or evasion of legal or platform safeguards.",
            "No output use that violates law, privacy, publicity, confidentiality, contract, copyright, neighbouring rights, trademark, or another person's rights.",
          ],
          "zh-HK": [
            "不得進行違法、欺詐、誹謗、仇恨、騷擾、剝削、未經同意的私密內容、兒童性虐待或暴力極端主義內容或活動。",
            "不得冒充他人、誤導性署名、虛構代言、詐騙、聲音欺騙、移除權利管理資料，或規避法律／平台保障。",
            "不得以輸出違反法律、私隱、形象權、保密、合約、版權、相關權利、商標或他人權利。",
          ],
        },
      },
      {
        heading: { en: "3. No abuse of the service", "zh-HK": "3. 不得濫用服務" },
        items: {
          en: [
            "Do not bypass authentication, account restrictions, quotas, rate limits, legal gates, provider kill switches, signed-URL scope, expiry, or owner checks.",
            "Do not probe another user's identifiers or data, automate excessive requests, create duplicate paid work, upload malware or hostile files, interfere with availability, or discover secrets through the service.",
            "Do not submit remote URLs for ingestion, scrape source websites or APIs through StudyMix AI, reverse engineer protected provider behavior, or resell account access.",
          ],
          "zh-HK": [
            "不得繞過身份驗證、帳戶限制、配額、速率限制、法律關卡、供應商 kill switch、簽署 URL 範圍、到期時間或擁有人檢查。",
            "不得試探其他用戶識別碼或資料、自動發出過量要求、建立重複付費工作、上載惡意或敵意檔案、干擾可用性，或透過服務探取秘密。",
            "不得提交遠端 URL 供擷取、利用 StudyMix AI 抓取來源網站或 API、逆向受保護供應商行為，或轉售帳戶存取權。",
          ],
        },
      },
      {
        heading: { en: "4. Private evaluation only", "zh-HK": "4. 只供私下評估" },
        paragraphs: {
          en: [
            "The private beta does not authorize public release, monetization, synchronization, broadcast, performance, platform upload, dataset creation, model training, or distribution. You must obtain all separate clearances before any such use outside the service.",
          ],
          "zh-HK": [
            "私密測試不授權公開發佈、變現、配樂同步、廣播、表演、平台上載、建立數據集、模型訓練或分發。進行任何服務以外用途前，你必須另行取得全部所需許可。",
          ],
        },
      },
      {
        heading: { en: "5. Enforcement and reporting", "zh-HK": "5. 執行及舉報" },
        paragraphs: {
          en: [
            "StudyMix AI may reject content, disable generation, suspend access, preserve narrowly required evidence, or notify a provider or authority where reasonably necessary and lawful. Report suspected infringement, privacy harm, unsafe content, or security abuse to the configured contact with the relevant job or account context and a good-faith explanation.",
          ],
          "zh-HK": [
            "在合理必要及合法情況下，StudyMix AI 可拒絕內容、停用生成、暫停存取、保留極少量必要證據，或通知供應商／主管機關。如懷疑侵權、私隱損害、不安全內容或保安濫用，請向已設定聯絡地址提供相關工作／帳戶資料及真誠說明。",
          ],
        },
      },
    ],
  },
  "ai-output-notice": {
    documentId: "ai-output-notice",
    title: { en: "AI and Output Notice", "zh-HK": "AI 及輸出聲明" },
    introduction: {
      en: "AI audio generation is probabilistic. This notice explains what StudyMix AI cannot verify or promise and what you must check before relying on an output.",
      "zh-HK":
        "AI 音訊生成具有隨機性。本聲明說明 StudyMix AI 無法驗證或承諾的事項，以及你在依賴輸出前必須自行檢查的內容。",
    },
    version: currentLegalDocumentVersions["ai-output-notice"],
    sections: [
      {
        heading: { en: "1. No guaranteed result", "zh-HK": "1. 不保證結果" },
        items: {
          en: [
            "A preset is an instruction hypothesis, not a guarantee of melody, structure, duration, instrument, mood, vocal removal, fidelity, or quality.",
            "Outputs may contain artifacts, silence, unwanted vocals, altered notes, incorrect structure, or unsafe and unexpected content.",
            "Two users or requests may receive identical or similar output, and an output may resemble existing material by coincidence or model behavior.",
          ],
          "zh-HK": [
            "風格 preset 只是指令假設，不保證旋律、結構、長度、樂器、情緒、移除人聲、忠實度或質素。",
            "輸出可能包含雜訊、靜音、意外人聲、被改變音符、錯誤結構，或不安全及意料之外的內容。",
            "兩名用戶或兩次要求可能取得相同或相似輸出；輸出亦可能因巧合或模型行為而與現有素材相似。",
          ],
        },
      },
      {
        heading: {
          en: "2. No copyright or licence conclusion",
          "zh-HK": "2. 不提供版權或授權結論",
        },
        paragraphs: {
          en: [
            "Neither access to a model nor generation of an output proves that your input was authorized, that the output is original, that copyright exists in it, that you own it, or that use is non-infringing. Copyright and related-rights outcomes depend on facts, contracts, jurisdiction, and intended use. Obtain qualified advice and all required licences before release or commercial use.",
          ],
          "zh-HK": [
            "能夠使用模型或成功生成輸出，均不代表輸入已獲授權、輸出屬原創、輸出享有版權、你擁有輸出，或使用輸出不構成侵權。版權及相關權利結果取決於事實、合約、司法管轄區及預定用途。公開或商業使用前，應取得合資格意見及全部所需授權。",
          ],
        },
      },
      {
        heading: { en: "3. Data sources and provider claims", "zh-HK": "3. 數據來源及供應商聲明" },
        paragraphs: {
          en: [
            "StudyMix AI uses fixed, versioned style presets and user-supplied authorized audio. It does not search, scrape, or import songs from official sites, third-party websites, public databases, social platforms, or user-provided URLs. The planned AI model is supplied by a third-party provider. StudyMix AI does not represent that every item used to train or operate that external model is identified or licensed for every downstream purpose; provider provenance, input use, and output terms remain contractual launch checks.",
          ],
          "zh-HK": [
            "StudyMix AI 使用固定、具版本的風格 preset 及由用戶提供的已授權音訊；不會從官方網站、第三方網站、公開數據庫、社交平台或用戶提供 URL 搜尋、抓取或匯入歌曲。計劃中的 AI 模型由第三方供應商提供。StudyMix AI 不聲明外部模型訓練或運作所用的每項素材均已被識別，或已獲准作所有下游用途；供應商來源、輸入用途及輸出條款仍是合約上線檢查。",
          ],
        },
      },
      {
        heading: { en: "4. Required review", "zh-HK": "4. 必須自行審查" },
        items: {
          en: [
            "Listen to the complete output and inspect its metadata before relying on it.",
            "Do not assume private generation makes later public use lawful.",
            "Check source rights, output similarity, personal data, voices, trademarks, attribution, platform rules, and licences for the exact intended territory and use.",
            "Do not use an output where ownership, consent, provenance, safety, or required permission is uncertain.",
          ],
          "zh-HK": [
            "依賴輸出前，完整聆聽並檢查其元數據。",
            "不得假設私下生成會令日後公開使用變成合法。",
            "按確切地區及用途檢查來源權利、輸出相似度、個人資料、聲音、商標、署名、平台規則及授權。",
            "如擁有權、同意、來源、安全或所需許可有疑問，便不要使用輸出。",
          ],
        },
      },
      {
        heading: { en: "5. Current activation status", "zh-HK": "5. 現時啟用狀態" },
        paragraphs: {
          en: [
            "Real AI generation is disabled in the current release. The interface is not evidence that fal.ai, ACE-Step, R2 transfer, retention cleanup, or output delivery is operational. Those features require current official-schema verification, provider contract and privacy review, restrictive media handling, quota controls, server-side rights and legal gates, and a new focused security review before activation.",
          ],
          "zh-HK": [
            "現版本未啟用真實 AI 生成。介面不代表 fal.ai、ACE-Step、R2 傳送、保留清理或輸出交付已投入運作。啟用這些功能前，必須完成現行官方 schema 驗證、供應商合約及私隱審查、限制媒體處理、配額控制、伺服器端權利及法律關卡，以及新的聚焦安全審查。",
          ],
        },
      },
    ],
  },
};

export const legalPathToDocumentId: Readonly<Record<string, LegalDocumentId>> = {
  "/legal/acceptable-use": "acceptable-use",
  "/legal/ai-output-notice": "ai-output-notice",
  "/legal/privacy": "privacy-notice",
  "/legal/terms": "terms-of-use",
};
