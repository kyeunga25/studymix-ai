import type { PrivateSession } from "./auth-session";
import type { Language } from "./legal-content";
import { ShieldIcon } from "./site-chrome";

export type AccessReadinessItemId =
  "upload" | "synthetic" | "realAi" | "credits" | "retention" | "payments";

export type AccessReadinessState =
  "available" | "local" | "review" | "approved-disabled" | "unavailable";

export type AccessReadinessItem = {
  id: AccessReadinessItemId;
  state: AccessReadinessState;
};

const itemOrder = [
  "upload",
  "synthetic",
  "realAi",
  "credits",
  "retention",
  "payments",
] as const satisfies readonly AccessReadinessItemId[];

export function buildAccessReadiness(session: PrivateSession): readonly AccessReadinessItem[] {
  const states = {
    credits: session.capabilities.creditAccounting ? "available" : "unavailable",
    payments:
      session.authorization.paymentStatus === "review_required"
        ? "review"
        : session.authorization.paymentStatus === "approved"
          ? "approved-disabled"
          : "unavailable",
    realAi: session.capabilities.realGeneration
      ? "available"
      : session.authorization.realProviderStatus === "review_required"
        ? "review"
        : session.authorization.realProviderStatus === "approved"
          ? "approved-disabled"
          : "unavailable",
    retention: session.capabilities.retentionCleanup ? "available" : "unavailable",
    synthetic: session.capabilities.localAiHarness
      ? "local"
      : session.capabilities.mockGeneration
        ? "available"
        : "unavailable",
    upload: session.capabilities.localAiHarness
      ? "local"
      : session.capabilities.privateAudioUpload
        ? "available"
        : "unavailable",
  } as const satisfies Record<AccessReadinessItemId, AccessReadinessState>;

  return itemOrder.map((id) => ({ id, state: states[id] }));
}

type AccessReadinessCopy = {
  badge: string;
  description: string;
  items: Record<AccessReadinessItemId, string>;
  note: string;
  states: Record<AccessReadinessState, string>;
  title: string;
};

const copy = {
  en: {
    badge: "Owner workspace active",
    description:
      "Read-only status from this verified session. AI and payments still require manual approval.",
    items: {
      credits: "Beta credits",
      payments: "Payments",
      realAi: "Real AI",
      retention: "Automatic deletion",
      synthetic: "Synthetic workflow",
      upload: "Private upload",
    },
    note: "Never enter API keys or payment details here.",
    states: {
      "approved-disabled": "Approved · off",
      available: "Available",
      local: "Local only",
      review: "Review required",
      unavailable: "Unavailable",
    },
    title: "Workspace readiness",
  },
  "zh-HK": {
    badge: "擁有人工作區已啟用",
    description: "此唯讀狀態來自已驗證工作階段；AI 及付款仍須人工審批。",
    items: {
      credits: "測試額度",
      payments: "付款",
      realAi: "真實 AI",
      retention: "自動刪除",
      synthetic: "合成工作流程",
      upload: "私人上載",
    },
    note: "切勿在此輸入 API key 或付款資料。",
    states: {
      "approved-disabled": "已核准 · 關閉",
      available: "可用",
      local: "只限本機",
      review: "需要審批",
      unavailable: "不可用",
    },
    title: "工作區準備狀態",
  },
} as const satisfies Record<Language, AccessReadinessCopy>;

export function AccessReadinessPanel({
  language,
  session,
}: {
  language: Language;
  session: PrivateSession;
}) {
  const strings = copy[language];
  const readiness = buildAccessReadiness(session);

  return (
    <section className="access-readiness" aria-labelledby="access-readiness-title" role="status">
      <div className="access-readiness-heading">
        <div>
          <h2 id="access-readiness-title">{strings.title}</h2>
          <p>{strings.description}</p>
        </div>
        <span className="access-readiness-badge">
          <ShieldIcon />
          {strings.badge}
        </span>
      </div>
      <ul className="access-readiness-grid">
        {readiness.map((item) => (
          <li className="access-readiness-item" key={item.id}>
            <div className="access-readiness-item-heading">
              <strong>{strings.items[item.id]}</strong>
              <span className={`access-readiness-state is-${item.state}`}>
                {strings.states[item.state]}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="access-readiness-note">{strings.note}</p>
    </section>
  );
}
