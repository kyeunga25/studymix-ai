import { type ReactNode } from "react";
import type { PrivateAccessStatus } from "./auth-session";
import type { Language } from "./legal-content";

const gateCopy = {
  en: {
    checking: {
      title: "Checking your private-beta access",
      body: "StudyMix is verifying the signed Access session and active beta permission before loading the workspace.",
    },
    denied: {
      title: "This account does not have beta access",
      body: "Your identity was verified, but this account is not currently permitted to use the StudyMix private workspace.",
    },
    "signed-out": {
      title: "Your sign-in session has ended",
      body: "Return to the sign-in page and verify an invited identity before reopening the workspace.",
    },
    unavailable: {
      title: "Access cannot be checked right now",
      body: "The workspace remains locked because StudyMix could not safely verify this session. Try again shortly.",
    },
    retry: "Check again",
    reauthenticate: "Verify another identity",
    signIn: "Return to sign in",
    home: "Product overview",
    status: "Private workspace gate",
  },
  "zh-HK": {
    checking: {
      title: "正在檢查私密 Beta 使用權",
      body: "載入工作區前，StudyMix 正在驗證已簽署的 Access 工作階段與有效 Beta 權限。",
    },
    denied: {
      title: "此帳戶未獲 Beta 測試權限",
      body: "身份驗證已完成，但這個帳戶目前沒有使用 StudyMix 私人工作區的權限。",
    },
    "signed-out": {
      title: "登入工作階段已結束",
      body: "請返回登入頁，再以已獲邀身份完成驗證，然後重新進入工作區。",
    },
    unavailable: {
      title: "暫時未能檢查使用權",
      body: "StudyMix 未能安全驗證目前工作階段，因此工作區會繼續鎖定。請稍後重試。",
    },
    retry: "重新檢查",
    reauthenticate: "驗證另一個身份",
    signIn: "返回登入",
    home: "產品介紹",
    status: "私人工作區閘道",
  },
} satisfies Record<
  Language,
  Record<Exclude<PrivateAccessStatus, "verified">, { title: string; body: string }> &
    Record<"retry" | "reauthenticate" | "signIn" | "home" | "status", string>
>;

export function PrivateAccessGate({
  language,
  onLanguageChange,
  onRetry,
  status,
}: {
  language: Language;
  onLanguageChange: () => void;
  onRetry: () => void;
  status: Exclude<PrivateAccessStatus, "verified">;
}) {
  const copy = gateCopy[language];
  const stateCopy = copy[status];

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

      <main className={`private-gate-card is-${status}`} aria-labelledby="private-gate-title">
        <span className="private-gate-icon" aria-hidden="true">
          {status === "checking" ? (
            <LoadingIcon />
          ) : status === "denied" ? (
            <LockIcon />
          ) : (
            <ShieldIcon />
          )}
        </span>
        <p className="private-gate-label">{copy.status}</p>
        <h1 id="private-gate-title">{stateCopy.title}</h1>
        <p role="status" aria-live="polite">
          {stateCopy.body}
        </p>
        {status === "checking" ? (
          <span className="private-gate-progress" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <div className="private-gate-actions">
            {status === "unavailable" ? (
              <button type="button" onClick={onRetry}>
                <ShieldIcon />
                {copy.retry}
              </button>
            ) : null}
            {status === "denied" ? (
              <a className="is-primary" href="/cdn-cgi/access/logout">
                {copy.reauthenticate}
                <ArrowIcon />
              </a>
            ) : null}
            {status === "signed-out" ? (
              <a className="is-primary" href="/login">
                {copy.signIn}
                <ArrowIcon />
              </a>
            ) : null}
            <a href="/">{copy.home}</a>
          </div>
        )}
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

function LoadingIcon() {
  return (
    <IconBase>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 5v7h-7" />
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
