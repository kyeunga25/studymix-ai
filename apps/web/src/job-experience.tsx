import { useState, type ReactNode } from "react";
import type { JobStatus, PublicJob } from "@studymix/contracts";
import type { Language } from "./legal-content";
import type { JobApiError } from "./job-api";
import { isPendingJob, type ActiveJobAction } from "./job-lifecycle";

const copy = {
  en: {
    aiNotice: "AI output may not preserve every musical detail. Review both candidates carefully.",
    candidate: "Candidate",
    cancel: "Cancel local job",
    cancelledHeading: "Local job cancelled",
    cancelledStatus: "The local job ended normally, and its reserved beta credits were released.",
    cancelling: "Cancelling local job…",
    completed: "Completed",
    deletePrivateData: "Delete this private mix",
    deletingPrivateData: "Deleting private audio…",
    download: "Download candidate",
    errorHeading: "We could not finish this study mix",
    errorLead: "Your source remains private. Follow the guidance below before trying again.",
    expires: "Expires",
    failedStatus: "Generation failed",
    loadingOutputs: "Preparing private playback links…",
    pendingHeading: "Creating your study mix",
    pendingLead:
      "The service is preparing two candidates. You can keep using this page; no fixed completion time is promised.",
    prefer: "I prefer this version",
    preferred: "Preferred",
    preset: "Preset",
    privateNotice: "Results are private and are not published on a public page.",
    refreshOutputs: "Refresh private playback links",
    refreshingOutputs: "Refreshing private playback links…",
    resultHeading: "Your study mix is ready",
    resultLead: "Compare both candidates before choosing the version you prefer.",
    retry: "Try again",
    retrying: "Trying again…",
    retryGuidance: "Retry is available. If it fails again, start a new mix or try later.",
    returnToUpload: "Back to private upload",
    source: "Source",
    startAnother: "Start another mix",
    status: "Status",
    steps: ["Request checked", "Job queued", "Candidates generating", "Results prepared"],
    unavailableGuidance:
      "Retry is unavailable for this error. Start a new mix and review the input.",
  },
  "zh-HK": {
    aiNotice: "AI 輸出未必能保留每個音樂細節，請仔細比較兩個候選版本。",
    candidate: "候選版本",
    cancel: "取消本機工作",
    cancelledHeading: "本機工作已取消",
    cancelledStatus: "本機工作已正常終止，已預留的 Beta 額度亦已釋放。",
    cancelling: "正在取消本機工作……",
    completed: "已完成",
    deletePrivateData: "刪除這個私人 Mix",
    deletingPrivateData: "正在刪除私人音訊……",
    download: "下載候選版本",
    errorHeading: "未能完成這個 Study Mix",
    errorLead: "你的來源仍保持私密。請按以下指引處理後再試。",
    expires: "到期時間",
    failedStatus: "生成失敗",
    loadingOutputs: "正在準備私人播放連結……",
    pendingHeading: "正在製作你的 Study Mix",
    pendingLead: "服務正在準備兩個候選版本。你可以繼續使用此頁；系統不承諾固定完成時間。",
    prefer: "我較喜歡此版本",
    preferred: "已選擇",
    preset: "風格",
    privateNotice: "結果保持私密，不會發佈到公開結果頁。",
    refreshOutputs: "重新整理私人播放連結",
    refreshingOutputs: "正在重新整理私人播放連結……",
    resultHeading: "你的 Study Mix 已準備好",
    resultLead: "比較兩個候選版本，然後選擇你較喜歡的一個。",
    retry: "再試一次",
    retrying: "正在重試……",
    retryGuidance: "此錯誤可以重試；若再次失敗，請建立新的 Mix 或稍後再試。",
    returnToUpload: "返回私人上載",
    source: "來源",
    startAnother: "建立另一個 Mix",
    status: "狀態",
    steps: ["已檢查要求", "工作已排隊", "正在生成候選版本", "正在準備結果"],
    unavailableGuidance: "此錯誤不能直接重試。請建立新的 Mix，並重新檢查輸入。",
  },
} satisfies Record<Language, Record<string, string | readonly string[]>>;

const safeErrorCopy = {
  en: {
    access:
      "Private beta access is not available for this account. Sign in with an approved account before continuing.",
    credits:
      "There are not enough beta credits to create this mix. Return to your private upload and try again after credits are updated.",
    invalid: "The request or service response was invalid. Review the input and try again.",
    internal:
      "The private service had a temporary problem. Retry if the option is available, or try again later.",
    legal: "Accept the current legal documents before creating a study mix.",
    limited: "The generation limit has been reached. Wait before trying again.",
    network: "The private job service could not be reached. Check your connection and try again.",
    notFound: "The private upload or job is no longer available.",
    outputExpired:
      "One or more private playback files have expired, so this mix can no longer be played. Delete this private mix and create a new one if needed.",
    outputNotReady:
      "One or more private playback files are not ready yet. Try again to request a fresh pair of playback links.",
    provider: "The private generation service could not complete this study mix.",
    rights:
      "Confirm that you have the rights needed to use this audio before creating a study mix.",
    uploadExpired:
      "The private upload has expired. Return to the upload step, delete it, and choose the file again.",
    uploadNotConfirmed:
      "The private upload was not confirmed. Return to the upload step, delete it, and choose the file again.",
  },
  "zh-HK": {
    access: "此帳戶目前沒有私密 Beta 使用權。請以已獲批准的帳戶登入後再繼續。",
    credits: "目前沒有足夠 Beta 額度建立這個 Mix。請返回私人上載，待額度更新後再試。",
    invalid: "要求或服務回應無效，請檢查輸入後再試。",
    internal: "私人服務暫時出現問題。如畫面提供「再試一次」，可先重試；否則請稍後再試。",
    legal: "建立 Study Mix 前，請先接受現行法律文件。",
    limited: "已達生成上限，請稍後再試。",
    network: "未能連接私人工作服務，請檢查網絡後再試。",
    notFound: "私人上載或工作已不可用。",
    outputExpired:
      "一個或多個私人播放檔案已到期，因此這個 Mix 已無法播放。如有需要，請刪除這個私人 Mix 後再建立新的 Mix。",
    outputNotReady: "一個或多個私人播放檔案尚未準備好。請再試一次，以取得一對新的播放連結。",
    provider: "私人生成服務未能完成這個 Study Mix。",
    rights: "建立 Study Mix 前，請確認你擁有使用此音訊所需的權利。",
    uploadExpired: "私人上載已到期。請返回上載步驟，刪除該上載後重新選擇檔案。",
    uploadNotConfirmed: "私人上載未完成確認。請返回上載步驟，刪除該上載後重新選擇檔案。",
  },
} satisfies Record<Language, Record<string, string>>;

type JobExperienceProps = {
  activeAction: ActiveJobAction | null;
  canCancel: boolean;
  canRefreshOutputs: boolean;
  canReturnToUpload: boolean;
  candidateSources: readonly [string, string] | null;
  cancellationError: string | null;
  deletionError: string | null;
  error: JobApiError | null;
  filename: string;
  job: PublicJob | null;
  language: Language;
  onRetry: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onRefreshOutputs: () => void;
  onStartOver: () => void;
  presetName: string;
};

export function JobExperience(props: JobExperienceProps) {
  if (props.error !== null) {
    return <ErrorPage {...props} retryable={props.error.retryable} />;
  }
  if (props.job === null) {
    return null;
  }
  if (props.job.status === "completed") {
    return <ResultPage {...props} job={props.job} />;
  }
  if (
    props.job.status === "cancelled" ||
    props.job.status === "failed" ||
    props.job.status === "expired"
  ) {
    return <ErrorPage {...props} retryable={props.job.retryPermitted} />;
  }
  return <PendingPage {...props} job={props.job} />;
}

function PendingPage({
  activeAction,
  canCancel,
  cancellationError,
  job,
  language,
  onCancel,
}: JobExperienceProps & { job: PublicJob }) {
  const strings = copy[language];
  const steps = strings.steps as readonly string[];
  const currentStep = progressStep(job.status);
  const isBusy = activeAction !== null;

  return (
    <section className="job-page" aria-labelledby="job-page-title">
      <header className="job-heading">
        <div>
          <h1 id="job-page-title">{strings.pendingHeading}</h1>
          <p>{strings.pendingLead}</p>
        </div>
        <div className="job-state-card is-pending" role="status" aria-live="polite">
          <SpinnerIcon />
          <span>{statusLabel(job.status, language)}</span>
        </div>
      </header>
      <ol className="progress-list">
        {steps.map((step, index) => (
          <li
            className={
              index < currentStep ? "is-complete" : index === currentStep ? "is-current" : ""
            }
            key={step}
          >
            <span aria-hidden="true">{index < currentStep ? <CheckIcon /> : index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>
      <JobSummary {...{ job, language }} />
      {cancellationError === null ? null : (
        <p className="form-status is-error" role="alert">
          {cancellationError}
        </p>
      )}
      {canCancel ? (
        <div className="error-actions">
          <button className="secondary-action" disabled={isBusy} type="button" onClick={onCancel}>
            {activeAction === "cancel" ? strings.cancelling : strings.cancel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ResultPage({
  activeAction,
  canRefreshOutputs,
  candidateSources,
  deletionError,
  filename,
  job,
  language,
  onDelete,
  onRefreshOutputs,
  presetName,
}: JobExperienceProps & { job: PublicJob }) {
  const strings = copy[language];
  const isBusy = activeAction !== null;
  const [preferredCandidate, setPreferredCandidate] = useState<number | null>(null);

  return (
    <section className="job-page" aria-labelledby="job-page-title">
      <header className="job-heading result-heading">
        <div>
          <h1 id="job-page-title">{strings.resultHeading}</h1>
          <p>{strings.resultLead}</p>
        </div>
        <div className="job-state-card is-complete" role="status">
          <CheckCircleIcon />
          <span>{strings.completed}</span>
        </div>
      </header>
      <div className="result-summary">
        <SummaryItem label={strings.source as string}>{filename}</SummaryItem>
        <SummaryItem label={strings.preset as string}>{presetName}</SummaryItem>
        <SummaryItem label={strings.status as string}>{strings.completed}</SummaryItem>
        <SummaryItem label={strings.expires as string}>
          {formatDate(job.expiresAt, language)}
        </SummaryItem>
      </div>
      {candidateSources === null ? (
        <p className="form-status is-ready" role="status">
          {strings.loadingOutputs}
        </p>
      ) : null}
      <div className="candidate-list">
        {job.outputs.map((output) => {
          const candidateNumber = output.candidateIndex + 1;
          const isPreferred = preferredCandidate === output.candidateIndex;
          return (
            <article
              className={`candidate-card${isPreferred ? " is-preferred" : ""}`}
              key={output.outputId}
            >
              <div className="candidate-heading">
                <h2>
                  {strings.candidate} {candidateNumber}
                </h2>
                {isPreferred ? <span className="preferred-label">{strings.preferred}</span> : null}
              </div>
              {candidateSources === null ? null : (
                <>
                  <audio
                    aria-label={`${strings.candidate} ${candidateNumber}`}
                    controls
                    preload="metadata"
                    src={candidateSources[output.candidateIndex]}
                  />
                  <a
                    className="text-button candidate-download"
                    download={`studymix-candidate-${candidateNumber.toString()}.${audioExtension(output.contentType)}`}
                    href={candidateSources[output.candidateIndex]}
                  >
                    {strings.download}
                  </a>
                </>
              )}
              <label className="preference-control">
                <input
                  checked={isPreferred}
                  name="preferred-candidate"
                  type="radio"
                  onChange={() => setPreferredCandidate(output.candidateIndex)}
                />
                <span>{strings.prefer}</span>
              </label>
            </article>
          );
        })}
      </div>
      <div className="result-notices">
        <Notice icon={<InfoIcon />}>{strings.aiNotice}</Notice>
        <Notice icon={<LockIcon />}>{strings.privateNotice}</Notice>
      </div>
      {deletionError === null ? null : (
        <p className="form-status is-error" role="alert">
          {deletionError}
        </p>
      )}
      <div className="error-actions">
        {canRefreshOutputs ? (
          <button
            className="secondary-action"
            disabled={isBusy || candidateSources === null}
            type="button"
            onClick={onRefreshOutputs}
          >
            {candidateSources === null ? strings.refreshingOutputs : strings.refreshOutputs}
          </button>
        ) : null}
        <button className="secondary-action" disabled={isBusy} type="button" onClick={onDelete}>
          {activeAction === "delete" ? strings.deletingPrivateData : strings.deletePrivateData}
        </button>
      </div>
    </section>
  );
}

function ErrorPage({
  activeAction,
  canCancel,
  canReturnToUpload,
  cancellationError,
  deletionError,
  error,
  job,
  language,
  onCancel,
  onRetry,
  onDelete,
  onStartOver,
  retryable,
}: JobExperienceProps & { retryable: boolean }) {
  const strings = copy[language];
  const message = safeErrorMessage(error, job, language);
  const isBusy = activeAction !== null;
  const isCancelled = error === null && job?.status === "cancelled";
  const isPending = job !== null && isPendingJob(job.status);

  return (
    <section className="job-page error-page" aria-labelledby="job-error-title">
      <div
        className={`error-summary${isCancelled ? " is-cancelled" : ""}`}
        role={isCancelled ? "status" : "alert"}
        tabIndex={-1}
      >
        {isCancelled ? <CheckCircleIcon /> : <AlertIcon />}
        <div>
          <h1 id="job-error-title">
            {isCancelled ? strings.cancelledHeading : strings.errorHeading}
          </h1>
          <p>{isCancelled ? strings.cancelledStatus : strings.errorLead}</p>
          {isCancelled ? null : <p className="error-message">{message}</p>}
          {isCancelled ? null : (
            <p>{retryable ? strings.retryGuidance : strings.unavailableGuidance}</p>
          )}
        </div>
      </div>
      <div className="error-actions">
        {retryable ? (
          <button className="primary-action" disabled={isBusy} type="button" onClick={onRetry}>
            {activeAction === "retry" ? strings.retrying : strings.retry}
          </button>
        ) : null}
        {job === null ? (
          <button
            className="secondary-action"
            disabled={isBusy}
            type="button"
            onClick={onStartOver}
          >
            {canReturnToUpload ? strings.returnToUpload : strings.startAnother}
          </button>
        ) : isPending ? (
          canCancel ? (
            <button className="secondary-action" disabled={isBusy} type="button" onClick={onCancel}>
              {activeAction === "cancel" ? strings.cancelling : strings.cancel}
            </button>
          ) : null
        ) : (
          <button className="secondary-action" disabled={isBusy} type="button" onClick={onDelete}>
            {activeAction === "delete" ? strings.deletingPrivateData : strings.deletePrivateData}
          </button>
        )}
      </div>
      {cancellationError === null ? null : (
        <p className="form-status is-error" role="alert">
          {cancellationError}
        </p>
      )}
      {deletionError === null ? null : (
        <p className="form-status is-error" role="alert">
          {deletionError}
        </p>
      )}
    </section>
  );
}

function JobSummary({ job, language }: { job: PublicJob; language: Language }) {
  const strings = copy[language];
  return (
    <div className="pending-summary">
      <SummaryItem label={strings.status as string}>
        {statusLabel(job.status, language)}
      </SummaryItem>
      <SummaryItem label={strings.expires as string}>
        {formatDate(job.expiresAt, language)}
      </SummaryItem>
    </div>
  );
}

function SummaryItem({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="job-summary-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function Notice({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <div className="result-notice">
      <span aria-hidden="true">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

function progressStep(status: JobStatus): number {
  switch (status) {
    case "created":
    case "validating":
      return 0;
    case "queued":
      return 1;
    case "generating":
      return 2;
    case "processing_output":
      return 3;
    case "cancelled":
    case "completed":
    case "expired":
    case "failed":
      return 4;
  }
}

function statusLabel(status: JobStatus, language: Language): string {
  const labels: Record<Language, Record<JobStatus, string>> = {
    en: {
      cancelled: "Cancelled",
      completed: "Completed",
      created: "Request received",
      expired: "Expired",
      failed: "Failed",
      generating: "Generating candidates",
      processing_output: "Preparing results",
      queued: "Queued",
      validating: "Checking request",
    },
    "zh-HK": {
      cancelled: "已取消",
      completed: "已完成",
      created: "已收到要求",
      expired: "已到期",
      failed: "失敗",
      generating: "正在生成候選版本",
      processing_output: "正在準備結果",
      queued: "已排隊",
      validating: "正在檢查要求",
    },
  };
  return labels[language][status];
}

function formatDate(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function assertUnhandledJobApiErrorCode(code: never): never {
  void code;
  throw new Error("Unhandled private job error code.");
}

export function safeErrorMessage(
  error: JobApiError | null,
  job: PublicJob | null,
  language: Language,
): string {
  const messages = safeErrorCopy[language];
  if (error !== null) {
    const code = error.code;
    switch (code) {
      case "UNAUTHORIZED":
      case "FORBIDDEN":
      case "ENTITLEMENT_REQUIRED":
        return messages.access;
      case "INSUFFICIENT_CREDITS":
        return messages.credits;
      case "LEGAL_ACCEPTANCE_REQUIRED":
      case "LEGAL_DOCUMENT_VERSION_MISMATCH":
        return messages.legal;
      case "RATE_LIMITED":
        return messages.limited;
      case "NETWORK_ERROR":
        return messages.network;
      case "NOT_FOUND":
        return messages.notFound;
      case "OUTPUT_EXPIRED":
        return messages.outputExpired;
      case "OUTPUT_NOT_READY":
        return messages.outputNotReady;
      case "PROVIDER_UNAVAILABLE":
        return messages.provider;
      case "RIGHTS_DECLARATION_REQUIRED":
        return messages.rights;
      case "UPLOAD_EXPIRED":
        return messages.uploadExpired;
      case "UPLOAD_NOT_CONFIRMED":
        return messages.uploadNotConfirmed;
      case "INTERNAL_ERROR":
        return messages.internal;
      case "INVALID_RESPONSE":
      case "VALIDATION_ERROR":
      case "CONFLICT":
      case "ILLEGAL_JOB_TRANSITION":
      case "PRESET_NOT_FOUND":
        return messages.invalid;
      default:
        return assertUnhandledJobApiErrorCode(code);
    }
  }
  if (
    job?.errorCode === "PROVIDER_WORKFLOW_FAILED" ||
    job?.errorCode === "MOCK_WORKFLOW_FAILED" ||
    job?.errorCode === "PROVIDER_UNAVAILABLE"
  ) {
    return messages.provider;
  }
  return copy[language].failedStatus as string;
}

function audioExtension(contentType: string | null): string {
  switch (contentType) {
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/ogg":
      return "ogg";
    case null:
    default:
      return "audio";
  }
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function CheckIcon() {
  return (
    <IconBase>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

function CheckCircleIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </IconBase>
  );
}

function SpinnerIcon() {
  return (
    <IconBase>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </IconBase>
  );
}

function AlertIcon() {
  return (
    <IconBase>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.5v.1" />
    </IconBase>
  );
}

function InfoIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.1" />
    </IconBase>
  );
}

function LockIcon() {
  return (
    <IconBase>
      <rect height="10" rx="2" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </IconBase>
  );
}
