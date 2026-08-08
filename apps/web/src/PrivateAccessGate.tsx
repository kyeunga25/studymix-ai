import { type ReactNode } from "react";
import type { Language } from "./legal-content";

const gateCopy = {
  en: {
    title: "Checking your private-beta access",
    body: "StudyMix is verifying the signed Access session and active beta permission before loading the workspace.",
    home: "Product overview",
    status: "Private workspace gate",
  },
  "zh-HK": {
    title: "正在檢查私密 Beta 使用權",
    body: "載入工作區前，StudyMix 正在驗證已簽署的 Access 工作階段與有效 Beta 權限。",
    home: "產品介紹",
    status: "私人工作區閘道",
  },
} satisfies Record<Language, Record<"title" | "body" | "home" | "status", string>>;

export function PrivateAccessGate({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: () => void;
}) {
  const copy = gateCopy[language];

  return (
    <div className="private-gate-page">
      <header className="private-gate-header">
        <a className="login-brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <button className="login-language" type="button" onClick={onLanguageChange}>
          <GlobeIcon />
          <span>{language === "en" ? "繁體中文" : "EN"}</span>
        </button>
      </header>

      <main className="private-gate-card is-checking" aria-labelledby="private-gate-title">
        <span className="private-gate-icon" aria-hidden="true">
          <LoadingIcon />
        </span>
        <p className="private-gate-label">{copy.status}</p>
        <h1 id="private-gate-title">{copy.title}</h1>
        <p role="status" aria-live="polite">
          {copy.body}
        </p>
        <span className="private-gate-progress" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <a className="private-gate-home" href="/">
          {copy.home}
        </a>
      </main>
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

function LoadingIcon() {
  return (
    <IconBase>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 5v7h-7" />
    </IconBase>
  );
}
