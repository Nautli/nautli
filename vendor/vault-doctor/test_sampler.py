#!/usr/bin/env python3
"""NEARDUP-SAMPLER 불변식 상설 테스트 (LLM 없음, 순수 로컬).

불변식:
  1) max_files < 전체 && near-dup 클러스터 존재 → 클러스터 양쪽 파일이 표본에 포함(dup-cluster).
  2) 같은 볼트 경로 재실행 → 동일 표본(결정론).
  3) max_files >= 전체 → 프리스캔/편향 없이 전량(no-op).
CLI: python3 test_sampler.py  (exit 0=pass, 1=fail)
"""
import os, sys, tempfile, shutil, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("vd", os.path.join(HERE, "vault_doctor.py"))
vd = importlib.util.module_from_spec(spec); spec.loader.exec_module(vd)

DUP_A = ("# 결제 재시도 정책\n결제가 실패하면 최대 3회까지 자동으로 재시도한다. "
         "재시도 간격은 지수 백오프(2초, 4초, 8초)를 적용하고, 3회 모두 실패하면 "
         "사용자에게 카드 재등록을 요청한다. 이 규칙은 모든 결제 게이트웨이에 공통 적용된다.\n")
DUP_B = ("# 빌링 재시도 규칙\n결제가 실패하면 최대 3회까지 자동으로 재시도한다. "
         "재시도 간격은 지수 백오프(2초, 4초, 8초)를 적용하고, 세 번 모두 실패하면 "
         "사용자에게 카드 재등록을 요청한다. 이 규칙은 모든 결제 게이트웨이에 공통 적용된다.\n")


def build_vault(vault, n_unique=41):
    for i in range(n_unique):
        d = os.path.join(vault, f"proj{i % 5}"); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f"note{i}.md"), "w").write(
            f"# 노트 {i}\n프로젝트 {i % 5} 결정 {i}. 고유 {i} 값 {i * 7} 상태 진행중{i}.\n")
    dd = os.path.join(vault, "dupzone"); os.makedirs(dd, exist_ok=True)
    open(os.path.join(dd, "payment.md"), "w").write(DUP_A)
    open(os.path.join(dd, "billing.md"), "w").write(DUP_B)
    # dup_bytes는 exact-dup만 세므로 near-dup fixture와 분리해 하한을 만든다.
    exact = os.path.join(vault, "exactzone"); os.makedirs(exact, exist_ok=True)
    exact_text = "# 동일 문서\n정규화된 내용이 정확히 같은 복제본이다.\n"
    open(os.path.join(exact, "copy-a.md"), "w").write(exact_text)
    open(os.path.join(exact, "copy-b.md"), "w").write(exact_text)


def sample_rels(vault, max_files):
    work = tempfile.mkdtemp(prefix="vd-w-")
    try:
        ctx = vd.Ctx([vault], work, max_files)
        vd.stage_scan(ctx)
        man = vd.stage_manifest(ctx)
        rels, reasons = [], {}
        for b in man["batches"]:
            for f in b:
                rels.append(f["rel"]); reasons[f["rel"]] = f.get("sampling_reason")
        return man, rels, reasons
    finally:
        shutil.rmtree(work, ignore_errors=True)


def instruction_layer_invariants(base):
    """TASK-018/020: 지시파일 근거와 감점표는 LLM 없이도 검증 가능하다."""
    vault = os.path.join(base, "instruction-vault")
    os.makedirs(os.path.join(vault, ".cursor", "rules"), exist_ok=True)
    open(os.path.join(vault, "CLAUDE.md"), "w").write(
        "Do run tests.\nRead `./missing-claude.md`.\n")
    open(os.path.join(vault, "AGENTS.md"), "w").write(
        "Do run tests.\nDo not deploy production.\n")
    open(os.path.join(vault, ".cursorrules"), "w").write(
        "Do deploy production.\nRead `docs/missing-cursor.md`.\n")
    open(os.path.join(vault, ".cursor", "rules", "team.mdc"), "w").write(
        "Use local rules.\n")
    work = tempfile.mkdtemp(prefix="vd-instruction-w-")
    try:
        ctx = vd.Ctx([vault], work, 0)
        layer = vd.stage_instruction_layer(ctx)
        assert [item["path"] for item in layer["loading_map"]["claude"]] == ["CLAUDE.md"]
        assert [item["path"] for item in layer["loading_map"]["codex"]] == ["AGENTS.md"]
        assert {item["path"] for item in layer["loading_map"]["cursor"]} == {
            ".cursorrules", ".cursor/rules/team.mdc"}
        signals = layer["signals"]
        assert signals["exact_duplicates"] and all("path" in e and "line" in e
                                                   for e in signals["exact_duplicates"][0]["evidence"])
        assert signals["polarity_conflicts"] and all("path" in e and "line" in e
                                                      for e in signals["polarity_conflicts"][0]["evidence"])
        assert signals["dead_paths"] and all("path" in item["evidence"] and "line" in item["evidence"]
                                              for item in signals["dead_paths"])

        scan = vd.stage_scan(ctx)
        man = vd.stage_manifest(ctx)
        atoms = [
            {"id": "fa_memory", "claim": "The test command is npm test.", "kind": "memory",
             "source": "note.md", "source_id": "source", "scope": "project:vault", "type": "semantic"},
            {"id": "fa_rule", "claim": "Run tests before deployment.", "kind": "rule",
             "source": "AGENTS.md", "source_id": "source", "scope": "project:vault", "type": "semantic"},
        ]
        pairs = [{"a": "fa_memory", "b": "fa_rule", "kind_a": "memory", "kind_b": "rule",
                  "claim_a": atoms[0]["claim"], "claim_b": atoms[1]["claim"], "src_a": "note.md", "src_b": "AGENTS.md"}]
        judgments = [{"pair_id": "fa_memory|fa_rule", "verdict": "duplicate", "confidence": 0.9}]
        summary = vd.stage_report(ctx, scan, man, atoms, pairs, judgments, [])
        deductions = summary["score_deductions"]
        assert sum(item["subtotal"] for name, item in deductions.items() if name != "final") == deductions["final"]
        report = open(summary["report"], encoding="utf-8").read()
        assert "| **final**" in report and "CLAUDE.md:1" in report and "AGENTS.md:2" in report
        assert summary["rule_review_candidates"] == 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    base = tempfile.mkdtemp(prefix="vd-sampler-test-")
    try:
        vault = os.path.join(base, "vault"); build_vault(vault)
        pay, bil = "dupzone/payment.md", "dupzone/billing.md"

        # 1) near-dup 쌍이 표본에 포함
        man, rels, reasons = sample_rels(vault, 40)
        assert man["files"] == 40, f"expected 40 sampled, got {man['files']}"
        assert man["near_dup_pairs"] >= 1, "near_dup_pairs should be >=1"
        assert man["dup_bytes"] > 0, "dup_bytes should be >0"
        assert pay in rels and bil in rels, "both near-dup files must be sampled"
        assert reasons[pay] == "dup-cluster" and reasons[bil] == "dup-cluster", \
            "near-dup files must be tagged dup-cluster"

        # 2) 결정론
        _, rels2, _ = sample_rels(vault, 40)
        assert sorted(rels) == sorted(rels2), "same vault must yield identical sample"

        # 3) max_files >= 전체 → 전량(no-op)
        man_all, rels_all, _ = sample_rels(vault, 500)
        assert man_all["files"] == 45, f"full mode must keep all 45, got {man_all['files']}"

        instruction_layer_invariants(base)

        print("test_sampler: PASS (near-dup, instruction evidence, score deductions, deterministic, full-mode no-op)")
        return 0
    except AssertionError as e:
        print("test_sampler: FAIL —", e); return 1
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
