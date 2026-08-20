import {
  currentRightsDeclarationVersion,
  localSyntheticSourceFilename,
  type CreditSummary,
  type LocalAiScenario,
  type PresetId,
  type PublicJob,
  type PublicUpload,
} from "@studymix/contracts";
import type { AudioContainerFormat } from "@studymix/core";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { PrivateAccessGate } from "./PrivateAccessGate";
import { buildLoginRedirect, type PrivateAccessFailureStatus } from "./auth-navigation";
import { loadPrivateSession, type PrivateSession } from "./auth-session";
import { getCreditSummary } from "./credit-api";
import type { Language } from "./legal-content";
import {
  cancelJob,
  createJob,
  deleteJob,
  getJob,
  getPlayableOutputSource,
  JobApiError,
  toJobApiError,
} from "./job-api";
import { isPendingJob, type ActiveJobAction } from "./job-lifecycle";
import { privateAccessFailureEventName, readPrivateAccessFailureEvent } from "./private-api";
import {
  clearRememberedPrivateJob,
  readRememberedPrivateJobId,
  rememberPrivateJobId,
} from "./private-job-session";
import { presetOptions, PresetIcon } from "./preset-presentation";
import { loadJobExperience } from "./route-loaders";
import { BrandMark, GlobeIcon, legalLinkCopy, ShieldIcon, SiteFooter } from "./site-chrome";
import {
  clientAudioFileAccept,
  deleteUpload,
  inspectClientAudioFileStructure,
  UploadApiError,
  uploadAndConfirmAudio,
  validateClientAudioFile,
  type ClientAudioFileValidationIssue,
} from "./upload-api";
import "./auth.css";
import "./styles.css";

const LazyJobExperience = lazy(loadJobExperience);
const LazyRecentJobHistory = lazy(async () => {
  const module = await import("./recent-job-history");
  return { default: module.RecentJobHistoryPanel };
});
const LazyAccessReadiness = lazy(async () => {
  const module = await import("./access-readiness");
  return { default: module.AccessReadinessPanel };
});

const copy = {
  en: {
    languageName: "繁體中文",
    heading: "Turn your track into a study mix",
    lede: "Private AI audio restyling for recordings you own or are authorized to process.",
    uploadTitle: "Upload your audio",
    uploadHint: "MP3, WAV, M4A, AAC or OGG · up to 500 MB",
    drop: "Drag & drop your track here",
    or: "or",
    choose: "Choose file",
    replace: "Replace file",
    retention:
      "Audio upload is not active. Before activation, automatic deletion must be verified against the planned 72-hour source and 7-day output limits.",
    retentionActive:
      "Private upload testing is active. Delete the confirmed upload when finished; automatic retention cleanup is not active yet.",
    retentionManaged:
      "Private upload testing and automatic retention cleanup are active. You can also delete a completed private mix immediately.",
    presetTitle: "Choose a study mix style",
    rights:
      "I own this recording or have permission to upload, process, and create an adapted version of it.",
    summary: "Your selection",
    file: "File",
    preset: "Preset",
    candidates: "Candidates",
    generate: "Generate 2 candidates",
    upload: "Securely upload audio",
    uploading: "Uploading directly to private Cloudflare R2…",
    cancelUpload: "Cancel upload",
    cancellingUpload: "Cancelling the private upload and requesting cleanup…",
    uploadCancelled: "Private upload cancelled. Your file and selections remain ready to retry.",
    uploadSuccess: "Private upload confirmed. AI generation remains disabled.",
    uploadSuccessMock:
      "Private upload confirmed. You can now create two synthetic test candidates; external AI remains disabled.",
    uploadSuccessReal:
      "Private upload confirmed. You can now create two private AI candidates with the configured provider.",
    uploadFailed: "The private upload could not be confirmed. Check the file and try again.",
    deleteUpload: "Delete private upload",
    deletingUpload: "Deleting the private upload…",
    deleteFailed: "The private upload could not be deleted. Please retry.",
    deleteJobFailed: "The private mix could not be deleted. Please retry.",
    createMock: "Create 2 test candidates",
    creatingMock: "Creating two private synthetic test candidates…",
    createReal: "Generate 2 private AI candidates",
    creatingReal: "Creating two private AI candidates…",
    replaceBlocked: "Delete the confirmed private upload before choosing another file.",
    fileEmpty: "The selected audio file is empty. Choose a file that contains audio data.",
    fileInvalidName: "The filename is invalid. Rename the file and choose it again.",
    fileInvalidContent:
      "The selected file is not a recognized MP3, WAV, M4A, AAC, or OGG audio stream. Check the original file instead of only renaming its extension.",
    fileChecking: "Checking the audio structure on this device…",
    fileReady:
      "Recognized {format} audio structure. Confirm your rights and accept the current legal documents to continue.",
    fileRejected: "Audio structure not recognized.",
    fileVerified:
      "Recognized {format} audio structure on this device. This checks the format only, not full decodability, musical content, or rights.",
    fileMultiple: "Choose one audio file at a time.",
    fileTooLarge: "The selected audio file exceeds the 500 MB limit.",
    fileUnsupported: "Choose an MP3, WAV, M4A, AAC, or OGG audio file.",
    legalAcceptanceLead: "I accept the current",
    legalAnd: "and",
    privacyAcknowledgement: "and acknowledge the",
    disabled: "Add a file, confirm your rights, and accept the current legal documents.",
    ready: "Ready to record legal acceptance. Real generation remains disabled.",
    readyUpload: "Ready for private R2 upload. AI generation remains disabled.",
    readyUploadReal:
      "Ready for private R2 upload. Generation will share a short-lived source URL with the configured AI provider.",
    saving: "Recording the current legal document versions…",
    demo: "Acceptance saved. Audio upload and AI generation remain disabled until release gates pass.",
    legalSaveFailed:
      "Acceptance was not recorded. Check the legal configuration and try again; generation remains blocked.",
    privacy: "Private by default",
    privateSourceName: "Private audio source",
    privacyDetail:
      "This release keeps selected files in your browser; upload and external AI processing are disabled.",
    privacyDetailActive:
      "Audio goes directly to private R2 for upload testing and is not sent to an AI provider. Use the delete control when finished.",
    privacyDetailMock:
      "Audio stays in private R2. Test candidates are synthetic tones created without an external AI provider and remain private.",
    privacyDetailReal:
      "Audio stays in private R2. When you generate, a short-lived source URL is shared with the configured AI provider; validated outputs return to private R2.",
    credits: "Beta credits",
    creditsLoading: "Loading credits…",
    creditsUnavailable: "Credits unavailable",
    logout: "Sign out",
    localCancelFailed: "The local job could not be cancelled. It may already be complete.",
    localCreate: "Run local Workflow",
    localDisabled:
      "Confirm your rights and accept the current legal documents to prepare the synthetic source.",
    localPreparing: "Preparing the deterministic synthetic source in local R2…",
    localPrivacy:
      "This loopback-only harness uses a generated tone, local D1, local R2, and local Workflow simulation. It never uploads your audio or calls an external AI provider.",
    localReady:
      "Ready to prepare a deterministic synthetic source. External AI and real audio remain unused.",
    localScenario: "Local test scenario",
    localScenarioFailure: "Terminal failure",
    localScenarioRecovery: "Timeout recovery",
    localScenarioSuccess: "Successful result",
    localSourceDetail: "Generated WAV fixture · no user audio · no external provider",
    localSourceName: "Deterministic synthetic tone",
    localSourceTitle: "Local synthetic source",
    localUpload: "Prepare synthetic source",
    localUploadSuccess:
      "Synthetic source confirmed in local R2. You can now run the local Workflow.",
    jobRecoveryUnavailable:
      "This browser could not save the private job recovery reference. Keep this tab open and do not reload until you finish or delete the mix.",
    jobRecoveryRetry: "Retry saving recovery reference",
    jobRecoverySaved: "Private job recovery reference saved for this tab.",
    staleJobReferenceCleared:
      "The saved private job is no longer available. Its recovery reference was cleared; you can safely start a new mix.",
    staleJobReferenceClearRetry: "Retry clearing recovery reference",
    staleJobReferenceClearUnavailable:
      "The saved private job is no longer available, but this browser could not clear its recovery reference. Retry locally before reloading.",
    startOverReferenceClearRetry: "Retry clearing recovery reference and start another mix",
    startOverReferenceClearUnavailable:
      "This browser could not clear the saved recovery reference, so this job remains on screen. Retry locally before starting another mix.",
    restoringPrivateJob: "Restoring your private job…",
  },
  "zh-HK": {
    languageName: "EN",
    heading: "把你的音樂變成專注讀書 Mix",
    lede: "只處理你擁有或已獲授權的錄音，私密地生成適合學習的純音樂版本。",
    uploadTitle: "上載你的音訊",
    uploadHint: "支援 MP3、WAV、M4A、AAC 或 OGG · 最大 500 MB",
    drop: "把音訊拖放到這裡",
    or: "或",
    choose: "選擇檔案",
    replace: "更換檔案",
    retention:
      "音訊上載尚未啟用。啟用前，必須先驗證自動刪除能符合來源 72 小時及輸出 7 日的預定上限。",
    retentionActive: "私人上載測試已啟用。完成後請刪除已確認的上載；自動保留期清理尚未啟用。",
    retentionManaged: "私人上載測試及自動保留期清理已啟用；你亦可立即刪除已完成的私人 Mix。",
    presetTitle: "選擇你的 Study Mix 風格",
    rights: "我擁有此錄音，或已獲准上載、處理及製作其改編版本。",
    summary: "你的選擇",
    file: "檔案",
    preset: "風格",
    candidates: "候選版本",
    generate: "生成 2 個候選版本",
    upload: "安全上載音訊",
    uploading: "正在直接上載至私人 Cloudflare R2……",
    cancelUpload: "取消上載",
    cancellingUpload: "正在取消私人上載並要求清理……",
    uploadCancelled: "私人上載已取消；檔案及選項已保留，可再次嘗試。",
    uploadSuccess: "私人上載已確認；AI 生成仍然關閉。",
    uploadSuccessMock: "私人上載已確認；現可建立兩個合成測試候選版本，外部 AI 仍然關閉。",
    uploadSuccessReal: "私人上載已確認；現可使用已設定的供應商生成兩個私人 AI 候選版本。",
    uploadFailed: "未能確認私人上載。請檢查檔案後再試。",
    deleteUpload: "刪除私人上載",
    deletingUpload: "正在刪除私人上載……",
    deleteFailed: "未能刪除私人上載，請重試。",
    deleteJobFailed: "未能刪除私人 Mix，請重試。",
    createMock: "建立 2 個測試候選版本",
    creatingMock: "正在建立兩個私人合成測試候選版本……",
    createReal: "生成 2 個私人 AI 候選版本",
    creatingReal: "正在生成兩個私人 AI 候選版本……",
    replaceBlocked: "請先刪除已確認的私人上載，然後再選擇另一個檔案。",
    fileEmpty: "所選音訊檔案是空白的，請選擇含有音訊資料的檔案。",
    fileInvalidName: "檔案名稱無效，請重新命名後再選擇。",
    fileInvalidContent:
      "所選檔案不是可辨識的 MP3、WAV、M4A、AAC 或 OGG 音訊串流；請檢查原始檔案，不要只更改副檔名。",
    fileChecking: "正在此裝置核對音訊結構……",
    fileReady: "已辨識 {format} 音訊結構。請確認相關權利並接受現行法律文件，以繼續操作。",
    fileRejected: "未能辨識音訊結構。",
    fileVerified:
      "已在此裝置辨識 {format} 音訊結構。這只核對格式，不代表可完整解碼、一定是音樂或已具備相關權利。",
    fileMultiple: "每次只可選擇一個音訊檔案。",
    fileTooLarge: "所選音訊檔案超過 500 MB 上限。",
    fileUnsupported: "請選擇 MP3、WAV、M4A、AAC 或 OGG 音訊檔案。",
    legalAcceptanceLead: "我接受現行",
    legalAnd: "及",
    privacyAcknowledgement: "並確認已閱讀",
    disabled: "請加入檔案、確認權利，並接受現行法律文件。",
    ready: "可保存法律接受紀錄；真實生成仍然關閉。",
    readyUpload: "可上載至私人 R2；AI 生成仍然關閉。",
    readyUploadReal: "可上載至私人 R2；生成時會把短效來源連結交給已設定的 AI 供應商。",
    saving: "正在保存現行法律文件版本……",
    demo: "接受紀錄已保存。音訊上載及 AI 生成會維持關閉，直至全部上線關卡通過。",
    legalSaveFailed: "未能保存接受紀錄。請檢查法律設定後重試；生成功能仍被阻擋。",
    privacy: "預設保持私密",
    privateSourceName: "私人音訊來源",
    privacyDetail: "本版本只在瀏覽器處理所選檔案；上載及外部 AI 處理尚未啟用。",
    privacyDetailActive:
      "音訊會直接上載至私人 R2 作測試，不會送到 AI 供應商；完成後請使用刪除控制。",
    privacyDetailMock:
      "音訊只存於私人 R2；測試候選版本是無需外部 AI 供應商的合成音調，並保持私密。",
    privacyDetailReal:
      "音訊只存於私人 R2；生成時會把短效來源連結交給已設定的 AI 供應商，經驗證的輸出會存回私人 R2。",
    credits: "Beta 額度",
    creditsLoading: "正在讀取額度……",
    creditsUnavailable: "額度暫時不可用",
    logout: "登出",
    localCancelFailed: "未能取消本機工作；工作可能已經完成。",
    localCreate: "執行本機 Workflow",
    localDisabled: "請確認音訊權利並接受現行法律文件，以準備合成來源。",
    localPreparing: "正在本機 R2 準備固定的合成音訊來源……",
    localPrivacy:
      "此功能只限 loopback，使用程式生成音調、本機 D1、本機 R2 及本機 Workflow 模擬；不會上載你的音訊，亦不會呼叫外部 AI 供應商。",
    localReady: "可準備固定的合成音訊來源；外部 AI 及真實音訊均不會使用。",
    localScenario: "本機測試情境",
    localScenarioFailure: "終止失敗",
    localScenarioRecovery: "逾時後恢復",
    localScenarioSuccess: "成功結果",
    localSourceDetail: "程式生成 WAV 測試檔 · 不使用者音訊 · 不接駁外部供應商",
    localSourceName: "固定合成音調",
    localSourceTitle: "本機合成來源",
    localUpload: "準備合成來源",
    localUploadSuccess: "合成來源已在本機 R2 確認；現可執行本機 Workflow。",
    jobRecoveryUnavailable:
      "瀏覽器未能保存私人工作的恢復識別資料。完成或刪除這個 Mix 前，請保持此分頁開啟並不要重新載入。",
    jobRecoveryRetry: "再試保存恢復識別資料",
    jobRecoverySaved: "已為此分頁保存私人工作的恢復識別資料。",
    staleJobReferenceCleared:
      "已保存的私人工作不再可用；恢復識別資料已清除，你可以安全建立新的 Mix。",
    staleJobReferenceClearRetry: "再試清除恢復識別資料",
    staleJobReferenceClearUnavailable:
      "已保存的私人工作不再可用，但瀏覽器未能清除恢復識別資料。重新載入前，請先在本機重試。",
    startOverReferenceClearRetry: "再試清除恢復識別資料並建立另一個 Mix",
    startOverReferenceClearUnavailable:
      "瀏覽器未能清除已保存的恢復識別資料，因此目前工作會保留在畫面。建立另一個 Mix 前，請先在本機重試。",
    restoringPrivateJob: "正在找回你的私人工作……",
  },
} satisfies Record<Language, Record<string, string>>;

const mockApiEnabled = import.meta.env.DEV;
const maxJobPollAttempts = 150;
const localSyntheticFilename = localSyntheticSourceFilename;

function revokeCandidateSources(sources: readonly string[]): void {
  for (const source of sources) {
    if (source.startsWith("blob:")) {
      URL.revokeObjectURL(source);
    }
  }
}

function JobExperienceLoading({ language }: { language: Language }) {
  return (
    <section className="job-page" aria-busy="true">
      <p className="form-status is-ready" role="status" aria-live="polite">
        {language === "en" ? "Loading private job…" : "正在載入私人工作……"}
      </p>
    </section>
  );
}

function RecentJobHistoryLoading({ language }: { language: Language }) {
  return (
    <section className="job-history-panel" aria-busy="true">
      <h2>{language === "en" ? "Recent private mixes" : "最近的私人 Mix"}</h2>
      <p className="job-history-message" aria-live="polite">
        {language === "en" ? "Loading recent private mixes…" : "正在讀取最近的私人 Mix……"}
      </p>
    </section>
  );
}

function AccessReadinessLoading({ language }: { language: Language }) {
  return (
    <section className="access-readiness is-loading" aria-busy="true" role="status">
      <p aria-live="polite">
        {language === "en" ? "Loading workspace readiness…" : "正在載入工作區準備狀態……"}
      </p>
    </section>
  );
}

function PrivateJobRestoreStatus({ language }: { language: Language }) {
  return (
    <section className="job-page" aria-busy="true">
      <p className="form-status is-ready" role="status" aria-live="polite">
        {copy[language].restoringPrivateJob}
      </p>
    </section>
  );
}

const localAiScenarios: readonly LocalAiScenario[] = [
  "success",
  "terminal-failure",
  "timeout-recovery",
];

type CreditSummaryState =
  | { status: "loading" | "unavailable"; summary: null }
  | { status: "ready" | "refreshing"; summary: CreditSummary };

type ActiveJobOrigin = "browser-mock" | "private-api";

type ClientAudioPreflightState =
  | { status: "idle" }
  | { file: File; status: "checking" }
  | { file: File; format: AudioContainerFormat; status: "valid" }
  | { file: File; status: "invalid" };

const audioContainerFormatLabels: Readonly<Record<AudioContainerFormat, string>> = {
  "aac-adts": "AAC",
  m4a: "M4A",
  mp3: "MP3",
  "ogg-opus": "OGG Opus",
  "ogg-speex": "OGG Speex",
  "ogg-vorbis": "OGG Vorbis",
  wav: "WAV",
};

function audioPreflightMessage(template: string, format: AudioContainerFormat): string {
  return template.replace("{format}", audioContainerFormatLabels[format]);
}

const waveformHeights = [
  17, 24, 31, 20, 38, 26, 45, 22, 34, 48, 29, 41, 25, 35, 19, 30, 23, 39, 28, 18,
];

function buildPrivateLoginRedirect(status: PrivateAccessFailureStatus): string {
  const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return buildLoginRedirect(status, destination);
}

export function PrivateApp() {
  const [language, setLanguage] = useState<Language>("zh-HK");
  const [selectedPreset, setSelectedPreset] = useState<PresetId>("soft-piano");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileValidationIssue, setFileValidationIssue] =
    useState<ClientAudioFileValidationIssue | null>(null);
  const [filePreflight, setFilePreflight] = useState<ClientAudioPreflightState>({
    status: "idle",
  });
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [privateSession, setPrivateSession] = useState<PrivateSession | null>(null);
  const [isSavingAcceptance, setIsSavingAcceptance] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<PublicJob | null>(null);
  const [jobError, setJobError] = useState<JobApiError | null>(null);
  const rememberedPrivateJobId = useRef<string | null>(readRememberedPrivateJobId());
  const [activeJobOrigin, setActiveJobOrigin] = useState<ActiveJobOrigin | null>(() =>
    rememberedPrivateJobId.current === null ? null : "private-api",
  );
  const [isRestoringPrivateJob, setIsRestoringPrivateJob] = useState(
    rememberedPrivateJobId.current !== null,
  );
  const [activeJobAction, setActiveJobAction] = useState<ActiveJobAction | null>(null);
  const [jobCancellationFailed, setJobCancellationFailed] = useState(false);
  const [jobDeletionFailed, setJobDeletionFailed] = useState(false);
  const [jobRecoveryNotice, setJobRecoveryNotice] = useState<"saved" | "unavailable" | null>(null);
  const [staleJobRecoveryNotice, setStaleJobRecoveryNotice] = useState<
    "cleared" | "unavailable" | null
  >(null);
  const [startOverReferenceClearUnavailable, setStartOverReferenceClearUnavailable] =
    useState(false);
  const [candidateSources, setCandidateSources] = useState<readonly [string, string] | null>(null);
  const [downloadRetryVersion, setDownloadRetryVersion] = useState(0);
  const [jobPollAttempt, setJobPollAttempt] = useState(0);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const [mockGenerationEnabled, setMockGenerationEnabled] = useState(false);
  const [localAiHarnessEnabled, setLocalAiHarnessEnabled] = useState(false);
  const [localAiScenario, setLocalAiScenario] = useState<LocalAiScenario>("success");
  const [creditAccountingEnabled, setCreditAccountingEnabled] = useState(false);
  const [creditSummaryState, setCreditSummaryState] = useState<CreditSummaryState>({
    status: "loading",
    summary: null,
  });
  const [realGenerationEnabled, setRealGenerationEnabled] = useState(false);
  const [privateAudioUploadEnabled, setPrivateAudioUploadEnabled] = useState(false);
  const [retentionCleanupEnabled, setRetentionCleanupEnabled] = useState(false);
  const [confirmedUpload, setConfirmedUpload] = useState<PublicUpload | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const uploadAbortController = useRef<AbortController | null>(null);
  const filePreflightAbortController = useRef<AbortController | null>(null);
  const jobIdempotencyKey = useRef<string | null>(null);
  const localSourceIdempotencyKey = useRef<string | null>(null);
  const strings = copy[language];
  const fileValidationMessages: Record<ClientAudioFileValidationIssue, string> = {
    empty: strings.fileEmpty,
    "invalid-content": strings.fileInvalidContent,
    "invalid-name": strings.fileInvalidName,
    multiple: strings.fileMultiple,
    "too-large": strings.fileTooLarge,
    unsupported: strings.fileUnsupported,
  };
  const fileValidationMessage =
    fileValidationIssue === null ? null : fileValidationMessages[fileValidationIssue];
  const selectedPresetName =
    presetOptions.find((item) => item.id === selectedPreset)?.displayName[language] ?? "Soft Piano";
  const privateGenerationMode =
    realGenerationEnabled === mockGenerationEnabled
      ? null
      : realGenerationEnabled
        ? "real"
        : "mock";
  const canGenerate =
    (localAiHarnessEnabled ||
      (selectedFile !== null &&
        filePreflight.status === "valid" &&
        filePreflight.file === selectedFile)) &&
    fileValidationIssue === null &&
    rightsAccepted &&
    legalAccepted &&
    confirmedUpload === null;
  const canStartPrivateGeneration =
    confirmedUpload !== null && privateGenerationMode !== null && rightsAccepted && legalAccepted;
  const canRefreshPrivateOutputs =
    activeJob?.status === "completed" && activeJobOrigin === "private-api";
  const canOpenRecentJob =
    selectedFile === null &&
    confirmedUpload === null &&
    !isUploadingAudio &&
    !isSavingAcceptance &&
    activeJob === null;
  const activeJobId = activeJob?.jobId;
  const activeJobStatus = activeJob?.status;
  const sourceFilename = localAiHarnessEnabled
    ? localSyntheticFilename
    : (selectedFile?.name ?? (activeJobOrigin === "private-api" ? strings.privateSourceName : "—"));

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "en" ? "StudyMix AI | Private beta" : "StudyMix AI｜私密測試";
  }, [language]);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(
    () => () => {
      uploadAbortController.current?.abort();
      uploadAbortController.current = null;
      filePreflightAbortController.current?.abort();
      filePreflightAbortController.current = null;
    },
    [],
  );

  useEffect(
    () => () => {
      if (candidateSources !== null) {
        revokeCandidateSources(candidateSources);
      }
    },
    [candidateSources],
  );

  useEffect(() => {
    const redirectToLogin = (event: Event) => {
      const status = readPrivateAccessFailureEvent(event);
      if (status !== null) {
        window.location.replace(buildPrivateLoginRedirect(status));
      }
    };

    window.addEventListener(privateAccessFailureEventName, redirectToLogin);
    return () => window.removeEventListener(privateAccessFailureEventName, redirectToLogin);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const verifyAccess = async () => {
      try {
        const result = await loadPrivateSession(controller.signal);
        if (result.status === "verified") {
          setPrivateSession(result.session);
          setCreditAccountingEnabled(result.session.capabilities.creditAccounting);
          setLocalAiHarnessEnabled(result.session.capabilities.localAiHarness);
          setMockGenerationEnabled(result.session.capabilities.mockGeneration);
          setRealGenerationEnabled(result.session.capabilities.realGeneration);
          setPrivateAudioUploadEnabled(result.session.capabilities.privateAudioUpload);
          setRetentionCleanupEnabled(result.session.capabilities.retentionCleanup);
          return;
        }
        setPrivateSession(null);
        window.location.replace(buildPrivateLoginRedirect(result.status));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setPrivateSession(null);
          window.location.replace(buildPrivateLoginRedirect("unavailable"));
        }
      }
    };

    void verifyAccess();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const jobId = rememberedPrivateJobId.current;
    if (privateSession === null || jobId === null) {
      return;
    }
    const controller = new AbortController();
    const restoreJob = async () => {
      try {
        const job = await getJob(jobId, controller.signal);
        setActiveJobOrigin("private-api");
        setSelectedPreset(job.preset.id);
        setActiveJob(job);
        setJobRecoveryNotice(null);
        setStaleJobRecoveryNotice(null);
        setJobPollAttempt(0);
        setCandidateSources(null);
        setJobError(null);
        setNotice(null);
        setIsRestoringPrivateJob(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const jobApiError = toJobApiError(error);
        if (jobApiError.code === "NOT_FOUND") {
          rememberedPrivateJobId.current = null;
          const referenceCleared = clearRememberedPrivateJob();
          setActiveJobOrigin(null);
          setJobRecoveryNotice(null);
          setStaleJobRecoveryNotice(referenceCleared ? "cleared" : "unavailable");
          setJobError(null);
        } else {
          setJobError(jobApiError);
        }
        setIsRestoringPrivateJob(false);
      }
    };
    const timeout = window.setTimeout(() => void restoreJob(), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [privateSession]);

  useEffect(() => {
    if (privateSession === null || !creditAccountingEnabled) {
      setCreditSummaryState({ status: "loading", summary: null });
      return;
    }
    const controller = new AbortController();
    setCreditSummaryState((current) =>
      current.summary === null
        ? { status: "loading", summary: null }
        : { status: "refreshing", summary: current.summary },
    );
    void getCreditSummary(controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) {
          setCreditSummaryState({ status: "ready", summary });
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCreditSummaryState({ status: "unavailable", summary: null });
        }
      });
    return () => controller.abort();
  }, [privateSession, activeJobStatus, creditAccountingEnabled]);

  useEffect(() => {
    if (
      activeJobId === undefined ||
      activeJobStatus === undefined ||
      !isPendingJob(activeJobStatus) ||
      !isDocumentVisible
    ) {
      return;
    }
    if (jobPollAttempt >= maxJobPollAttempts) {
      setJobError(
        new JobApiError({
          code: "NETWORK_ERROR",
          message: "The job is taking longer than the private session can monitor.",
          retryable: true,
        }),
      );
      return;
    }

    const controller = new AbortController();
    const pollDelay = Math.min(750 * 1.5 ** jobPollAttempt, 10_000);
    const timeout = window.setTimeout(() => {
      void getJob(activeJobId, controller.signal)
        .then((job) => {
          setActiveJob(job);
          setJobError(null);
          setJobPollAttempt((attempt) => attempt + 1);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setJobError(toJobApiError(error));
          }
        });
    }, pollDelay);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeJobId, activeJobStatus, isDocumentVisible, jobPollAttempt]);

  useEffect(() => {
    if (
      activeJob?.status !== "completed" ||
      activeJob.outputs.length !== 2 ||
      candidateSources !== null
    ) {
      return;
    }
    const controller = new AbortController();
    const loadPrivateOutputs = async () => {
      const resolvedSources: string[] = [];
      try {
        const outputs = [...activeJob.outputs].sort(
          (first, second) => first.candidateIndex - second.candidateIndex,
        );
        const sourceResults = await Promise.all(
          outputs.map(async (output) => {
            try {
              return {
                source: await getPlayableOutputSource(output.outputId, {
                  allowLocalContent: localAiHarnessEnabled,
                  signal: controller.signal,
                }),
                status: "fulfilled" as const,
              };
            } catch (error) {
              controller.abort();
              return { error, status: "rejected" as const };
            }
          }),
        );
        for (const result of sourceResults) {
          if (result.status === "fulfilled") {
            resolvedSources.push(result.source);
          }
        }
        const failure =
          sourceResults.find(
            (result) =>
              result.status === "rejected" &&
              !(result.error instanceof DOMException && result.error.name === "AbortError"),
          ) ?? sourceResults.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          throw failure.error;
        }
        controller.signal.throwIfAborted();
        const first = resolvedSources[0];
        const second = resolvedSources[1];
        if (first === undefined || second === undefined) {
          throw new Error("Private output URLs are unavailable.");
        }
        setCandidateSources([first, second]);
        setJobError(null);
      } catch (error) {
        revokeCandidateSources(resolvedSources);
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setJobError(toJobApiError(error));
        }
      }
    };
    void loadPrivateOutputs();
    return () => controller.abort();
  }, [activeJob, candidateSources, downloadRetryVersion, localAiHarnessEnabled]);

  const setFile = (fileList: FileList | null): boolean => {
    if (confirmedUpload !== null) {
      setNotice(strings.replaceBlocked);
      return false;
    }
    filePreflightAbortController.current?.abort();
    filePreflightAbortController.current = null;
    if (fileList !== null && fileList.length > 1) {
      setSelectedFile(null);
      setFileValidationIssue("multiple");
      setFilePreflight({ status: "idle" });
      setNotice(null);
      jobIdempotencyKey.current = null;
      return false;
    }
    const file = fileList?.item(0) ?? null;
    if (file === null) {
      setSelectedFile(null);
      setFileValidationIssue(null);
      setFilePreflight({ status: "idle" });
      setNotice(null);
      jobIdempotencyKey.current = null;
      return true;
    }
    const validation = validateClientAudioFile(file);
    if (!validation.valid) {
      setSelectedFile(null);
      setFileValidationIssue(validation.issue);
      setFilePreflight({ status: "idle" });
      setNotice(null);
      jobIdempotencyKey.current = null;
      return false;
    }
    const controller = new AbortController();
    filePreflightAbortController.current = controller;
    setSelectedFile(file);
    setFileValidationIssue(null);
    setFilePreflight({ file, status: "checking" });
    setNotice(null);
    jobIdempotencyKey.current = null;
    void inspectClientAudioFileStructure(file, controller.signal)
      .then((format) => {
        if (filePreflightAbortController.current === controller && !controller.signal.aborted) {
          setFilePreflight({ file, format, status: "valid" });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (filePreflightAbortController.current === controller) {
          setFilePreflight({ file, status: "invalid" });
          setFileValidationIssue("invalid-content");
          setNotice(null);
          jobIdempotencyKey.current = null;
        }
      })
      .finally(() => {
        if (filePreflightAbortController.current === controller) {
          filePreflightAbortController.current = null;
        }
      });
    return true;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!setFile(event.currentTarget.files)) {
      event.currentTarget.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setFile(event.dataTransfer.files);
  };

  const startMockJob = async () => {
    if (!mockApiEnabled) {
      return;
    }
    const { startLocalMockJob } = await import("./dev/mock-job");
    const result = await startLocalMockJob(selectedPreset);
    setActiveJobOrigin("browser-mock");
    setActiveJob(result.job);
    setJobRecoveryNotice(null);
    setJobPollAttempt(0);
    setCandidateSources(result.candidateSources);
    setJobError(null);
    setNotice(null);
  };

  const startPrivateJob = async () => {
    if (confirmedUpload === null || privateGenerationMode === null) {
      return;
    }
    jobIdempotencyKey.current ??= `ui:${crypto.randomUUID()}`;
    const job = await createJob({
      candidateCount: 2,
      idempotencyKey: jobIdempotencyKey.current,
      presetId: selectedPreset,
      presetVersion: 1,
      rightsDeclarationVersion: currentRightsDeclarationVersion,
      uploadId: confirmedUpload.uploadId,
    });
    rememberedPrivateJobId.current = job.jobId;
    setJobRecoveryNotice(rememberPrivateJobId(job.jobId) ? null : "unavailable");
    setStaleJobRecoveryNotice(null);
    setActiveJobOrigin("private-api");
    setActiveJob(job);
    setJobPollAttempt(0);
    setCandidateSources(null);
    setJobError(null);
    setNotice(null);
  };

  const prepareLocalSyntheticSource = async () => {
    localSourceIdempotencyKey.current ??= `ui-local-source:${crypto.randomUUID()}`;
    const { createLocalSyntheticUpload } = await import("./local-ai-api");
    const upload = await createLocalSyntheticUpload({
      fixture: "deterministic-tone-v1",
      idempotencyKey: localSourceIdempotencyKey.current,
      scenario: localAiScenario,
    });
    setConfirmedUpload(upload);
    setNotice(strings.localUploadSuccess);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setNotice(strings.saving);
    try {
      const { saveCurrentLegalAcceptance } = await import("./legal-acceptance");
      await saveCurrentLegalAcceptance();
      if (localAiHarnessEnabled) {
        setNotice(strings.localPreparing);
        try {
          await prepareLocalSyntheticSource();
        } catch {
          setNotice(strings.uploadFailed);
        }
        return;
      }
      if (privateAudioUploadEnabled && selectedFile !== null) {
        const controller = new AbortController();
        uploadAbortController.current = controller;
        setIsUploadingAudio(true);
        setNotice(strings.uploading);
        try {
          const upload = await uploadAndConfirmAudio(selectedFile, controller.signal);
          setConfirmedUpload(upload);
          setNotice(
            privateGenerationMode === "real"
              ? strings.uploadSuccessReal
              : privateGenerationMode === "mock"
                ? strings.uploadSuccessMock
                : strings.uploadSuccess,
          );
        } catch (error) {
          if (
            error instanceof UploadApiError &&
            (error.code === "INVALID_AUDIO_CONTENT" || error.code === "VALIDATION_ERROR")
          ) {
            setFileValidationIssue("invalid-content");
            if (selectedFile !== null) {
              setFilePreflight({ file: selectedFile, status: "invalid" });
            }
            setNotice(null);
          } else {
            setNotice(
              error instanceof DOMException && error.name === "AbortError"
                ? strings.uploadCancelled
                : strings.uploadFailed,
            );
          }
        } finally {
          if (uploadAbortController.current === controller) {
            uploadAbortController.current = null;
            setIsUploadingAudio(false);
          }
        }
        return;
      }
      if (!mockApiEnabled) {
        setNotice(strings.demo);
        return;
      }
      try {
        await startMockJob();
      } catch (error) {
        setJobError(toJobApiError(error));
      }
    } catch {
      setNotice(strings.legalSaveFailed);
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleCancelUpload = () => {
    const controller = uploadAbortController.current;
    if (controller === null || controller.signal.aborted) {
      return;
    }
    setNotice(strings.cancellingUpload);
    controller.abort();
  };

  const handleCreatePrivateJob = async () => {
    if (!canStartPrivateGeneration || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setNotice(privateGenerationMode === "real" ? strings.creatingReal : strings.creatingMock);
    try {
      await startPrivateJob();
    } catch (error) {
      setJobError(toJobApiError(error));
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleDeleteUpload = async () => {
    if (confirmedUpload === null || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setNotice(strings.deletingUpload);
    try {
      await deleteUpload(confirmedUpload.uploadId);
      setConfirmedUpload(null);
      setSelectedFile(null);
      setFileValidationIssue(null);
      filePreflightAbortController.current?.abort();
      filePreflightAbortController.current = null;
      setFilePreflight({ status: "idle" });
      setRightsAccepted(false);
      setNotice(null);
      jobIdempotencyKey.current = null;
      localSourceIdempotencyKey.current = null;
    } catch {
      setNotice(strings.deleteFailed);
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleRetry = async () => {
    if (isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setActiveJobAction("retry");
    setJobError(null);
    setStartOverReferenceClearUnavailable(false);
    const rememberedJobId = activeJob === null ? rememberedPrivateJobId.current : null;
    try {
      if (rememberedJobId !== null) {
        const restoredJob = await getJob(rememberedJobId, new AbortController().signal);
        setActiveJobOrigin("private-api");
        setSelectedPreset(restoredJob.preset.id);
        setActiveJob(restoredJob);
        setStaleJobRecoveryNotice(null);
        setJobPollAttempt(0);
      } else if (activeJob?.status === "completed") {
        setDownloadRetryVersion((version) => version + 1);
      } else if (activeJob !== null && isPendingJob(activeJob.status)) {
        const refreshedJob = await getJob(activeJob.jobId, new AbortController().signal);
        setActiveJob(refreshedJob);
        setJobPollAttempt(0);
      } else if (confirmedUpload !== null && privateGenerationMode !== null) {
        await startPrivateJob();
      } else {
        await startMockJob();
      }
    } catch (error) {
      const jobApiError = toJobApiError(error);
      if (rememberedJobId !== null && jobApiError.code === "NOT_FOUND") {
        rememberedPrivateJobId.current = null;
        const referenceCleared = clearRememberedPrivateJob();
        setActiveJobOrigin(null);
        setStaleJobRecoveryNotice(referenceCleared ? "cleared" : "unavailable");
        setJobError(null);
      } else {
        setJobError(jobApiError);
      }
    } finally {
      setActiveJobAction(null);
      setIsSavingAcceptance(false);
    }
  };

  const handleRefreshOutputs = () => {
    if (!canRefreshPrivateOutputs || candidateSources === null) {
      return;
    }
    setCandidateSources(null);
    setJobError(null);
    setDownloadRetryVersion((version) => version + 1);
  };

  const handleOpenRecentJob = (job: PublicJob) => {
    if (!canOpenRecentJob) {
      return;
    }
    rememberedPrivateJobId.current = job.jobId;
    setJobRecoveryNotice(rememberPrivateJobId(job.jobId) ? null : "unavailable");
    setStaleJobRecoveryNotice(null);
    setStartOverReferenceClearUnavailable(false);
    setActiveJobOrigin("private-api");
    setSelectedPreset(job.preset.id);
    setActiveJob(job);
    setJobError(null);
    setJobCancellationFailed(false);
    setJobDeletionFailed(false);
    setCandidateSources(null);
    setDownloadRetryVersion(0);
    setJobPollAttempt(0);
    setNotice(null);
  };

  const handleRetryJobRecovery = () => {
    if (activeJob === null || activeJobOrigin !== "private-api") {
      return;
    }
    if (rememberPrivateJobId(activeJob.jobId)) {
      setJobRecoveryNotice("saved");
    }
  };

  const handleRetryStaleJobReferenceClear = () => {
    if (clearRememberedPrivateJob()) {
      setStaleJobRecoveryNotice("cleared");
    }
  };

  const resetPrivateWorkspace = () => {
    rememberedPrivateJobId.current = null;
    setActiveJobOrigin(null);
    setIsRestoringPrivateJob(false);
    setActiveJobAction(null);
    setActiveJob(null);
    setJobError(null);
    setJobCancellationFailed(false);
    setJobDeletionFailed(false);
    setJobRecoveryNotice(null);
    setStaleJobRecoveryNotice(null);
    setStartOverReferenceClearUnavailable(false);
    setCandidateSources(null);
    setSelectedFile(null);
    setFileValidationIssue(null);
    filePreflightAbortController.current?.abort();
    filePreflightAbortController.current = null;
    setFilePreflight({ status: "idle" });
    setRightsAccepted(false);
    setLegalAccepted(false);
    setNotice(null);
    setConfirmedUpload(null);
    setDownloadRetryVersion(0);
    setJobPollAttempt(0);
    jobIdempotencyKey.current = null;
    localSourceIdempotencyKey.current = null;
  };

  const handleRetryStartOverReferenceClear = () => {
    if (clearRememberedPrivateJob()) {
      resetPrivateWorkspace();
    }
  };

  const handleDeleteJob = async () => {
    if (activeJob === null || isPendingJob(activeJob.status) || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setActiveJobAction("delete");
    setJobDeletionFailed(false);
    try {
      if (activeJobOrigin !== "browser-mock") {
        await deleteJob(activeJob.jobId);
      }
      handleStartOver();
    } catch {
      setJobDeletionFailed(true);
    } finally {
      setActiveJobAction(null);
      setIsSavingAcceptance(false);
    }
  };

  const handleCancelJob = async () => {
    if (
      !localAiHarnessEnabled ||
      activeJob === null ||
      !isPendingJob(activeJob.status) ||
      isSavingAcceptance
    ) {
      return;
    }
    setIsSavingAcceptance(true);
    setActiveJobAction("cancel");
    setJobCancellationFailed(false);
    try {
      const job = await cancelJob(activeJob.jobId);
      setActiveJob(job);
      setJobError(null);
      setJobPollAttempt(0);
    } catch {
      setJobCancellationFailed(true);
    } finally {
      setActiveJobAction(null);
      setIsSavingAcceptance(false);
    }
  };

  const handleStartOver = () => {
    const hadRememberedPrivateJob = rememberedPrivateJobId.current !== null;
    const referenceCleared = clearRememberedPrivateJob();
    if (hadRememberedPrivateJob && !referenceCleared) {
      setStartOverReferenceClearUnavailable(true);
      return;
    }
    resetPrivateWorkspace();
  };

  const handleReturnToConfirmedUpload = () => {
    setActiveJobAction(null);
    setJobError(null);
    setJobCancellationFailed(false);
    setJobDeletionFailed(false);
    setCandidateSources(null);
    setNotice(null);
    setDownloadRetryVersion(0);
    setJobPollAttempt(0);
  };

  if (privateSession === null) {
    return (
      <PrivateAccessGate
        language={language}
        onLanguageChange={() => setLanguage(language === "en" ? "zh-HK" : "en")}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="app-header">
        <a className="brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <div className="header-actions">
          {creditAccountingEnabled ? (
            <div
              className="credit-status"
              aria-busy={
                creditSummaryState.status === "loading" ||
                creditSummaryState.status === "refreshing"
              }
              aria-live="polite"
            >
              <span>{strings.credits}</span>
              <strong>
                {creditSummaryState.summary === null
                  ? creditSummaryState.status === "unavailable"
                    ? strings.creditsUnavailable
                    : strings.creditsLoading
                  : `${creditSummaryState.summary.availableCredits.toString()} · ${creditSummaryState.summary.reservedCredits.toString()}`}
              </strong>
            </div>
          ) : null}
          <button
            className="language-switch"
            type="button"
            onClick={() => {
              setLanguage(language === "en" ? "zh-HK" : "en");
              setNotice(null);
            }}
          >
            <GlobeIcon />
            <span>{strings.languageName}</span>
          </button>
          <a
            className="logout-link"
            href="/cdn-cgi/access/logout"
            onClick={() => {
              rememberedPrivateJobId.current = null;
              clearRememberedPrivateJob();
            }}
          >
            {strings.logout}
          </a>
        </div>
      </header>

      <main>
        <Suspense fallback={<AccessReadinessLoading language={language} />}>
          <LazyAccessReadiness language={language} session={privateSession} />
        </Suspense>
        {privateSession !== null ? (
          isRestoringPrivateJob ? (
            <PrivateJobRestoreStatus language={language} />
          ) : activeJob !== null || jobError !== null ? (
            <>
              {startOverReferenceClearUnavailable ? (
                <div className="job-recovery-notice is-warning" role="alert">
                  <p>{strings.startOverReferenceClearUnavailable}</p>
                  <button
                    className="text-button"
                    disabled={activeJobAction !== null}
                    type="button"
                    onClick={handleRetryStartOverReferenceClear}
                  >
                    {strings.startOverReferenceClearRetry}
                  </button>
                </div>
              ) : jobRecoveryNotice === "unavailable" ? (
                <div className="job-recovery-notice is-warning" role="alert">
                  <p>{strings.jobRecoveryUnavailable}</p>
                  <button
                    className="text-button"
                    disabled={activeJobAction !== null}
                    type="button"
                    onClick={handleRetryJobRecovery}
                  >
                    {strings.jobRecoveryRetry}
                  </button>
                </div>
              ) : jobRecoveryNotice === "saved" ? (
                <p className="job-recovery-notice is-saved" role="status" aria-live="polite">
                  {strings.jobRecoverySaved}
                </p>
              ) : null}
              <Suspense fallback={<JobExperienceLoading language={language} />}>
                <LazyJobExperience
                  activeAction={activeJobAction}
                  canCancel={
                    localAiHarnessEnabled && isPendingJob(activeJob?.status ?? "cancelled")
                  }
                  canRefreshOutputs={canRefreshPrivateOutputs}
                  canReturnToUpload={activeJob === null && confirmedUpload !== null}
                  candidateSources={candidateSources}
                  cancellationError={jobCancellationFailed ? strings.localCancelFailed : null}
                  error={jobError}
                  deletionError={jobDeletionFailed ? strings.deleteJobFailed : null}
                  filename={sourceFilename}
                  job={activeJob}
                  language={language}
                  onCancel={() => void handleCancelJob()}
                  onDelete={() => void handleDeleteJob()}
                  onRefreshOutputs={handleRefreshOutputs}
                  presetName={selectedPresetName}
                  onRetry={() => void handleRetry()}
                  onStartOver={
                    activeJob === null && confirmedUpload !== null
                      ? handleReturnToConfirmedUpload
                      : handleStartOver
                  }
                />
              </Suspense>
            </>
          ) : (
            <>
              {staleJobRecoveryNotice === "unavailable" ? (
                <div className="job-recovery-notice is-warning" role="alert">
                  <p>{strings.staleJobReferenceClearUnavailable}</p>
                  <button
                    className="text-button"
                    type="button"
                    onClick={handleRetryStaleJobReferenceClear}
                  >
                    {strings.staleJobReferenceClearRetry}
                  </button>
                </div>
              ) : staleJobRecoveryNotice === "cleared" ? (
                <p className="job-recovery-notice is-saved" role="status" aria-live="polite">
                  {strings.staleJobReferenceCleared}
                </p>
              ) : null}
              <Suspense fallback={<RecentJobHistoryLoading language={language} />}>
                <LazyRecentJobHistory
                  canOpen={canOpenRecentJob}
                  language={language}
                  onOpen={handleOpenRecentJob}
                />
              </Suspense>
              <form className="mix-workspace" onSubmit={(event) => void handleSubmit(event)}>
                {localAiHarnessEnabled ? (
                  <LocalSyntheticSourcePanel
                    disabled={confirmedUpload !== null || isSavingAcceptance}
                    language={language}
                    onScenarioChange={(scenario) => {
                      setLocalAiScenario(scenario);
                      setNotice(null);
                      jobIdempotencyKey.current = null;
                      localSourceIdempotencyKey.current = null;
                    }}
                    scenario={localAiScenario}
                  />
                ) : (
                  <UploadPanel
                    filePreflight={filePreflight}
                    hasFileValidationError={fileValidationIssue !== null}
                    language={language}
                    privateAudioUploadEnabled={privateAudioUploadEnabled}
                    retentionCleanupEnabled={retentionCleanupEnabled}
                    selectedFile={selectedFile}
                    onFileChange={handleFileChange}
                    onDrop={handleDrop}
                  />
                )}

                <section className="setup-panel" aria-labelledby="page-title">
                  <div className="intro">
                    <h1 id="page-title">{strings.heading}</h1>
                    <p>{strings.lede}</p>
                  </div>

                  <fieldset className="preset-fieldset">
                    <legend>{strings.presetTitle}</legend>
                    <div className="preset-grid">
                      {presetOptions.map((item) => (
                        <label
                          className={`preset-option${selectedPreset === item.id ? " is-selected" : ""}`}
                          data-preset={item.id}
                          key={item.id}
                        >
                          <input
                            type="radio"
                            name="preset"
                            value={item.id}
                            checked={selectedPreset === item.id}
                            onChange={() => {
                              setSelectedPreset(item.id);
                              setNotice(null);
                              jobIdempotencyKey.current = null;
                            }}
                          />
                          <span className="preset-icon" aria-hidden="true">
                            <PresetIcon presetId={item.id} />
                          </span>
                          <strong>{item.displayName[language]}</strong>
                          <small>{item.description[language]}</small>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="rights-control">
                    <input
                      type="checkbox"
                      checked={rightsAccepted}
                      onChange={(event) => {
                        setRightsAccepted(event.target.checked);
                        setNotice(null);
                      }}
                    />
                    <span className="custom-checkbox" aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>{strings.rights}</span>
                  </label>

                  <div className="rights-control legal-acceptance-control">
                    <input
                      id="legal-acceptance"
                      type="checkbox"
                      checked={legalAccepted}
                      onChange={(event) => {
                        setLegalAccepted(event.target.checked);
                        setNotice(null);
                      }}
                    />
                    <label className="custom-checkbox" htmlFor="legal-acceptance">
                      <span className="visually-hidden">
                        {language === "en" ? "Accept current legal documents" : "接受現行法律文件"}
                      </span>
                      <CheckIcon />
                    </label>
                    <span>
                      {strings.legalAcceptanceLead}{" "}
                      <a href="/legal/terms">{legalLinkCopy[language].terms}</a> {strings.legalAnd}{" "}
                      <a href="/legal/acceptable-use">{legalLinkCopy[language].acceptableUse}</a>{" "}
                      {strings.legalAnd}{" "}
                      <a href="/legal/ai-output-notice">{legalLinkCopy[language].aiOutputNotice}</a>
                      {"; "}
                      {strings.privacyAcknowledgement}{" "}
                      <a href="/legal/privacy">{legalLinkCopy[language].privacyNotice}</a>.
                    </span>
                  </div>

                  <div className="selection-summary">
                    <strong className="summary-title">{strings.summary}</strong>
                    <SummaryRow icon={<FileIcon />} label={strings.file}>
                      {sourceFilename}
                    </SummaryRow>
                    <SummaryRow icon={<SlidersIcon />} label={strings.preset}>
                      {selectedPresetName}
                    </SummaryRow>
                    <SummaryRow icon={<CandidatesIcon />} label={strings.candidates}>
                      2
                    </SummaryRow>
                  </div>

                  {confirmedUpload === null ? (
                    <button
                      className="generate-button"
                      type="submit"
                      disabled={!canGenerate || isSavingAcceptance}
                    >
                      <SparkleIcon />
                      <span>
                        {localAiHarnessEnabled
                          ? strings.localUpload
                          : privateAudioUploadEnabled
                            ? strings.upload
                            : strings.generate}
                      </span>
                    </button>
                  ) : privateGenerationMode !== null ? (
                    <button
                      className="generate-button"
                      type="button"
                      disabled={!canStartPrivateGeneration || isSavingAcceptance}
                      onClick={() => void handleCreatePrivateJob()}
                    >
                      <SparkleIcon />
                      <span>
                        {localAiHarnessEnabled
                          ? strings.localCreate
                          : privateGenerationMode === "real"
                            ? strings.createReal
                            : strings.createMock}
                      </span>
                    </button>
                  ) : null}
                  <p
                    className={`form-status${fileValidationMessage !== null ? " is-error" : canGenerate || canStartPrivateGeneration || filePreflight.status === "valid" ? " is-ready" : ""}`}
                    id="file-selection-status"
                    aria-busy={filePreflight.status === "checking"}
                    aria-live="polite"
                    role={fileValidationMessage === null ? undefined : "alert"}
                  >
                    {fileValidationMessage ??
                      (filePreflight.status === "checking" ? strings.fileChecking : null) ??
                      notice ??
                      (filePreflight.status === "valid" && (!rightsAccepted || !legalAccepted)
                        ? audioPreflightMessage(strings.fileReady, filePreflight.format)
                        : null) ??
                      (localAiHarnessEnabled
                        ? confirmedUpload !== null
                          ? strings.localUploadSuccess
                          : canGenerate
                            ? strings.localReady
                            : strings.localDisabled
                        : confirmedUpload !== null
                          ? privateGenerationMode === "real"
                            ? strings.uploadSuccessReal
                            : privateGenerationMode === "mock"
                              ? strings.uploadSuccessMock
                              : strings.uploadSuccess
                          : canGenerate
                            ? privateAudioUploadEnabled
                              ? privateGenerationMode === "real"
                                ? strings.readyUploadReal
                                : strings.readyUpload
                              : strings.ready
                            : strings.disabled)}
                  </p>
                  {isUploadingAudio ? (
                    <button className="text-button" type="button" onClick={handleCancelUpload}>
                      {strings.cancelUpload}
                    </button>
                  ) : confirmedUpload !== null ? (
                    <button
                      className="text-button"
                      disabled={isSavingAcceptance}
                      type="button"
                      onClick={() => void handleDeleteUpload()}
                    >
                      {strings.deleteUpload}
                    </button>
                  ) : null}
                </section>
              </form>

              <aside className="privacy-note">
                <ShieldIcon />
                <div>
                  <strong>{strings.privacy}</strong>
                  <span>
                    {localAiHarnessEnabled
                      ? strings.localPrivacy
                      : privateAudioUploadEnabled
                        ? privateGenerationMode === "real"
                          ? strings.privacyDetailReal
                          : privateGenerationMode === "mock"
                            ? strings.privacyDetailMock
                            : strings.privacyDetailActive
                        : strings.privacyDetail}
                  </span>
                </div>
              </aside>
            </>
          )
        ) : null}
        <SiteFooter language={language} />
      </main>
    </div>
  );
}

type UploadPanelProps = {
  filePreflight: ClientAudioPreflightState;
  hasFileValidationError: boolean;
  language: Language;
  privateAudioUploadEnabled: boolean;
  retentionCleanupEnabled: boolean;
  selectedFile: File | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
};

function UploadPanel({
  filePreflight,
  hasFileValidationError,
  language,
  privateAudioUploadEnabled,
  retentionCleanupEnabled,
  selectedFile,
  onFileChange,
  onDrop,
}: UploadPanelProps) {
  const strings = copy[language];
  const verifiedMessage =
    filePreflight.status === "valid"
      ? audioPreflightMessage(strings.fileVerified, filePreflight.format)
      : null;

  return (
    <section className="upload-panel" aria-labelledby="upload-title">
      <div className="panel-heading">
        <h2 id="upload-title">{strings.uploadTitle}</h2>
        <p>{strings.uploadHint}</p>
      </div>

      <label
        className={`drop-zone${selectedFile === null ? "" : " has-file"}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <input
          aria-describedby="file-selection-status"
          aria-invalid={hasFileValidationError}
          className="visually-hidden"
          type="file"
          accept={clientAudioFileAccept}
          onClick={(event) => {
            event.currentTarget.value = "";
          }}
          onChange={onFileChange}
        />
        <span className="upload-orbit" aria-hidden="true">
          <UploadIcon />
        </span>
        <strong>{strings.drop}</strong>
        <span>{strings.or}</span>
        <span className="choose-file-button">
          {selectedFile === null ? strings.choose : strings.replace}
        </span>
      </label>

      {selectedFile !== null ? (
        <div className="file-preview" aria-busy={filePreflight.status === "checking"}>
          <div className="file-tile" aria-hidden="true">
            <WaveFileIcon />
          </div>
          <div className="file-copy">
            <strong>{selectedFile.name}</strong>
            <span>
              {(selectedFile.type || "audio").replace("audio/", "").toUpperCase()} ·{" "}
              {formatBytes(selectedFile.size)}
            </span>
            {filePreflight.status === "checking" ? (
              <span className="file-structure-status is-checking">{strings.fileChecking}</span>
            ) : verifiedMessage !== null ? (
              <span className="file-structure-status is-valid">{verifiedMessage}</span>
            ) : filePreflight.status === "invalid" ? (
              <span className="file-structure-status is-invalid">{strings.fileRejected}</span>
            ) : null}
          </div>
          {filePreflight.status === "valid" ? (
            <span className="file-check" aria-hidden="true">
              <CheckIcon />
            </span>
          ) : filePreflight.status === "checking" ? (
            <span className="file-check is-checking" aria-hidden="true">
              …
            </span>
          ) : filePreflight.status === "invalid" ? (
            <span className="file-check is-invalid" aria-hidden="true">
              !
            </span>
          ) : null}
          <div className="mini-player" aria-hidden="true">
            <span className="mini-play">
              <PlayIcon />
            </span>
            <span className="waveform">
              {waveformHeights.map((height, index) => (
                <i className={`waveform-height-${height}`} key={`${height}-${index}`} />
              ))}
            </span>
          </div>
        </div>
      ) : (
        <div className="upload-encouragement" aria-hidden="true">
          <span className="music-spark">♪</span>
          <span className="music-spark">✦</span>
          <span className="music-spark">♫</span>
        </div>
      )}

      <div className="retention-note">
        <ShieldIcon />
        <span>
          {privateAudioUploadEnabled
            ? retentionCleanupEnabled
              ? strings.retentionManaged
              : strings.retentionActive
            : strings.retention}
        </span>
      </div>
    </section>
  );
}

function LocalSyntheticSourcePanel({
  disabled,
  language,
  onScenarioChange,
  scenario,
}: {
  disabled: boolean;
  language: Language;
  onScenarioChange: (scenario: LocalAiScenario) => void;
  scenario: LocalAiScenario;
}) {
  const strings = copy[language];
  const scenarioLabels: Record<LocalAiScenario, string> = {
    success: strings.localScenarioSuccess,
    "terminal-failure": strings.localScenarioFailure,
    "timeout-recovery": strings.localScenarioRecovery,
  };

  return (
    <section className="upload-panel local-source-panel" aria-labelledby="local-source-title">
      <div className="panel-heading">
        <h2 id="local-source-title">{strings.localSourceTitle}</h2>
        <p>{strings.localSourceDetail}</p>
      </div>

      <div className="local-source-card" role="note">
        <span className="upload-orbit" aria-hidden="true">
          <WaveFileIcon />
        </span>
        <div>
          <strong>{strings.localSourceName}</strong>
          <span>{localSyntheticFilename}</span>
        </div>
        <span className="local-only-badge">LOCAL</span>
      </div>

      <fieldset className="local-scenario-fieldset" disabled={disabled}>
        <legend>{strings.localScenario}</legend>
        <div className="local-scenario-options">
          {localAiScenarios.map((item) => (
            <label key={item} className={scenario === item ? "is-selected" : ""}>
              <input
                checked={scenario === item}
                name="local-ai-scenario"
                type="radio"
                value={item}
                onChange={() => onScenarioChange(item)}
              />
              <span>{scenarioLabels[item]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="retention-note">
        <ShieldIcon />
        <span>{strings.localPrivacy}</span>
      </div>
    </section>
  );
}

function SummaryRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="summary-row">
      <span className="summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function IconBase({ children, viewBox = "0 0 24 24" }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {children}
    </svg>
  );
}

function UploadIcon() {
  return (
    <IconBase>
      <path d="M7.5 18.5H6a4 4 0 0 1-.7-7.9A6.5 6.5 0 0 1 18 9.2a4.8 4.8 0 0 1 0 9.5h-1.5" />
      <path d="m9 14 3-3 3 3M12 11v10" />
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

function FileIcon() {
  return (
    <IconBase>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h4" />
    </IconBase>
  );
}

function SlidersIcon() {
  return (
    <IconBase>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8M4 12h2M10 12h10" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="10" cy="17" r="2" />
    </IconBase>
  );
}

function CandidatesIcon() {
  return (
    <IconBase>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M16 14a4.5 4.5 0 0 1 4.5 4.5V20" />
    </IconBase>
  );
}

function WaveFileIcon() {
  return (
    <IconBase>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h4M9 14h1l1-3 2 6 2-5 1 2h1" />
    </IconBase>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <IconBase>
      <path d="M12 2c.6 4 2 5.4 6 6-4 .6-5.4 2-6 6-.6-4-2-5.4-6-6 4-.6 5.4-2 6-6Z" />
      <path d="M19 15c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3Z" />
    </IconBase>
  );
}
