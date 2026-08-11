import type { LegalDocumentId } from "@studymix/contracts";
import { useEffect, useState } from "react";
import { legalPageContent, type Language } from "./legal-content";
import { loadPublicLegalManifest } from "./legal-manifest-api";
import { preloadLoginRoute } from "./route-loaders";
import { BrandMark, GlobeIcon, ShieldIcon, SiteFooter } from "./site-chrome";
import "./styles.css";

type LegalContactState =
  { email: null; status: "loading" | "unavailable" } | { email: string; status: "ready" };

export function PublicLegalExperience({ documentId }: { documentId: LegalDocumentId }) {
  const [language, setLanguage] = useState<Language>("zh-HK");
  const [legalContactState, setLegalContactState] = useState<LegalContactState>({
    email: null,
    status: "loading",
  });

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${legalPageContent[documentId].title[language]} | StudyMix AI`;
  }, [documentId, language]);

  useEffect(() => {
    const controller = new AbortController();
    const loadLegalManifest = async () => {
      try {
        const manifest = await loadPublicLegalManifest(controller.signal);
        if (!controller.signal.aborted) {
          setLegalContactState({ email: manifest.contactEmail, status: "ready" });
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLegalContactState({ email: null, status: "unavailable" });
        }
      }
    };

    void loadLegalManifest();
    return () => controller.abort();
  }, []);

  return (
    <div className="app-shell public-legal-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <div className="header-actions">
          <button
            className="language-switch"
            type="button"
            onClick={() => setLanguage(language === "en" ? "zh-HK" : "en")}
          >
            <GlobeIcon />
            <span>{language === "en" ? "繁體中文" : "EN"}</span>
          </button>
          <a
            className="logout-link"
            href="/login"
            onFocus={preloadLoginRoute}
            onMouseEnter={preloadLoginRoute}
          >
            {language === "en" ? "Invited tester sign in" : "受邀測試者登入"}
          </a>
        </div>
      </header>
      <main>
        <LegalDocumentPage
          contactState={legalContactState}
          documentId={documentId}
          language={language}
        />
        <SiteFooter language={language} />
      </main>
    </div>
  );
}

function LegalDocumentPage({
  contactState,
  documentId,
  language,
}: {
  contactState: LegalContactState;
  documentId: LegalDocumentId;
  language: Language;
}) {
  const document = legalPageContent[documentId];
  const pageCopy =
    language === "en"
      ? {
          contact: "Contact for privacy, rights, security, and legal requests",
          contactLoading: "Checking the configured public contact…",
          contactUnavailable:
            "The production contact is temporarily unavailable. Public launch and real generation remain blocked.",
          draft:
            "Pre-release legal draft · Audio upload and external AI generation are disabled · Target-market legal review is required before public launch",
          effective: "Document version",
        }
      : {
          contact: "私隱、權利、保安及法律要求聯絡方法",
          contactLoading: "正在核對已設定的公開聯絡方法……",
          contactUnavailable: "正式聯絡方法暫時不可用；公開推出及真實生成會維持關閉。",
          draft:
            "推出前法律草案 · 音訊上載及外部 AI 生成尚未啟用 · 公開推出前須完成目標市場法律審閱",
          effective: "文件版本",
        };

  return (
    <article className="legal-page">
      <div className="legal-status" role="note">
        <ShieldIcon />
        <span>{pageCopy.draft}</span>
      </div>
      <header className="legal-heading">
        <p>
          {pageCopy.effective}: {document.version}
        </p>
        <h1>{document.title[language]}</h1>
        <p>{document.introduction[language]}</p>
      </header>

      <div className="legal-sections">
        {document.sections.map((section) => (
          <section key={section.heading.en}>
            <h2>{section.heading[language]}</h2>
            {section.paragraphs?.[language].map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items === undefined ? null : (
              <ul>
                {section.items[language].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section className="legal-contact" aria-labelledby="legal-contact-heading">
        <h2 id="legal-contact-heading">{pageCopy.contact}</h2>
        {contactState.status === "ready" ? (
          <p>
            <a href={`mailto:${contactState.email}`}>{contactState.email}</a>
          </p>
        ) : (
          <p role="status" aria-live="polite">
            {contactState.status === "loading"
              ? pageCopy.contactLoading
              : pageCopy.contactUnavailable}
          </p>
        )}
      </section>
    </article>
  );
}
