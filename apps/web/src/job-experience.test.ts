import { apiErrorCodes } from "@studymix/contracts";
import { describe, expect, it } from "vitest";
import { JobApiError } from "./job-api";
import { safeErrorMessage } from "./job-experience";

const jobErrorCodes = [...apiErrorCodes, "INVALID_RESPONSE", "NETWORK_ERROR"] as const;
type JobErrorCode = JobApiError["code"];

const expectedSafeMessages = {
  CONFLICT: {
    en: "The request or service response was invalid. Review the input and try again.",
    "zh-HK": "要求或服務回應無效，請檢查輸入後再試。",
  },
  ENTITLEMENT_REQUIRED: {
    en: "Private beta access is not available for this account. Sign in with an approved account before continuing.",
    "zh-HK": "此帳戶目前沒有私密 Beta 使用權。請以已獲批准的帳戶登入後再繼續。",
  },
  FORBIDDEN: {
    en: "Private beta access is not available for this account. Sign in with an approved account before continuing.",
    "zh-HK": "此帳戶目前沒有私密 Beta 使用權。請以已獲批准的帳戶登入後再繼續。",
  },
  ILLEGAL_JOB_TRANSITION: {
    en: "The request or service response was invalid. Review the input and try again.",
    "zh-HK": "要求或服務回應無效，請檢查輸入後再試。",
  },
  INSUFFICIENT_CREDITS: {
    en: "There are not enough beta credits to create this mix. Return to your private upload and try again after credits are updated.",
    "zh-HK": "目前沒有足夠 Beta 額度建立這個 Mix。請返回私人上載，待額度更新後再試。",
  },
  INTERNAL_ERROR: {
    en: "The private service had a temporary problem. Retry if the option is available, or try again later.",
    "zh-HK": "私人服務暫時出現問題。如畫面提供「再試一次」，可先重試；否則請稍後再試。",
  },
  INVALID_RESPONSE: {
    en: "The request or service response was invalid. Review the input and try again.",
    "zh-HK": "要求或服務回應無效，請檢查輸入後再試。",
  },
  LEGAL_ACCEPTANCE_REQUIRED: {
    en: "Accept the current legal documents before creating a study mix.",
    "zh-HK": "建立 Study Mix 前，請先接受現行法律文件。",
  },
  LEGAL_DOCUMENT_VERSION_MISMATCH: {
    en: "Accept the current legal documents before creating a study mix.",
    "zh-HK": "建立 Study Mix 前，請先接受現行法律文件。",
  },
  NETWORK_ERROR: {
    en: "The private job service could not be reached. Check your connection and try again.",
    "zh-HK": "未能連接私人工作服務，請檢查網絡後再試。",
  },
  NOT_FOUND: {
    en: "The private upload or job is no longer available.",
    "zh-HK": "私人上載或工作已不可用。",
  },
  OUTPUT_EXPIRED: {
    en: "One or more private playback files have expired, so this mix can no longer be played. Delete this private mix and create a new one if needed.",
    "zh-HK":
      "一個或多個私人播放檔案已到期，因此這個 Mix 已無法播放。如有需要，請刪除這個私人 Mix 後再建立新的 Mix。",
  },
  OUTPUT_NOT_READY: {
    en: "One or more private playback files are not ready yet. Try again to request a fresh pair of playback links.",
    "zh-HK": "一個或多個私人播放檔案尚未準備好。請再試一次，以取得一對新的播放連結。",
  },
  PRESET_NOT_FOUND: {
    en: "The request or service response was invalid. Review the input and try again.",
    "zh-HK": "要求或服務回應無效，請檢查輸入後再試。",
  },
  PROVIDER_UNAVAILABLE: {
    en: "The private generation service could not complete this study mix.",
    "zh-HK": "私人生成服務未能完成這個 Study Mix。",
  },
  RATE_LIMITED: {
    en: "The generation limit has been reached. Wait before trying again.",
    "zh-HK": "已達生成上限，請稍後再試。",
  },
  RIGHTS_DECLARATION_REQUIRED: {
    en: "Confirm that you have the rights needed to use this audio before creating a study mix.",
    "zh-HK": "建立 Study Mix 前，請確認你擁有使用此音訊所需的權利。",
  },
  UNAUTHORIZED: {
    en: "Private beta access is not available for this account. Sign in with an approved account before continuing.",
    "zh-HK": "此帳戶目前沒有私密 Beta 使用權。請以已獲批准的帳戶登入後再繼續。",
  },
  UPLOAD_EXPIRED: {
    en: "The private upload has expired. Return to the upload step, delete it, and choose the file again.",
    "zh-HK": "私人上載已到期。請返回上載步驟，刪除該上載後重新選擇檔案。",
  },
  UPLOAD_NOT_CONFIRMED: {
    en: "The private upload was not confirmed. Return to the upload step, delete it, and choose the file again.",
    "zh-HK": "私人上載未完成確認。請返回上載步驟，刪除該上載後重新選擇檔案。",
  },
  VALIDATION_ERROR: {
    en: "The request or service response was invalid. Review the input and try again.",
    "zh-HK": "要求或服務回應無效，請檢查輸入後再試。",
  },
} satisfies Record<JobErrorCode, Record<"en" | "zh-HK", string>>;

describe("private job error presentation", () => {
  it("keeps the executable matrix aligned with the typed code union", () => {
    expect(new Set(jobErrorCodes)).toEqual(new Set(Object.keys(expectedSafeMessages)));
  });

  it.each(jobErrorCodes)("renders only reviewed local copy for %s", (code) => {
    const serverOnlyDetail = "Synthetic server-only detail req_synthetic_private";
    const error = new JobApiError({
      code,
      message: serverOnlyDetail,
      requestId: "req_synthetic_private",
      retryable: true,
    });

    expect(safeErrorMessage(error, null, "en")).toBe(expectedSafeMessages[code].en);
    expect(safeErrorMessage(error, null, "zh-HK")).toBe(expectedSafeMessages[code]["zh-HK"]);
    expect(safeErrorMessage(error, null, "en")).not.toContain(serverOnlyDetail);
    expect(safeErrorMessage(error, null, "zh-HK")).not.toContain("req_synthetic_private");
  });
});
