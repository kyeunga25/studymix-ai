import type { ReactNode } from "react";
import type { Language } from "./legal-content";
import { preloadLegalRoute } from "./route-loaders";

export const legalLinkCopy = {
  en: {
    acceptableUse: "Acceptable Use Policy",
    aiOutputNotice: "AI and Output Notice",
    privacyNotice: "Privacy Notice",
    terms: "Terms of Use",
  },
  "zh-HK": {
    acceptableUse: "《可接受使用政策》",
    aiOutputNotice: "《AI 及輸出聲明》",
    privacyNotice: "《私隱通知》",
    terms: "《使用條款》",
  },
} satisfies Record<Language, Record<string, string>>;

export function SiteFooter({ language }: { language: Language }) {
  const links = legalLinkCopy[language];
  const footerText = language === "en" ? "Authenticated private beta" : "須登入的私密測試";

  return (
    <footer className="site-footer">
      <span>StudyMix AI · {footerText}</span>
      <nav aria-label={language === "en" ? "Legal documents" : "法律文件"}>
        <a href="/legal/terms" onFocus={preloadLegalRoute} onMouseEnter={preloadLegalRoute}>
          {links.terms}
        </a>
        <a href="/legal/privacy" onFocus={preloadLegalRoute} onMouseEnter={preloadLegalRoute}>
          {links.privacyNotice}
        </a>
        <a
          href="/legal/acceptable-use"
          onFocus={preloadLegalRoute}
          onMouseEnter={preloadLegalRoute}
        >
          {links.acceptableUse}
        </a>
        <a
          href="/legal/ai-output-notice"
          onFocus={preloadLegalRoute}
          onMouseEnter={preloadLegalRoute}
        >
          {links.aiOutputNotice}
        </a>
      </nav>
    </footer>
  );
}

export function BrandMark() {
  return (
    <IconBase viewBox="0 0 48 32">
      <path d="M3 16h5l3-10 5 21 5-22 5 20 4-14 4 10h5l3-7h3" />
    </IconBase>
  );
}

export function GlobeIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17M12 3c2.3 2.5 3.4 5.5 3.4 9S14.3 18.5 12 21c-2.3-2.5-3.4-5.5-3.4-9S9.7 5.5 12 3Z" />
    </IconBase>
  );
}

export function ShieldIcon() {
  return (
    <IconBase>
      <path d="M12 3 5 6v5c0 4.7 2.8 8.5 7 10 4.2-1.5 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </IconBase>
  );
}

function IconBase({ children, viewBox = "0 0 24 24" }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {children}
    </svg>
  );
}
