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

# ── 브랜드 (이름 미정 — 여기 한 곳만 바꾸면 전체 반영) ──────────────────────
BRAND = "vault-doctor"

PKG_DIR = os.path.dirname(os.path.abspath(__file__))
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


def stage_manifest(ctx):
    out = ctx.path("manifest.json")
    if os.path.exists(out):
        return json.load(open(out, encoding="utf-8"))
    files = []
    source_samples = collections.Counter()
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
        random.Random(seed).shuffle(root_files)
        if ctx.max_files:
            root_files = root_files[:ctx.max_files]
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
           "source_samples": dict(source_samples), "batches": batches}
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
        print(f"  ⚠️ 후보쌍 {dropped}건은 판정 상한({max_judge_pairs})에 걸려 이번 판정에서 제외됨 "
              f"(--max-judge-pairs로 조정 가능)", flush=True)
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
        print(f"  버려도 되는 조각 확인 {min(i + JUNK_BATCH, len(sample))}/{len(sample)}", flush=True)
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
        {"junk": round(s_junk), "모순": round(s_contra), "중복": round(s_dup), "구조": round(s_struct)}


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
        junk_types = dict(collections.Counter(j.get("type") or "기타" for j in junk_items))
    score, axes = health_score(scan, len(atoms), len(dups), len(contras), junk_rate)
    cards, n_contra_cards, n_dup_cards = build_cards(pairs, js)

    today = datetime.date.today().isoformat()
    L = []
    report_name = os.path.basename(ctx.vault.rstrip("/")) if len(ctx.vaults) == 1 else f"멀티소스 {len(ctx.vaults)}개"
    vault_display = ctx.vault if len(ctx.vaults) == 1 else ", ".join(ctx.vaults)
    L.append(f"# {BRAND} 리포트, {report_name}")
    L.append(f"\n생성일 {today} · 볼트 `{vault_display}` · 제3자 서버 0 · AI 판정은 본인 Claude 구독 경유 · 리포트는 로컬 파일\n")
    L.append(f"## 기억 건강 점수: **{score}/100**\n")
    L.append("점수 구성: 버려도 되는 조각 비율 40점 + 모순 밀도 30점 + 중복 밀도 20점 + 구조(머리말 정보·죽은 링크) 10점. 공식은 README에 있습니다.\n")
    L.append("| 축 | 점수 | 만점 |")
    L.append("|---|---|---|")
    for k, label, full in (("junk", "버려도 되는 조각", 40), ("모순", "모순", 30),
                           ("중복", "중복", 20), ("구조", "구조", 10)):
        L.append(f"| {label} | {axes[k]} | {full} |")
    L.append("\n## 볼트 스캔 요약\n")
    L.append(f"- 노트 **{scan['notes']}개** ({scan['bytes'] // 1024}KB), "
             f"머리말 정보가 있는 노트 {round(scan['frontmatter_rate'] * 100)}%")
    L.append(f"- 위키링크 {scan['wikilinks']}개 중 **죽은 링크 {scan['dead_links']}개** "
             f"({round(scan['dead_link_rate'] * 100)}%). 대상 노트가 없는 `[[링크]]`입니다.")
    L.append(f"- 노트에서 추출한 기억 조각 **{len(atoms):,}건**, 서로 비슷한 후보쌍 {len(pairs):,}건 판정")
    samples_str = ", ".join(f"{label} **{count}개**" for label, count in sorted(source_samples.items())) or "없음"
    L.append(f"- 소스별 표본 파일: {samples_str}")
    L.append("\n## 발견 사항\n")
    L.append(f"- **중복 {len(dups)}쌍**. 같은 얘기가 두 곳 이상에 적혀 있음. "
             f"그중 {len(dups_hi)}쌍은 확실한 중복(자동 병합 가능 수준), "
             f"{n_dup_cards}쌍은 사람 확인 필요")
    L.append(f"- **모순 {len(contras)}쌍**. 서로 부딪히는 기록(한쪽이 낡았을 가능성). "
             f"전부 아래 질문 대상")
    L.append(f"- **교차소스 모순 {cross_source_contradictions}쌍**. 서로 다른 AI 기억 소스 사이에서 발견")
    if junk_rate is not None:
        types_str = ", ".join(f"{k} {v}" for k, v in sorted(junk_types.items(), key=lambda x: -x[1])) or "없음"
        L.append(f"- **버려도 되는 조각 비율 약 {round(junk_rate * 100)}%** "
                 f"(표본 {len(junk_judgments)}건을 AI로 확인). 서사, 일회성 기록, 할 일처럼 "
                 f"기억할 가치가 낮은 조각의 비율입니다. 유형: {types_str}")
    else:
        L.append("- 버려도 되는 조각 비율: 측정 실패 (run.log 확인)")
    if failed_batches:
        L.append(f"- ⚠️ 추출 실패 묶음 **{failed_batches}/{len(man['batches'])}개** (시간 초과/오류). "
                 f"이 몫의 노트는 이번 진단에서 빠짐. 같은 명령을 재실행하면 실패분만 이어서 시도한다")
    L.append("\n## 답할 질문 (상위 " + str(len(cards)) + f"개 / 전체 {n_contra_cards + n_dup_cards}건)\n")
    if cards:
        L.append("**먼저 할 것**: '낡은 기록' 질문부터 보세요. AI와 미래의 내가 실제로 잘못 가져갈 위험은 "
                 "거기에 있습니다. 중복은 정보가 사라지지 않아 급하지 않습니다. 볼트가 크면 중복과 모순은 "
                 "자연스럽게 생기므로 점수보다 질문에 답하는 편이 더 유용합니다.\n")
    if not cards:
        L.append("답할 질문이 없습니다. 🎉")
    for i, (kind, j, p) in enumerate(cards, 1):
        # "모순"과 "낡은 기록 갱신"은 유저 체감이 다르다 — newer가 있으면 후자로 표기 (같은 verdict라도)
        if kind == "contradiction" and j.get("newer") in ("a", "b"):
            label, head = "낡은 기록(갱신 필요)", "한쪽이 낡은 기록으로 보입니다. 최신 쪽을 기준으로 정리하세요."
        elif kind == "contradiction":
            label, head = "모순", "이 두 기록이 서로 부딪힙니다. 지금은 어느 쪽이 맞나요?"
        else:
            label, head = "중복(확인 필요)", "같은 내용으로 보이는데 확실하지 않습니다. 하나로 합칠까요?"
        L.append(f"### 질문 {i} · {label} (판정 확신 {j.get('confidence')})")
        L.append(f"**{head}**")
        L.append(f"- A: {p['claim_a']}  \n  `{p.get('src_a')}` ({p.get('t_a')})")
        L.append(f"- B: {p['claim_b']}  \n  `{p.get('src_b')}` ({p.get('t_b')})")
        if j.get("newer") in ("a", "b"):
            L.append(f"- 판정 참고: **{j['newer'].upper()}쪽이 더 최신**으로 보임")
        if j.get("reason"):
            L.append(f"- 판정 이유: {j['reason']}")
        L.append("")
    if len(contras) + n_dup_cards > 0:
        L.append("---\n### 이 리포트가 말하는 것\n")
        L.append("모순과 중복을 그대로 두면 AI와 미래의 내가 낡은 기록을 집어 갑니다. "
                 "볼트가 클수록 검색은 잘 되는데 답이 틀리기 시작하는 이유가 이것입니다. "
                 "위 질문들을 지금 정리하거나, 주기적으로 이 진단을 다시 돌리세요.")
        # TODO(브랜드 확정: Nightmerge — 전환 브릿지 문단 추가 가능): 소화 데몬 제품으로의 전환 브릿지 문단 추가 (차용검토 v2 롤플레이 §)
    L.append("---\n### 방법론·한계")
    L.append(f"- 추출·판정은 로컬 claude CLI(구독) 경유, 판정 프롬프트는 nautli PoC 검증본(모순 오탐 반례 3종 포함).")
    L.append("- 버려도 되는 조각 비율은 고정된 표본으로 계산한 추정치입니다. 표본이 작으면 오차 범위가 넓습니다.")
    L.append(f"- 중간 산출물·로그: `{ctx.work}`")
    report_path = ctx.path("report.md")
    open(report_path, "w", encoding="utf-8").write("\n".join(L) + "\n")

    summary = {"score": score, "notes": scan["notes"], "atoms": len(atoms),
               "duplicates": len(dups), "contradictions": len(contras),
               "source_samples": source_samples,
               "cross_source_contradictions": cross_source_contradictions,
               "junk_rate": round(junk_rate, 3) if junk_rate is not None else None,
               "review_cards": n_contra_cards + n_dup_cards,
               "failed_extract_batches": failed_batches, "report": report_path}
    json.dump(summary, open(ctx.path("summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return summary


# ── main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(prog=BRAND, description=f"{BRAND}, 마크다운 볼트 건강검진 (전 과정 로컬)")
    ap.add_argument("vault", nargs="+", help="옵시디언/마크다운 볼트 경로 (복수 가능)")
    ap.add_argument("--work-home", default=os.path.expanduser(f"~/.{BRAND}"),
                    help=f"작업/리포트 저장 위치 (기본 ~/.{BRAND})")
    ap.add_argument("--max-files", type=int, default=0, help="스모크 테스트용: 앞에서 N개 파일만")
    ap.add_argument("--sample-seed", help="표본 셔플 시드 (기본: 소스별 canonical 경로 sha1)")
    ap.add_argument("--exclude", action="append", default=[],
                    help="제외할 폴더/글롭 (반복 가능, 예: --exclude 일기 --exclude '*.excalidraw.md'). 제외분은 LLM에 안 감")
    ap.add_argument("--max-judge-pairs", type=int, default=1500, help="LLM 판정 쌍 상한 (비용 캡)")
    ap.add_argument("--junk-sample", type=int, default=40, help="버려도 되는 조각을 확인할 표본 수")
    ap.add_argument("--extract-model", default="haiku")
    ap.add_argument("--judge-model", default="sonnet")
    ap.add_argument("--estimate", action="store_true",
                    help="LLM 호출 0: 전송 대상 파일 목록과 예상 소요·배치 수만 출력하고 종료 (실행 전 확인용)")
    ap.add_argument("--fresh", action="store_true", help="이전 중간 산출물 버리고 처음부터")
    args = ap.parse_args()

    canonical = [os.path.realpath(os.path.abspath(os.path.expanduser(v))) for v in args.vault]
    for vault in canonical:
        if not os.path.isdir(vault):
            print(f"볼트 경로가 없다: {vault}", file=sys.stderr)
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
    print(f"작업 폴더: {work} (중단해도 재실행하면 이어서 돈다)\n")
    print("[1/6] 정적 스캔...")
    scan = stage_scan(ctx)
    print(f"      노트 {scan['notes']}개, 죽은 링크 {scan['dead_links']}개")
    print("[2/6] 배치 구성...")
    man = stage_manifest(ctx)
    print(f"      {man['files']}파일 → {len(man['batches'])}배치")
    if args.estimate:
        # LLM 0 견적 모드: 뭐가 나가고 얼마나 걸리는지 실행 전에 보여준다
        listing = ctx.path("estimate-files.txt")
        with open(listing, "w", encoding="utf-8") as f:
            for b in man["batches"]:
                for fi in b:
                    prefix = f'[{fi["source_label"]}] ' if len(vaults) > 1 else ""
                    f.write(prefix + fi["rel"] + "\n")
        total_kb = sum(fi["size"] for b in man["batches"] for fi in b) // 1024
        n_b = len(man["batches"])
        est_extract = max(1, round(n_b * 0.15))          # 배치당 ~45초, 병렬 5 실측 근사
        est_judge = max(1, round(min(args.max_judge_pairs, 6 * man["files"]) / JUDGE_BATCH / JUDGE_PARALLEL * 1.5))
        print(f"\n📋 견적 (LLM 호출 0, 아직 아무것도 전송 안 됨)")
        print(f"   Claude로 전송될 파일: {man['files']}개 ({total_kb}KB). 전체 목록: {listing}")
        print(f"   예상 소요: 추출 ~{est_extract}분 + 판정 ~{est_judge}분 (구독 쿼터 사용, 대략치)")
        print(f"   빼고 싶은 폴더가 목록에 있으면 --exclude <폴더> 로 제외하고 다시 확인하라.")
        return
    print(f"[3/6] fact 추출 ({args.extract_model}, 병렬 {EXTRACT_PARALLEL})...")
    atoms = stage_extract(ctx, man, args.extract_model)
    print(f"      atom {len(atoms):,}건")
    print("[4/6] 후보쌍 계산...")
    pairs = stage_pair(ctx, atoms, args.max_judge_pairs)
    print(f"      후보쌍 {len(pairs):,}건")
    print(f"[5/6] 중복·모순 판정 ({args.judge_model}, 병렬 {JUDGE_PARALLEL})...")
    js = stage_judge(ctx, pairs, args.judge_model)
    print(f"      판정 {len(js):,}건")
    print(f"[6/6] 버려도 되는 조각 확인 (표본 {args.junk_sample}) + 리포트...")
    junk = stage_junk(ctx, atoms, args.judge_model, args.junk_sample)
    summary = stage_report(ctx, scan, man, atoms, pairs, js, junk)

    if _limit_hits["hits"]:
        print(f"\n⚠️ 사용량 한도/네트워크 장애 감지 {_limit_hits['hits']}회. 실패분이 있으면 같은 명령 재실행")
    if summary["failed_extract_batches"]:
        print(f"\n⚠️ 추출 실패 배치 {summary['failed_extract_batches']}개. 같은 명령 재실행으로 이어받기 가능")
    print(f"\n✅ 완료. 기억 건강 점수 {summary['score']}/100")
    junk_str = f"~{round(summary['junk_rate'] * 100)}%" if summary["junk_rate"] is not None else "측정실패"
    print(f"   중복 {summary['duplicates']}쌍 · 모순 {summary['contradictions']}쌍 · "
          f"교차소스 모순 {summary['cross_source_contradictions']}쌍 · "
          f"버려도 되는 조각 {junk_str} · 질문 {summary['review_cards']}건")
    print(f"   리포트: {summary['report']}")


if __name__ == "__main__":
    main()
