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
  itemListLabel: string;
  items: Record<AccessReadinessItemId, { detail: string; label: string }>;
  note: string;
  states: Record<AccessReadinessState, string>;
  title: string;
};

const copy = {
  en: {
    badge: "Owner workspace active",
    description:
      "Read-only launch controls derived from this verified session. Provider and payment activation still require manual approval.",
    itemListLabel: "Workspace capability status",
    items: {
      credits: { detail: "Private usage ledger.", label: "Beta credits" },
      payments: { detail: "Checkout and subscriptions.", label: "Payments" },
      realAi: { detail: "External provider and launch flag.", label: "Real AI" },
      retention: { detail: "Scheduled retention cleanup.", label: "Automatic deletion" },
      synthetic: { detail: "No paid AI provider.", label: "Synthetic workflow" },
      upload: { detail: "Direct transfer to private storage.", label: "Private upload" },
    },
    note: "API keys and payment details are never entered in this browser panel.",
    states: {
      "approved-disabled": "Approved · feature off",
      available: "Available",
      local: "Local only",
      review: "Review required",
      unavailable: "Unavailable",
    },
    title: "Workspace readiness",
  },
  "zh-HK": {
    badge: "擁有人工作區已啟用",
    description: "根據此已驗證工作階段顯示的唯讀上線控制。供應商及付款功能仍須經人工審批才可啟用。",
    itemListLabel: "工作區能力狀態",
    items: {
      credits: { detail: "私人使用額度紀錄。", label: "測試額度" },
      payments: { detail: "結帳及訂閱。", label: "付款" },
      realAi: { detail: "外部供應商及上線旗標。", label: "真實 AI" },
      retention: { detail: "排程保留期清理。", label: "自動刪除" },
      synthetic: { detail: "不使用付費 AI 供應商。", label: "合成工作流程" },
      upload: { detail: "直接傳送至私人儲存空間。", label: "私人上載" },
    },
    note: "此瀏覽器面板不會要求輸入 API key 或付款資料。",
    states: {
      "approved-disabled": "已核准 · 功能關閉",
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
      <ul className="access-readiness-grid" aria-label={strings.itemListLabel}>
        {readiness.map((item) => (
          <li className="access-readiness-item" key={item.id}>
            <div className="access-readiness-item-heading">
              <strong>{strings.items[item.id].label}</strong>
              <span className={`access-readiness-state is-${item.state}`}>
                {strings.states[item.state]}
              </span>
            </div>
            <p>{strings.items[item.id].detail}</p>
          </li>
        ))}
      </ul>
      <p className="access-readiness-note">{strings.note}</p>
    </section>
  );
}
