import type { JobStatus, PublicJob, PublicJobSummary } from "@studymix/contracts";
import { useEffect, useRef, useState } from "react";
import { getJob, getRecentJobs, toJobApiError } from "./job-api";
import type { Language } from "./legal-content";
import { presetOptions } from "./preset-presentation";

const copy = {
  en: {
    description: "Up to 10 jobs. Open one to load its private details.",
    draftBlocked: "Finish or remove the selected upload before opening another mix.",
    empty: "No recent mixes yet.",
    expires: "Private until",
    loading: "Loading recent private mixes…",
    open: "Open private mix",
    opening: "Opening private mix…",
    openMissing: "That mix is no longer available. Refreshing history…",
    openUnavailable: "That mix could not be opened. Retry from this list.",
    refresh: "Refresh history",
    refreshing: "Refreshing recent private mixes…",
    title: "Recent private mixes",
    unavailable: "Recent mixes are unavailable. Your current work is unchanged.",
    updated: "Updated",
  },
  "zh-HK": {
    description: "顯示此擁有人最近最多 10 個工作；開啟後才讀取私人詳情。",
    draftBlocked: "請先完成或移除所選上載，然後開啟另一個 Mix。",
    empty: "此工作區暫時沒有私人 Mix。",
    expires: "保持私密至",
    loading: "正在讀取最近的私人 Mix……",
    open: "開啟私人 Mix",
    opening: "正在開啟私人 Mix……",
    openMissing: "這個 Mix 已不再可用，正在重新整理紀錄……",
    openUnavailable: "未能開啟這個 Mix，請從紀錄重試。",
    refresh: "重新整理紀錄",
    refreshing: "正在重新整理最近的私人 Mix……",
    title: "最近的私人 Mix",
    unavailable: "最近工作暫時不可用；目前工作不受影響。",
    updated: "更新時間",
  },
} satisfies Record<Language, Record<string, string>>;

type RecentJobHistoryState = {
  jobs: readonly PublicJobSummary[];
  status: "loading" | "ready" | "refreshing" | "unavailable";
};

type RecentJobHistoryNotice = "missing" | "unavailable" | null;

const statusLabels: Readonly<Record<Language, Readonly<Record<JobStatus, string>>>> = {
  en: {
    cancelled: "Cancelled",
    completed: "Completed",
    created: "Created",
    expired: "Expired",
    failed: "Failed",
    generating: "Generating",
    processing_output: "Preparing results",
    queued: "Queued",
    validating: "Checking",
  },
  "zh-HK": {
    cancelled: "已取消",
    completed: "已完成",
    created: "已建立",
    expired: "已到期",
    failed: "失敗",
    generating: "正在生成",
    processing_output: "正在準備結果",
    queued: "等待處理",
    validating: "正在核對",
  },
};

function formatPrivateJobTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-HK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: JobStatus): "active" | "complete" | "terminal" {
  if (status === "completed") {
    return "complete";
  }
  if (status === "failed" || status === "expired" || status === "cancelled") {
    return "terminal";
  }
  return "active";
}

export type RecentJobHistoryPanelProps = {
  canOpen: boolean;
  language: Language;
  onOpen: (job: PublicJob) => void;
};

export function RecentJobHistoryPanel({ canOpen, language, onOpen }: RecentJobHistoryPanelProps) {
  const [state, setState] = useState<RecentJobHistoryState>({ jobs: [], status: "loading" });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [notice, setNotice] = useState<RecentJobHistoryNotice>(null);
  const [openingJobId, setOpeningJobId] = useState<string | null>(null);
  const openAbortController = useRef<AbortController | null>(null);
  const strings = copy[language];
  const busy = state.status === "loading" || state.status === "refreshing";
  const stateMessage =
    state.status === "loading"
      ? strings.loading
      : state.status === "refreshing"
        ? strings.refreshing
        : state.status === "unavailable"
          ? strings.unavailable
          : state.jobs.length === 0
            ? strings.empty
            : null;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setState((current) => ({
        jobs: current.jobs,
        status: current.jobs.length === 0 ? "loading" : "refreshing",
      }));
      void getRecentJobs(controller.signal)
        .then((history) => {
          if (!controller.signal.aborted) {
            setState({ jobs: history.jobs, status: "ready" });
          }
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setState((current) => ({ jobs: current.jobs, status: "unavailable" }));
          }
        });
    }, 0);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshVersion]);

  useEffect(
    () => () => {
      openAbortController.current?.abort();
      openAbortController.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!canOpen) {
      openAbortController.current?.abort();
      openAbortController.current = null;
      setOpeningJobId(null);
    }
  }, [canOpen]);

  const refresh = () => {
    if (openingJobId !== null) {
      return;
    }
    setNotice(null);
    setRefreshVersion((version) => version + 1);
  };

  const open = async (summary: PublicJobSummary) => {
    if (!canOpen || openingJobId !== null) {
      return;
    }
    openAbortController.current?.abort();
    const controller = new AbortController();
    openAbortController.current = controller;
    setOpeningJobId(summary.jobId);
    setNotice(null);
    try {
      const job = await getJob(summary.jobId, controller.signal);
      if (openAbortController.current === controller && !controller.signal.aborted) {
        onOpen(job);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (openAbortController.current !== controller) {
        return;
      }
      if (toJobApiError(error).code === "NOT_FOUND") {
        setNotice("missing");
        setRefreshVersion((version) => version + 1);
      } else {
        setNotice("unavailable");
      }
    } finally {
      if (openAbortController.current === controller) {
        openAbortController.current = null;
        setOpeningJobId(null);
      }
    }
  };

  return (
    <section className="job-history-panel" aria-busy={busy} aria-labelledby="job-history-title">
      <div className="job-history-heading">
        <div>
          <h2 id="job-history-title">{strings.title}</h2>
          <p>{strings.description}</p>
        </div>
        <button
          className="text-button history-refresh-button"
          disabled={busy || openingJobId !== null}
          type="button"
          onClick={refresh}
        >
          {strings.refresh}
        </button>
      </div>

      {notice !== null ? (
        <p className="job-history-message is-warning" role="alert">
          {notice === "missing" ? strings.openMissing : strings.openUnavailable}
        </p>
      ) : null}
      {!canOpen && state.jobs.length > 0 ? (
        <p className="job-history-message">{strings.draftBlocked}</p>
      ) : null}
      {stateMessage !== null ? (
        <p
          className={`job-history-message${state.status === "unavailable" ? " is-warning" : ""}`}
          aria-live="polite"
          role={state.status === "unavailable" ? "alert" : undefined}
        >
          {stateMessage}
        </p>
      ) : null}

      {state.jobs.length > 0 ? (
        <ul className="job-history-list">
          {state.jobs.map((job) => {
            const presetName =
              presetOptions.find((preset) => preset.id === job.preset.id)?.displayName[language] ??
              job.preset.id;
            const opening = openingJobId === job.jobId;
            return (
              <li className="job-history-item" key={job.jobId}>
                <div className="job-history-item-heading">
                  <strong>{presetName}</strong>
                  <span className={`job-history-status is-${statusTone(job.status)}`}>
                    {statusLabels[language][job.status]}
                  </span>
                </div>
                <dl className="job-history-times">
                  <div>
                    <dt>{strings.updated}</dt>
                    <dd>
                      <time dateTime={job.updatedAt}>
                        {formatPrivateJobTime(job.updatedAt, language)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{strings.expires}</dt>
                    <dd>
                      <time dateTime={job.expiresAt}>
                        {formatPrivateJobTime(job.expiresAt, language)}
                      </time>
                    </dd>
                  </div>
                </dl>
                <button
                  className="history-open-button"
                  aria-busy={opening}
                  disabled={!canOpen || openingJobId !== null}
                  type="button"
                  onClick={() => void open(job)}
                >
                  {opening ? strings.opening : strings.open}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
