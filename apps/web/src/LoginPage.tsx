import { useEffect, useState, type ReactNode } from "react";

type LoginLanguage = "en" | "zh-HK";

const loginCopy = {
  en: {
    language: "繁體中文",
    title: "Return to your private StudyMix workspace",
    body: "Sign in with an invited identity. StudyMix checks both the Cloudflare Access session and your active beta access before loading any workspace data.",
    points: [
      "Identity verified by Cloudflare Access",
      "Beta access checked again by the StudyMix Worker",
      "Your workspace and audio remain private",
    ],
    loginTab: "Sign in",
    registerTab: "Create account",
    registerLater: "Later",
    cardTitle: "Invited tester sign in",
    cardBody: "Continue to Cloudflare Access, then return here automatically after verification.",
    closedTitle: "Closed beta",
    closedBody: "Only approved testers can enter. Public registration is not open yet.",
    action: "Continue to secure sign in",
    passwordNote:
      "Cloudflare Access handles sign-in. StudyMix does not create or store a password.",
    futureTitle: "Public registration is reserved for a later release",
    futureBody:
      "When registration opens, new users will be able to create a StudyMix account from this page.",
    home: "Back to product overview",
    footer: "Private beta access",
  },
  "zh-HK": {
    language: "EN",
    title: "返回你的私人 StudyMix 工作區",
    body: "使用已獲邀身份登入。載入任何工作區資料前，StudyMix 會先驗證 Cloudflare Access 工作階段，再核對有效的 Beta 測試權限。",
    points: [
      "由 Cloudflare Access 驗證身份",
      "StudyMix Worker 再核對 Beta 使用權",
      "工作區與音訊保持私密",
    ],
    loginTab: "登入",
    registerTab: "建立帳戶",
    registerLater: "稍後開放",
    cardTitle: "受邀測試者登入",
    cardBody: "前往 Cloudflare Access 完成驗證，成功後會自動返回私人工作區。",
    closedTitle: "目前為封閉測試",
    closedBody: "只有已獲批准的測試者可以進入，公開註冊尚未開放。",
    action: "繼續安全登入",
    passwordNote: "登入由 Cloudflare Access 處理；StudyMix 不會建立或儲存密碼。",
    futureTitle: "已為日後公開註冊預留位置",
    futureBody: "公開註冊開放後，新用戶可由此頁建立 StudyMix 帳戶。",
    home: "返回產品介紹",
    footer: "私密 Beta 測試存取",
  },
} as const;

const legalLinks = {
  en: [
    ["/legal/terms", "Terms"],
    ["/legal/privacy", "Privacy"],
    ["/legal/acceptable-use", "Acceptable use"],
    ["/legal/ai-output-notice", "AI & output notice"],
  ],
  "zh-HK": [
    ["/legal/terms", "使用條款"],
    ["/legal/privacy", "私隱通知"],
    ["/legal/acceptable-use", "可接受使用政策"],
    ["/legal/ai-output-notice", "AI 及輸出聲明"],
  ],
} as const;

export function LoginPage() {
  const [language, setLanguage] = useState<LoginLanguage>("zh-HK");
  const copy = loginCopy[language];

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "en" ? "Sign in | StudyMix AI" : "登入｜StudyMix AI";
  }, [language]);

  return (
    <div className="login-page">
      <header className="login-header">
        <a className="login-brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <button
          className="login-language"
          type="button"
          onClick={() => setLanguage(language === "en" ? "zh-HK" : "en")}
        >
          <GlobeIcon />
          <span>{copy.language}</span>
        </button>
      </header>

      <main className="login-main">
        <section className="login-introduction" aria-labelledby="login-page-title">
          <div>
            <h1 id="login-page-title">{copy.title}</h1>
            <p>{copy.body}</p>
          </div>
          <ul>
            {copy.points.map((point, index) => (
              <li key={point}>
                <span aria-hidden="true">
                  {index === 0 ? <AccessIcon /> : index === 1 ? <ShieldIcon /> : <LockIcon />}
                </span>
                {point}
              </li>
            ))}
          </ul>
        </section>

        <section className="login-card" aria-labelledby="login-card-title">
          <div
            className="login-tabs"
            role="tablist"
            aria-label={language === "en" ? "Account access" : "帳戶存取"}
          >
            <button className="is-active" type="button" role="tab" aria-selected="true">
              {copy.loginTab}
            </button>
            <button type="button" role="tab" aria-selected="false" disabled>
              <span>{copy.registerTab}</span>
              <small>{copy.registerLater}</small>
            </button>
          </div>

          <div className="login-card-body">
            <header>
              <h2 id="login-card-title">{copy.cardTitle}</h2>
              <p>{copy.cardBody}</p>
            </header>

            <div className="login-beta-note" role="note">
              <LockIcon />
              <span>
                <strong>{copy.closedTitle}</strong>
                <small>{copy.closedBody}</small>
              </span>
            </div>

            <a className="login-submit" href="/app">
              <AccessIcon />
              <span>{copy.action}</span>
              <ArrowIcon />
            </a>
            <p className="login-password-note">{copy.passwordNote}</p>

            <div className="login-future-registration">
              <strong>{copy.futureTitle}</strong>
              <span>{copy.futureBody}</span>
            </div>

            <a className="login-home-link" href="/">
              <ArrowBackIcon />
              <span>{copy.home}</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="login-footer">
        <span>StudyMix AI · {copy.footer}</span>
        <nav aria-label={language === "en" ? "Legal documents" : "法律文件"}>
          {legalLinks[language].map(([href, label]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
      </footer>
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

function GlobeIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17M12 3c2.3 2.5 3.4 5.5 3.4 9S14.3 18.5 12 21c-2.3-2.5-3.4-5.5-3.4-9S9.7 5.5 12 3Z" />
    </IconBase>
  );
}

function AccessIcon() {
  return (
    <IconBase>
      <path d="M4 12h10M10 7l5 5-5 5" />
      <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
    </IconBase>
  );
}

function ShieldIcon() {
  return (
    <IconBase>
      <path d="M12 3 5 6v5c0 4.7 2.8 8.5 7 10 4.2-1.5 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </IconBase>
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

function ArrowIcon() {
  return (
    <IconBase>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </IconBase>
  );
}

function ArrowBackIcon() {
  return (
    <IconBase>
      <path d="M19 12H6M11 6l-6 6 6 6" />
    </IconBase>
  );
}
