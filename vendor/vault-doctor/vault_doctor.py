#!/usr/bin/env python3
"""옵시디언/마크다운 볼트 헬스체크 — 중복·모순·junk를 스캔해 사람 언어 리포트를 만든다.

사용법:
    python3 vault_doctor.py <볼트경로> [옵션]

데이터 경계 (정직하게): 이 도구 자체는 아무것도 업로드하지 않고(제3자 서버 0,
텔레메트리 0), 리포트도 로컬 파일이다. 단 LLM 판정은 본인의 claude CLI(구독)
경유라 분석 대상 텍스트가 Anthropic API로 전송된다 — 경계는 "내가 Claude를
쓸 때"와 동일. 민감 폴더는 --exclude로 판정 경로에서 제외할 수 있다.

파이프라인 (전 스테이지 멱등 — 중단 후 재실행하면 이어서 돈다):
    scan → manifest → extract(haiku) → pair → judge(sonnet) → junk(sonnet) → report
원형: Nightmerge(구 onebrain) PoC / bug4city/onebrain-vault-holdout-kit v2 (extract_prompt v2가 정본)
"""
import argparse
import collections
import concurrent.futures as cf
import datetime
import fnmatch
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata

# ── 브랜드 (이름 미정 — 여기 한 곳만 바꾸면 전체 반영) ──────────────────────
BRAND = "vault-doctor"

PKG_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_lang():
    override = os.environ.get("NAUTLI_LANG", "").lower()
    if override in ("ko", "en"):
        return override
    detected = os.environ.get("LC_ALL") or os.environ.get("LANG") or ""
    return "ko" if detected.lower().startswith("ko") else "en"


_LANG = _resolve_lang()

_T = {
    "docstring": {
        "en": "Obsidian/Markdown vault health check \u2014 scans duplicates, contradictions, and junk to produce a human-language report.",
        "ko": "옵시디언/마크다운 볼트 헬스체크 \u2014 중복\u00b7모순\u00b7junk를 스캔해 사람 언어 리포트를 만든다.",
    },
    "axis_junk": { "en": "Discardable fragments", "ko": "버려도 되는 조각" },
    "axis_contradiction": { "en": "Contradictions", "ko": "모순" },
    "axis_duplicate": { "en": "Duplicates", "ko": "중복" },
    "axis_structure": { "en": "Structure", "ko": "구조" },
    "report_title": { "en": "# {brand} report, {name}", "ko": "# {brand} 리포트, {name}" },
    "report_meta": {
        "en": "\nGenerated {today} \u00b7 vault `{vault}` \u00b7 no third-party servers \u00b7 AI judgments via your own Claude subscription \u00b7 report is a local file\n",
        "ko": "\n생성일 {today} \u00b7 볼트 `{vault}` \u00b7 제3자 서버 0 \u00b7 AI 판정은 본인 Claude 구독 경유 \u00b7 리포트는 로컬 파일\n",
    },
    "score_heading": { "en": "## AI taste-test signal: **{score}/100**\n", "ko": "## AI 맛보기 신호: **{score}/100**\n" },
    "score_breakdown": {
        "en": "Taste-test signal breakdown: discardable fragment ratio 40pts + contradiction density 30pts + duplicate density 20pts + structure (frontmatter, dead links) 10pts. Formula in README.\n",
        "ko": "맛보기 신호 구성: 버려도 되는 조각 비율 40점 + 모순 밀도 30점 + 중복 밀도 20점 + 구조(머리말 정보\u00b7죽은 링크) 10점. 공식은 README에 있습니다.\n",
    },
    "table_header": { "en": "| Axis | Score | Max |", "ko": "| 축 | 점수 | 만점 |" },
    "waste_heading": { "en": "\n## Waste signals: local facts and AI taste-test signals\n", "ko": "\n## 낭비 신호: 로컬 실측과 AI 맛보기 신호\n" },
    "waste_local_confirmed": {
        "en": "- Local exact-duplicate scan: **confirmed duplicate text, at least {dup_kb}KB**.",
        "ko": "- 로컬 정확중복 검사: **확인된 중복 텍스트 최소 {dup_kb}KB**.",
    },
    "waste_local_none": {
        "en": "- Local exact-duplicate scan found 0KB of confirmed duplicate text.",
        "ko": "- 로컬 정확중복 검사에서 확인된 중복 텍스트는 0KB입니다.",
    },
    "waste_local_unmeasured": {
        "en": "- Local exact-duplicate text was not measured for this legacy run.",
        "ko": "- 이 레거시 실행에서는 로컬 정확중복 텍스트를 측정하지 못했습니다.",
    },
    "waste_ai_positive": {
        "en": "- AI taste-test signal: about **{waste_pct}%** duplicate or stale-fragment signals. This was calculated from a selected sample that prioritizes records likely to be duplicates; it is not the whole vault's waste rate or an estimated savings rate.",
        "ko": "- AI 맛보기 신호: 중복\u00b7낡은 조각 신호 약 **{waste_pct}%**. 중복 가능성이 높은 기록을 우선 포함한 선택 표본에서 계산했습니다. 전체 볼트의 낭비율이나 예상 절감률이 아닙니다.",
    },
    "waste_ai_none": {
        "en": "- This AI taste test found no waste signals. Not finding one does not mean the whole vault is clean.",
        "ko": "- 이번 AI 맛보기에서는 낭비 신호를 찾지 못했습니다. 미발견은 전체 볼트가 깨끗하다는 뜻이 아닙니다.",
    },
    "waste_ai_unmeasured": {
        "en": "- This AI taste test could not measure waste signals. The state of the whole vault cannot be determined.",
        "ko": "- 이번 AI 맛보기의 낭비 신호를 측정하지 못했습니다. 전체 볼트 상태는 판단할 수 없습니다.",
    },
    "scan_heading": { "en": "\n## Vault scan summary\n", "ko": "\n## 볼트 스캔 요약\n" },
    "scan_notes": {
        "en": "- **{notes}** notes ({kb}KB), {fm_pct}% have frontmatter",
        "ko": "- 노트 **{notes}개** ({kb}KB), 머리말 정보가 있는 노트 {fm_pct}%",
    },
    "scan_dead_links": {
        "en": "- {wikilinks} wikilinks, **{dead} dead link(s)** ({dl_pct}%). `[[links]]` whose target note does not exist.",
        "ko": "- 위키링크 {wikilinks}개 중 **죽은 링크 {dead}개** ({dl_pct}%). 대상 노트가 없는 `[[링크]]`입니다.",
    },
    "scan_atoms": {
        "en": "- **{atoms}** memory fragments extracted from notes, {pairs} candidate pairs judged",
        "ko": "- 노트에서 추출한 기억 조각 **{atoms}건**, 서로 비슷한 후보쌍 {pairs}건 판정",
    },
    "scan_sources": {
        "en": "- Sample files per source: {samples}",
        "ko": "- 소스별 표본 파일: {samples}",
    },
    "findings_heading": { "en": "\n## Findings\n", "ko": "\n## 발견 사항\n" },
    "findings_dups": {
        "en": "- **{total} duplicate pair(s)**. The same thing written in two or more places. {hi} pair(s) are definite duplicates (auto-merge level), {mid} need human confirmation",
        "ko": "- **중복 {total}쌍**. 같은 얘기가 두 곳 이상에 적혀 있음. 그중 {hi}쌍은 확실한 중복(자동 병합 가능 수준), {mid}쌍은 사람 확인 필요",
    },
    "findings_contras": {
        "en": "- **{total} contradiction pair(s)**. Conflicting records (one may be outdated). All included in the questions below",
        "ko": "- **모순 {total}쌍**. 서로 부딪히는 기록(한쪽이 낡았을 가능성). 전부 아래 질문 대상",
    },
    "findings_cross": {
        "en": "- **{total} cross-source contradiction pair(s)**. Found between different AI memory sources",
        "ko": "- **교차소스 모순 {total}쌍**. 서로 다른 AI 기억 소스 사이에서 발견",
    },
    "findings_junk": {
        "en": "- **Discardable fragment ratio approx {pct}%** ({sample} items checked by AI). Fragments with low memory value such as narratives, one-off records, and todos. Types: {types}",
        "ko": "- **버려도 되는 조각 비율 약 {pct}%** (표본 {sample}건을 AI로 확인). 서사, 일회성 기록, 할 일처럼 기억할 가치가 낮은 조각의 비율입니다. 유형: {types}",
    },
    "findings_junk_fail": {
        "en": "- Discardable fragment ratio: measurement failed (check run.log)",
        "ko": "- 버려도 되는 조각 비율: 측정 실패 (run.log 확인)",
    },
    "findings_extract_fail": {
        "en": "- \u26a0\ufe0f **{failed}/{total}** extraction batch(es) failed (timeout/error). Those notes were skipped. Re-running the same command will retry only the failed batches",
        "ko": "- \u26a0\ufe0f 추출 실패 묶음 **{failed}/{total}개** (시간 초과/오류). 이 몫의 노트는 이번 진단에서 빠짐. 같은 명령을 재실행하면 실패분만 이어서 시도한다",
    },
    "questions_heading": {
        "en": "\n## Questions to answer (top {shown} / total {total})\n",
        "ko": "\n## 답할 질문 (상위 {shown}개 / 전체 {total}건)\n",
    },
    "questions_priority": {
        "en": "**Start here**: Look at 'outdated record' questions first. The real risk is AI or your future self picking up the wrong version. Duplicates are less urgent since no information is lost. In a large vault, duplicates and contradictions appear naturally, so answering the questions matters more than the score.\n",
        "ko": "**먼저 할 것**: '낡은 기록' 질문부터 보세요. AI와 미래의 내가 실제로 잘못 가져갈 위험은 거기에 있습니다. 중복은 정보가 사라지지 않아 급하지 않습니다. 볼트가 크면 중복과 모순은 자연스럽게 생기므로 점수보다 질문에 답하는 편이 더 유용합니다.\n",
    },
    "questions_none": { "en": "No questions to answer. \U0001f389", "ko": "답할 질문이 없습니다. \U0001f389" },
    "card_stale_label": { "en": "Outdated record (update needed)", "ko": "낡은 기록(갱신 필요)" },
    "card_stale_head": {
        "en": "One side appears to be outdated. Keep the newer one.",
        "ko": "한쪽이 낡은 기록으로 보입니다. 최신 쪽을 기준으로 정리하세요.",
    },
    "card_contra_label": { "en": "Contradiction", "ko": "모순" },
    "card_contra_head": {
        "en": "These two records conflict. Which one is correct now?",
        "ko": "이 두 기록이 서로 부딪힙니다. 지금은 어느 쪽이 맞나요?",
    },
    "card_dup_label": { "en": "Duplicate (needs confirmation)", "ko": "중복(확인 필요)" },
    "card_dup_head": {
        "en": "These look like the same thing but we are not certain. Merge into one?",
        "ko": "같은 내용으로 보이는데 확실하지 않습니다. 하나로 합칠까요?",
    },
    "card_question": {
        "en": "### Question {i} \u00b7 {label} (confidence {conf})",
        "ko": "### 질문 {i} \u00b7 {label} (판정 확신 {conf})",
    },
    "card_newer": {
        "en": "- Note: **{side} looks newer**",
        "ko": "- 판정 참고: **{side}쪽이 더 최신**으로 보임",
    },
    "card_reason": { "en": "- Reason: {reason}", "ko": "- 판정 이유: {reason}" },
    "report_meaning_heading": { "en": "---\n### What this report means\n", "ko": "---\n### 이 리포트가 말하는 것\n" },
    "report_meaning_body": {
        "en": "Leaving contradictions and duplicates unchecked means AI and your future self will pick up outdated records. This is why search works well in a large vault but the answers start being wrong. Clean up the questions above now, or re-run this checkup periodically.",
        "ko": "모순과 중복을 그대로 두면 AI와 미래의 내가 낡은 기록을 집어 갑니다. 볼트가 클수록 검색은 잘 되는데 답이 틀리기 시작하는 이유가 이것입니다. 위 질문들을 지금 정리하거나, 주기적으로 이 진단을 다시 돌리세요.",
    },
    "methodology_heading": { "en": "---\n### Methodology and limitations", "ko": "---\n### 방법론\u00b7한계" },
    "methodology_line1": {
        "en": "- Extraction and judgment via local claude CLI (subscription). Judgment prompts are the nautli PoC verified version (includes 3 false-positive counter-examples for contradictions).",
        "ko": "- 추출\u00b7판정은 로컬 claude CLI(구독) 경유, 판정 프롬프트는 nautli PoC 검증본(모순 오탐 반례 3종 포함).",
    },
    "methodology_line2": {
        "en": "- The discardable fragment ratio is an estimate based on a fixed sample. A small sample means a wide margin of error.",
        "ko": "- 버려도 되는 조각 비율은 고정된 표본으로 계산한 추정치입니다. 표본이 작으면 오차 범위가 넓습니다.",
    },
    "methodology_artifacts": {
        "en": "- Intermediate artifacts and logs: `{work}`",
        "ko": "- 중간 산출물\u00b7로그: `{work}`",
    },
    "multi_source": { "en": "multi-source {n}", "ko": "멀티소스 {n}개" },
    "junk_type_other": { "en": "other", "ko": "기타" },
    "none": { "en": "none", "ko": "없음" },
    "main_desc": {
        "en": "{brand}, Markdown vault health check (fully local)",
        "ko": "{brand}, 마크다운 볼트 건강검진 (전 과정 로컬)",
    },
    "main_vault_help": { "en": "Obsidian/Markdown vault path(s)", "ko": "옵시디언/마크다운 볼트 경로 (복수 가능)" },
    "main_work_help": { "en": "Working/report directory (default ~/.{brand})", "ko": "작업/리포트 저장 위치 (기본 ~/.{brand})" },
    "main_max_files_help": { "en": "Smoke test: first N files only", "ko": "스모크 테스트용: 앞에서 N개 파일만" },
    "main_sample_seed_help": {
        "en": "Sample shuffle seed (default: per-source canonical path sha1)",
        "ko": "표본 셔플 시드 (기본: 소스별 canonical 경로 sha1)",
    },
    "main_exclude_help": {
        "en": "Folders/globs to exclude (repeatable). Excluded items are not sent to the LLM",
        "ko": "제외할 폴더/글롭 (반복 가능, 예: --exclude 일기 --exclude '*.excalidraw.md'). 제외분은 LLM에 안 감",
    },
    "main_judge_pairs_help": { "en": "Max LLM judgment pairs (cost cap)", "ko": "LLM 판정 쌍 상한 (비용 캡)" },
    "main_junk_sample_help": { "en": "Number of samples to check for discardable fragments", "ko": "버려도 되는 조각을 확인할 표본 수" },
    "main_estimate_help": {
        "en": "Zero LLM calls: show which files would be sent and estimated time, then exit",
        "ko": "LLM 호출 0: 전송 대상 파일 목록과 예상 소요\u00b7배치 수만 출력하고 종료 (실행 전 확인용)",
    },
    "main_fresh_help": { "en": "Discard previous intermediates and start from scratch", "ko": "이전 중간 산출물 버리고 처음부터" },
    "main_vault_missing": { "en": "Vault path does not exist: {vault}", "ko": "볼트 경로가 없다: {vault}" },
    "main_work_folder": { "en": "Working folder: {work} (interrupt and re-run to resume)\n", "ko": "작업 폴더: {work} (중단해도 재실행하면 이어서 돈다)\n" },
    "main_step1": { "en": "[1/6] Static scan...", "ko": "[1/6] 정적 스캔..." },
    "main_step1_result": { "en": "      {notes} notes, {dead} dead links", "ko": "      노트 {notes}개, 죽은 링크 {dead}개" },
    "main_step2": { "en": "[2/6] Building batches...", "ko": "[2/6] 배치 구성..." },
    "main_step2_result": { "en": "      {files} files \u2192 {batches} batches", "ko": "      {files}파일 \u2192 {batches}배치" },
    "main_estimate_header": { "en": "\n\U0001f4cb Estimate (0 LLM calls, nothing sent yet)", "ko": "\n\U0001f4cb 견적 (LLM 호출 0, 아직 아무것도 전송 안 됨)" },
    "main_estimate_files": {
        "en": "   Files to send to Claude: {files} ({kb}KB). Full list: {listing}",
        "ko": "   Claude로 전송될 파일: {files}개 ({kb}KB). 전체 목록: {listing}",
    },
    "main_estimate_time": {
        "en": "   Estimated time: extraction ~{extract}min + judgment ~{judge}min (uses subscription quota, approximate)",
        "ko": "   예상 소요: 추출 ~{extract}분 + 판정 ~{judge}분 (구독 쿼터 사용, 대략치)",
    },
    "main_estimate_exclude": {
        "en": "   To exclude folders from the list, use --exclude <folder> and re-run.",
        "ko": "   빼고 싶은 폴더가 목록에 있으면 --exclude <폴더> 로 제외하고 다시 확인하라.",
    },
    "main_step3": { "en": "[3/6] Extracting facts ({model}, parallel {p})...", "ko": "[3/6] fact 추출 ({model}, 병렬 {p})..." },
    "main_step3_result": { "en": "      {atoms} atoms", "ko": "      atom {atoms}건" },
    "main_step4": { "en": "[4/6] Computing candidate pairs...", "ko": "[4/6] 후보쌍 계산..." },
    "main_step4_result": { "en": "      {pairs} candidate pairs", "ko": "      후보쌍 {pairs}건" },
    "main_step5": { "en": "[5/6] Judging duplicates/contradictions ({model}, parallel {p})...", "ko": "[5/6] 중복\u00b7모순 판정 ({model}, 병렬 {p})..." },
    "main_step5_result": { "en": "      {judgments} judgments", "ko": "      판정 {judgments}건" },
    "main_step6": { "en": "[6/6] Checking discardable fragments (sample {sample}) + report...", "ko": "[6/6] 버려도 되는 조각 확인 (표본 {sample}) + 리포트..." },
    "main_limit_warn": {
        "en": "\n\u26a0\ufe0f Rate limit/network issue detected {hits} time(s). Re-run if there are failures",
        "ko": "\n\u26a0\ufe0f 사용량 한도/네트워크 장애 감지 {hits}회. 실패분이 있으면 같은 명령 재실행",
    },
    "main_extract_fail_warn": {
        "en": "\n\u26a0\ufe0f {failed} extraction batch(es) failed. Re-run to resume",
        "ko": "\n\u26a0\ufe0f 추출 실패 배치 {failed}개. 같은 명령 재실행으로 이어받기 가능",
    },
    "main_done": { "en": "\n\u2705 Done. AI taste-test signal {score}/100", "ko": "\n\u2705 완료. AI 맛보기 신호 {score}/100" },
    "main_summary": {
        "en": "   {dups} duplicate pair(s) \u00b7 {contras} contradiction pair(s) \u00b7 {cross} cross-source contradiction pair(s) \u00b7 discardable {junk} \u00b7 {cards} question(s)",
        "ko": "   중복 {dups}쌍 \u00b7 모순 {contras}쌍 \u00b7 교차소스 모순 {cross}쌍 \u00b7 버려도 되는 조각 {junk} \u00b7 질문 {cards}건",
    },
    "main_report_path": { "en": "   Report: {path}", "ko": "   리포트: {path}" },
    "junk_fail_short": { "en": "measurement failed", "ko": "측정실패" },
    "dropped_over_limit": {
        "en": "  \u26a0\ufe0f {dropped} candidate pair(s) excluded by the judgment cap ({limit}). Adjust with --max-judge-pairs",
        "ko": "  \u26a0\ufe0f 후보쌍 {dropped}건은 판정 상한({limit})에 걸려 이번 판정에서 제외됨 (--max-judge-pairs로 조정 가능)",
    },
    "junk_checking": {
        "en": "  Checking discardable fragments {cur}/{total}",
        "ko": "  버려도 되는 조각 확인 {cur}/{total}",
    },
}


def _t(key, **kwargs):
    entry = _T.get(key, {})
    template = entry.get(_LANG) or entry.get("en", key)
    for k, v in kwargs.items():
        template = template.replace("{" + k + "}", str(v))
    return template
BATCH_BYTES = 28_000      # extract 배치당 원문 상한 (~10K tok)
MAX_FILE_BYTES = 60_000   # 거대 파일 절단 방어
EXTRACT_PARALLEL = 5
JUDGE_PARALLEL = 4
JUDGE_BATCH = 20
JUNK_BATCH = 15
CLI_TIMEOUT = 300


# ── 공용 ────────────────────────────────────────────────────────────────────
def claude_bin():
    for c in (os.environ.get("VD_CLAUDE"), os.path.expanduser("~/.local/bin/claude-patched"), "claude"):
        if c and (os.path.sep not in c or os.path.exists(c)):
            return c
    return "claude"


def run_claude(model, prompt, stdin_text, cwd_empty):
    """claude CLI 호출. cwd는 반드시 빈 격리 폴더 — 리포 cwd면 에이전트 모드가
    프로젝트 컨텍스트(CLAUDE.md 등)를 물고 들어와 판정이 오염된다."""
    r = subprocess.run([claude_bin(), "--model", model, "-p", prompt],
                       input=stdin_text, capture_output=True, text=True,
                       timeout=CLI_TIMEOUT, cwd=cwd_empty)
    return r


# 일시 장애(사용량 한도·네트워크) 공용 백오프 게이트 — 걸리면 전 스레드가 함께 쉰다
_LIMIT_MARKERS = ("limit", "overload", "rate", "429", "529", "quota",
                  "enotfound", "etimedout", "econnrefused", "econnreset",
                  "unable to connect", "network", "fetch failed")
_gate = {"until": 0.0}
_gate_lock = threading.Lock()
_limit_hits = collections.Counter()


def _wait_gate():
    while True:
        with _gate_lock:
            wait = _gate["until"] - time.time()
        if wait <= 0:
            return
        time.sleep(min(wait, 10))


def _trip_gate(seconds):
    with _gate_lock:
        _gate["until"] = max(_gate["until"], time.time() + seconds)


def call_llm(ctx, model, prompt, stdin_text, tag, retries=(0, 120, 300)):
    """run_claude + 한도 감지 재시도. 성공 시 stdout, 최종 실패 시 None."""
    for attempt, base_wait in enumerate(retries):
        if base_wait:
            time.sleep(base_wait)
        _wait_gate()
        try:
            r = run_claude(model, prompt, stdin_text, ctx.cwd_empty)
        except subprocess.TimeoutExpired:
            ctx.log(f"TIMEOUT {tag} attempt={attempt + 1}")
            continue
        if r.returncode == 0:
            return r.stdout
        # claude CLI는 한도 메시지를 stdout으로 내는 경우가 있어 둘 다 본다
        err = " ".join(((r.stderr or "") + " " + (r.stdout or "")).split())[:300]
        ctx.log(f"ERR {tag} rc={r.returncode} attempt={attempt + 1} {err}")
        if any(k in err.lower() for k in _LIMIT_MARKERS):
            _limit_hits["hits"] += 1
            _trip_gate(180)  # 한도/네트워크 장애 — 전 스레드 3분 공동 대기 후 재시도
        elif not err:
            _trip_gate(60)   # 원인불명 즉사(한도일 확률 높음) — 짧은 공동 대기
        else:
            return None      # 한도가 아닌 에러는 재시도 무의미
    return None


def parse_jsonl_stdout(stdout, required_keys):
    """모델 출력에서 JSON 줄만 회수 (마크다운 펜스·잡설 방어)."""
    out = []
    for line in stdout.splitlines():
        line = line.strip().strip("`")
        if not line.startswith("{"):
            continue
        try:
            j = json.loads(line)
        except json.JSONDecodeError:
            continue
        if all(j.get(k) is not None for k in required_keys):
            out.append(j)
    return out


def load_prompt(name):
    return open(os.path.join(PKG_DIR, "prompts", name), encoding="utf-8").read()


def is_excluded(rel, patterns):
    """--exclude 판정: 글롭(예: '*.excalidraw.md') 또는 폴더 접두(예: '일기')."""
    return any(fnmatch.fnmatch(rel, p) or rel == p or rel.startswith(p.rstrip("/") + "/")
               for p in patterns)


class Ctx:
    def __init__(self, vaults, work, max_files, excludes=(), sample_seed=None):
        self.vaults = list(vaults)
        self.sources = [
            {"source_id": hashlib.sha1(root.encode()).hexdigest()[:8],
             "source_label": os.path.basename(root), "root": root}
            for root in self.vaults
        ]
        self.vault = self.vaults[0]  # 단일 볼트 호출과 기존 표시 코드 하위호환
        self.work = work
        self.max_files = max_files
        self.excludes = list(excludes)
        self.sample_seed = sample_seed
        self.cwd_empty = os.path.join(work, "cwd_empty")  # CLI 격리용 빈 폴더
        os.makedirs(self.cwd_empty, exist_ok=True)
        # 격리 폴더는 항상 비어 있어야 함 (CLAUDE.md 등 유입 방지)
        for f in os.listdir(self.cwd_empty):
            os.remove(os.path.join(self.cwd_empty, f))
        self.logf = os.path.join(work, "run.log")

    def path(self, *p):
        return os.path.join(self.work, *p)

    def log(self, msg):
        with open(self.logf, "a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {msg}\n")


# ── 0. scan — LLM 없는 정적 진단 ────────────────────────────────────────────
WIKILINK = re.compile(r"\[\[([^\]\[|#]+)")


def stage_scan(ctx):
    out = ctx.path("scan.json")
    if os.path.exists(out):
        scan = json.load(open(out, encoding="utf-8"))
        scan.setdefault("sampled", False)
        scan.setdefault("source_notes", {})
        return scan
    scan_cap = max(200, ctx.max_files * 5) if ctx.max_files else 0
    fm = links = dead = total_bytes = 0
    total_notes = 0
    sampled = False
    source_notes = collections.Counter()
    source_stats = {}
    for source in ctx.sources:
        root = source["root"]
        files, basenames = [], set()
        source_sampled = False
        for dirpath, dirnames, filenames in os.walk(root):
            # root 자체가 dot 디렉토리여도 허용하고, 그 아래 dot 폴더만 제외한다.
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in sorted(filenames):
                if not fn.endswith(".md"):
                    continue
                p = os.path.join(dirpath, fn)
                if is_excluded(os.path.relpath(p, root), ctx.excludes):
                    continue
                if scan_cap and len(files) >= scan_cap:
                    source_sampled = True
                    break
                files.append(p)
                basenames.add(fn[:-3].strip().lower())
            if source_sampled:
                break
        source_fm = source_links = source_dead = source_bytes = 0
        for p in files:
            try:
                txt = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            source_bytes += len(txt.encode("utf-8", "replace"))
            if txt.startswith("---\n") or txt.startswith("---\r"):
                source_fm += 1
            for m in WIKILINK.finditer(txt):
                target = m.group(1).strip().lower()
                if not target:
                    continue
                source_links += 1
                name = target.split("/")[-1]
                if name not in basenames and name.removesuffix(".md") not in basenames:
                    source_dead += 1
        notes = len(files)
        total_notes += notes
        fm += source_fm
        links += source_links
        dead += source_dead
        total_bytes += source_bytes
        sampled = sampled or source_sampled
        source_notes[source["source_label"]] += notes
        source_stats[source["source_id"]] = {
            "label": source["source_label"], "notes": notes, "bytes": source_bytes,
            "frontmatter": source_fm, "wikilinks": source_links,
            "dead_links": source_dead, "sampled": source_sampled,
        }
    scan = {"notes": total_notes, "bytes": total_bytes, "frontmatter": fm,
            "frontmatter_rate": round(fm / total_notes, 3) if total_notes else 0,
            "wikilinks": links, "dead_links": dead,
            "dead_link_rate": round(dead / links, 3) if links else 0,
            "sampled": sampled, "source_notes": dict(source_notes),
            "sources": source_stats}
    json.dump(scan, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ctx.log(f"scan notes={scan['notes']} dead_links={dead}/{links}")
    return scan


# ── 1. manifest — 파일 목록 → 배치 ─────────────────────────────────────────
def scope_of(rel):
    top = rel.split("/")[0] if "/" in rel else "(root)"
    return "project:vault-root" if top == "(root)" else f"project:{top}"


# NEARDUP-SAMPLER v1
POSTINGS_CAP = 32
CAND_PER_FILE = 64


def prescan_near_dup(root_files, read_text):
    """로컬 bottom-k 스케치로 near-dup 클러스터와 중복 바이트 하한을 구한다."""
    sketches = []
    exact_groups = collections.defaultdict(list)
    for i, f in enumerate(root_files):
        text = unicodedata.normalize("NFC", read_text(f)).casefold()
        normalized = re.sub(r"\s+", " ", text).strip()
        words = normalized.split()
        shingles = ({" ".join(words[j:j + 4]) for j in range(len(words) - 3)}
                    if len(words) >= 4 else set(words))
        sketch = set(sorted(
            int(hashlib.sha1(shingle.encode()).hexdigest(), 16)
            for shingle in shingles
        )[:48])
        normalized_hash = hashlib.sha1(normalized.encode()).hexdigest()
        sketches.append(sketch)
        exact_groups[normalized_hash].append(i)

    parent = list(range(len(root_files)))
    rank = [0] * len(root_files)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        a, b = find(a), find(b)
        if a == b:
            return
        if rank[a] < rank[b]:
            a, b = b, a
        parent[b] = a
        if rank[a] == rank[b]:
            rank[a] += 1

    # 정확 중복은 star edge로 먼저 합치고 대표 하나만 역색인에 넣는다. 동일 파일이
    # 수천 개여도 postings와 후보쌍이 제곱으로 불어나는 것을 막는다. 이 edge들은
    # 아래 postings/candidate cap과 무관하므로 정확 중복을 빠뜨리지 않는다.
    representatives = []
    exact_edges = []
    for members in exact_groups.values():
        representative = members[0]
        representatives.append(representative)
        for member in members[1:]:
            exact_edges.append((representative, member))
            union(representative, member)

    # normalized content가 같은 그룹만 보수적인 중복 바이트 하한에 포함한다.
    dup_bytes = sum(
        (len(members) - 1) * min(root_files[i]["size"] for i in members)
        for members in exact_groups.values()
        if len(members) >= 2
    )

    inverted = collections.defaultdict(list)
    for i in representatives:
        for shingle_hash in sorted(sketches[i]):
            inverted[shingle_hash].append(i)

    # 흔한 shingle은 변별력이 낮으면서 quadratic pair를 만들므로 버린다.
    # cap 이하 postings에서 생기는 pair 수는 shingle당 상수이고, 이후 각 파일의
    # 후보 degree도 제한해 전체 후보 그래프를 입력 파일 수에 선형으로 묶는다.
    shared = collections.Counter()
    for shingle_hash in sorted(inverted):
        postings = inverted[shingle_hash]
        if len(postings) > POSTINGS_CAP:
            continue
        for pos, left in enumerate(postings):
            for right in postings[pos + 1:]:
                pair = (left, right) if left < right else (right, left)
                shared[pair] += 1

    candidate_degree = [0] * len(root_files)
    candidates = []
    for (left, right), common in sorted(
            shared.items(), key=lambda item: (-item[1], item[0])):
        if (candidate_degree[left] >= CAND_PER_FILE or
                candidate_degree[right] >= CAND_PER_FILE):
            continue
        candidate_degree[left] += 1
        candidate_degree[right] += 1
        candidates.append((left, right, common))

    near_dup_edges = []
    for left, right, common in candidates:
        smaller_sketch = min(len(sketches[left]), len(sketches[right]))
        thresh = max(1, min(8, math.ceil(smaller_sketch * 0.25)))
        if common < thresh:
            continue
        union_sketch = sketches[left] | sketches[right]
        jaccard = (len(sketches[left] & sketches[right]) / len(union_sketch)
                   if union_sketch else 0.0)
        if jaccard >= 0.5:
            # exact 그룹에서는 대표 하나만 후보 생성에 참여하므로 이 목록은
            # 실제 near-dup 판정을 통과한 non-exact edge만 담는다.
            near_dup_edges.append((left, right))
            union(left, right)

    grouped = collections.defaultdict(set)
    for i in range(len(root_files)):
        grouped[find(i)].add(i)
    near_edges_by_root = collections.defaultdict(list)
    exact_edges_by_root = collections.defaultdict(list)
    for edge in near_dup_edges:
        near_edges_by_root[find(edge[0])].append(edge)
    for edge in exact_edges:
        exact_edges_by_root[find(edge[0])].append(edge)
    clusters = []
    for cluster_root, members in grouped.items():
        if len(members) < 2:
            continue
        clusters.append({
            "members": members,
            "near_edges": near_edges_by_root[cluster_root],
            "exact_edges": exact_edges_by_root[cluster_root],
        })
    clusters.sort(key=lambda cluster: min(cluster["members"]))
    return clusters, dup_bytes, len(near_dup_edges)


# NEARDUP-SAMPLER v1
def select_sample(root_files, clusters, max_files, seed):
    """중복 클러스터 쌍을 우선하고 나머지는 최상위 폴더별로 층화한다."""
    total = len(root_files)
    if not max_files or total <= max_files:
        return list(root_files)

    target = min(max_files, total)
    risk_budget = round(max_files * 0.6)
    chosen = []
    chosen_indices = set()
    ordered_clusters = sorted(
        clusters,
        key=lambda cluster: (
            -len(cluster["members"]),
            min(root_files[i]["rel"] for i in cluster["members"]),
        ),
    )
    for cluster in ordered_clusters:
        edges = cluster["near_edges"] or cluster["exact_edges"]
        if not edges:
            continue
        representative_edge = min(
            edges,
            key=lambda edge: tuple(sorted(
                (root_files[edge[0]]["rel"], root_files[edge[1]]["rel"]),
            )),
        )
        representatives = sorted(
            representative_edge, key=lambda i: root_files[i]["rel"])
        if len(representatives) < 2 or len(chosen) + 2 > risk_budget:
            continue
        for i in representatives:
            if i not in chosen_indices:
                root_files[i]["sampling_reason"] = "dup-cluster"
                chosen.append(root_files[i])
                chosen_indices.add(i)

    folders = collections.defaultdict(list)
    for i, f in enumerate(root_files):
        if i in chosen_indices:
            continue
        rel = f["rel"].replace(os.path.sep, "/")
        folder = rel.split("/", 1)[0] if "/" in rel else "(root)"
        folders[folder].append(i)

    rng = random.Random(seed)
    folder_names = sorted(folders)
    rng.shuffle(folder_names)
    for folder in folder_names:
        rng.shuffle(folders[folder])

    positions = {folder: 0 for folder in folder_names}
    while len(chosen) < target:
        added = False
        for folder in folder_names:
            pos = positions[folder]
            if pos >= len(folders[folder]):
                continue
            i = folders[folder][pos]
            positions[folder] += 1
            root_files[i]["sampling_reason"] = "stratified"
            chosen.append(root_files[i])
            chosen_indices.add(i)
            added = True
            if len(chosen) == target:
                break
        if not added:
            break
    return chosen


def _read_prescan_text(f):
    with open(f["abs"], encoding="utf-8", errors="replace") as handle:
        return handle.read(MAX_FILE_BYTES)


def stage_manifest(ctx):
    out = ctx.path("manifest.json")
    if os.path.exists(out):
        man = json.load(open(out, encoding="utf-8"))
        man.setdefault("near_dup_pairs", 0)
        man.setdefault("dup_bytes", None)
        return man
    files = []
    source_samples = collections.Counter()
    near_dup_pairs = 0
    dup_bytes = 0
    for source in ctx.sources:
        root_files = []
        root = source["root"]
        for dirpath, dirnames, filenames in os.walk(root):
            # os.walk는 root 자체를 이미 방문하므로 dot root는 허용된다.
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in sorted(filenames):
                if not fn.endswith(".md"):
                    continue
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, root)
                if is_excluded(rel, ctx.excludes):
                    continue
                st = os.stat(p)
                root_files.append({
                    "source_id": source["source_id"],
                    "source_label": source["source_label"],
                    "root": root,
                    "rel": rel,
                    "abs": os.path.abspath(p),
                    "size": min(st.st_size, MAX_FILE_BYTES),
                    "date": datetime.date.fromtimestamp(st.st_mtime).isoformat(),
                    "scope": scope_of(rel),
                })
        root_files.sort(key=lambda f: f["rel"])
        seed = (ctx.sample_seed + "\x1f" + root if ctx.sample_seed
                else hashlib.sha1(root.encode()).hexdigest())
        clusters, source_dup_bytes, source_near_dup_pairs = prescan_near_dup(
            root_files, _read_prescan_text)
        near_dup_pairs += source_near_dup_pairs
        dup_bytes += source_dup_bytes
        if ctx.max_files and len(root_files) > ctx.max_files:
            root_files = select_sample(
                root_files, clusters, ctx.max_files, seed)
        else:
            # 풀 모드는 표본 편향 없이 기존의 결정적 전량 순서를 유지한다.
            random.Random(seed).shuffle(root_files)
        files.extend(root_files)
        source_samples[source["source_label"]] += len(root_files)
    batches, cur, cur_sz = [], [], 0
    for f in files:
        # 모델 출력의 source는 rel뿐이다. 같은 rel이 한 배치에 두 번 들어가면
        # source_id를 역매핑할 수 없으므로 별도 배치로 나눈다.
        duplicate_rel = any(prev["rel"] == f["rel"] for prev in cur)
        if cur and (cur_sz + f["size"] > BATCH_BYTES or duplicate_rel):
            batches.append(cur)
            cur, cur_sz = [], 0
        cur.append(f)
        cur_sz += f["size"]
    if cur:
        batches.append(cur)
    man = {"vault": ctx.vault, "vaults": ctx.vaults, "files": len(files),
           "source_samples": dict(source_samples), "batches": batches,
           "near_dup_pairs": near_dup_pairs, "dup_bytes": dup_bytes}
    json.dump(man, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ctx.log(f"manifest files={len(files)} batches={len(batches)}")
    return man


# ── 2. extract — 배치별 fact atom 추출 (haiku) ──────────────────────────────
def stage_extract(ctx, man, model):
    done = ctx.path("done_extract")
    os.makedirs(done, exist_ok=True)
    prompt = load_prompt("extract_prompt.md")
    batches = man["batches"]

    def run_batch(i):
        mark = os.path.join(done, f"b{i:03d}.jsonl")
        if os.path.exists(mark):
            return (i, "skip", 0)
        batch = batches[i]
        parts = []
        for f in batch:
            try:
                txt = open(f["abs"], encoding="utf-8", errors="replace").read()[:MAX_FILE_BYTES]
            except OSError as e:
                ctx.log(f"READFAIL {f['source_label']}:{f['rel']} {e}")
                continue
            parts.append(f'<DOC file="{f["rel"]}" date="{f["date"]}" scope="{f["scope"]}" '
                         f'source="{f["source_label"]}">\n{txt}\n</DOC>')
        inp = "\n\n".join(parts)
        if not inp.strip():
            open(mark, "w").close()
            return (i, "empty", 0)
        stdout = call_llm(ctx, model, prompt, inp, f"extract b{i}")
        if stdout is None:
            return (i, "err", 0)
        meta_by_file = {f["rel"]: f for f in batch}
        atoms = []
        for a in parse_jsonl_stdout(stdout, ("claim", "source")):
            if a.get("type") not in ("semantic", "procedural", "episodic"):
                a["type"] = "semantic"
            meta = meta_by_file.get(a["source"])
            a["scope"] = meta["scope"] if meta else "unknown"
            a["source_id"] = meta["source_id"] if meta else "unknown"
            a["source_label"] = meta["source_label"] if meta else "unknown"
            f_rel = meta["rel"] if meta else a["source"]
            identity = a["source_id"] + "\x1f" + f_rel + "\x1f" + a["claim"]
            a["id"] = "fa_" + hashlib.sha1(identity.encode()).hexdigest()[:12]
            atoms.append(a)
        with open(mark, "w", encoding="utf-8") as f:
            for a in atoms:
                f.write(json.dumps(a, ensure_ascii=False) + "\n")
        ctx.log(f"OK extract b{i} atoms={len(atoms)}")
        return (i, "ok", len(atoms))

    with cf.ThreadPoolExecutor(EXTRACT_PARALLEL) as ex:
        for i, status, n in ex.map(run_batch, range(len(batches))):
            print(f"  extract b{i:03d}/{len(batches)} {status} +{n}", flush=True)
    # 취합
    atoms_path = ctx.path("atoms.jsonl")
    with open(atoms_path, "w", encoding="utf-8") as out:
        for fn in sorted(os.listdir(done)):
            out.write(open(os.path.join(done, fn), encoding="utf-8").read())
    atoms = [json.loads(l) for l in open(atoms_path, encoding="utf-8")]
    atoms = list({a["id"]: a for a in atoms}.values())
    ctx.log(f"extract total atoms={len(atoms)}")
    return atoms


# ── 3. pair — 후보쌍 (결정적 코드, LLM 없음) ────────────────────────────────
SIM_FLOOR = 0.22
TOP_K = 5
SELF_FILE_PENALTY = 0.6


def ngrams(s, n=2):
    s = re.sub(r"\s+", " ", s.lower())
    return collections.Counter(s[i:i + n] for i in range(len(s) - n + 1))


def cosine(a, b):
    num = sum(a[g] * b[g] for g in set(a) & set(b))
    da = math.sqrt(sum(v * v for v in a.values()))
    db = math.sqrt(sum(v * v for v in b.values()))
    return num / (da * db) if da and db else 0.0


def atoms_fingerprint(atoms, max_judge_pairs):
    payload = "pair-v2\n" + str(max_judge_pairs) + "\n" + "\n".join(sorted(a["id"] for a in atoms))
    return hashlib.sha1(payload.encode()).hexdigest()


def normalized_claim_hash(claim):
    normalized = re.sub(r"\s+", " ", str(claim).lower()).strip()
    return hashlib.sha1(normalized.encode()).hexdigest()


def stage_pair(ctx, atoms, max_judge_pairs):
    out = ctx.path("pairs.jsonl")
    fp_path = ctx.path("pairs.fp")
    fp = atoms_fingerprint(atoms, max_judge_pairs)
    if os.path.exists(out) and os.path.exists(fp_path) and open(fp_path).read() == fp:
        return [json.loads(l) for l in open(out, encoding="utf-8")]
    # atoms가 달라졌다(재개로 추출이 늘었거나 새 볼트 상태) — 부분 atoms로 만든 하류 캐시는 stale이므로 전부 무효화
    for stale in ("judgments.jsonl", "junk_judgments.json"):
        p = ctx.path(stale)
        if os.path.exists(p):
            os.remove(p)
            ctx.log(f"invalidated {stale} (atoms fingerprint changed)")
    shutil.rmtree(ctx.path("done_judge"), ignore_errors=True)
    for a in atoms:
        a["subject"] = str(a.get("subject", "")).lower().strip()
        a["_ng"] = ngrams(a["claim"])
        a["_claim_hash"] = normalized_claim_hash(a["claim"])
    by_scope = collections.defaultdict(list)
    for a in atoms:
        normalized_scope = re.sub(r"\s+", " ", str(a.get("scope", "unknown")).lower()).strip()
        by_scope[normalized_scope].append(a)
    layer1 = {}
    for scope, group in by_scope.items():
        for a in group:
            sims = []
            for b in group:
                if b["id"] <= a["id"]:
                    continue
                cross_source = a.get("source_id") != b.get("source_id")
                if cross_source and a["_claim_hash"] == b["_claim_hash"]:
                    continue
                s = cosine(a["_ng"], b["_ng"])
                if a["subject"] and a["subject"] == b["subject"]:
                    s += 0.08
                if (a.get("source_id"), a.get("source")) == (b.get("source_id"), b.get("source")):
                    s *= SELF_FILE_PENALTY
                if s >= SIM_FLOOR:
                    sims.append((s, b))
            sims.sort(key=lambda x: -x[0])
            for s, b in sims[:TOP_K]:
                key = (a["id"], b["id"])
                layer1[key] = max(layer1.get(key, 0), s)

    # Layer 2: scope와 무관하게 서로 다른 소스의 같은 subject/고유사도 후보를 추가한다.
    cross_candidates = {}
    for i, a in enumerate(atoms):
        for b in atoms[i + 1:]:
            if a.get("source_id") == b.get("source_id"):
                continue
            if a["_claim_hash"] == b["_claim_hash"]:
                continue
            raw_sim = cosine(a["_ng"], b["_ng"])
            same_subject = bool(a["subject"] and a["subject"] == b["subject"])
            if not same_subject and raw_sim < SIM_FLOOR:
                continue
            s = raw_sim + (0.08 if same_subject else 0)
            key = tuple(sorted((a["id"], b["id"])))
            cross_candidates[key] = max(cross_candidates.get(key, 0), s)

    # Layer 1에서 우연히 생성된 교차쌍도 같은 quota를 적용한다.
    same_source_pairs = {}
    atom_by_id = {a["id"]: a for a in atoms}
    for key, s in layer1.items():
        ia, ib = key
        if atom_by_id[ia].get("source_id") != atom_by_id[ib].get("source_id"):
            cross_candidates[key] = max(cross_candidates.get(key, 0), s)
        else:
            same_source_pairs[key] = s
    cross_quota = max(10, int(max_judge_pairs * 0.4))
    selected_cross = dict(sorted(cross_candidates.items(), key=lambda kv: -kv[1])[:cross_quota])
    pairs = dict(same_source_pairs)
    for key, s in selected_cross.items():
        pairs[key] = max(pairs.get(key, 0), s)
    rows = sorted(pairs.items(), key=lambda kv: -kv[1])
    dropped = max(0, len(rows) - max_judge_pairs)
    rows = rows[:max_judge_pairs]
    idx = {a["id"]: a for a in atoms}
    result = []
    with open(out, "w", encoding="utf-8") as f:
        for (ia, ib), s in rows:
            cross_source = idx[ia].get("source_id") != idx[ib].get("source_id")
            row = {"a": ia, "b": ib, "sim": round(s, 3),
                   "claim_a": idx[ia]["claim"], "claim_b": idx[ib]["claim"],
                   "scope": idx[ia]["scope"], "src_a": idx[ia].get("source"),
                   "src_b": idx[ib].get("source"),
                   "t_a": idx[ia].get("t_valid"), "t_b": idx[ib].get("t_valid"),
                   "cross_source": cross_source,
                   "src_label_a": idx[ia].get("source_label"),
                   "src_label_b": idx[ib].get("source_label"),
                   "type_a": idx[ia].get("type"), "type_b": idx[ib].get("type")}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            result.append(row)
    open(fp_path, "w").write(fp)
    dropped_cross = max(0, len(cross_candidates) - len(selected_cross))
    ctx.log(f"pair pairs={len(result)} cross={sum(p['cross_source'] for p in result)} "
            f"dropped_cross_quota={dropped_cross} dropped_by_cap={dropped}")
    if dropped:
        print(_t("dropped_over_limit", dropped=dropped, limit=max_judge_pairs), flush=True)
    return result


# ── 4. judge — 쌍 판정 (sonnet) ─────────────────────────────────────────────
def stage_judge(ctx, pairs, model):
    done = ctx.path("done_judge")
    os.makedirs(done, exist_ok=True)
    prompt = load_prompt("judge_prompt.md")
    batches = [pairs[i:i + JUDGE_BATCH] for i in range(0, len(pairs), JUDGE_BATCH)]

    def run(i):
        mark = os.path.join(done, f"j{i:03d}.jsonl")
        if os.path.exists(mark):
            return (i, "skip")
        lines = []
        for p in batches[i]:
            item = {"pair_id": f'{p["a"]}|{p["b"]}',
                    "claim_a": f'{p["claim_a"]} (기록시점 {p.get("t_a")})',
                    "claim_b": f'{p["claim_b"]} (기록시점 {p.get("t_b")})',
                    "source_a": p.get("src_label_a"), "source_b": p.get("src_label_b")}
            if p.get("type_a"):
                item["type_a"] = p["type_a"]
            if p.get("type_b"):
                item["type_b"] = p["type_b"]
            lines.append(json.dumps(item, ensure_ascii=False))
        stdout = call_llm(ctx, model, prompt, "\n".join(lines), f"judge j{i}")
        if stdout is None:
            return (i, "err")
        out = parse_jsonl_stdout(stdout, ("pair_id", "verdict"))
        with open(mark, "w", encoding="utf-8") as f:
            for j in out:
                f.write(json.dumps(j, ensure_ascii=False) + "\n")
        return (i, f"ok:{len(out)}")

    with cf.ThreadPoolExecutor(JUDGE_PARALLEL) as ex:
        for i, st in ex.map(run, range(len(batches))):
            print(f"  judge j{i:03d}/{len(batches)} {st}", flush=True)
    js_path = ctx.path("judgments.jsonl")
    with open(js_path, "w", encoding="utf-8") as out:
        for fn in sorted(os.listdir(done)):
            out.write(open(os.path.join(done, fn), encoding="utf-8").read())
    js = list({j["pair_id"]: j for j in
               (json.loads(l) for l in open(js_path, encoding="utf-8"))}.values())
    ctx.log(f"judge total={len(js)}/{len(pairs)}")
    return js


# ── 5. junk — 표본 LLM 감사 → junk 추정율 ───────────────────────────────────
def stage_junk(ctx, atoms, model, sample_n):
    out = ctx.path("junk_judgments.json")
    if os.path.exists(out):
        cached = json.load(open(out, encoding="utf-8"))
        if cached:  # 빈 결과(전배치 실패)는 캐시로 안 침 — 재시도
            return cached
    if not atoms:
        return []
    random.seed(42)
    sample = random.sample(atoms, min(sample_n, len(atoms)))
    prompt = load_prompt("junk_prompt.md")
    results = []
    for i in range(0, len(sample), JUNK_BATCH):
        lines = [json.dumps({"id": a["id"], "claim": a["claim"], "type": a.get("type"),
                             "source": a.get("source"), "t_valid": a.get("t_valid")},
                            ensure_ascii=False) for a in sample[i:i + JUNK_BATCH]]
        stdout = call_llm(ctx, model, prompt, "\n".join(lines), f"junk batch {i}")
        if stdout is None:
            continue
        results += parse_jsonl_stdout(stdout, ("id", "label"))
        print(_t("junk_checking", cur=min(i + JUNK_BATCH, len(sample)), total=len(sample)), flush=True)
    json.dump(results, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ctx.log(f"junk sample={len(sample)} judged={len(results)}")
    return results


# ── 6. report — 사람 언어 리포트 ────────────────────────────────────────────
def health_score(scan, atoms_n, dup_n, contra_n, junk_rate):
    """0~100. 축: junk 40 + 모순 30 + 중복 20 + 구조 10. 공식은 README에 문서화."""
    per1k = lambda n: n / atoms_n * 1000 if atoms_n else 0
    s_junk = 40 * max(0.0, 1 - max(0.0, (junk_rate if junk_rate is not None else 0.15) - 0.05) / 0.35)
    s_contra = 30 * max(0.0, 1 - max(0.0, per1k(contra_n) - 2) / 28)
    s_dup = 20 * max(0.0, 1 - max(0.0, per1k(dup_n) - 5) / 55)
    s_struct = 10 * (0.5 * scan["frontmatter_rate"] + 0.5 * (1 - scan["dead_link_rate"]))
    return round(s_junk + s_contra + s_dup + s_struct), \
        {"junk": round(s_junk), "contradiction": round(s_contra), "duplicate": round(s_dup), "structure": round(s_struct)}


def count_all_notes(ctx, cap=20000):
    """스캔 캡과 무관한 전체 .md 개수 — 낭비 외삽의 분모 (읽지 않고 세기만 한다)."""
    total = 0
    for source in ctx.sources:
        root = source["root"]
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in filenames:
                if not fn.endswith(".md"):
                    continue
                if is_excluded(os.path.relpath(os.path.join(dirpath, fn), root), ctx.excludes):
                    continue
                total += 1
                if total >= cap:
                    return total
    return total


def waste_estimate(ctx, scan, atoms_n, dup_n, junk_rate):
    """실측 기반 낭비 정량화: 낭비율 = 중복 원자 비율 + junk 비율, 토큰은 4바이트=1토큰 보수 외삽."""
    result = {
        "waste_rate": None,
        "waste_dup_rate": None,
        "waste_junk_rate": round(junk_rate, 3) if junk_rate is not None else None,
    }
    if not atoms_n:
        return result
    dup_rate = dup_n / atoms_n
    result["waste_dup_rate"] = round(dup_rate, 3)
    if junk_rate is None:
        return result
    waste_rate = min(0.9, dup_rate + junk_rate)
    result["waste_rate"] = round(waste_rate, 3)
    if not scan["notes"] or not scan["bytes"]:
        return result
    notes_total = max(scan["notes"], count_all_notes(ctx))
    est_vault_tokens = int(scan["bytes"] / scan["notes"] * notes_total / 4)
    result.update({
        "notes_total": notes_total,
        "est_vault_tokens": est_vault_tokens,
        "est_wasted_tokens": int(est_vault_tokens * waste_rate),
    })
    return result


def build_cards(pairs, js, limit=10):
    by_id = {f'{p["a"]}|{p["b"]}': p for p in pairs}
    cards = []
    contras = sorted((j for j in js if j["verdict"] == "contradiction" and (j.get("confidence") or 0) >= 0.6),
                     key=lambda j: -(j.get("confidence") or 0))
    dups_mid = sorted((j for j in js if j["verdict"] == "duplicate" and 0.6 <= (j.get("confidence") or 0) < 0.9),
                      key=lambda j: -(j.get("confidence") or 0))
    for kind, pool in (("contradiction", contras), ("duplicate", dups_mid)):
        for j in pool:
            p = by_id.get(j["pair_id"])
            if p:
                cards.append((kind, j, p))
    return cards[:limit], len(contras), len(dups_mid)


def stage_report(ctx, scan, man, atoms, pairs, js, junk_judgments):
    done_dir = ctx.path("done_extract")
    done_n = len(os.listdir(done_dir)) if os.path.isdir(done_dir) else 0
    failed_batches = max(0, len(man["batches"]) - done_n)
    dups = [j for j in js if j["verdict"] == "duplicate"]
    dups_hi = [j for j in dups if (j.get("confidence") or 0) >= 0.9]
    contras = [j for j in js if j["verdict"] == "contradiction" and (j.get("confidence") or 0) >= 0.6]
    pair_by_id = {f'{p["a"]}|{p["b"]}': p for p in pairs}
    cross_source_contradictions = sum(
        1 for j in contras if pair_by_id.get(j.get("pair_id"), {}).get("cross_source")
    )
    source_samples = man.get("source_samples", {})
    junk_rate = None
    junk_types = {}
    if junk_judgments:
        junk_items = [j for j in junk_judgments if j["label"] == "junk"]
        junk_rate = len(junk_items) / len(junk_judgments)
        junk_types = dict(collections.Counter(j.get("type") or _t("junk_type_other") for j in junk_items))
    score, axes = health_score(scan, len(atoms), len(dups), len(contras), junk_rate)
    cards, n_contra_cards, n_dup_cards = build_cards(pairs, js)

    today = datetime.date.today().isoformat()
    L = []
    report_name = os.path.basename(ctx.vault.rstrip("/")) if len(ctx.vaults) == 1 else _t("multi_source", n=len(ctx.vaults))
    vault_display = ctx.vault if len(ctx.vaults) == 1 else ", ".join(ctx.vaults)
    L.append(_t("report_title", brand=BRAND, name=report_name))
    L.append(_t("report_meta", today=today, vault=vault_display))
    L.append(_t("score_heading", score=score))
    L.append(_t("score_breakdown"))
    L.append(_t("table_header"))
    L.append("|---|---|---|")
    for k, t_key, full in (("junk", "axis_junk", 40), ("contradiction", "axis_contradiction", 30),
                           ("duplicate", "axis_duplicate", 20), ("structure", "axis_structure", 10)):
        L.append(f"| {_t(t_key)} | {axes[k]} | {full} |")
    waste = waste_estimate(ctx, scan, len(atoms), len(dups), junk_rate)
    L.append(_t("waste_heading"))
    dup_bytes = man.get("dup_bytes")
    if dup_bytes is None:
        L.append(_t("waste_local_unmeasured"))
    elif dup_bytes > 0:
        L.append(_t("waste_local_confirmed",
                    dup_kb=max(1, round(dup_bytes / 1024))))
    else:
        L.append(_t("waste_local_none"))
    if waste["waste_rate"] is None:
        L.append(_t("waste_ai_unmeasured"))
    elif waste["waste_rate"] > 0:
        L.append(_t("waste_ai_positive",
                    waste_pct=round(waste["waste_rate"] * 100)))
    else:
        L.append(_t("waste_ai_none"))
    L.append(_t("scan_heading"))
    L.append(_t("scan_notes", notes=scan["notes"], kb=scan["bytes"] // 1024, fm_pct=round(scan["frontmatter_rate"] * 100)))
    L.append(_t("scan_dead_links", wikilinks=scan["wikilinks"], dead=scan["dead_links"], dl_pct=round(scan["dead_link_rate"] * 100)))
    L.append(_t("scan_atoms", atoms=f"{len(atoms):,}", pairs=f"{len(pairs):,}"))
    samples_str = ", ".join(f"{label} **{count}**" for label, count in sorted(source_samples.items())) or _t("none")
    L.append(_t("scan_sources", samples=samples_str))
    L.append(_t("findings_heading"))
    L.append(_t("findings_dups", total=len(dups), hi=len(dups_hi), mid=n_dup_cards))
    L.append(_t("findings_contras", total=len(contras)))
    L.append(_t("findings_cross", total=cross_source_contradictions))
    if junk_rate is not None:
        types_str = ", ".join(f"{k} {v}" for k, v in sorted(junk_types.items(), key=lambda x: -x[1])) or _t("none")
        L.append(_t("findings_junk", pct=round(junk_rate * 100), sample=len(junk_judgments), types=types_str))
    else:
        L.append(_t("findings_junk_fail"))
    if failed_batches:
        L.append(_t("findings_extract_fail", failed=failed_batches, total=len(man["batches"])))
    L.append(_t("questions_heading", shown=len(cards), total=n_contra_cards + n_dup_cards))
    if cards:
        L.append(_t("questions_priority"))
    if not cards:
        L.append(_t("questions_none"))
    for i, (kind, j, p) in enumerate(cards, 1):
        # "contradiction" vs "outdated record" — newer가 있으면 후자로 표기 (같은 verdict라도)
        if kind == "contradiction" and j.get("newer") in ("a", "b"):
            label, head = _t("card_stale_label"), _t("card_stale_head")
        elif kind == "contradiction":
            label, head = _t("card_contra_label"), _t("card_contra_head")
        else:
            label, head = _t("card_dup_label"), _t("card_dup_head")
        L.append(_t("card_question", i=i, label=label, conf=j.get("confidence")))
        L.append(f"**{head}**")
        L.append(f"- A: {p['claim_a']}  \n  `{p.get('src_a')}` ({p.get('t_a')})")
        L.append(f"- B: {p['claim_b']}  \n  `{p.get('src_b')}` ({p.get('t_b')})")
        if j.get("newer") in ("a", "b"):
            L.append(_t("card_newer", side=j["newer"].upper()))
        if j.get("reason"):
            L.append(_t("card_reason", reason=j["reason"]))
        L.append("")
    if len(contras) + n_dup_cards > 0:
        L.append(_t("report_meaning_heading"))
        L.append(_t("report_meaning_body"))
    L.append(_t("methodology_heading"))
    L.append(_t("methodology_line1"))
    L.append(_t("methodology_line2"))
    L.append(_t("methodology_artifacts", work=ctx.work))
    report_path = ctx.path("report.md")
    open(report_path, "w", encoding="utf-8").write("\n".join(L) + "\n")

    summary = {"score": score, "notes": scan["notes"], "atoms": len(atoms),
               "duplicates": len(dups), "contradictions": len(contras),
               "source_samples": source_samples,
               "cross_source_contradictions": cross_source_contradictions,
               "junk_rate": round(junk_rate, 3) if junk_rate is not None else None,
               "dup_bytes": man.get("dup_bytes"),
               "review_cards": n_contra_cards + n_dup_cards,
               "failed_extract_batches": failed_batches, "report": report_path,
               **(waste or {})}
    json.dump(summary, open(ctx.path("summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return summary


# ── main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(prog=BRAND, description=_t("main_desc", brand=BRAND))
    ap.add_argument("vault", nargs="+", help=_t("main_vault_help"))
    ap.add_argument("--work-home", default=os.path.expanduser(f"~/.{BRAND}"),
                    help=_t("main_work_help", brand=BRAND))
    ap.add_argument("--max-files", type=int, default=0, help=_t("main_max_files_help"))
    ap.add_argument("--sample-seed", help=_t("main_sample_seed_help"))
    ap.add_argument("--exclude", action="append", default=[],
                    help=_t("main_exclude_help"))
    ap.add_argument("--max-judge-pairs", type=int, default=1500, help=_t("main_judge_pairs_help"))
    ap.add_argument("--junk-sample", type=int, default=40, help=_t("main_junk_sample_help"))
    ap.add_argument("--extract-model", default="haiku")
    ap.add_argument("--judge-model", default="sonnet")
    ap.add_argument("--estimate", action="store_true",
                    help=_t("main_estimate_help"))
    ap.add_argument("--fresh", action="store_true", help=_t("main_fresh_help"))
    args = ap.parse_args()

    canonical = [os.path.realpath(os.path.abspath(os.path.expanduser(v))) for v in args.vault]
    for vault in canonical:
        if not os.path.isdir(vault):
            print(_t("main_vault_missing", vault=vault), file=sys.stderr)
            sys.exit(1)
    unique = list(dict.fromkeys(canonical))
    vaults = []
    for candidate in sorted(unique, key=lambda p: (len(p.split(os.path.sep)), p)):
        if any(os.path.commonpath((parent, candidate)) == parent for parent in vaults):
            continue
        vaults.append(candidate)
    vaults.sort()

    slug_config = [
        {"root": root, "exclude": sorted(args.exclude), "max_files": args.max_files,
         "sample_seed": args.sample_seed}
        for root in vaults
    ]
    slug_hash = hashlib.sha1(json.dumps(slug_config, ensure_ascii=False, sort_keys=True,
                                       separators=(",", ":")).encode()).hexdigest()[:10]
    slug_name = os.path.basename(vaults[0].rstrip("/")) if len(vaults) == 1 else f"multisource-{len(vaults)}"
    slug = f"{slug_name}-{slug_hash}"
    work = os.path.join(os.path.expanduser(args.work_home), "runs", slug)
    if args.fresh and os.path.isdir(work):
        shutil.rmtree(work)
    os.makedirs(work, exist_ok=True)
    ctx = Ctx(vaults, work, args.max_files, excludes=args.exclude, sample_seed=args.sample_seed)

    print(f"{BRAND}, {', '.join(vaults)}")
    print(_t("main_work_folder", work=work))
    print(_t("main_step1"))
    scan = stage_scan(ctx)
    print(_t("main_step1_result", notes=scan["notes"], dead=scan["dead_links"]))
    print(_t("main_step2"))
    man = stage_manifest(ctx)
    print(_t("main_step2_result", files=man["files"], batches=len(man["batches"])))
    if args.estimate:
        # LLM 0 estimate mode
        listing = ctx.path("estimate-files.txt")
        with open(listing, "w", encoding="utf-8") as f:
            for b in man["batches"]:
                for fi in b:
                    prefix = f'[{fi["source_label"]}] ' if len(vaults) > 1 else ""
                    f.write(prefix + fi["rel"] + "\n")
        total_kb = sum(fi["size"] for b in man["batches"] for fi in b) // 1024
        n_b = len(man["batches"])
        est_extract = max(1, round(n_b * 0.15))
        est_judge = max(1, round(min(args.max_judge_pairs, 6 * man["files"]) / JUDGE_BATCH / JUDGE_PARALLEL * 1.5))
        print(_t("main_estimate_header"))
        print(_t("main_estimate_files", files=man["files"], kb=total_kb, listing=listing))
        print(_t("main_estimate_time", extract=est_extract, judge=est_judge))
        print(_t("main_estimate_exclude"))
        return
    print(_t("main_step3", model=args.extract_model, p=EXTRACT_PARALLEL))
    atoms = stage_extract(ctx, man, args.extract_model)
    print(_t("main_step3_result", atoms=f"{len(atoms):,}"))
    print(_t("main_step4"))
    pairs = stage_pair(ctx, atoms, args.max_judge_pairs)
    print(_t("main_step4_result", pairs=f"{len(pairs):,}"))
    print(_t("main_step5", model=args.judge_model, p=JUDGE_PARALLEL))
    js = stage_judge(ctx, pairs, args.judge_model)
    print(_t("main_step5_result", judgments=f"{len(js):,}"))
    print(_t("main_step6", sample=args.junk_sample))
    junk = stage_junk(ctx, atoms, args.judge_model, args.junk_sample)
    summary = stage_report(ctx, scan, man, atoms, pairs, js, junk)

    if _limit_hits["hits"]:
        print(_t("main_limit_warn", hits=_limit_hits["hits"]))
    if summary["failed_extract_batches"]:
        print(_t("main_extract_fail_warn", failed=summary["failed_extract_batches"]))
    print(_t("main_done", score=summary["score"]))
    junk_str = f"~{round(summary['junk_rate'] * 100)}%" if summary["junk_rate"] is not None else _t("junk_fail_short")
    print(_t("main_summary", dups=summary["duplicates"], contras=summary["contradictions"],
             cross=summary["cross_source_contradictions"], junk=junk_str, cards=summary["review_cards"]))
    print(_t("main_report_path", path=summary["report"]))


if __name__ == "__main__":
    main()
