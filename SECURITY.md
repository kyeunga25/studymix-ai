# 安全政策 / Security Policy

## 私密回報 / Private reporting

如發現漏洞，請透過 GitHub Security 頁面的私人漏洞回報或私人 security advisory
通知維護者。不要在公開 issue、PR 或 discussion 張貼 token、音訊、使用者資料、
簽署 URL、Cloudflare identifier、私人 hostname 或可直接利用的重現資料。

Report vulnerabilities through GitHub's private vulnerability reporting or a
private security advisory. Do not put credentials, audio, user data, signed
URLs, deployment identifiers, private hostnames, or actionable exploit details
in public issues, pull requests, or discussions.

## 支援及邊界 / Support and boundaries

- 安全修正以預設分支最新原始碼為準；本機、CI 或 preview 結果不代表 production。
- 只使用合成資料重現，並只測試你擁有或明確獲准的帳戶及資源。
- 每項 API 讀寫均須在 Access 驗證後重新核對 owner、workspace 及 membership；
  client-side 隱藏控制不構成授權。
- 私人 R2 音訊不得以永久公開 URL 提供；簽署 URL 視為 bearer credential。
- 外部 AI、正式上載及清理能力預設關閉；缺少設定時必須 fail closed。
- Secret 只可存於被 Git 忽略的 `.env*`／`.dev.vars*` 或受控 secret store。

Security fixes target the latest default-branch source. Every protected read or
write must recheck the owner, workspace, and membership after Access
verification. Client-side UI state is not authorization. Private audio must not
be exposed through permanent public URLs, and provider capabilities must fail
closed when configuration is missing.

完整公開邊界見 [`docs/PUBLICATION_SAFETY.md`](docs/PUBLICATION_SAFETY.md)。
