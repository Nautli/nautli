# Brand Assets — SLAB & nautli (v1)

Two ready-to-deploy identity kits. Each brand folder is self-contained.

## Structure (per brand)
- `BRAND.html` / `BRAND.png` — brand one-pager (logo, colour tokens, clear space, min size, do/don't, asset index)
- `svg/`      — master vector logos (scale to any size, edit here)
- `png/`      — rasterised app icons + wordmark/mark exports
- `favicon/`  — favicon PNGs (16–180) + `*.ico`

## SLAB — graded-card resale
- Palette: Ink `#141414`, Cream `#F5F1E8`, app-icon gradient `#2E2E33→#0D0D0F`. Strictly monochrome.
- Wordmark: L and A are connected (one solid "slab"). Min height 22px; below that use the app-icon.
- Web favicon: `favicon/slab-favicon.ico` (+ PNG 16/32/48). iOS: `png/slab-appicon-180.png`. Store: `png/slab-appicon-1024.png`.

## nautli — cross-AI memory
- Palette: Ink `#141414`, Teal `#00E6A1` (bright `#00E6A1` on dark), Off-white `#F7F7F5`. One teal accent only.
- NEVER use warm clay-orange / cream (reads as another AI house style).
- Mark: open ~1.5-turn spiral, centred teal memory-point touching the stroke. Min 24px; below that use the favicon.
- Web favicon: `favicon/nautli-favicon.ico`. iOS: `png/nautli-appicon-180.png`. Store: `png/nautli-appicon-1024.png`.

## Also included (per brand)
- `android/`     — adaptive icon layers: `*-ic_background.png` + `*-ic_foreground.png` (432²), `*-ic_composited.png`, `_mask-preview.png`
- `og/`          — Open Graph share image `*-og-1200x630.png`
- `screenshots/` — App Store marketing panels `*-store-1..3.png` (1290×2796) + editable `.html` templates


## v2 (2026-07-19) — Neon Green

액센트를 Teal `#087A6B` → **Neon Green `#00E6A1`** 로 교체. 색상 172도 → 162도(8도 이웃)라 나선 마크의 실루엣과 인상은 그대로다. v1 킷은 `../nautli-v1-teal/`에 보존.

### 네온은 채움색이다 — 그라운드로 값이 갈린다
| 그라운드 | 액센트 | 자산 |
|---|---|---|
| 다크 `#141414` | `#00E6A1` (11.26:1) | appicon, favicon, mark-white, lockup-dark, og, android |
| 라이트 `#F7F7F5` | `#007A58` (4.99:1) | mark, lockup |

`#00E6A1`을 라이트 배경 위에 올리면 대비가 **1.55:1** 이라 사라진다. 라이트 그라운드 자산에는 절대 쓰지 마라.

### v1에서 바뀐 구성
- **favicon에 다크 라운드 그라운드 추가** — 기존엔 투명 배경 + 잉크 나선이라 네온 점이 16px에서 안 보였다. 이제 appicon과 같은 구성(니어블랙 판 + 오프화이트 나선 + 네온 점)이라 브라우저 크롬이 밝든 어둡든 읽힌다.
- **OG를 라이트 → 다크 그라운드로 반전** — 사이트가 다크 전용으로 갔다(`nautli/site/DESIGN.md` v3). `svg/nautli-og.svg` 마스터 신설.
- android adaptive 전경은 v1과 bbox 픽셀 동일(140x165 @159,121).
