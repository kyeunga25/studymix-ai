import { useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";

type Language = "en" | "zh-HK";
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
    retention: "Source deleted within 72 hours. Outputs expire after 7 days.",
    presetTitle: "Choose a study mix style",
    rights:
      "I own this recording or have permission to upload, process, and create an adapted version of it.",
    summary: "Your selection",
    file: "File",
    preset: "Preset",
    candidates: "Candidates",
    generate: "Generate 2 candidates",
    disabled: "Add a file and confirm your permission to continue.",
    ready: "Everything is ready. Your file stays private.",
    demo: "The interface is ready. API generation will be connected in the next product phases.",
    privacy: "Private by default",
    privacyDetail: "No public result pages and no training on your upload.",
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
    retention: "來源音訊會在 72 小時內刪除，輸出則於 7 日後到期。",
    presetTitle: "選擇你的 Study Mix 風格",
    rights: "我擁有此錄音，或已獲准上載、處理及製作其改編版本。",
    summary: "你的選擇",
    file: "檔案",
    preset: "風格",
    candidates: "候選版本",
    generate: "生成 2 個候選版本",
    disabled: "請加入檔案並確認你已獲授權。",
    ready: "準備完成，你的檔案會保持私密。",
    demo: "介面已準備好；API 生成流程會在下一個產品階段接通。",
    privacy: "預設保持私密",
    privacyDetail: "不設公開結果頁，亦不會使用你的音訊作模型訓練。",
  },
} satisfies Record<Language, Record<string, string>>;

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
  const [language, setLanguage] = useState<Language>("en");
  const [selectedPreset, setSelectedPreset] = useState<PresetId>("soft-piano");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const strings = copy[language];
  const selectedPresetName =
    presets.find((item) => item.id === selectedPreset)?.name[language] ?? "Soft Piano";
  const canGenerate = selectedFile !== null && rightsAccepted;

  const setFile = (fileList: FileList | null) => {
    const file = fileList?.item(0) ?? null;
    setSelectedFile(file);
    setNotice(null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setFile(event.dataTransfer.files);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate) {
      return;
    }
    setNotice(strings.demo);
  };

  return (
    <div className="app-shell">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="app-header">
        <a className="brand" href="/" aria-label="StudyMix AI home">
          <BrandMark />
          <span>StudyMix AI</span>
        </a>
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
      </header>

      <main>
        <form className="mix-workspace" onSubmit={handleSubmit}>
          <UploadPanel
            language={language}
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

            <button className="generate-button" type="submit" disabled={!canGenerate}>
              <SparkleIcon />
              <span>{strings.generate}</span>
            </button>
            <p className={`form-status${canGenerate ? " is-ready" : ""}`} aria-live="polite">
              {notice ?? (canGenerate ? strings.ready : strings.disabled)}
            </p>
          </section>
        </form>

        <aside className="privacy-note">
          <ShieldIcon />
          <div>
            <strong>{strings.privacy}</strong>
            <span>{strings.privacyDetail}</span>
          </div>
        </aside>
      </main>
    </div>
  );
}

type UploadPanelProps = {
  language: Language;
  selectedFile: File | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
};

function UploadPanel({ language, selectedFile, onFileChange, onDrop }: UploadPanelProps) {
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
        <span>{strings.retention}</span>
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
