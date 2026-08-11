# Product UI concept

The active visual source of truth is the relaxed, study-focused v2 direction:

- `public-landing-hero-concept.png` — public product overview hero and protected-workspace preview.
- `public-landing-page-concept.png` — full desktop landing-page direction.
- `public-landing-mobile-concept.png` — mobile landing-page direction.
- `implementation-public-desktop.png` — verified desktop implementation capture.
- `implementation-public-mobile.png` — verified mobile implementation capture.
- `style-expansion-landing-desktop-concept.png` — original five-style public overview baseline.
- `style-expansion-dashboard-desktop-concept.png` — original five-style private workspace baseline.
- `style-expansion-dashboard-mobile-concept.png` — compact two-column mobile workspace direction.
- `implementation-style-expansion-public-desktop.png` — historical five-style public desktop capture.
- `implementation-style-expansion-public-mobile.png` — historical five-style public mobile capture.
- `implementation-style-expansion-app-desktop.png` — historical five-style private desktop capture.
- `implementation-style-expansion-app-mobile.png` — historical five-style private mobile capture.
- `upload-flow-concept-v2.png` — upload, preset selection, rights declaration, and confirmation.
- `results-concept-v2.png` — completed job summary and two-candidate comparison.

The original neutral SaaS explorations are retained as `upload-flow-concept.png` and
`results-concept.png` for design history only.

## Publication and evidence boundary

- Every concept and implementation capture uses synthetic example content only. Do not add real
  user audio, filenames, account details, logs, analytics, deployment identifiers, or production
  records.
- Files named `implementation-` are historical local visual checks, not proof of the current
  production deployment, configuration, retention behavior, or vendor data handling.
- Any privacy, deletion, expiry, storage, or model-training wording visible inside a PNG is a design
  target only. Current runtime flags, reviewed legal text, and `docs/TODO.md` supersede image text.
- Reusing these images as production, compliance, legal, or operational evidence requires a new
  human review against the deployed version.

## Design system extraction

- Original anime-inspired blue-hour study room with no reference to a specific franchise or artist.
- Dusky periwinkle and lavender atmosphere, warm peach lamp light, and muted mint foliage.
- Cream-white readable surfaces, deep blue-violet text, and muted indigo interactions.
- Soft shadows, subtle paper texture, and purposeful 18–24 px radii.
- Friendly rounded display typography paired with disciplined sans-serif UI typography.
- Outline waveform/audio icons with consistent optical weight.
- Open two-part workspace on desktop, collapsing to one column on mobile.
- Compact six-card preset row on wide screens; a balanced two-column, three-row grid on narrow
  screens.
- Acoustic Ease uses a paired guitar-and-piano outline; Slowwave uses a calm waveform outline. Both
  follow the existing code-native icon weight and selection treatment.
- Kissa Jazzhop uses a coffee cup, steam, and musical-note outline that follows the same optical
  weight and selection treatment.

All real application text, controls, waveforms, status, audio playback, and interactions must be
implemented as accessible code-native React UI. The concept PNG files are specifications, not production
interface assets. Browser captures beginning with `implementation-` record a local visual check at the
time they were created.
