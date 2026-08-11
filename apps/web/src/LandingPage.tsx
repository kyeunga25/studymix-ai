import { useEffect, useState, type ReactNode } from "react";
import { presetOptions, presetPresentation, PresetIcon } from "./preset-presentation";
import { preloadLegalRoute, preloadLoginRoute } from "./route-loaders";
import "./landing.css";

type LandingLanguage = "en" | "zh-HK";

const landingCopy = {
  en: {
    language: "繁體中文",
    nav: {
      overview: "Product",
      process: "How it works",
      privacy: "Privacy & safety",
    },
    login: "Invited tester sign in",
    mobileLogin: "Sign in",
    hero: {
      title: "Turn your recording into a better study mix",
      body: "Upload audio you own or are authorized to process, choose a focus style—from soft piano and acoustic guitar to slow electronic ambience or café jazz-hop—then privately compare two candidates.",
      primaryAction: "See how it works",
      status: "Closed beta only. Registration and real generation are not open.",
    },
    preview: {
      source: "Your recording",
      filename: "authorized-track.wav",
      styles: "Choose a study style",
      candidates: "Two private candidates",
      candidateA: "Candidate A",
      candidateB: "Candidate B",
      privateNote: "Visible only in the protected workspace. Real processing is still disabled.",
    },
    process: {
      heading: "From one recording to two focus-friendly versions",
      intro:
        "A short, rights-aware flow designed for focused listening rather than public sharing.",
      steps: [
        {
          title: "Upload authorized audio",
          body: "Choose an MP3, WAV, M4A, AAC, or OGG that you own or have permission to process.",
        },
        {
          title: "Choose a Study Mix style",
          body: "Choose Soft Piano, Music Box, Lo-fi Study, Acoustic Ease, Slowwave, or Kissa Jazzhop—without artist-name prompting.",
        },
        {
          title: "Compare privately",
          body: "Listen to two candidates in a protected workspace and choose the version you prefer.",
        },
      ],
    },
    privacy: {
      heading: "Private from start to result",
      points: [
        "A private workspace with no public result pages",
        "User uploads are not used to train models",
        "Retention and deletion must be verified before real processing is enabled",
      ],
    },
    status: {
      heading: "What can be tested now?",
      body: "Invited testers can verify sign-in, legal documents, the rights declaration, and the complete interface flow.",
      limitation: "Audio upload and external AI generation remain disabled.",
    },
    footer: "Public product overview · Invite-only application",
  },
  "zh-HK": {
    language: "EN",
    nav: {
      overview: "產品概覽",
      process: "如何運作",
      privacy: "私隱與安全",
    },
    login: "受邀測試者登入",
    mobileLogin: "登入",
    hero: {
      title: "把你的錄音，變成更適合專注的 Study Mix",
      body: "上載你擁有或已獲授權的音訊，從柔和鋼琴、木結他、慢拍舒緩電音或咖啡店爵士輕拍中選擇專注風格，再私密比較兩個候選版本。",
      primaryAction: "了解如何運作",
      status: "目前為封閉測試，尚未開放註冊及真實生成。",
    },
    preview: {
      source: "你的錄音",
      filename: "authorized-track.wav",
      styles: "選擇學習風格",
      candidates: "兩個候選版本（私密比較）",
      candidateA: "候選版本 A",
      candidateB: "候選版本 B",
      privateNote: "只在受保護工作區顯示；真實音訊處理尚未啟用。",
    },
    process: {
      heading: "從一段錄音，到兩個專注版本",
      intro: "以權利和私隱為前提的簡短流程，專注個人試聽，不設公開分享。",
      steps: [
        {
          title: "上載已獲授權的音訊",
          body: "選擇你擁有或已獲許可處理的 MP3、WAV、M4A、AAC 或 OGG。",
        },
        {
          title: "選擇 Study Mix 風格",
          body: "可選柔和鋼琴、八音盒、Lo-fi 學習、木結他輕奏、慢拍舒緩電音或喫茶爵士輕拍，預設不使用歌手名稱。",
        },
        {
          title: "私密比較候選版本",
          body: "在受保護的工作區試聽兩個版本，再選擇偏好的結果。",
        },
      ],
    },
    privacy: {
      heading: "由開始到結果，都以私密為前提",
      points: [
        "私人工作區，不設公開結果頁",
        "不以用戶上載內容訓練模型",
        "正式啟用前，保留期與刪除流程必須通過驗證",
      ],
    },
    status: {
      heading: "目前可以測試甚麼？",
      body: "受邀測試者可驗證登入、法律文件、權利聲明及完整介面流程。",
      limitation: "音訊上載及外部 AI 生成目前仍然停用。",
    },
    footer: "公開產品介紹 · 應用程式只限獲邀測試者",
  },
} as const;

const waveform = [
  10, 18, 14, 26, 17, 31, 12, 22, 28, 15, 34, 20, 25, 11, 29, 19, 24, 14, 30, 17, 22, 12, 26, 16,
  20, 10,
];

export function LandingPage() {
  const [language, setLanguage] = useState<LandingLanguage>("zh-HK");
  const copy = landingCopy[language];

  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === "zh-HK"
        ? "StudyMix AI｜私密音訊學習風格重塑"
        : "StudyMix AI | Private study-friendly audio restyling";
  }, [language]);

  return (
    <div className="landing-page">
      <section className="landing-hero" id="product">
        <PublicHeader language={language} onLanguageChange={setLanguage} />
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <h1>{copy.hero.title}</h1>
            <p>{copy.hero.body}</p>
            <div className="landing-hero-actions">
              <a className="landing-primary-action" href="#how-it-works">
                {copy.hero.primaryAction}
                <ArrowIcon />
              </a>
              <a
                className="landing-secondary-action"
                href="/login"
                onFocus={preloadLoginRoute}
                onMouseEnter={preloadLoginRoute}
              >
                {copy.login}
              </a>
            </div>
            <p className="landing-release-note">
              <LockIcon />
              <span>{copy.hero.status}</span>
            </p>
          </div>

          <ProductPreview language={language} />
        </div>
      </section>

      <main className="landing-content">
        <section className="landing-process" id="how-it-works">
          <header className="landing-section-heading">
            <h2>{copy.process.heading}</h2>
            <p>{copy.process.intro}</p>
          </header>
          <ol className="landing-steps">
            {copy.process.steps.map((step, index) => (
              <li key={step.title}>
                <span className="landing-step-icon" aria-hidden="true">
                  {index === 0 ? <UploadDocumentIcon /> : null}
                  {index === 1 ? <HeadphonesIcon /> : null}
                  {index === 2 ? <PrivateAudioIcon /> : null}
                </span>
                <span className="landing-step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-privacy" id="privacy">
          <div className="landing-privacy-image" aria-hidden="true" />
          <div className="landing-privacy-copy">
            <h2>{copy.privacy.heading}</h2>
            <ul>
              {copy.privacy.points.map((point, index) => (
                <li key={point}>
                  <span aria-hidden="true">
                    {index === 0 ? <PrivateAudioIcon /> : null}
                    {index === 1 ? <LockIcon /> : null}
                    {index === 2 ? <ShieldCheckIcon /> : null}
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-beta-status" id="beta-status">
          <div className="landing-beta-visual" aria-hidden="true">
            <HeadphonesIcon />
            <span className="landing-beta-wave">
              {waveform.slice(0, 18).map((height, index) => (
                <i className={`waveform-height-${height}`} key={`${height}-${index}`} />
              ))}
            </span>
          </div>
          <div className="landing-beta-copy">
            <h2>{copy.status.heading}</h2>
            <p>{copy.status.body}</p>
            <p className="landing-beta-limitation">{copy.status.limitation}</p>
            <a
              className="landing-primary-action"
              href="/login"
              onFocus={preloadLoginRoute}
              onMouseEnter={preloadLoginRoute}
            >
              {copy.login}
              <ArrowIcon />
            </a>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <span>{copy.footer}</span>
        <nav aria-label={language === "en" ? "Legal documents" : "法律文件"}>
          <a href="/legal/terms" onFocus={preloadLegalRoute} onMouseEnter={preloadLegalRoute}>
            {language === "en" ? "Terms" : "使用條款"}
          </a>
          <a href="/legal/privacy" onFocus={preloadLegalRoute} onMouseEnter={preloadLegalRoute}>
            {language === "en" ? "Privacy" : "私隱通知"}
          </a>
          <a
            href="/legal/acceptable-use"
            onFocus={preloadLegalRoute}
            onMouseEnter={preloadLegalRoute}
          >
            {language === "en" ? "Acceptable use" : "可接受使用政策"}
          </a>
          <a
            href="/legal/ai-output-notice"
            onFocus={preloadLegalRoute}
            onMouseEnter={preloadLegalRoute}
          >
            {language === "en" ? "AI & output notice" : "AI 及輸出聲明"}
          </a>
        </nav>
      </footer>
    </div>
  );
}

function PublicHeader({
  language,
  onLanguageChange,
}: {
  language: LandingLanguage;
  onLanguageChange: (language: LandingLanguage) => void;
}) {
  const copy = landingCopy[language];
  return (
    <header className="landing-header">
      <a className="landing-brand" href="/" aria-label="StudyMix AI home">
        <BrandMark />
        <span>StudyMix AI</span>
      </a>
      <nav className="landing-nav" aria-label={language === "en" ? "Main navigation" : "主要導覽"}>
        <a href="#product">{copy.nav.overview}</a>
        <a href="#how-it-works">{copy.nav.process}</a>
        <a href="#privacy">{copy.nav.privacy}</a>
      </nav>
      <div className="landing-header-actions">
        <button type="button" onClick={() => onLanguageChange(language === "en" ? "zh-HK" : "en")}>
          {copy.language}
        </button>
        <a href="/login" onFocus={preloadLoginRoute} onMouseEnter={preloadLoginRoute}>
          <span className="landing-login-wide">{copy.login}</span>
          <span className="landing-login-compact">{copy.mobileLogin}</span>
        </a>
      </div>
    </header>
  );
}

function ProductPreview({ language }: { language: LandingLanguage }) {
  const copy = landingCopy[language].preview;
  const selectedPreviewPreset = "kissa-jazzhop" as const;
  const selectedPreviewName = presetPresentation[selectedPreviewPreset].displayName[language];
  return (
    <section
      className="landing-product-preview"
      aria-label={language === "en" ? "Product preview" : "產品介面預覽"}
    >
      <div className="landing-preview-source">
        <div>
          <strong>{copy.source}</strong>
          <span>{copy.filename}</span>
        </div>
        <span>04:12</span>
      </div>
      <WaveformRow />

      <strong className="landing-preview-label">{copy.styles}</strong>
      <div className="landing-style-options">
        {presetOptions.map((style) => (
          <div
            className={style.id === selectedPreviewPreset ? "is-selected" : ""}
            data-preset={style.id}
            key={style.id}
          >
            <span className="landing-style-radio" aria-hidden="true" />
            <span className="landing-style-icon" aria-hidden="true">
              <PresetIcon presetId={style.id} />
            </span>
            <strong>{style.displayName[language]}</strong>
          </div>
        ))}
      </div>

      <strong className="landing-preview-label">{copy.candidates}</strong>
      <div className="landing-candidate-rows">
        <CandidatePreview label={copy.candidateA} presetName={selectedPreviewName} />
        <CandidatePreview label={copy.candidateB} presetName={selectedPreviewName} offset />
      </div>
      <p className="landing-preview-private">
        <LockIcon />
        <span>{copy.privateNote}</span>
      </p>
    </section>
  );
}

function WaveformRow() {
  return (
    <div className="landing-waveform-row" aria-hidden="true">
      <span className="landing-play">
        <PlayIcon />
      </span>
      <span className="landing-waveform">
        {waveform.map((height, index) => (
          <i className={`waveform-height-${height}`} key={`${height}-${index}`} />
        ))}
      </span>
    </div>
  );
}

function CandidatePreview({
  label,
  presetName,
  offset = false,
}: {
  label: string;
  presetName: string;
  offset?: boolean;
}) {
  return (
    <div>
      <span className="landing-play" aria-hidden="true">
        <PlayIcon />
      </span>
      <span className={`landing-waveform${offset ? " is-offset" : ""}`} aria-hidden="true">
        {waveform.slice(2, 23).map((height, index) => {
          const candidateHeight = Math.max(7, height - 5);
          return <i className={`waveform-height-${candidateHeight}`} key={`${height}-${index}`} />;
        })}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{presetName}</small>
      </span>
    </div>
  );
}

function IconBase({ children, viewBox = "0 0 24 24" }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {children}
    </svg>
  );
}

function BrandMark() {
  return (
    <IconBase viewBox="0 0 48 32">
      <path d="M3 16h5l3-10 5 21 5-22 5 20 4-14 4 10h5l3-7h3" />
    </IconBase>
  );
}

function ArrowIcon() {
  return (
    <IconBase>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </IconBase>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <IconBase>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </IconBase>
  );
}

function ShieldCheckIcon() {
  return (
    <IconBase>
      <path d="M12 3 5 6v5c0 4.7 2.8 8.5 7 10 4.2-1.5 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </IconBase>
  );
}

function UploadDocumentIcon() {
  return (
    <IconBase>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v5h4M12 18v-7m-3 3 3-3 3 3" />
    </IconBase>
  );
}

function PrivateAudioIcon() {
  return (
    <IconBase>
      <rect x="4" y="9" width="16" height="12" rx="2" />
      <path d="M8 9V7a4 4 0 0 1 8 0v2M8 15h2l1-3 2 6 1-3h2" />
    </IconBase>
  );
}

function HeadphonesIcon() {
  return (
    <IconBase>
      <path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2ZM20 13h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" />
    </IconBase>
  );
}
