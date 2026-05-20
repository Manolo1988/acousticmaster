#!/usr/bin/env python3
"""Symmetric loudspeaker layout optimizer for meeting-room screening.

This is a fast engineering pre-screening tool. It chooses loudspeaker models
from product.txt, generates symmetric wall/ceiling layouts, estimates direct
sound coverage over the listener area, and ranks feasible schemes by cost.
Final compliance should be verified with PFFDTD or measurement.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import plotly.graph_objects as go


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PRODUCT_TXT = ROOT / "product.txt"
DEFAULT_CONFIG = Path(__file__).resolve().parent / "config.json"
OUT_DIR = Path(__file__).resolve().parent / "outputs"
EPS = 1.0e-12


@dataclass(frozen=True)
class Product:
    name: str
    model: str
    price: float
    rated_power_w: float | None
    sensitivity_db: float | None
    continuous_spl_db: float
    peak_spl_db: float
    coverage_h_deg: float
    coverage_v_deg: float
    weight_kg: float | None


@dataclass(frozen=True)
class Speaker:
    model: str
    position: tuple[float, float, float]
    aim: tuple[float, float, float]
    layout_role: str
    gain_db: float = 0.0
    source_item_id: str | None = None
    source_row_index: int | None = None
    source_name: str | None = None
    source_type: str | None = None
    source_unit_index: int | None = None
    source_label: str | None = None


@dataclass
class CandidateResult:
    feasible: bool
    total_cost: float
    product_cost: float
    install_cost: float
    dsp_cost: float
    model: str
    layout: str
    speaker_count: int
    min_spl_db: float
    avg_spl_db: float
    max_spl_db: float
    nonuniformity_db: float
    headroom_db: float
    coverage_loss_db_p95: float
    reason: str
    speakers: list[Speaker]


def parse_float(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, flags=re.S)
    if not match:
        return None
    return float(match.group(1))


def parse_coverage(text: str) -> tuple[float, float]:
    match = re.search(r"覆盖角(?:度)?[^\d]*(\d+(?:\.\d+)?)\s*°[^\d]*(\d+(?:\.\d+)?)\s*°", text)
    if match:
        return float(match.group(1)), float(match.group(2))
    return 90.0, 60.0


def parse_spl_values(text: str, sensitivity: float | None) -> tuple[float, float]:
    cont = parse_float(r"连续声压级[:：]\s*(\d+(?:\.\d+)?)\s*dB", text)
    peak = parse_float(r"最大声压级[:：]\s*(\d+(?:\.\d+)?)\s*dB", text)
    if cont is not None and peak is not None:
        return cont, peak

    line_match = re.search(r"最大声压级[:：]([^\n]+)", text)
    if line_match:
        nums = [float(num) for num in re.findall(r"(\d+(?:\.\d+)?)\s*dB", line_match.group(1), flags=re.I)]
        if len(nums) >= 2:
            return nums[0], nums[1]
        if len(nums) == 1:
            peak = nums[0]
            return peak - 6.0, peak

    if peak is not None:
        return peak - 6.0, peak

    rated = parse_float(r"额定功率[:：]\s*(\d+(?:\.\d+)?)\s*W", text)
    if sensitivity is not None and rated is not None and rated > 0:
        estimated = sensitivity + 10.0 * math.log10(rated)
        return estimated, estimated + 6.0
    return 105.0, 111.0


def load_products(path: Path) -> list[Product]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))

    products: list[Product] = []
    for row in rows:
        spec = row["完整参数（网站、宣传资料参数）"]
        sensitivity = parse_float(r"灵敏度[^：:]*[:：]?\s*(\d+(?:\.\d+)?)\s*dB", spec)
        rated_power = parse_float(r"额定功率[:：]\s*(\d+(?:\.\d+)?)\s*W", spec)
        cont_spl, peak_spl = parse_spl_values(spec, sensitivity)
        cov_h, cov_v = parse_coverage(spec)
        weight = parse_float(r"(?:产品重量|净重)[:：]?\s*(\d+(?:\.\d+)?)\s*KG", spec)
        products.append(
            Product(
                name=row["产品名称"].strip(),
                model=row["型号"].strip(),
                price=float(row["市场价"]),
                rated_power_w=rated_power,
                sensitivity_db=sensitivity,
                continuous_spl_db=cont_spl,
                peak_spl_db=peak_spl,
                coverage_h_deg=cov_h,
                coverage_v_deg=cov_v,
                weight_kg=weight,
            )
        )
    return products


def listener_grid(config: dict) -> np.ndarray:
    room = config["room"]
    area = config["listener_area"]
    xs = np.linspace(area["x_min_m"], min(area["x_max_m"], room["length_m"] - 0.5), area["grid_x"])
    ys = np.linspace(area["y_min_m"], min(area["y_max_m"], room["width_m"] - 0.5), area["grid_y"])
    points = [(x, y, area["ear_height_m"]) for x in xs for y in ys]
    return np.asarray(points, dtype=float)


def unit(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm < EPS:
        return vec
    return vec / norm


def make_speaker(model: str, pos: tuple[float, float, float], target: tuple[float, float, float], role: str) -> Speaker:
    return Speaker(model=model, position=pos, aim=target, layout_role=role)


def with_gain(speaker: Speaker, gain_db: float) -> Speaker:
    return Speaker(
        model=speaker.model,
        position=speaker.position,
        aim=speaker.aim,
        layout_role=speaker.layout_role,
        gain_db=gain_db,
        source_item_id=speaker.source_item_id,
        source_row_index=speaker.source_row_index,
        source_name=speaker.source_name,
        source_type=speaker.source_type,
        source_unit_index=speaker.source_unit_index,
        source_label=speaker.source_label,
    )


def generate_symmetric_layouts(model: str, config: dict) -> list[tuple[str, list[Speaker]]]:
    room = config["room"]
    lx, ly, lz = room["length_m"], room["width_m"], room["height_m"]
    area = config["listener_area"]
    z_values = sorted({min(lz - 0.35, 2.1), min(lz - 0.35, 2.35), min(lz - 0.35, 2.6)})
    center_target = ((area["x_min_m"] + area["x_max_m"]) / 2, ly / 2, area["ear_height_m"])
    rear_target = (0.62 * lx, ly / 2, area["ear_height_m"])
    front_target = (0.42 * lx, ly / 2, area["ear_height_m"])

    layouts: list[tuple[str, list[Speaker]]] = []
    front_x = 0.35
    rear_x = lx - 0.35
    side_y0 = 0.25
    side_y1 = ly - 0.25

    for z in z_values:
        for sep_ratio in (0.42, 0.55, 0.68):
            sep = min(ly - 1.0, ly * sep_ratio)
            y0, y1 = ly / 2 - sep / 2, ly / 2 + sep / 2
            layouts.append(
                (
                    f"front_wall_pair_sep_{sep_ratio:.2f}_z_{z:.2f}",
                    [
                        make_speaker(model, (front_x, y0, z), rear_target, "front_left"),
                        make_speaker(model, (front_x, y1, z), rear_target, "front_right"),
                    ],
                )
            )

        layouts.append(
            (
                f"diagonal_pair_z_{z:.2f}",
                [
                    make_speaker(model, (0.55, 0.55, z), center_target, "front_left_corner"),
                    make_speaker(model, (lx - 0.55, ly - 0.55, z), center_target, "rear_right_corner"),
                ],
            )
        )

        for x_ratio in (0.32, 0.50, 0.68):
            x = lx * x_ratio
            local_target = (x, ly / 2, area["ear_height_m"])
            layouts.append(
                (
                    f"side_wall_pair_x_{x_ratio:.2f}_z_{z:.2f}",
                    [
                        make_speaker(model, (x, side_y0, z), local_target, "side_left"),
                        make_speaker(model, (x, side_y1, z), local_target, "side_right"),
                    ],
                )
            )

        for x0_ratio, x1_ratio in ((0.28, 0.66), (0.22, 0.74)):
            x0, x1 = lx * x0_ratio, lx * x1_ratio
            target0 = (x0, ly / 2, area["ear_height_m"])
            target1 = (x1, ly / 2, area["ear_height_m"])
            layouts.append(
                (
                    f"four_side_pairs_x_{x0_ratio:.2f}_{x1_ratio:.2f}_z_{z:.2f}",
                    [
                        make_speaker(model, (x0, side_y0, z), target0, "side_left_front"),
                        make_speaker(model, (x0, side_y1, z), target0, "side_right_front"),
                        make_speaker(model, (x1, side_y0, z), target1, "side_left_rear"),
                        make_speaker(model, (x1, side_y1, z), target1, "side_right_rear"),
                    ],
                )
            )

        max_speakers = int(config.get("optimization", {}).get("max_speakers", 8))
        max_pairs = max(2, max_speakers // 2)
        for pair_count in range(3, max_pairs + 1):
            ratios = np.linspace(0.14, 0.86, pair_count)
            speakers = []
            for pair_idx, ratio in enumerate(ratios, 1):
                x = lx * float(ratio)
                target = (x, ly / 2, area["ear_height_m"])
                speakers.append(make_speaker(model, (x, side_y0, z), target, f"side_left_zone_{pair_idx}"))
                speakers.append(make_speaker(model, (x, side_y1, z), target, f"side_right_zone_{pair_idx}"))
            layouts.append(
                (
                    f"{pair_count * 2}_side_distributed_x_{'_'.join(f'{r:.2f}' for r in ratios)}_z_{z:.2f}",
                    speakers,
                )
            )

        ceiling_z = max(area["ear_height_m"] + 0.8, lz - 0.35)
        for row_count in range(2, min(4, max_pairs) + 1):
            max_cols = max_speakers // row_count
            for col_count in range(2, max_cols + 1):
                x_positions = np.linspace(area["x_min_m"], area["x_max_m"], col_count)
                y_positions = np.linspace(area["y_min_m"], area["y_max_m"], row_count)
                speakers = []
                for col_idx, x in enumerate(x_positions, 1):
                    for row_idx, y in enumerate(y_positions, 1):
                        target = (float(x), float(y), area["ear_height_m"])
                        speakers.append(
                            make_speaker(
                                model,
                                (float(x), float(y), ceiling_z),
                                target,
                                f"ceiling_col_{col_idx}_row_{row_idx}",
                            )
                        )
                layouts.append(
                    (
                        f"{len(speakers)}_ceiling_grid_{col_count}x{row_count}_z_{ceiling_z:.2f}",
                        speakers,
                    )
                )

        layouts.append(
            (
                f"front_rear_center_pair_z_{z:.2f}",
                [
                    make_speaker(model, (front_x, ly / 2, z), rear_target, "front_center"),
                    make_speaker(model, (rear_x, ly / 2, z), front_target, "rear_center"),
                ],
            )
        )

    unique_layouts: dict[str, tuple[str, list[Speaker]]] = {}
    for layout_name, speakers in layouts:
        unique_layouts.setdefault(layout_name, (layout_name, speakers))
    return list(unique_layouts.values())


def angular_loss_db(speaker: Speaker, receiver: np.ndarray, product: Product) -> float:
    pos = np.asarray(speaker.position)
    aim = np.asarray(speaker.aim)
    forward = unit(aim - pos)
    to_receiver = unit(receiver - pos)

    horizontal_forward_raw = np.array([forward[0], forward[1], 0.0])
    horizontal_receiver_raw = np.array([to_receiver[0], to_receiver[1], 0.0])
    if np.linalg.norm(horizontal_forward_raw) < EPS or np.linalg.norm(horizontal_receiver_raw) < EPS:
        h_angle = 0.0
    else:
        horizontal_forward = unit(horizontal_forward_raw)
        horizontal_receiver = unit(horizontal_receiver_raw)
        dot_h = float(np.clip(np.dot(horizontal_forward, horizontal_receiver), -1.0, 1.0))
        h_angle = math.degrees(math.acos(dot_h))

    elev_forward = math.degrees(math.asin(float(np.clip(forward[2], -1.0, 1.0))))
    elev_receiver = math.degrees(math.asin(float(np.clip(to_receiver[2], -1.0, 1.0))))
    v_angle = abs(elev_receiver - elev_forward)

    h_half = max(product.coverage_h_deg / 2, 1.0)
    v_half = max(product.coverage_v_deg / 2, 1.0)
    h_ratio = h_angle / h_half
    v_ratio = v_angle / v_half

    loss = 3.0 * h_ratio**2 + 3.0 * v_ratio**2
    if h_ratio > 1.0:
        loss += 12.0 * (h_ratio - 1.0)
    if v_ratio > 1.0:
        loss += 12.0 * (v_ratio - 1.0)
    return min(loss, 36.0)


def evaluate_layout(product: Product, layout_name: str, speakers: list[Speaker], config: dict, receivers: np.ndarray) -> tuple[CandidateResult, np.ndarray]:
    targets = config["targets"]
    opt = config["optimization"]

    base_spl = np.zeros((len(speakers), len(receivers)), dtype=float)
    worst_angular_losses: list[float] = []
    for speaker_idx, speaker in enumerate(speakers):
        pos = np.asarray(speaker.position)
        for idx, receiver in enumerate(receivers):
            dist = max(float(np.linalg.norm(receiver - pos)), 1.0)
            angle_loss = angular_loss_db(speaker, receiver, product)
            base_spl[speaker_idx, idx] = product.continuous_spl_db - 20.0 * math.log10(dist) - angle_loss
            worst_angular_losses.append(angle_loss)

    gain_grid = np.arange(-18.0, 0.1, 3.0)
    best_combined_spl = None
    best_gains = None
    best_score = None
    if len(speakers) > 8:
        gain_vectors = optimize_pair_gains(base_spl, targets)
    else:
        gain_vectors = generate_gain_vectors(len(speakers), gain_grid)
    for gains in gain_vectors:
        shifted = base_spl + np.asarray(gains)[:, None]
        combined_spl_trial = 10.0 * np.log10(np.sum(10.0 ** (shifted / 10.0), axis=0) + EPS)
        min_trial = float(np.min(combined_spl_trial))
        max_trial = float(np.max(combined_spl_trial))
        nonuniformity_trial = max_trial - min_trial
        headroom_trial = min_trial - targets["min_spl_db"]
        violation = (
            max(0.0, targets["min_spl_db"] - min_trial) * 4.0
            + max(0.0, nonuniformity_trial - targets["max_nonuniformity_db"]) * 3.0
            + max(0.0, targets["min_headroom_db"] - headroom_trial) * 2.0
        )
        excess = max(0.0, max_trial - targets["min_spl_db"])
        score = (violation, nonuniformity_trial, excess, -headroom_trial)
        if best_score is None or score < best_score:
            best_score = score
            best_combined_spl = combined_spl_trial
            best_gains = gains

    assert best_combined_spl is not None
    assert best_gains is not None
    combined_spl = best_combined_spl
    speakers = [with_gain(speaker, gain) for speaker, gain in zip(speakers, best_gains)]
    min_spl = float(np.min(combined_spl))
    max_spl = float(np.max(combined_spl))
    avg_spl = float(10.0 * np.log10(np.mean(10.0 ** (combined_spl / 10.0)) + EPS))
    nonuniformity = max_spl - min_spl
    required_at_loudest_receiver = targets["min_spl_db"] + nonuniformity
    max_system_spl = float(np.max(combined_spl))
    headroom = min_spl - targets["min_spl_db"]
    coverage_loss_p95 = float(np.percentile(worst_angular_losses, 95))

    product_cost = product.price * len(speakers)
    install_cost = opt["installation_cost_per_speaker"] * len(speakers)
    dsp_cost = opt["dsp_cost_if_more_than_two_speakers"] if len(speakers) > 2 else 0.0
    total_cost = product_cost + install_cost + dsp_cost

    failures = []
    if min_spl < targets["min_spl_db"]:
        failures.append(f"最低声压级不足 {targets['min_spl_db']:.1f} dB")
    if nonuniformity > targets["max_nonuniformity_db"]:
        failures.append(f"声场不均匀度超过 {targets['max_nonuniformity_db']:.1f} dB")
    if headroom < targets["min_headroom_db"]:
        failures.append(f"最低点余量低于 {targets['min_headroom_db']:.1f} dB")

    result = CandidateResult(
        feasible=not failures,
        total_cost=total_cost,
        product_cost=product_cost,
        install_cost=install_cost,
        dsp_cost=dsp_cost,
        model=product.model,
        layout=layout_name,
        speaker_count=len(speakers),
        min_spl_db=min_spl,
        avg_spl_db=avg_spl,
        max_spl_db=max_spl,
        nonuniformity_db=nonuniformity,
        headroom_db=headroom,
        coverage_loss_db_p95=coverage_loss_p95,
        reason="达标" if not failures else "；".join(failures),
        speakers=speakers,
    )
    _ = required_at_loudest_receiver, max_system_spl
    return result, combined_spl


def generate_gain_vectors(count: int, gain_grid: np.ndarray):
    if count > 8:
        pair_count = count // 2
        pair_positions = np.linspace(-1.0, 1.0, pair_count)
        profiles = []
        for base in (-12.0, -9.0, -6.0, -3.0, 0.0):
            profiles.append(np.full(pair_count, base))
            for slope in (-6.0, 6.0):
                profiles.append(np.clip(base + slope * pair_positions, -18.0, 0.0))
            profiles.append(np.clip(base - 6.0 * (1.0 - np.abs(pair_positions)), -18.0, 0.0))
            profiles.append(np.clip(base - 6.0 * np.abs(pair_positions), -18.0, 0.0))
        seen = set()
        for profile in profiles:
            rounded = tuple(float(round(value / 3.0) * 3.0) for value in profile)
            if rounded in seen:
                continue
            seen.add(rounded)
            gains = []
            for gain in rounded:
                gains.extend([gain, gain])
            yield tuple(gains)
        return
    if count == 2:
        for gain in gain_grid:
            yield (float(gain), float(gain))
        return
    if count % 2 == 0:
        pair_count = count // 2
        current = [0.0] * count

        def walk(pair_idx: int):
            if pair_idx == pair_count:
                yield tuple(current)
                return
            for gain in gain_grid:
                current[2 * pair_idx] = float(gain)
                current[2 * pair_idx + 1] = float(gain)
                yield from walk(pair_idx + 1)

        yield from walk(0)
        return
    for gain in gain_grid:
        yield tuple(float(gain) for _ in range(count))


def optimize_pair_gains(base_spl: np.ndarray, targets: dict) -> list[tuple[float, ...]]:
    count = base_spl.shape[0]
    pair_count = count // 2
    gain_grid = np.arange(-24.0, 0.1, 1.0)
    gains = np.zeros(count, dtype=float)

    def score_for(candidate_gains: np.ndarray) -> tuple[float, float, float, float]:
        shifted = base_spl + candidate_gains[:, None]
        combined = 10.0 * np.log10(np.sum(10.0 ** (shifted / 10.0), axis=0) + EPS)
        min_spl = float(np.min(combined))
        max_spl = float(np.max(combined))
        nonuniformity = max_spl - min_spl
        headroom = min_spl - targets["min_spl_db"]
        violation = (
            max(0.0, targets["min_spl_db"] - min_spl) * 4.0
            + max(0.0, nonuniformity - targets["max_nonuniformity_db"]) * 3.0
            + max(0.0, targets["min_headroom_db"] - headroom) * 2.0
        )
        return violation, nonuniformity, max(0.0, max_spl - targets["min_spl_db"]), -headroom

    for _ in range(4):
        improved = False
        for pair_idx in range(pair_count):
            best_pair_gain = gains[2 * pair_idx]
            best_pair_score = score_for(gains)
            for gain in gain_grid:
                trial = gains.copy()
                trial[2 * pair_idx] = gain
                trial[2 * pair_idx + 1] = gain
                trial_score = score_for(trial)
                if trial_score < best_pair_score:
                    best_pair_score = trial_score
                    best_pair_gain = gain
            if best_pair_gain != gains[2 * pair_idx]:
                gains[2 * pair_idx] = best_pair_gain
                gains[2 * pair_idx + 1] = best_pair_gain
                improved = True
        if not improved:
            break

    equal_gains = [tuple(float(gain) for _ in range(count)) for gain in (-18.0, -12.0, -6.0, -3.0, 0.0)]
    return [tuple(float(value) for value in gains), *equal_gains]


def select_products(products: list[Product], config: dict) -> list[Product]:
    opt = config["optimization"]
    if opt.get("include_large_models", False):
        return products
    shortlist = set(opt.get("shortlist_models", []))
    return [product for product in products if product.model in shortlist]


def result_sort_key(result: CandidateResult) -> tuple[int, float, float, float]:
    return (0 if result.feasible else 1, result.total_cost, result.nonuniformity_db, -result.min_spl_db)


def write_outputs(results: list[CandidateResult], best_field: np.ndarray, receivers: np.ndarray, config: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = OUT_DIR / "ranked_solutions.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "rank",
                "feasible",
                "total_cost",
                "model",
                "layout",
                "speaker_count",
                "min_spl_db",
                "avg_spl_db",
                "max_spl_db",
                "nonuniformity_db",
                "headroom_db",
                "coverage_loss_db_p95",
                "reason",
            ]
        )
        for rank, item in enumerate(results, 1):
            writer.writerow(
                [
                    rank,
                    item.feasible,
                    f"{item.total_cost:.0f}",
                    item.model,
                    item.layout,
                    item.speaker_count,
                    f"{item.min_spl_db:.2f}",
                    f"{item.avg_spl_db:.2f}",
                    f"{item.max_spl_db:.2f}",
                    f"{item.nonuniformity_db:.2f}",
                    f"{item.headroom_db:.2f}",
                    f"{item.coverage_loss_db_p95:.2f}",
                    item.reason,
                ]
            )

    json_path = OUT_DIR / "best_solution.json"
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(asdict(results[0]), handle, ensure_ascii=False, indent=2)

    md_path = OUT_DIR / "best_solution.md"
    with md_path.open("w", encoding="utf-8") as handle:
        best = results[0]
        handle.write("# 最低成本对称扩声方案\n\n")
        handle.write(f"- 是否满足当前筛选指标：{'是' if best.feasible else '否'}\n")
        handle.write(f"- 推荐型号：{best.model}\n")
        handle.write(f"- 布置方式：{best.layout}\n")
        handle.write(f"- 音箱数量：{best.speaker_count}\n")
        handle.write(f"- 估算总成本：{best.total_cost:.0f} 元\n")
        handle.write(f"- 最低/平均/最高 SPL：{best.min_spl_db:.1f} / {best.avg_spl_db:.1f} / {best.max_spl_db:.1f} dB\n")
        handle.write(f"- 声场不均匀度：{best.nonuniformity_db:.1f} dB\n")
        handle.write(f"- 最低点余量：{best.headroom_db:.1f} dB\n")
        handle.write(f"- 判定说明：{best.reason}\n\n")
        handle.write("## 音箱位置与朝向\n\n")
        for speaker in best.speakers:
            handle.write(
                f"- {speaker.layout_role}: pos={tuple(round(v, 3) for v in speaker.position)}, "
                f"aim={tuple(round(v, 3) for v in speaker.aim)}, gain={speaker.gain_db:.1f} dB\n"
            )
        handle.write("\n## 注意\n\n")
        handle.write("这是快速筛选结果，使用直达声和标称覆盖角估算。正式国标验收前，应使用 PFFDTD 对该方案进行精算，并结合实测材料、背景噪声、功放限幅、DSP 和音箱指向性数据校准。\n")

    draw_best_solution(results[0], best_field, receivers, config)
    write_html_report(results[0], best_field, receivers, config)


def draw_best_solution(best: CandidateResult, field: np.ndarray, receivers: np.ndarray, config: dict) -> None:
    room = config["room"]
    plt.figure(figsize=(10, 6))
    scatter = plt.scatter(receivers[:, 0], receivers[:, 1], c=field, s=160, cmap="turbo", edgecolor="black")
    plt.colorbar(scatter, label="Estimated SPL (dB)")
    for speaker in best.speakers:
        x, y, _ = speaker.position
        ax, ay, _ = speaker.aim
        plt.scatter([x], [y], marker="^", s=220, c="white", edgecolor="black", linewidth=1.6)
        plt.arrow(x, y, (ax - x) * 0.16, (ay - y) * 0.16, head_width=0.12, color="black", length_includes_head=True)
        plt.text(x, y + 0.12, speaker.layout_role, fontsize=8, ha="center")
    plt.xlim(0, room["length_m"])
    plt.ylim(0, room["width_m"])
    plt.gca().set_aspect("equal", adjustable="box")
    plt.grid(alpha=0.25)
    plt.title(f"Best symmetric layout: {best.model}, cost={best.total_cost:.0f} yuan")
    plt.xlabel("Room length X (m)")
    plt.ylabel("Room width Y (m)")
    plt.tight_layout()
    plt.savefig(OUT_DIR / "best_solution_top_view.png", dpi=180)
    plt.close()


def heatmap_grid(receivers: np.ndarray, field: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xs = np.unique(np.round(receivers[:, 0], 9))
    ys = np.unique(np.round(receivers[:, 1], 9))
    z = np.full((len(ys), len(xs)), np.nan)
    for point, value in zip(receivers, field):
        xi = int(np.where(xs == round(point[0], 9))[0][0])
        yi = int(np.where(ys == round(point[1], 9))[0][0])
        z[yi, xi] = value
    return np.meshgrid(xs, ys), z


def add_room_box(fig: go.Figure, config: dict) -> None:
    lx = config["room"]["length_m"]
    ly = config["room"]["width_m"]
    lz = config["room"]["height_m"]
    vertices = np.array(
        [
            [0, 0, 0],
            [lx, 0, 0],
            [lx, ly, 0],
            [0, ly, 0],
            [0, 0, lz],
            [lx, 0, lz],
            [lx, ly, lz],
            [0, ly, lz],
        ],
        dtype=float,
    )
    faces = np.array(
        [
            [0, 1, 2],
            [0, 2, 3],
            [4, 6, 5],
            [4, 7, 6],
            [0, 4, 5],
            [0, 5, 1],
            [1, 5, 6],
            [1, 6, 2],
            [2, 6, 7],
            [2, 7, 3],
            [3, 7, 4],
            [3, 4, 0],
        ]
    )
    fig.add_trace(
        go.Mesh3d(
            name="Room shell",
            x=vertices[:, 0],
            y=vertices[:, 1],
            z=vertices[:, 2],
            i=faces[:, 0],
            j=faces[:, 1],
            k=faces[:, 2],
            color="#64748b",
            opacity=0.18,
            flatshading=True,
            lighting=dict(ambient=0.48, diffuse=0.72, specular=0.22),
            hovertemplate="Room shell<extra></extra>",
        )
    )


def add_speaker_trace(fig: go.Figure, speaker: Speaker, color: str) -> None:
    pos = np.asarray(speaker.position, dtype=float)
    aim = np.asarray(speaker.aim, dtype=float)
    direction = unit(aim - pos)
    fig.add_trace(
        go.Scatter3d(
            name=speaker.layout_role,
            x=[pos[0]],
            y=[pos[1]],
            z=[pos[2]],
            mode="markers+text",
            marker=dict(size=9, color=color, symbol="diamond", line=dict(color="white", width=1.2)),
            text=[speaker.model],
            textposition="top center",
            hovertemplate=(
                f"{speaker.layout_role}<br>"
                f"pos=({pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f}) m<br>"
                f"aim=({aim[0]:.2f}, {aim[1]:.2f}, {aim[2]:.2f}) m<br>"
                f"gain={speaker.gain_db:.1f} dB<extra></extra>"
            ),
        )
    )
    fig.add_trace(
        go.Cone(
            name=f"{speaker.layout_role} aim",
            x=[pos[0]],
            y=[pos[1]],
            z=[pos[2]],
            u=[direction[0]],
            v=[direction[1]],
            w=[direction[2]],
            sizemode="absolute",
            sizeref=0.55,
            anchor="tail",
            colorscale=[[0, color], [1, color]],
            showscale=False,
            opacity=0.85,
            hoverinfo="skip",
        )
    )


def add_coverage_trace(fig: go.Figure, speaker: Speaker, product_label: str, color: str) -> None:
    pos = np.asarray(speaker.position, dtype=float)
    aim = np.asarray(speaker.aim, dtype=float)
    forward = unit(aim - pos)
    up = np.array([0.0, 0.0, 1.0])
    right = np.cross(forward, up)
    if np.linalg.norm(right) < EPS:
        right = np.array([1.0, 0.0, 0.0])
    right = unit(right)
    vertical = unit(np.cross(right, forward))
    length = 3.0
    base = pos + forward * length
    radius_h = length * math.tan(math.radians(45.0))
    radius_v = length * math.tan(math.radians(30.0))
    ring = []
    for theta in np.linspace(0, 2 * np.pi, 36, endpoint=False):
        ring.append(base + right * math.cos(theta) * radius_h + vertical * math.sin(theta) * radius_v)
    pts = np.vstack([pos, np.asarray(ring)])
    i, j, k = [], [], []
    for idx in range(1, len(pts)):
        i.append(0)
        j.append(idx)
        k.append(1 if idx == len(pts) - 1 else idx + 1)
    fig.add_trace(
        go.Mesh3d(
            name=f"{speaker.layout_role} coverage",
            x=pts[:, 0],
            y=pts[:, 1],
            z=pts[:, 2],
            i=i,
            j=j,
            k=k,
            color=color,
            opacity=0.12,
            hovertemplate=f"{product_label} nominal coverage envelope<extra></extra>",
        )
    )


def write_html_report(best: CandidateResult, field: np.ndarray, receivers: np.ndarray, config: dict) -> None:
    (gx, gy), gz_field = heatmap_grid(receivers, field)
    ear_z = config["listener_area"]["ear_height_m"]
    fig = go.Figure()
    add_room_box(fig, config)

    fig.add_trace(
        go.Surface(
            name="Estimated SPL listening plane",
            x=gx,
            y=gy,
            z=np.full_like(gx, ear_z),
            surfacecolor=gz_field,
            colorscale="Turbo",
            cmin=max(best.min_spl_db - 1.0, 80.0),
            cmax=best.max_spl_db + 1.0,
            opacity=0.9,
            colorbar=dict(title=dict(text="SPL dB", font=dict(color="#d8dee9")), tickfont=dict(color="#d8dee9")),
            hovertemplate="x=%{x:.2f} m<br>y=%{y:.2f} m<br>SPL=%{surfacecolor:.1f} dB<extra></extra>",
        )
    )
    fig.add_trace(
        go.Scatter3d(
            name="Listener grid",
            x=receivers[:, 0],
            y=receivers[:, 1],
            z=receivers[:, 2],
            mode="markers",
            marker=dict(
                size=5,
                color=field,
                colorscale="Turbo",
                cmin=max(best.min_spl_db - 1.0, 80.0),
                cmax=best.max_spl_db + 1.0,
                line=dict(color="white", width=0.8),
            ),
            hovertemplate="x=%{x:.2f} m<br>y=%{y:.2f} m<br>SPL=%{marker.color:.1f} dB<extra></extra>",
        )
    )

    colors = ["#00d5ff", "#ffb000", "#22c55e", "#f472b6"]
    for idx, speaker in enumerate(best.speakers):
        color = colors[idx % len(colors)]
        add_speaker_trace(fig, speaker, color)
        add_coverage_trace(fig, speaker, best.model, color)

    summary = (
        f"model={best.model}<br>"
        f"layout={best.layout}<br>"
        f"cost={best.total_cost:.0f} yuan<br>"
        f"SPL min/avg/max={best.min_spl_db:.1f}/{best.avg_spl_db:.1f}/{best.max_spl_db:.1f} dB<br>"
        f"nonuniformity={best.nonuniformity_db:.1f} dB<br>"
        f"headroom={best.headroom_db:.1f} dB"
    )

    fig.update_layout(
        title=dict(text="Symmetric Loudspeaker Optimization Result", x=0.5, font=dict(size=23, color="#f8fafc")),
        paper_bgcolor="#05070d",
        plot_bgcolor="#05070d",
        font=dict(color="#d8dee9", family="Arial, sans-serif"),
        margin=dict(l=0, r=0, t=54, b=0),
        legend=dict(
            x=0.02,
            y=0.98,
            bgcolor="rgba(5,7,13,0.66)",
            bordercolor="rgba(255,255,255,0.16)",
            borderwidth=1,
        ),
        scene=dict(
            bgcolor="#05070d",
            aspectmode="data",
            xaxis=dict(title="Length X (m)", showbackground=True, backgroundcolor="rgba(15,23,42,0.70)", gridcolor="rgba(148,163,184,0.18)"),
            yaxis=dict(title="Width Y (m)", showbackground=True, backgroundcolor="rgba(15,23,42,0.70)", gridcolor="rgba(148,163,184,0.18)"),
            zaxis=dict(title="Height Z (m)", showbackground=True, backgroundcolor="rgba(15,23,42,0.70)", gridcolor="rgba(148,163,184,0.18)"),
            camera=dict(eye=dict(x=1.45, y=-1.7, z=1.2), center=dict(x=0.0, y=0.0, z=-0.08)),
        ),
        annotations=[
            dict(
                text=summary,
                x=0.01,
                y=0.02,
                xref="paper",
                yref="paper",
                showarrow=False,
                align="left",
                font=dict(size=12, color="#e5edf8"),
                bgcolor="rgba(5,7,13,0.72)",
                bordercolor="rgba(255,255,255,0.18)",
                borderwidth=1,
                borderpad=8,
            )
        ],
    )

    fig.write_html(
        OUT_DIR / "best_solution.html",
        include_plotlyjs=True,
        full_html=True,
        config={
            "displaylogo": False,
            "toImageButtonOptions": {
                "format": "png",
                "filename": "best_symmetric_loudspeaker_solution",
                "height": 1400,
                "width": 2200,
                "scale": 2,
            },
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--products", type=Path, default=DEFAULT_PRODUCT_TXT)
    parser.add_argument("--top", type=int, default=12)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    products = select_products(load_products(args.products), config)
    receivers = listener_grid(config)

    all_results: list[CandidateResult] = []
    fields_by_key: dict[tuple[str, str], np.ndarray] = {}
    for product in products:
        for layout_name, speakers in generate_symmetric_layouts(product.model, config):
            result, field = evaluate_layout(product, layout_name, speakers, config, receivers)
            all_results.append(result)
            fields_by_key[(result.model, result.layout)] = field

    all_results.sort(key=result_sort_key)
    best = all_results[0]
    write_outputs(all_results, fields_by_key[(best.model, best.layout)], receivers, config)

    print(f"Evaluated {len(all_results)} symmetric candidates from {len(products)} products.")
    print(f"Best: {best.model} / {best.layout} / cost={best.total_cost:.0f} / feasible={best.feasible}")
    print(f"SPL min/avg/max: {best.min_spl_db:.1f}/{best.avg_spl_db:.1f}/{best.max_spl_db:.1f} dB")
    print(f"Nonuniformity: {best.nonuniformity_db:.1f} dB, headroom: {best.headroom_db:.1f} dB")
    print(f"Wrote outputs to {OUT_DIR}")


if __name__ == "__main__":
    main()
