import {
  apiEnvelopeSchema,
  currentLegalAcceptanceDocuments,
  currentRightsDeclarationVersion,
  legalAcceptanceStatusSchema,
  legalDocumentsManifestSchema,
  ownerIdSchema,
  type LegalDocumentId,
  type PublicJob,
  type PublicUpload,
} from "@studymix/contracts";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import { LandingPage } from "./LandingPage";
import { legalPageContent, legalPathToDocumentId, type Language } from "./legal-content";
import { JobExperience, isPendingJob } from "./job-experience";
import {
  createJob,
  deleteJob,
  getJob,
  getOutputDownload,
  toJobApiError,
  type JobApiError,
} from "./job-api";
import { deleteUpload, uploadAndConfirmAudio } from "./upload-api";

type PresetId = "soft-piano" | "music-box" | "lofi-study";

type Preset = {
  id: PresetId;
  name: Record<Language, string>;
  description: Record<Language, string>;
  icon: ReactNode;
};

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
    uploadSuccess: "Private upload confirmed. AI generation remains disabled.",
    uploadSuccessMock:
      "Private upload confirmed. You can now create two synthetic test candidates; external AI remains disabled.",
    uploadFailed: "The private upload could not be confirmed. Check the file and try again.",
    deleteUpload: "Delete private upload",
    deletingUpload: "Deleting the private upload…",
    deleteFailed: "The private upload could not be deleted. Please retry.",
    deleteJobFailed: "The private mix could not be deleted. Please retry.",
    createMock: "Create 2 test candidates",
    creatingMock: "Creating two private synthetic test candidates…",
    replaceBlocked: "Delete the confirmed private upload before choosing another file.",
    legalAcceptanceLead: "I accept the current",
    legalAnd: "and",
    privacyAcknowledgement: "and acknowledge the",
    disabled: "Add a file, confirm your rights, and accept the current legal documents.",
    ready: "Ready to record legal acceptance. Real generation remains disabled.",
    readyUpload: "Ready for private R2 upload. AI generation remains disabled.",
    saving: "Recording the current legal document versions…",
    demo: "Acceptance saved. Audio upload and AI generation remain disabled until release gates pass.",
    legalSaveFailed:
      "Acceptance was not recorded. Check the legal configuration and try again; generation remains blocked.",
    privacy: "Private by default",
    privacyDetail:
      "This release keeps selected files in your browser; upload and external AI processing are disabled.",
    privacyDetailActive:
      "Audio goes directly to private R2 for upload testing and is not sent to an AI provider. Use the delete control when finished.",
    privacyDetailMock:
      "Audio stays in private R2. Test candidates are synthetic tones created without an external AI provider and remain private.",
    logout: "Sign out",
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
    uploadSuccess: "私人上載已確認；AI 生成仍然關閉。",
    uploadSuccessMock: "私人上載已確認；現可建立兩個合成測試候選版本，外部 AI 仍然關閉。",
    uploadFailed: "未能確認私人上載。請檢查檔案後再試。",
    deleteUpload: "刪除私人上載",
    deletingUpload: "正在刪除私人上載……",
    deleteFailed: "未能刪除私人上載，請重試。",
    deleteJobFailed: "未能刪除私人 Mix，請重試。",
    createMock: "建立 2 個測試候選版本",
    creatingMock: "正在建立兩個私人合成測試候選版本……",
    replaceBlocked: "請先刪除已確認的私人上載，然後再選擇另一個檔案。",
    legalAcceptanceLead: "我接受現行",
    legalAnd: "及",
    privacyAcknowledgement: "並確認已閱讀",
    disabled: "請加入檔案、確認權利，並接受現行法律文件。",
    ready: "可保存法律接受紀錄；真實生成仍然關閉。",
    readyUpload: "可上載至私人 R2；AI 生成仍然關閉。",
    saving: "正在保存現行法律文件版本……",
    demo: "接受紀錄已保存。音訊上載及 AI 生成會維持關閉，直至全部上線關卡通過。",
    legalSaveFailed: "未能保存接受紀錄。請檢查法律設定後重試；生成功能仍被阻擋。",
    privacy: "預設保持私密",
    privacyDetail: "本版本只在瀏覽器處理所選檔案；上載及外部 AI 處理尚未啟用。",
    privacyDetailActive:
      "音訊會直接上載至私人 R2 作測試，不會送到 AI 供應商；完成後請使用刪除控制。",
    privacyDetailMock:
      "音訊只存於私人 R2；測試候選版本是無需外部 AI 供應商的合成音調，並保持私密。",
    logout: "登出",
  },
} satisfies Record<Language, Record<string, string>>;

const legalLinkCopy = {
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

const legalAcceptanceEnvelopeSchema = apiEnvelopeSchema(legalAcceptanceStatusSchema);
const legalManifestEnvelopeSchema = apiEnvelopeSchema(legalDocumentsManifestSchema);
const authMeEnvelopeSchema = apiEnvelopeSchema(
  z.object({
    capabilities: z
      .object({
        mockGeneration: z.boolean(),
        privateAudioUpload: z.boolean(),
        realGeneration: z.boolean(),
        retentionCleanup: z.boolean(),
      })
      .strict(),
    kind: z.enum(["authenticated", "development"]),
    ownerId: ownerIdSchema,
  }),
);
const mockApiEnabled = import.meta.env.DEV;

const presets: Preset[] = [
  {
    id: "soft-piano",
    name: { en: "Soft Piano", "zh-HK": "柔和鋼琴" },
    description: {
      en: "Gentle melody and quiet dynamics",
      "zh-HK": "柔和旋律與克制動態",
    },
    icon: <PianoIcon />,
  },
  {
    id: "music-box",
    name: { en: "Music Box", "zh-HK": "八音盒" },
    description: {
      en: "Delicate, sparse and dreamlike",
      "zh-HK": "輕盈、留白、夢幻",
    },
    icon: <MusicBoxIcon />,
  },
  {
    id: "lofi-study",
    name: { en: "Lo-fi Study", "zh-HK": "Lo-fi 學習" },
    description: {
      en: "Warm keys and restrained soft drums",
      "zh-HK": "溫暖琴鍵與柔和節拍",
    },
    icon: <HeadphonesIcon />,
  },
];

const waveformHeights = [
  17, 24, 31, 20, 38, 26, 45, 22, 34, 48, 29, 41, 25, 35, 19, 30, 23, 39, 28, 18,
];

export function App() {
  const path = window.location.pathname;
  const legalDocumentId = legalPathToDocumentId[path];

  if (path === "/" || path === "/index.html") {
    return <LandingPage />;
  }
  if (legalDocumentId !== undefined) {
    return <PublicLegalExperience documentId={legalDocumentId} />;
  }
  if (path === "/app" || path.startsWith("/app/")) {
    return <PrivateApp />;
  }
  return <LandingPage />;
}

function PrivateApp() {
  const [language, setLanguage] = useState<Language>("zh-HK");
  const [selectedPreset, setSelectedPreset] = useState<PresetId>("soft-piano");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [accessStatus, setAccessStatus] = useState<"checking" | "unavailable" | "verified">(
    "checking",
  );
  const [isSavingAcceptance, setIsSavingAcceptance] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<PublicJob | null>(null);
  const [jobError, setJobError] = useState<JobApiError | null>(null);
  const [jobDeletionFailed, setJobDeletionFailed] = useState(false);
  const [candidateSources, setCandidateSources] = useState<readonly [string, string] | null>(null);
  const [downloadRetryVersion, setDownloadRetryVersion] = useState(0);
  const [mockGenerationEnabled, setMockGenerationEnabled] = useState(false);
  const [privateAudioUploadEnabled, setPrivateAudioUploadEnabled] = useState(false);
  const [retentionCleanupEnabled, setRetentionCleanupEnabled] = useState(false);
  const [confirmedUpload, setConfirmedUpload] = useState<PublicUpload | null>(null);
  const jobIdempotencyKey = useRef<string | null>(null);
  const strings = copy[language];
  const selectedPresetName =
    presets.find((item) => item.id === selectedPreset)?.name[language] ?? "Soft Piano";
  const canGenerate =
    selectedFile !== null && rightsAccepted && legalAccepted && confirmedUpload === null;
  const canStartMockGeneration =
    confirmedUpload !== null && mockGenerationEnabled && rightsAccepted && legalAccepted;

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "en" ? "StudyMix AI | Private beta" : "StudyMix AI｜私密測試";
  }, [language]);

  useEffect(() => {
    const controller = new AbortController();
    const verifyAccess = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        const parsed = authMeEnvelopeSchema.safeParse(body);
        if (response.ok && parsed.success && parsed.data.error === null) {
          setMockGenerationEnabled(parsed.data.data.capabilities.mockGeneration);
          setPrivateAudioUploadEnabled(parsed.data.data.capabilities.privateAudioUpload);
          setRetentionCleanupEnabled(parsed.data.data.capabilities.retentionCleanup);
          setAccessStatus("verified");
          return;
        }
        setAccessStatus("unavailable");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccessStatus("unavailable");
        }
      }
    };

    void verifyAccess();
    return () => controller.abort();
  }, []);

  const activeJobId = activeJob?.jobId;
  const activeJobStatus = activeJob?.status;

  useEffect(() => {
    if (
      activeJobId === undefined ||
      activeJobStatus === undefined ||
      !isPendingJob(activeJobStatus)
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => {
        void getJob(activeJobId, controller.signal)
          .then((job) => {
            setActiveJob(job);
            setJobError(null);
          })
          .catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              setJobError(toJobApiError(error));
            }
          });
      },
      activeJobStatus === "created" ? 500 : 850,
    );

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeJobId, activeJobStatus]);

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
      try {
        const outputs = [...activeJob.outputs].sort(
          (first, second) => first.candidateIndex - second.candidateIndex,
        );
        const downloads = await Promise.all(
          outputs.map(
            async (output) => await getOutputDownload(output.outputId, controller.signal),
          ),
        );
        const first = downloads[0];
        const second = downloads[1];
        if (first === undefined || second === undefined) {
          throw new Error("Private output URLs are unavailable.");
        }
        setCandidateSources([first.downloadUrl, second.downloadUrl]);
        setJobError(null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setJobError(toJobApiError(error));
        }
      }
    };
    void loadPrivateOutputs();
    return () => controller.abort();
  }, [activeJob, candidateSources, downloadRetryVersion]);

  const setFile = (fileList: FileList | null) => {
    if (confirmedUpload !== null) {
      setNotice(strings.replaceBlocked);
      return;
    }
    const file = fileList?.item(0) ?? null;
    setSelectedFile(file);
    setNotice(null);
    jobIdempotencyKey.current = null;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files);
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
    setActiveJob(result.job);
    setCandidateSources(result.candidateSources);
    setJobError(null);
    setNotice(null);
  };

  const startPrivateMockJob = async () => {
    if (confirmedUpload === null || !mockGenerationEnabled) {
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
    setActiveJob(job);
    setCandidateSources(null);
    setJobError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setNotice(strings.saving);
    try {
      const response = await fetch("/api/legal/acceptances", {
        body: JSON.stringify({ documents: currentLegalAcceptanceDocuments }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      const parsed = legalAcceptanceEnvelopeSchema.safeParse(body);
      if (
        !response.ok ||
        !parsed.success ||
        parsed.data.error !== null ||
        !parsed.data.data.current
      ) {
        setNotice(strings.legalSaveFailed);
        return;
      }
      if (privateAudioUploadEnabled && selectedFile !== null) {
        setNotice(strings.uploading);
        try {
          const upload = await uploadAndConfirmAudio(selectedFile);
          setConfirmedUpload(upload);
          setNotice(mockGenerationEnabled ? strings.uploadSuccessMock : strings.uploadSuccess);
        } catch {
          setNotice(strings.uploadFailed);
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

  const handleCreatePrivateMockJob = async () => {
    if (!canStartMockGeneration || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setNotice(strings.creatingMock);
    try {
      await startPrivateMockJob();
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
      setRightsAccepted(false);
      setNotice(null);
      jobIdempotencyKey.current = null;
    } catch {
      setNotice(strings.deleteFailed);
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleRetry = async () => {
    setIsSavingAcceptance(true);
    setJobError(null);
    try {
      if (activeJob?.status === "completed") {
        setDownloadRetryVersion((version) => version + 1);
      } else if (confirmedUpload !== null && mockGenerationEnabled) {
        await startPrivateMockJob();
      } else {
        await startMockJob();
      }
    } catch (error) {
      setJobError(toJobApiError(error));
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleDeleteJob = async () => {
    if (activeJob === null || isPendingJob(activeJob.status) || isSavingAcceptance) {
      return;
    }
    setIsSavingAcceptance(true);
    setJobDeletionFailed(false);
    try {
      if (!(mockApiEnabled && confirmedUpload === null)) {
        await deleteJob(activeJob.jobId);
      }
      handleStartOver();
    } catch {
      setJobDeletionFailed(true);
    } finally {
      setIsSavingAcceptance(false);
    }
  };

  const handleStartOver = () => {
    setActiveJob(null);
    setJobError(null);
    setJobDeletionFailed(false);
    setCandidateSources(null);
    setSelectedFile(null);
    setRightsAccepted(false);
    setLegalAccepted(false);
    setNotice(null);
    setConfirmedUpload(null);
    setDownloadRetryVersion(0);
    jobIdempotencyKey.current = null;
  };

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="app-header">
        <a className="brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
        <div className="header-actions">
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
          <a className="logout-link" href="/cdn-cgi/access/logout">
            {strings.logout}
          </a>
        </div>
      </header>

      <main>
        <AccessVerificationStatus language={language} status={accessStatus} />
        {accessStatus === "verified" ? (
          activeJob !== null || jobError !== null ? (
            <JobExperience
              candidateSources={candidateSources}
              error={jobError}
              deletionError={jobDeletionFailed ? strings.deleteJobFailed : null}
              filename={selectedFile?.name ?? "—"}
              isRetrying={isSavingAcceptance}
              job={activeJob}
              language={language}
              onDelete={() => void handleDeleteJob()}
              presetName={selectedPresetName}
              onRetry={() => void handleRetry()}
              onStartOver={handleStartOver}
            />
          ) : (
            <>
              <form className="mix-workspace" onSubmit={(event) => void handleSubmit(event)}>
                <UploadPanel
                  language={language}
                  privateAudioUploadEnabled={privateAudioUploadEnabled}
                  retentionCleanupEnabled={retentionCleanupEnabled}
                  selectedFile={selectedFile}
                  onFileChange={handleFileChange}
                  onDrop={handleDrop}
                />

                <section className="setup-panel" aria-labelledby="page-title">
                  <div className="intro">
                    <h1 id="page-title">{strings.heading}</h1>
                    <p>{strings.lede}</p>
                  </div>

                  <fieldset className="preset-fieldset">
                    <legend>{strings.presetTitle}</legend>
                    <div className="preset-grid">
                      {presets.map((item) => (
                        <label
                          className={`preset-option${selectedPreset === item.id ? " is-selected" : ""}`}
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
                            }}
                          />
                          <span className="preset-icon" aria-hidden="true">
                            {item.icon}
                          </span>
                          <strong>{item.name[language]}</strong>
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
                      {selectedFile?.name ?? "—"}
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
                      <span>{privateAudioUploadEnabled ? strings.upload : strings.generate}</span>
                    </button>
                  ) : mockGenerationEnabled ? (
                    <button
                      className="generate-button"
                      type="button"
                      disabled={!canStartMockGeneration || isSavingAcceptance}
                      onClick={() => void handleCreatePrivateMockJob()}
                    >
                      <SparkleIcon />
                      <span>{strings.createMock}</span>
                    </button>
                  ) : null}
                  <p
                    className={`form-status${canGenerate || canStartMockGeneration ? " is-ready" : ""}`}
                    aria-live="polite"
                  >
                    {notice ??
                      (confirmedUpload !== null
                        ? mockGenerationEnabled
                          ? strings.uploadSuccessMock
                          : strings.uploadSuccess
                        : canGenerate
                          ? privateAudioUploadEnabled
                            ? strings.readyUpload
                            : strings.ready
                          : strings.disabled)}
                  </p>
                  {confirmedUpload !== null ? (
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
                    {privateAudioUploadEnabled
                      ? mockGenerationEnabled
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

function PublicLegalExperience({ documentId }: { documentId: LegalDocumentId }) {
  const [language, setLanguage] = useState<Language>("zh-HK");
  const [legalContactEmail, setLegalContactEmail] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${legalPageContent[documentId].title[language]} | StudyMix AI`;
  }, [documentId, language]);

  useEffect(() => {
    const controller = new AbortController();
    const loadLegalManifest = async () => {
      try {
        const response = await fetch("/legal/documents.json", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        const parsed = legalManifestEnvelopeSchema.safeParse(body);
        if (response.ok && parsed.success && parsed.data.error === null) {
          setLegalContactEmail(parsed.data.data.contactEmail);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLegalContactEmail(null);
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
          <a className="logout-link" href="/app">
            {language === "en" ? "Invited tester sign in" : "受邀測試者登入"}
          </a>
        </div>
      </header>
      <main>
        <LegalDocumentPage
          contactEmail={legalContactEmail}
          documentId={documentId}
          language={language}
        />
        <SiteFooter language={language} />
      </main>
    </div>
  );
}

function AccessVerificationStatus({
  language,
  status,
}: {
  language: Language;
  status: "checking" | "unavailable" | "verified";
}) {
  const statusCopy = {
    en: {
      checking: "Verifying private-beta access…",
      unavailable: "Access could not be verified. Sign in again before testing the app.",
      verified: "Private-beta access verified. This session is approved for testing.",
    },
    "zh-HK": {
      checking: "正在驗證私密測試存取權……",
      unavailable: "未能驗證存取權；請重新登入後再測試應用程式。",
      verified: "私密測試存取權已驗證；此工作階段可進行測試。",
    },
  } satisfies Record<Language, Record<typeof status, string>>;

  return (
    <section className={`access-verification is-${status}`} role="status">
      <ShieldIcon />
      <span>{statusCopy[language][status]}</span>
      {status === "unavailable" ? (
        <a href="/app">{language === "en" ? "Sign in again" : "重新登入"}</a>
      ) : null}
    </section>
  );
}

function LegalDocumentPage({
  contactEmail,
  documentId,
  language,
}: {
  contactEmail: string | null;
  documentId: LegalDocumentId;
  language: Language;
}) {
  const document = legalPageContent[documentId];
  const pageCopy =
    language === "en"
      ? {
          contact: "Contact for privacy, rights, security, and legal requests",
          contactPending:
            "The production contact is not configured. Public launch and real generation are blocked.",
          draft:
            "Pre-release legal draft · Audio upload and external AI generation are disabled · Hong Kong legal review is required before public launch",
          effective: "Document version",
        }
      : {
          contact: "私隱、權利、保安及法律要求聯絡方法",
          contactPending: "正式聯絡方法尚未設定；公開推出及真實生成會維持關閉。",
          draft: "推出前法律草案 · 音訊上載及外部 AI 生成尚未啟用 · 公開推出前須完成香港法律審閱",
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
        {contactEmail === null ? (
          <p>{pageCopy.contactPending}</p>
        ) : (
          <p>
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
        )}
      </section>
    </article>
  );
}

function SiteFooter({ language }: { language: Language }) {
  const links = legalLinkCopy[language];
  const footerText = language === "en" ? "Authenticated private beta" : "須登入的私密測試";

  return (
    <footer className="site-footer">
      <span>StudyMix AI · {footerText}</span>
      <nav aria-label={language === "en" ? "Legal documents" : "法律文件"}>
        <a href="/legal/terms">{links.terms}</a>
        <a href="/legal/privacy">{links.privacyNotice}</a>
        <a href="/legal/acceptable-use">{links.acceptableUse}</a>
        <a href="/legal/ai-output-notice">{links.aiOutputNotice}</a>
      </nav>
    </footer>
  );
}

type UploadPanelProps = {
  language: Language;
  privateAudioUploadEnabled: boolean;
  retentionCleanupEnabled: boolean;
  selectedFile: File | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
};

function UploadPanel({
  language,
  privateAudioUploadEnabled,
  retentionCleanupEnabled,
  selectedFile,
  onFileChange,
  onDrop,
}: UploadPanelProps) {
  const strings = copy[language];

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
          className="visually-hidden"
          type="file"
          accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*"
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
        <div className="file-preview">
          <div className="file-tile" aria-hidden="true">
            <WaveFileIcon />
          </div>
          <div className="file-copy">
            <strong>{selectedFile.name}</strong>
            <span>
              {(selectedFile.type || "audio").replace("audio/", "").toUpperCase()} ·{" "}
              {formatBytes(selectedFile.size)}
            </span>
          </div>
          <span className="file-check" aria-label="File selected">
            <CheckIcon />
          </span>
          <div className="mini-player" aria-hidden="true">
            <span className="mini-play">
              <PlayIcon />
            </span>
            <span className="waveform">
              {waveformHeights.map((height, index) => (
                <i key={`${height}-${index}`} style={{ height }} />
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

function UploadIcon() {
  return (
    <IconBase>
      <path d="M7.5 18.5H6a4 4 0 0 1-.7-7.9A6.5 6.5 0 0 1 18 9.2a4.8 4.8 0 0 1 0 9.5h-1.5" />
      <path d="m9 14 3-3 3 3M12 11v10" />
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

function PianoIcon() {
  return (
    <IconBase>
      <path d="M5 10c1-4 4-6 9-6h3v8H5v-2Z" />
      <path d="M5 12h14v4H5zM7 16v4M17 16v4M9 12v4M12 12v4M15 12v4" />
    </IconBase>
  );
}

function MusicBoxIcon() {
  return (
    <IconBase>
      <path d="M5 9h14v10H5zM8 6h8l2 3H6l2-3Z" />
      <path d="M9 13h6M12 13v4M16 4c2-2 3-1 3 1v2" />
    </IconBase>
  );
}

function HeadphonesIcon() {
  return (
    <IconBase>
      <path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2ZM20 13h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" />
    </IconBase>
  );
}
