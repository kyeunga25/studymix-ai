import { useState, type ReactNode } from "react";
import type { JobStatus, PublicJob } from "@studymix/contracts";
import type { Language } from "./legal-content";
import type { JobApiError } from "./job-api";

const terminalStatuses: readonly JobStatus[] = ["cancelled", "completed", "expired", "failed"];

const copy = {
  en: {
    aiNotice: "AI output may not preserve every musical detail. Review both candidates carefully.",
    candidate: "Candidate",
    completed: "Completed",
    deletePrivateData: "Delete this private mix",
    deletingPrivateData: "Deleting private audio…",
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
    resultHeading: "Your study mix is ready",
    resultLead: "Compare both candidates before choosing the version you prefer.",
    retry: "Try again",
    retryGuidance: "Retry is available. If it fails again, start a new mix or try later.",
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
    completed: "已完成",
    deletePrivateData: "刪除這個私人 Mix",
    deletingPrivateData: "正在刪除私人音訊……",
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
    resultHeading: "你的 Study Mix 已準備好",
    resultLead: "比較兩個候選版本，然後選擇你較喜歡的一個。",
    retry: "再試一次",
    retryGuidance: "此錯誤可以重試；若再次失敗，請建立新的 Mix 或稍後再試。",
    source: "來源",
    startAnother: "建立另一個 Mix",
    status: "狀態",
    steps: ["已檢查要求", "工作已排隊", "正在生成候選版本", "正在準備結果"],
    unavailableGuidance: "此錯誤不能直接重試。請建立新的 Mix，並重新檢查輸入。",
  },
} satisfies Record<Language, Record<string, string | readonly string[]>>;

const pendingStatuses: readonly JobStatus[] = [
  "created",
  "validating",
  "queued",
  "generating",
  "processing_output",
];

export function isPendingJob(status: JobStatus): boolean {
  return pendingStatuses.includes(status);
}

export function isTerminalJob(status: JobStatus): boolean {
  return terminalStatuses.includes(status);
}

type JobExperienceProps = {
  candidateSources: readonly [string, string] | null;
  deletionError: string | null;
  error: JobApiError | null;
  filename: string;
  isRetrying: boolean;
  job: PublicJob | null;
  language: Language;
  onRetry: () => void;
  onDelete: () => void;
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
    props.job.status === "failed" ||
    props.job.status === "expired" ||
    props.job.status === "cancelled"
  ) {
    return <ErrorPage {...props} retryable={props.job.retryPermitted} />;
  }
  return <PendingPage {...props} job={props.job} />;
}

function PendingPage({ job, language, onStartOver }: JobExperienceProps & { job: PublicJob }) {
  const strings = copy[language];
  const steps = strings.steps as readonly string[];
  const currentStep = progressStep(job.status);

  return (
    <section className="job-page" aria-labelledby="job-page-title">
      <button className="text-button" type="button" onClick={onStartOver}>
        <ArrowLeftIcon />
        {strings.startAnother}
      </button>
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
    </section>
  );
}

function ResultPage({
  candidateSources,
  deletionError,
  filename,
  job,
  language,
  isRetrying,
  onDelete,
  presetName,
}: JobExperienceProps & { job: PublicJob }) {
  const strings = copy[language];
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
                <audio
                  aria-label={`${strings.candidate} ${candidateNumber}`}
                  controls
                  preload="metadata"
                  src={candidateSources[output.candidateIndex]}
                />
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
        <button className="secondary-action" disabled={isRetrying} type="button" onClick={onDelete}>
          {isRetrying ? strings.deletingPrivateData : strings.deletePrivateData}
        </button>
      </div>
    </section>
  );
}

function ErrorPage({
  deletionError,
  error,
  isRetrying,
  job,
  language,
  onRetry,
  onDelete,
  onStartOver,
  retryable,
}: JobExperienceProps & { retryable: boolean }) {
  const strings = copy[language];
  const message = error?.message ?? job?.errorCode ?? (strings.failedStatus as string);

  return (
    <section className="job-page error-page" aria-labelledby="job-error-title">
      <div className="error-summary" role="alert" tabIndex={-1}>
        <AlertIcon />
        <div>
          <h1 id="job-error-title">{strings.errorHeading}</h1>
          <p>{strings.errorLead}</p>
          <p className="error-message">{message}</p>
          <p>{retryable ? strings.retryGuidance : strings.unavailableGuidance}</p>
        </div>
      </div>
      <div className="error-actions">
        {retryable ? (
          <button className="primary-action" disabled={isRetrying} type="button" onClick={onRetry}>
            {strings.retry}
          </button>
        ) : null}
        {job === null ? (
          <button className="secondary-action" type="button" onClick={onStartOver}>
            {strings.startAnother}
          </button>
        ) : (
          <button
            className="secondary-action"
            disabled={isRetrying}
            type="button"
            onClick={onDelete}
          >
            {isRetrying ? strings.deletingPrivateData : strings.deletePrivateData}
          </button>
        )}
      </div>
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

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <IconBase>
      <path d="m15 18-6-6 6-6M9 12h11" />
    </IconBase>
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
