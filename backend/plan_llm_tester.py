#!/usr/bin/env python3
"""Iterative tester for Ark Responses API based plan generation.

Workflow:
1) Read guidance markdown.
2) Build prompt with user input and Excel equipment list.
3) Call LLM to generate markdown plan.
4) Evaluate gaps against constraints from reference docs.
5) If failed, append corrective rules to working markdown and retry.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib import request
from urllib.error import HTTPError, URLError

import openpyxl

# Import post_processor from the same scripts/ directory.
try:
    _SCRIPTS_DIR = Path(__file__).parent
    if str(_SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPTS_DIR))
    from post_processor import check_prose_under_headings, post_process
    _POST_PROCESSOR_AVAILABLE = True
except ImportError:
    _POST_PROCESSOR_AVAILABLE = False


ALLOWED_SYSTEMS = ["扩声系统", "中控系统", "录播系统", "矩阵系统", "视频会议系统","话筒"]

SYSTEM_KEYWORDS = {
"扩声系统": ["全频音箱", "台唇音箱", "拉声像音箱", "全频线性音柱", "返听音箱", "超低音箱", "吸顶音箱", "线阵列音箱", "定阻功放", "调音台", "反馈抑制器", "数字音频处理器", "电源时序器"],
"话筒": ["无线手持话筒", "无线方管麦克风", "无线鹅颈麦克风", "有线鹅颈麦克风", "有线方管麦克风", "天线放大系统", "无线手拉手会议单元", "物联网数字会议单元", "无线网联会议单元"],
"中控系统": ["中控主机", "中控编辑软件", "电源控制器"],
"录播系统": ["高清录播主机", "高清录播一体机", "4K高清录播主机", "录播服务器"],
"矩阵系统": ["一体式HDMI矩阵", "高清混插矩阵主机", "HDMI输入卡", "HDMI输出卡", "DVI输入卡", "DVI输出卡", "VGA输入卡", "VGA输出卡", "AV输入卡", "AV输出卡", "SDI输入卡", "SDI输出卡"],
"视频会议系统": ["MCU", "视频会议终端", "一体化视频会议终端", "高清摄像头", "摄像机控制键盘"]
}

REFERENCE_CHAPTER_HINTS = ["项目概述", "设计依据", "设计原则", "系统设计", "设备清单", "结论"]

FORMULA_TOKENS = ["Lρ", "L_p", "NAG", "PAG", "EPR", "Dc", "ALcons", "T60"]

FORMULA_REFERENCE_BLOCK = textwrap.dedent(
    """
    指标与公式参考（源自附件示例文档，可作为“依据与计算方法”章节写作素材，注意公式格式）：
    - 直达声压级：Lρ = SPL + 10logW - 20logr
    - 必要声增益：NAG(dB) = 20logD0 - 20logEAD
    - 可用声增益：PAG(dB) = 20logD0 + 20logD1 - 20logD2 - 20logDs - 10logNOM - FSM
    - 输入电功率：EPR = 10^X, X = [SPL + 3dB + (ΔD2 - Δref_dist) - LSENSI]/10
    - 临界距离（混响半径）：Dc = K * sqrt((Q^2 * V) / T60)
    - 语言可懂度相关：ALcons 与 D2、T60、V、Q 相关

    约束：
    - 可给出公式、变量定义与适用前提。
    - 没有实测或仿真输入参数时，不得编造具体计算结果。
    """
).strip()


@dataclass
class Equipment:
    category: str
    name: str
    brand: str
    model: str
    params: str
    qty: float
    unit: str
    system: str


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_qty(value: float) -> str:
    iv = int(value)
    if abs(value - iv) < 1e-9:
        return str(iv)
    return f"{value:.2f}".rstrip("0").rstrip(".")


def classify_system_by_name(device_name: str) -> str:
    for system, keywords in SYSTEM_KEYWORDS.items():
        for keyword in keywords:
            if keyword in device_name:
                return system
    return "未归类"


def normalize_system_label(raw_system: str, category: str, device_name: str) -> str:
    raw = _clean_text(raw_system)
    if raw in ALLOWED_SYSTEMS:
        return raw

    alias = {
        "会议": "会议系统",
        "话筒": "会议系统",
        "中控": "中控系统",
        "矩阵": "矩阵系统",
        "视频会议": "视频会议系统",
        "专业扩声系统": "扩声系统",
    }
    if raw in alias:
        return alias[raw]

    merged = f"{_clean_text(category)} {_clean_text(device_name)}"
    guessed = classify_system_by_name(merged)
    if guessed != "未归类":
        return guessed
    return "未归类"


def _find_first_existing(index: Dict[str, int], candidates: List[str]) -> str:
    for c in candidates:
        if c in index:
            return c
    return ""


def load_equipment_from_excel(excel_path: Path) -> List[Equipment]:
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("Excel 为空")

    header = [str(x).strip() if x is not None else "" for x in rows[0]]
    index = {name: i for i, name in enumerate(header)}
    col_system = _find_first_existing(index, ["系统"])
    col_category = _find_first_existing(index, ["设备分类", "分类"])
    col_name = _find_first_existing(index, ["设备名称", "产品名称"])
    col_brand = _find_first_existing(index, ["品牌"])
    col_model = _find_first_existing(index, ["型号"])
    col_qty = _find_first_existing(index, ["数量"])
    col_params = _find_first_existing(index, ["参数", "规格", "设备分类"])
    col_unit = _find_first_existing(index, ["单位"])

    required_cols = [col_name, col_brand, col_model, col_qty]
    missing = []
    if not col_name:
        missing.append("设备名称/产品名称")
    if not col_brand:
        missing.append("品牌")
    if not col_model:
        missing.append("型号")
    if not col_qty:
        missing.append("数量")
    if missing:
        raise ValueError(f"Excel 缺少必要列: {missing}")

    items: List[Equipment] = []
    for row in rows[1:]:
        if not row:
            continue
        raw_name = _clean_text(row[index[col_name]])
        device_name = raw_name
        if not device_name or device_name in {"总价", "合计"}:
            continue
        brand = _clean_text(row[index[col_brand]])
        model = _clean_text(row[index[col_model]])
        category = _clean_text(row[index[col_category]]) if col_category else ""
        params = _clean_text(row[index[col_params]]) if col_params else ""
        qty_raw = row[index[col_qty]]
        try:
            qty = float(qty_raw) if qty_raw is not None else 0.0
        except Exception:
            qty = 0.0
        unit = _clean_text(row[index[col_unit]]) if col_unit else ""

        # Some rows are filled as: 产品名称=型号代码, 型号=1.
        # Heuristic: if 型号 is numeric but 产品名称 looks like model code,
        # then use 产品名称 as 型号 and 设备分类 as设备名称.
        if re.fullmatch(r"\d+(?:\.\d+)?", model or "") and re.search(r"[A-Za-z].*\d|\d.*[A-Za-z]", raw_name or ""):
            model = raw_name
            if category:
                device_name = category

        raw_system = _clean_text(row[index[col_system]]) if col_system else ""
        system = normalize_system_label(raw_system, category, device_name)
        items.append(
            Equipment(
                category=category,
                name=device_name,
                brand=brand,
                model=model,
                params=params,
                qty=qty,
                unit=unit,
                system=system,
            )
        )
    return items


def find_missing_systems(selected_systems: List[str], items: List[Equipment]) -> List[str]:
    present = {x.system for x in items}
    return [s for s in selected_systems if s not in present]


def build_equipment_json(items: List[Equipment]) -> str:
    data = []
    for x in items:
        data.append(
            {
                "系统": x.system,
                "设备分类": x.category,
                "设备名称": x.name,
                "品牌": x.brand,
                "型号": x.model,
                "参数": x.params,
                "数量": int(x.qty) if x.qty.is_integer() else x.qty,
                "单位": x.unit,
            }
        )
    return json.dumps(data, ensure_ascii=False, indent=2)


def filter_items_by_selected_systems(items: List[Equipment], selected_systems: List[str]) -> List[Equipment]:
    return [x for x in items if x.system in set(selected_systems)]


def build_prompt_text(
    guidance_md: str,
    user_input: Dict[str, object],
    selected_items: List[Equipment],
    strict_missing_systems: List[str],
) -> str:
    missing_block = "[]"
    if strict_missing_systems:
        missing_block = json.dumps(strict_missing_systems, ensure_ascii=False)

    payload = {
        "scene": user_input["scene"],
        "length": user_input["length"],
        "width": user_input["width"],
        "height": user_input["height"],
        "selected_systems": user_input["selected_systems"],
    }

    has_mic = any("话筒" in (x.category + x.name) for x in selected_items)
    min_chars = 2200 + 500 * max(1, len(user_input["selected_systems"]))

    mic_rule = ""
    if has_mic:
        mic_rule = (
            "\n        10. 检测到设备清单包含话筒设备，必须单独设置“话筒系统”章节（独立于扩声系统/会议系统），"
            "并在该章节中单独给出话筒设备表、点位逻辑和抗啸叫说明。"
        )

    return textwrap.dedent(
        f"""
        你需要依据以下规范文档生成最终方案：

        ----- 规范文档开始 -----
        {guidance_md}
        ----- 规范文档结束 -----

        以下是本次任务输入：
        {json.dumps(payload, ensure_ascii=False, indent=2)}

        以下是可用设备清单（仅允许使用这些设备）：
        {build_equipment_json(selected_items)}

        {FORMULA_REFERENCE_BLOCK}

        严格模式缺失系统检查结果：
        {missing_block}

        输出要求：
        1. 输出必须是 Markdown。
        2. 如果 strict_missing_systems 非空，必须输出“信息不足”说明，不得输出完整方案。
        3. 如果 strict_missing_systems 为空，输出完整方案，且设备型号和数量必须与设备清单完全一致。
        4. 必须新增“设计指标依据与计算公式”章节：至少包含 4 个指标条目（如最大声压级、传声增益、声场不均匀度、系统噪声级）及对应依据说明。
        5. 必须包含不少于 4 条公式（可使用 $...$ 或 $$...$$），并解释变量含义和使用条件。
        6. 必须包含插图，不少于 3 幅，优先使用 Mermaid（如系统拓扑图、信号流图、设备点位图）。
        7. 方案篇幅要充分，正文不少于 {min_chars} 个中文字符（不含代码块和表格分隔线）。
        8. 每个已选系统都要包含：建设目标、设计指标、设备配置、拓扑/插图、设计理由、预期效果。
        9. 输出不得出现“内容从简”“略”等压缩性表述。        10. 【内容深度要求】每个三级标题（###）下必须有至少 1 段实质性描述文字（不少于 80 字），
            解释该节的建设目标、设计思路、选型依据或方案优势，不允许只放表格或图示而没有文字说明。
        11. 【写作顺序要求】每小节必须先用文字分析背景/原因/设计思路，再给出图表，最后总结预期效果；
            禁止正文只有"如下所示"/"详见下表"等一两句然后直接跟图/表的写法。        {mic_rule}
        """
    ).strip()


def call_ark_responses(
    api_key: str,
    model: str,
    prompt_text: str,
    endpoint: str,
    timeout_seconds: int = 120,
) -> Dict[str, object]:
    body = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt_text}],
            }
        ],
    }

    req = request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP 错误: {e.code} {detail}") from e
    except URLError as e:
        raise RuntimeError(f"网络错误: {e}") from e


def _extract_text_recursive(node: object, buf: List[str]) -> None:
    if isinstance(node, dict):
        node_type = str(node.get("type", "")).lower()
        if node_type in {"output_text", "text"} and isinstance(node.get("text"), str):
            buf.append(node["text"])
        if isinstance(node.get("output_text"), str):
            buf.append(node["output_text"])
        for v in node.values():
            _extract_text_recursive(v, buf)
    elif isinstance(node, list):
        for x in node:
            _extract_text_recursive(x, buf)


def extract_response_text(payload: Dict[str, object]) -> str:
    if isinstance(payload.get("output_text"), str):
        return str(payload["output_text"]).strip()

    buf: List[str] = []
    _extract_text_recursive(payload, buf)
    merged = "\n".join(x.strip() for x in buf if x and x.strip())
    return merged.strip()


def extract_heading_titles(markdown: str) -> List[str]:
    titles = []
    for line in markdown.splitlines():
        m = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
        if m:
            titles.append(m.group(1).strip())
    return titles


def parse_markdown_device_tables_grouped(markdown: str) -> List[List[Dict[str, str]]]:
    lines = markdown.splitlines()
    tables: List[List[Dict[str, str]]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if "|" not in line:
            i += 1
            continue
        if i + 1 >= len(lines):
            i += 1
            continue
        sep = lines[i + 1]
        if "|" not in sep or "-" not in sep:
            i += 1
            continue

        header = [x.strip() for x in line.strip().strip("|").split("|")]
        if "型号" not in header or "数量" not in header:
            i += 1
            continue
        header_index = {k: idx for idx, k in enumerate(header)}
        table_rows: List[Dict[str, str]] = []
        j = i + 2
        while j < len(lines) and "|" in lines[j]:
            raw = [x.strip() for x in lines[j].strip().strip("|").split("|")]
            if len(raw) < len(header):
                j += 1
                continue
            row = {k: raw[idx] for k, idx in header_index.items()}
            table_rows.append(row)
            j += 1
        if table_rows:
            tables.append(table_rows)
        i = j
    return tables


def parse_markdown_device_tables(markdown: str) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for t in parse_markdown_device_tables_grouped(markdown):
        out.extend(t)
    return out


def aggregate_model_qty_from_rows(rows: List[Dict[str, str]]) -> Dict[str, float]:
    model_qty: Dict[str, float] = {}
    for r in rows:
        model = r.get("型号", "").strip()
        qty_text = r.get("数量", "").strip()
        if not model:
            continue
        m = re.search(r"\d+(?:\.\d+)?", qty_text)
        if not m:
            continue
        qty = float(m.group(0))
        model_qty[model] = model_qty.get(model, 0.0) + qty
    return model_qty


def expected_model_qty(items: List[Equipment]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for x in items:
        out[x.model] = out.get(x.model, 0.0) + x.qty
    return out


def compare_with_reference_structure(markdown: str) -> List[str]:
    gaps = []
    for hint in REFERENCE_CHAPTER_HINTS:
        if hint not in markdown:
            gaps.append(f"缺少参考方案常见章节或关键词：{hint}")
    return gaps


def count_mermaid_blocks(markdown: str) -> int:
    return len(re.findall(r"```mermaid[\s\S]*?```", markdown, flags=re.I))


def count_markdown_images(markdown: str) -> int:
    return len(re.findall(r"!\[[^\]]*\]\([^\)]+\)", markdown))


def extract_plain_text_length(markdown: str) -> int:
    # Remove fenced code blocks, markdown table separators, and headings markers.
    text = re.sub(r"```[\s\S]*?```", "", markdown)
    text = re.sub(r"^\s*\|[-:\s\|]+\|\s*$", "", text, flags=re.M)
    text = re.sub(r"^\s*#+\s*", "", text, flags=re.M)
    text = text.replace("|", " ")
    text = re.sub(r"\s+", "", text)
    return len(text)


def contains_formula_evidence(markdown: str) -> bool:
    if "计算公式" not in markdown and "公式" not in markdown:
        return False
    hits = sum(1 for t in FORMULA_TOKENS if t in markdown)
    return hits >= 3


def has_indicator_basis(markdown: str) -> bool:
    keys = ["最大声压级", "传声增益", "声场不均匀度", "系统噪声", "设计指标"]
    hits = sum(1 for k in keys if k in markdown)
    return hits >= 4


def evaluate_result(
    markdown: str,
    selected_systems: List[str],
    selected_items: List[Equipment],
    missing_systems: List[str],
) -> Dict[str, object]:
    issues: List[str] = []
    suggestions: List[str] = []

    if not markdown.strip().startswith("#"):
        issues.append("输出不是标准 Markdown 标题起始格式。")

    if missing_systems:
        if "信息不足" not in markdown:
            issues.append("严格模式要求返回“信息不足”，但输出未包含该标题。")
        for s in missing_systems:
            if s not in markdown:
                issues.append(f"信息不足内容未明确指出缺失系统：{s}")
        if "## 1." in markdown or "系统设计方案" in markdown:
            issues.append("严格模式下不应输出完整方案正文。")
    else:
        headings = extract_heading_titles(markdown)
        heading_text = "\n".join(headings)

        for s in selected_systems:
            if s not in heading_text and s not in markdown:
                issues.append(f"未体现已选择系统：{s}")

        unselected = [s for s in ALLOWED_SYSTEMS if s not in selected_systems]
        for s in unselected:
            if re.search(rf"^\s*#+\s*.*{re.escape(s)}", markdown, flags=re.M):
                issues.append(f"出现未选择系统章节：{s}")

        if any("话筒" in (x.category + x.name) for x in selected_items):
            if not re.search(r"^\s*#+\s*.*话筒系统", markdown, flags=re.M):
                issues.append("检测到话筒设备，但未设置独立“话筒系统”章节。")

        table_groups = parse_markdown_device_tables_grouped(markdown)
        if not table_groups:
            issues.append("未识别到包含型号与数量的设备表格。")
        else:
            expected = expected_model_qty(selected_items)
            best_candidate_issues: List[str] | None = None
            best_candidate_key: Tuple[int, int] | None = None
            for rows in table_groups:
                declared = aggregate_model_qty_from_rows(rows)
                candidate_issues: List[str] = []
                for model, qty in expected.items():
                    got = declared.get(model)
                    if got is None:
                        candidate_issues.append(f"设备表格缺少型号：{model}")
                    elif abs(got - qty) > 1e-9:
                        candidate_issues.append(f"设备数量不一致：型号 {model} 期望 {qty}，实际 {got}")
                extra_models = [m for m in declared.keys() if m not in expected]
                for m in extra_models:
                    candidate_issues.append(f"出现 Excel 未提供的设备型号：{m}")

                matched = len([m for m in declared.keys() if m in expected])
                key = (len(candidate_issues), -matched)
                if best_candidate_key is None or key < best_candidate_key:
                    best_candidate_key = key
                    best_candidate_issues = candidate_issues

            if best_candidate_issues:
                issues.extend(best_candidate_issues)

        if not has_indicator_basis(markdown):
            issues.append("缺少指标依据内容（最大声压级/传声增益/声场不均匀度/系统噪声等）。")

        if not contains_formula_evidence(markdown):
            issues.append("缺少计算公式依据，或公式条目不足。")

        mermaid_count = count_mermaid_blocks(markdown)
        image_count = count_markdown_images(markdown)
        if (mermaid_count + image_count) < 3 or mermaid_count < 2:
            issues.append("插图不足：至少需要3幅插图，且至少2幅为Mermaid图。")

        min_len = 2200 + 500 * max(1, len(selected_systems))
        plain_len = extract_plain_text_length(markdown)
        if plain_len < min_len:
            issues.append(f"方案篇幅偏短：正文长度 {plain_len}，低于要求 {min_len}。")

        # Check prose depth under each heading.
        if _POST_PROCESSOR_AVAILABLE:
            prose_issues = check_prose_under_headings(markdown, min_chars=80)
            # Report at most 3 prose issues to avoid overwhelming the correction list.
            if len(prose_issues) > 3:
                issues.append(
                    f"多个章节（共 {len(prose_issues)} 处）叙述文字不足80字，须在每个三级标题下补充实质性描述文字。"
                )
            else:
                issues.extend(prose_issues)

        structure_gaps = compare_with_reference_structure(markdown)
        for g in structure_gaps:
            suggestions.append(g)

    score = max(0, 100 - 15 * len(issues) - 3 * len(suggestions))
    return {
        "pass": len(issues) == 0,
        "score": score,
        "issues": issues,
        "suggestions": suggestions,
    }


def append_corrections_to_md(md_path: Path, iteration: int, issues: List[str], suggestions: List[str]) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "",
        f"## 自动纠偏规则（迭代 {iteration}）",
        "",
        f"- 生成时间：{stamp}",
        "- 以下规则由自动测试失败项生成，后续生成必须严格遵守：",
    ]
    if issues:
        for x in issues:
            lines.append(f"- 必须修复：{x}")
    if suggestions:
        for x in suggestions:
            lines.append(f"- 建议改进：{x}")
    lines.append("")

    with md_path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines))


def save_json(path: Path, data: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def run(args: argparse.Namespace) -> int:
    source_md = Path(args.source_md).resolve()
    working_md = Path(args.working_md).resolve()
    excel_path = Path(args.excel).resolve()
    out_dir = Path(args.out_dir).resolve()

    if not source_md.exists():
        raise FileNotFoundError(f"找不到源 md 文件: {source_md}")
    if not excel_path.exists():
        raise FileNotFoundError(f"找不到 Excel 文件: {excel_path}")

    if not working_md.exists():
        working_md.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_md, working_md)

    selected_systems = [x.strip() for x in args.selected_systems.split(",") if x.strip()]
    for s in selected_systems:
        if s not in ALLOWED_SYSTEMS:
            raise ValueError(f"selected_systems 包含非法系统: {s}")

    user_input = {
        "scene": args.scene,
        "length": args.length,
        "width": args.width,
        "height": args.height,
        "selected_systems": selected_systems,
    }

    all_items = load_equipment_from_excel(excel_path)
    selected_items = filter_items_by_selected_systems(all_items, selected_systems)
    missing_systems = find_missing_systems(selected_systems, all_items)

    api_key = args.api_key or os.getenv("ARK_API_KEY", "")
    if not api_key and not args.dry_run:
        raise RuntimeError("未提供 API Key。请传 --api-key 或设置 ARK_API_KEY 环境变量。")

    print("=== 测试参数 ===")
    print(json.dumps(user_input, ensure_ascii=False, indent=2))
    print("严格模式缺失系统:", missing_systems)
    print("工作 md:", str(working_md))

    passed = False
    best_eval = None
    for i in range(1, args.max_iters + 1):
        print(f"\n=== 迭代 {i}/{args.max_iters} ===")
        guidance_md = working_md.read_text(encoding="utf-8")
        prompt = build_prompt_text(guidance_md, user_input, selected_items, missing_systems)

        iter_dir = out_dir / f"iter_{i:02d}"
        save_text(iter_dir / "prompt.txt", prompt)

        if args.dry_run:
            if missing_systems:
                lines = ["# 信息不足", "", "当前无法生成完整方案，原因如下：", ""]
                for s in missing_systems:
                    lines.append(f"- 已选择系统：{s}")
                    lines.append(f"- 设备清单中未发现{s}相关设备")
                lines.append("")
                lines.append("请补充缺失系统设备清单后重新生成。")
                result_text = "\n".join(lines)
            else:
                result_text = "# 占位方案\n\n## 项目概述\n\nDry-run 模式未调用真实模型。"
            raw = {"dry_run": True, "output_text": result_text}
        else:
            raw = call_ark_responses(
                api_key=api_key,
                model=args.model,
                prompt_text=prompt,
                endpoint=args.endpoint,
                timeout_seconds=args.timeout,
            )
            result_text = extract_response_text(raw)

        save_json(iter_dir / "raw_response.json", raw)
        save_text(iter_dir / "result.md", result_text)

        # Post-process: inject static blocks + add TOC.
        if _POST_PROCESSOR_AVAILABLE:
            assets_root = Path(args.source_md).resolve().parent / "assets"
            processed_text, pp_report = post_process(
                markdown=result_text,
                assets_root=assets_root if assets_root.exists() else None,
                add_toc=True,
            )
            save_text(iter_dir / "result_processed.md", processed_text)
            save_json(iter_dir / "post_process_report.json", pp_report)
            print(f"后处理完成：注入静态块 {pp_report['injected_blocks']}，生成目录: {pp_report['toc_added']}")

        evaluation = evaluate_result(
            markdown=result_text,
            selected_systems=selected_systems,
            selected_items=selected_items,
            missing_systems=missing_systems,
        )
        save_json(iter_dir / "evaluation.json", evaluation)

        print("评分:", evaluation["score"], "通过:", evaluation["pass"])
        if evaluation["issues"]:
            print("失败项:")
            for x in evaluation["issues"]:
                print("-", x)
        if evaluation["suggestions"]:
            print("差距分析:")
            for x in evaluation["suggestions"]:
                print("-", x)

        best_eval = evaluation
        if evaluation["pass"]:
            passed = True
            break

        append_corrections_to_md(
            md_path=working_md,
            iteration=i,
            issues=evaluation["issues"],
            suggestions=evaluation["suggestions"],
        )

    summary = {
        "passed": passed,
        "max_iters": args.max_iters,
        "best_evaluation": best_eval,
        "working_md": str(working_md),
        "output_dir": str(out_dir),
    }
    save_json(out_dir / "summary.json", summary)

    print("\n=== 最终结果 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if passed else 2


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="方案生成自动测试与迭代修正脚本")
    p.add_argument("--source-md", default="大模型方案生成规范.md", help="初始规范 md")
    p.add_argument("--working-md", default="大模型方案生成规范_迭代版.md", help="自动追加纠偏规则的 md")
    p.add_argument("--excel", default="list.xlsx", help="设备清单 Excel")
    p.add_argument("--out-dir", default="outputs", help="输出目录")
    p.add_argument("--endpoint", default="https://ark.cn-beijing.volces.com/api/v3/responses", help="Ark Responses API")
    p.add_argument("--model", default="doubao-seed-2-0-pro-260215", help="模型名")
    p.add_argument("--api-key", default="", help="API Key；建议使用环境变量 ARK_API_KEY")
    p.add_argument("--scene", default="会议室", choices=["会议室", "报告厅"], help="场景")
    p.add_argument("--length", type=float, default=12.0, help="长度（米）")
    p.add_argument("--width", type=float, default=4.0, help="宽度（米）")
    p.add_argument("--height", type=float, default=5.0, help="高度（米）")
    p.add_argument("--selected-systems", default="扩声系统,中控系统,会议系统", help="逗号分隔")
    p.add_argument("--max-iters", type=int, default=3, help="最大迭代次数")
    p.add_argument("--timeout", type=int, default=120, help="API 超时时间（秒）")
    p.add_argument("--dry-run", action="store_true", help="不调 API，走本地占位结果流程")
    return p


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()
    try:
        sys.exit(run(args))
    except Exception as exc:
        print(f"执行失败: {exc}")
        sys.exit(1)
