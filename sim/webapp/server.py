#!/usr/bin/env python3
"""Local web server for the loudspeaker optimizer UI."""

from __future__ import annotations

import json
import math
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from scipy.optimize import differential_evolution, minimize

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from opt.optimizer import (  # noqa: E402
    EPS,
    CandidateResult,
    Product,
    Speaker,
    angular_loss_db,
    generate_gain_vectors,
)

CATALOG_PATH = ROOT / "opt" / "product_catalog.json"


class OptimizationTimeBudgetExceeded(Exception):
    pass


class FeasibleSolutionFound(Exception):
    def __init__(self, vector: np.ndarray):
        super().__init__("feasible solution found")
        self.vector = np.asarray(vector, dtype=float).copy()


def build_config(payload: dict) -> dict:
    room = payload["room"]
    listener = payload["listener"]
    targets = payload["targets"]
    optimizer = payload.get("optimizer") or {}
    geometry = build_geometry(payload.get("geometry"))
    if geometry:
        length = geometry["length_m"]
        width = geometry["width_m"]
    else:
        length = float(room["length"])
        width = float(room["width"])
    plane_length = length * 0.8
    plane_width = width * 0.8
    plane_x_min = (length - plane_length) / 2.0
    plane_y_min = (width - plane_width) / 2.0
    bbox_area = length * width
    room_area = polygon_area(geometry["polygon"]) if geometry else bbox_area
    if geometry and bbox_area > 250:
        max_speakers = 100
    elif geometry and bbox_area > 180:
        max_speakers = 60
    elif bbox_area <= 70:
        max_speakers = 4
    elif bbox_area <= 130:
        max_speakers = 8
    elif bbox_area <= 260:
        max_speakers = 24
    else:
        max_speakers = 30

    config = {
        "room": {
            "length_m": length,
            "width_m": width,
            "height_m": float(room["height"]),
            "area_m2": round(float(room_area), 3),
        },
        "listener_area": {
            "x_min_m": plane_x_min,
            "x_max_m": plane_x_min + plane_length,
            "y_min_m": plane_y_min,
            "y_max_m": plane_y_min + plane_width,
            "ear_height_m": 1.0,
            "length_m": plane_length,
            "width_m": plane_width,
            "center_x_m": length / 2.0,
            "center_y_m": width / 2.0,
            "grid_x": max(9, round(plane_length / 0.8) + 1),
            "grid_y": max(7, round(plane_width / 0.8) + 1),
        },
        "targets": {
            "min_spl_db": float(targets["minSpl"]),
            "max_nonuniformity_db": float(targets["maxUniformity"]),
            "min_headroom_db": float(targets["minHeadroom"]),
        },
        "optimization": {
            "installation_cost_per_speaker": 500.0,
            "dsp_cost_if_more_than_two_speakers": 3000.0,
            "max_speakers": max_speakers,
        },
        "optimizer_max_steps": max(1, min(20, int(optimizer.get("maxSteps", 20)))),
        "optimizer_time_budget_s": max(5.0, min(45.0, float(optimizer.get("timeBudgetSeconds", 32.0)))),
    }
    if geometry:
        config["geometry"] = geometry
    return config


def build_receiver_grid(config: dict) -> tuple[list[float], list[float], np.ndarray, list[tuple[int, int]]]:
    room = config["room"]
    area = config["listener_area"]
    xs = np.linspace(area["x_min_m"], min(area["x_max_m"], room["length_m"] - 0.5), area["grid_x"])
    ys = np.linspace(area["y_min_m"], min(area["y_max_m"], room["width_m"] - 0.5), area["grid_y"])
    receivers = []
    indices = []
    for x_idx, x in enumerate(xs):
        for y_idx, y in enumerate(ys):
            receivers.append((float(x), float(y), area["ear_height_m"]))
            indices.append((x_idx, y_idx))
    if not receivers:
        raise ValueError("听音区内没有生成有效测点，请检查几何边界或边距设置")
    return xs.round(6).tolist(), ys.round(6).tolist(), np.asarray(receivers, dtype=float), indices


def field_to_grid(field: np.ndarray, xs: list[float], ys: list[float], indices: list[tuple[int, int]]) -> list[list[float | None]]:
    matrix = [[None for _ in xs] for _ in ys]
    for value, (x_idx, y_idx) in zip(field, indices):
        matrix[y_idx][x_idx] = round(float(value), 4)
    return matrix


def build_geometry(raw: dict | None) -> dict | None:
    if not raw:
        return None
    points = raw.get("points", {})
    elements = raw.get("elements", [])
    screen = raw.get("screen")
    if not points or not elements or not screen:
        raise ValueError("几何文件必须包含 points、elements 和 screen")
    polygon_world = approximate_boundary(points, elements)
    if len(polygon_world) < 3:
        raise ValueError("几何边界必须形成至少 3 个点的封闭区域")
    screen_start = resolve_point(screen["start"], points)
    screen_end = resolve_point(screen["end"], points)
    polygon_local = transform_to_screen_local(polygon_world, screen_start, screen_end)
    min_x = min(point[0] for point in polygon_local)
    min_y = min(point[1] for point in polygon_local)
    max_x = max(point[0] for point in polygon_local)
    max_y = max(point[1] for point in polygon_local)
    if min_x < -1.0e-5:
        polygon_local = [(x - min_x, y) for x, y in polygon_local]
        max_x -= min_x
    polygon_local = [(max(0.0, x), y - min_y) for x, y in polygon_local]
    return {
        "name": raw.get("name", "imported_geometry"),
        "units": raw.get("units", "m"),
        "polygon": [[round(x, 6), round(y, 6)] for x, y in polygon_local],
        "length_m": round(float(max_x), 6),
        "width_m": round(float(max_y - min_y), 6),
        "screen": raw.get("screen", {}),
    }


def approximate_boundary(points: dict, elements: list[dict]) -> list[tuple[float, float]]:
    boundary: list[tuple[float, float]] = []
    for element in elements:
        kind = element.get("type")
        start = resolve_point(element["start"], points)
        end = resolve_point(element["end"], points)
        if not boundary:
            boundary.append(start)
        if kind == "line":
            segment = [end]
        elif kind == "arc":
            center = resolve_point(element["center"], points)
            segment = arc_points(start, end, center, element.get("direction", "ccw"), int(element.get("segments", 24)))
        else:
            raise ValueError(f"不支持的几何元素类型: {kind}")
        boundary.extend(segment)
    if distance(boundary[0], boundary[-1]) < 1.0e-6:
        boundary.pop()
    return boundary


def resolve_point(value, points: dict) -> tuple[float, float]:
    if isinstance(value, str):
        value = points[value]
    return float(value[0]), float(value[1])


def arc_points(start: tuple[float, float], end: tuple[float, float], center: tuple[float, float], direction: str, segments: int) -> list[tuple[float, float]]:
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
    if direction == "cw":
        while end_angle >= start_angle:
            end_angle -= 2 * math.pi
    else:
        while end_angle <= start_angle:
            end_angle += 2 * math.pi
    radius = distance(start, center)
    count = max(4, segments)
    return [
        (
            center[0] + radius * math.cos(start_angle + (end_angle - start_angle) * idx / count),
            center[1] + radius * math.sin(start_angle + (end_angle - start_angle) * idx / count),
        )
        for idx in range(1, count + 1)
    ]


def transform_to_screen_local(polygon: list[tuple[float, float]], screen_start: tuple[float, float], screen_end: tuple[float, float]) -> list[tuple[float, float]]:
    screen_vec = np.asarray(screen_end, dtype=float) - np.asarray(screen_start, dtype=float)
    screen_len = float(np.linalg.norm(screen_vec))
    if screen_len < 1.0e-6:
        raise ValueError("screen 起点和终点不能重合")
    y_axis = screen_vec / screen_len
    x_axis = np.asarray([y_axis[1], -y_axis[0]])
    midpoint = (np.asarray(screen_start, dtype=float) + np.asarray(screen_end, dtype=float)) / 2.0
    centroid = np.mean(np.asarray(polygon, dtype=float), axis=0)
    if float(np.dot(x_axis, centroid - midpoint)) < 0:
        x_axis = -x_axis
    return [
        (
            float(np.dot(np.asarray(point) - midpoint, x_axis)),
            float(np.dot(np.asarray(point) - midpoint, y_axis) + screen_len / 2.0),
        )
        for point in polygon
    ]


def point_in_polygon(x: float, y: float, polygon: list[list[float]] | list[tuple[float, float]]) -> bool:
    inside = False
    count = len(polygon)
    j = count - 1
    for i in range(count):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersects = (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1.0e-12) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return float(math.hypot(a[0] - b[0], a[1] - b[1]))


def polygon_area(polygon: list[list[float]] | list[tuple[float, float]]) -> float:
    area = 0.0
    count = len(polygon)
    for idx in range(count):
        x0, y0 = polygon[idx]
        x1, y1 = polygon[(idx + 1) % count]
        area += x0 * y1 - x1 * y0
    return abs(area) * 0.5


def product_payload() -> list[dict]:
    return [
        {
            "name": item["name"],
            "model": item["model"],
            "category": item["category"],
            "role": item["role"],
            "price": item["price"],
            "continuousSpl": item["continuous_spl_db"],
            "peakSpl": item["peak_spl_db"],
            "coverageH": item["coverage_h_deg"],
            "coverageV": item["coverage_v_deg"],
            "weightKg": item["weight_kg"],
        }
        for item in load_catalog()
    ]


def load_catalog(payload: dict | None = None) -> list[dict]:
    if payload:
        dynamic_catalog = payload.get("catalog")
        if isinstance(dynamic_catalog, list) and dynamic_catalog:
            return dynamic_catalog
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def to_product(item: dict) -> Product:
    return Product(
        name=item["name"],
        model=item["model"],
        price=float(item["price"]),
        rated_power_w=item.get("rated_power_w"),
        sensitivity_db=item.get("sensitivity_db"),
        continuous_spl_db=float(item["continuous_spl_db"]),
        peak_spl_db=float(item["peak_spl_db"]),
        coverage_h_deg=float(item["coverage_h_deg"]),
        coverage_v_deg=float(item["coverage_v_deg"]),
        weight_kg=item.get("weight_kg"),
    )


def optimize(payload: dict, progress_callback=None) -> dict:
    if payload.get("planSpeakers"):
        return optimize_fixed_plan(payload, progress_callback)

    started = time.perf_counter()
    config = build_config(payload)
    selected_models = set(payload.get("models", []))
    catalog_items = [item for item in load_catalog(payload) if item["model"] in selected_models]
    product_map = {item["model"]: to_product(item) for item in catalog_items}
    if not product_map:
        raise ValueError("至少选择一个音箱型号")

    xs, ys, receivers, grid_indices = build_receiver_grid(config)
    stages = generate_candidate_stages(catalog_items, config)
    if not stages:
        raise ValueError("当前产品选择无法生成可用安装方案")

    results: list[CandidateResult] = []
    fields = {}
    reached_feasible_stage = False
    for stage_name, candidates in stages:
        if reached_feasible_stage and "ceiling" not in stage_name:
            continue
        stage_results: list[CandidateResult] = []
        stage_candidates = candidates
        if reached_feasible_stage:
            stage_candidates = candidates[:18]
        feasible_in_stage = 0
        max_stage_evals = stage_eval_limit(stage_name, bool(config.get("geometry")))
        for eval_idx, (layout_name, speakers) in enumerate(stage_candidates):
            if eval_idx >= max_stage_evals:
                break
            result, field = evaluate_mixed_layout(layout_name, speakers, product_map, config, receivers)
            stage_results.append(result)
            fields[(result.model, result.layout)] = field
            if result.feasible:
                feasible_in_stage += 1
            if feasible_in_stage >= 8:
                break
        stage_results.sort(key=lambda result: result_order_key(result))
        keep = {id(result): result for result in stage_results[:24]}
        keep.update({id(result): result for result in sorted(stage_results, key=lambda result: violation_score(result, config))[:24]})
        results.extend(keep.values())
        if any(result.feasible for result in stage_results):
            reached_feasible_stage = True

    if not results:
        raise ValueError("当前设置没有生成可评估方案")
    results.sort(key=result_order_key)
    feasible = [result for result in results if result.feasible]
    if not feasible:
        fallback_results = []
        for layout_name, speakers in generate_dense_fill_candidates(catalog_items, config):
            result, field = evaluate_mixed_layout(layout_name, speakers, product_map, config, receivers)
            fallback_results.append(result)
            fields[(result.model, result.layout)] = field
            results.append(result)
            if result.feasible:
                break
        feasible = [result for result in results if result.feasible]
        if not feasible:
            best_failed = sorted(results, key=lambda result: violation_score(result, config))[0]
            feasible = [best_failed]
    display_results = feasible
    best = feasible[0]
    best_field = fields[(best.model, best.layout)]
    candidate_results = pick_display_candidates(display_results, 12)

    response = {
        "config": config,
        "receivers": receivers.round(6).tolist(),
        "grid": {
            "xs": xs,
            "ys": ys,
            "field": field_to_grid(best_field, xs, ys, grid_indices),
        },
        "best": serialize_result(best),
        "ranking": [
            serialize_result(
                item,
                include_speakers=True,
                field=field_to_grid(fields[(item.model, item.layout)], xs, ys, grid_indices),
            )
            for item in candidate_results
        ],
    }
    response["elapsedSeconds"] = round(time.perf_counter() - started, 3)
    return response


def optimize_fixed_plan(payload: dict, progress_callback=None) -> dict:
    started = time.perf_counter()
    config = build_config(payload)
    catalog_items = load_catalog(payload)
    product_map = {item["model"]: to_product(item) for item in catalog_items}
    units: list[dict] = []
    for source_idx, entry in enumerate(payload.get("planSpeakers", []), 1):
        model = str(entry.get("model") or "").strip()
        quantity = int(float(entry.get("quantity") or 0))
        if not model or model not in product_map or quantity <= 0:
            continue
        for unit_idx in range(1, min(quantity, 80) + 1):
            units.append(
                {
                    "model": model,
                    "source_item_id": str(entry.get("itemId") or "") or None,
                    "source_row_index": int(entry.get("rowIndex") or source_idx),
                    "source_name": str(entry.get("name") or model).strip(),
                    "source_type": str(entry.get("type") or "").strip(),
                    "source_unit_index": unit_idx,
                    "source_label": str(entry.get("label") or "").strip() or f"{source_idx}. {entry.get('name') or model} #{unit_idx}",
                }
            )
    if not units:
        raise ValueError("当前方案中没有可用于固定布点仿真的音箱型号")

    xs, ys, receivers, grid_indices = build_receiver_grid(config)
    if progress_callback:
        progress_callback({
            "type": "setup",
            "config": config,
            "receivers": receivers.round(6).tolist(),
            "grid": {"xs": xs, "ys": ys},
        })
    candidates = generate_fixed_plan_candidates(units, product_map, config)
    if not candidates:
        raise ValueError("当前方案音箱数量无法生成固定布点方案")

    preliminary: list[tuple[CandidateResult, str, list[Speaker]]] = []
    for layout_name_candidate, speakers in candidates:
        result, field = evaluate_mixed_layout(layout_name_candidate, speakers, product_map, config, receivers)
        preliminary.append((result, layout_name_candidate, speakers))

    preliminary.sort(key=lambda item: fixed_plan_order_key(item[0], config))
    symmetric_preliminary = [
        item for item in preliminary
        if item[1].startswith("fixed_xy_symmetric_xy_symmetric_")
    ]
    refine_pool = symmetric_preliminary or preliminary
    refine_targets = refine_pool[:1] if refine_pool[0][0].feasible else refine_pool[: min(2, len(refine_pool))]

    results: list[CandidateResult] = []
    fields = {}
    histories = {}
    for preliminary_result, layout_name_candidate, speakers in refine_targets:
        should_stream = progress_callback if not results else None
        if preliminary_result.feasible:
            result, field = evaluate_mixed_layout(layout_name_candidate, speakers, product_map, config, receivers)
            history = [
                build_optimization_frame(
                    result,
                    field,
                    xs,
                    ys,
                    grid_indices,
                    "初始布点已满足指标",
                    0,
                )
            ]
            if should_stream:
                should_stream({"type": "frame", "frame": history[0]})
        else:
            speakers, history = refine_fixed_plan_layout(
                layout_name_candidate,
                speakers,
                product_map,
                config,
                receivers,
                xs,
                ys,
                grid_indices,
                should_stream,
            )
            result, field = evaluate_mixed_layout(layout_name_candidate, speakers, product_map, config, receivers)
        results.append(result)
        fields[(result.model, result.layout)] = field
        if not history or not history[-1]["metrics"]["feasible"]:
            history.append(
                build_optimization_frame(
                    result,
                    field,
                    xs,
                    ys,
                    grid_indices,
                    "精调完成",
                    len(history),
                )
            )
        histories[(result.model, result.layout)] = history
        if result.feasible:
            break

    boosted_results: list[CandidateResult] = []
    boosted_fields = dict(fields)
    for item in results:
        field = boosted_fields[(item.model, item.layout)]
        boosted_item, boosted_field = apply_uniform_headroom_boost(item, field, product_map, config["targets"])
        boosted_results.append(boosted_item)
        boosted_fields[(boosted_item.model, boosted_item.layout)] = boosted_field

    boosted_results.sort(key=lambda item: fixed_plan_order_key(item, config))
    best = boosted_results[0]
    best_field = boosted_fields[(best.model, best.layout)]
    candidate_results = boosted_results[: min(8, len(boosted_results))]
    first_refined_key = next(iter(histories), None)
    optimization_history = list(histories.get(first_refined_key, []))
    if not optimization_history or (
        abs(float(optimization_history[-1]["metrics"]["minSpl"]) - best.min_spl_db) > 1.0e-6
        or abs(float(optimization_history[-1]["metrics"]["nonuniformity"]) - best.nonuniformity_db) > 1.0e-6
    ):
        final_frame = build_optimization_frame(
            best,
            best_field,
            xs,
            ys,
            grid_indices,
            "全局最佳方案",
            len(optimization_history),
        )
        optimization_history.append(final_frame)
        if progress_callback:
            progress_callback({"type": "frame", "frame": final_frame})

    response = {
        "config": config,
        "receivers": receivers.round(6).tolist(),
        "grid": {
            "xs": xs,
            "ys": ys,
            "field": field_to_grid(best_field, xs, ys, grid_indices),
        },
        "best": serialize_result(best),
        "ranking": [
            serialize_result(
                item,
                include_speakers=True,
                field=field_to_grid(boosted_fields[(item.model, item.layout)], xs, ys, grid_indices),
            )
            for item in candidate_results
        ],
        "mode": "fixed_plan",
        "optimizationHistory": optimization_history,
    }
    if not best.feasible:
        adjustment = build_fixed_plan_adjustment(
            units,
            product_map,
            config,
            receivers,
            xs,
            ys,
            grid_indices,
            best,
        )
        if adjustment:
            response["adjustment"] = adjustment
    response["elapsedSeconds"] = round(time.perf_counter() - started, 3)
    return response


def fixed_plan_order_key(result: CandidateResult, config: dict) -> tuple[float, float, float, float, float, float]:
    violation, _cost = violation_score(result, config)
    quality = layout_quality_penalty(result.speakers, config)
    return (
        0.0 if result.feasible else 1.0,
        violation,
        result.nonuniformity_db,
        quality,
        max(0.0, result.max_spl_db - result.avg_spl_db - 6.0),
        -result.headroom_db,
    )


def build_fixed_plan_adjustment(
    units: list[dict],
    product_map: dict[str, Product],
    config: dict,
    receivers: np.ndarray,
    xs: list[float],
    ys: list[float],
    grid_indices: list[tuple[int, int]],
    baseline: CandidateResult,
) -> dict | None:
    ceiling_models = [
        model
        for model, product in product_map.items()
        if product.coverage_v_deg >= 95 or "ceiling" in product.model.lower()
    ]
    other_models = [model for model in product_map if model not in ceiling_models]
    existing_models = {unit["model"] for unit in units}
    model_order = sorted(
        [*ceiling_models, *other_models],
        key=lambda model: (
            0 if model in existing_models else 1,
            0 if model in ceiling_models else 1,
            product_map[model].price / max(product_map[model].continuous_spl_db - 80.0, 1.0),
        ),
    )[:1]
    if not model_order:
        return None

    best_adjusted: tuple[CandidateResult, np.ndarray, str, int] | None = None

    for add_count in (1, 2):
        for model in model_order:
            product = product_map[model]
            extra_units = [
                {
                    "model": model,
                    "source_item_id": None,
                    "source_row_index": None,
                    "source_name": product.name,
                    "source_type": "建议增补",
                    "source_unit_index": idx + 1,
                    "source_label": f"建议增补 / {product.name} / {model} #{idx + 1}",
                }
                for idx in range(add_count)
            ]
            candidates = generate_fixed_plan_candidates([*units, *extra_units], product_map, config)
            if not candidates:
                continue

            preliminary: list[tuple[CandidateResult, np.ndarray, str, int]] = []
            for layout_name_candidate, speakers in candidates:
                result, field = evaluate_mixed_layout(layout_name_candidate, speakers, product_map, config, receivers)
                result, field = apply_uniform_headroom_boost(result, field, product_map, config["targets"])
                preliminary.append((result, field, model, add_count))
            preliminary.sort(key=lambda item: fixed_plan_order_key(item[0], config))

            for candidate in preliminary[: min(6, len(preliminary))]:
                adjusted_result = candidate[0]
                if best_adjusted is None or fixed_plan_order_key(adjusted_result, config) < fixed_plan_order_key(best_adjusted[0], config):
                    best_adjusted = candidate
                if adjusted_result.feasible:
                    return serialize_adjustment(candidate, baseline, xs, ys, grid_indices)

    if best_adjusted is None:
        return None
    return serialize_adjustment(best_adjusted, baseline, xs, ys, grid_indices)


def serialize_adjustment(
    candidate: tuple[CandidateResult, np.ndarray, str, int],
    baseline: CandidateResult,
    xs: list[float],
    ys: list[float],
    grid_indices: list[tuple[int, int]],
) -> dict:
    result, field, model, add_count = candidate
    if not result.feasible:
        return {
            "needed": True,
            "feasible": False,
            "reason": (
                f"{baseline.reason or '当前固定清单未满足对标指标'}。"
                "当前固定清单已优化到约束边界，快速增补诊断仍未找到达标解；"
                "请增补补声音箱数量或替换为更高连续声压级型号后重新生成。"
            ),
            "added": [],
            "result": serialize_result(result),
            "grid": field_to_grid(field, xs, ys, grid_indices),
        }
    return {
        "needed": True,
        "feasible": result.feasible,
        "reason": (
            f"{baseline.reason or '当前固定清单未满足对标指标'}。"
            f"当前清单固定布点已优化到约束边界，建议增补 {add_count} 只 {model} 后重新生成。"
        ),
        "added": [
            {
                "model": model,
                "quantity": add_count,
            }
        ],
        "result": serialize_result(result),
        "grid": field_to_grid(field, xs, ys, grid_indices),
    }


def layout_quality_penalty(speakers: list[Speaker], config: dict) -> float:
    if len(speakers) <= 1:
        return 0.0
    room = config["room"]
    area = config["listener_area"]
    positions = np.asarray([speaker.position for speaker in speakers], dtype=float)
    xy = positions[:, :2]
    lx = room["length_m"]
    ly = room["width_m"]
    listener_span_x = max(0.1, area["x_max_m"] - area["x_min_m"])
    listener_span_y = max(0.1, area["y_max_m"] - area["y_min_m"])

    span_x = float(np.max(xy[:, 0]) - np.min(xy[:, 0]))
    span_y = float(np.max(xy[:, 1]) - np.min(xy[:, 1]))
    desired_x = listener_span_x * (0.45 if len(speakers) >= 4 else 0.2)
    desired_y = listener_span_y * (0.55 if len(speakers) >= 2 else 0.2)
    span_penalty = max(0.0, desired_x - span_x) / listener_span_x * 6.0
    span_penalty += max(0.0, desired_y - span_y) / listener_span_y * 6.0

    min_pair_distance = min(
        float(np.linalg.norm(xy[i] - xy[j]))
        for i in range(len(xy))
        for j in range(i + 1, len(xy))
    )
    cluster_penalty = max(0.0, min(lx, ly) * 0.28 - min_pair_distance) * 2.2

    center_x = lx / 2
    center_y = ly / 2
    mirrored = []
    for point in xy:
        mirror_y = np.asarray([point[0], ly - point[1]])
        mirror_x = np.asarray([lx - point[0], point[1]])
        dist_y = float(np.min(np.linalg.norm(xy - mirror_y, axis=1)))
        dist_x = float(np.min(np.linalg.norm(xy - mirror_x, axis=1)))
        if abs(point[1] - center_y) <= ly * 0.06:
            dist_y = 0.0
        if abs(point[0] - center_x) <= lx * 0.06:
            dist_x = 0.0
        mirrored.append(
            dist_y / max(ly, 0.1)
            + dist_x / max(lx, 0.1)
        )
    symmetry_penalty = float(np.mean(mirrored)) * 36.0

    center_distances = np.linalg.norm(xy - np.asarray([center_x, center_y]), axis=1)
    central_ratio = float(np.mean(center_distances < min(lx, ly) * 0.18))
    center_clump_penalty = max(0.0, central_ratio - 0.25) * 7.0

    return span_penalty + cluster_penalty + symmetry_penalty + center_clump_penalty


def inverse_design_score(result: CandidateResult, config: dict) -> tuple[float, float, float, float]:
    targets = config["targets"]
    standard_penalty = (
        max(0.0, targets["min_spl_db"] - result.min_spl_db) * 30.0
        + max(0.0, result.nonuniformity_db - targets["max_nonuniformity_db"]) * 24.0
        + max(0.0, targets["min_headroom_db"] - result.headroom_db) * 18.0
    )
    return (
        standard_penalty + layout_quality_penalty(result.speakers, config),
        result.nonuniformity_db,
        -result.min_spl_db,
        -result.headroom_db,
    )


def clone_speaker(
    speaker: Speaker,
    position: tuple[float, float, float] | None = None,
    aim: tuple[float, float, float] | None = None,
    gain_db: float | None = None,
) -> Speaker:
    return Speaker(
        speaker.model,
        position or speaker.position,
        aim or speaker.aim,
        speaker.layout_role,
        speaker.gain_db if gain_db is None else gain_db,
        source_item_id=speaker.source_item_id,
        source_row_index=speaker.source_row_index,
        source_name=speaker.source_name,
        source_type=speaker.source_type,
        source_unit_index=speaker.source_unit_index,
        source_label=speaker.source_label,
    )


def clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def max_allowed_gain(speaker: Speaker, product_map: dict[str, Product]) -> float:
    product = product_map[speaker.model]
    return min(6.0, max(0.0, product.peak_spl_db - product.continuous_spl_db))


def build_candidate_failures(min_spl: float, nonuniformity: float, headroom: float, targets: dict) -> list[str]:
    failures = []
    tolerance = 1.0e-6
    if min_spl + tolerance < targets["min_spl_db"]:
        failures.append(f"最低声压级不足 {targets['min_spl_db']:.1f} dB")
    if nonuniformity - tolerance > targets["max_nonuniformity_db"]:
        failures.append(f"声场不均匀度超过 {targets['max_nonuniformity_db']:.1f} dB")
    if headroom + tolerance < targets["min_headroom_db"]:
        failures.append(f"最低点余量低于 {targets['min_headroom_db']:.1f} dB")
    return failures


def rebuild_candidate_with_field(
    template: CandidateResult,
    speakers: list[Speaker],
    field: np.ndarray,
    targets: dict,
) -> CandidateResult:
    min_spl = float(np.min(field))
    max_spl = float(np.max(field))
    avg_spl = float(10.0 * np.log10(np.mean(10.0 ** (field / 10.0)) + EPS))
    nonuniformity = max_spl - min_spl
    headroom = min_spl - targets["min_spl_db"]
    failures = build_candidate_failures(min_spl, nonuniformity, headroom, targets)
    return CandidateResult(
        feasible=not failures,
        total_cost=template.total_cost,
        product_cost=template.product_cost,
        install_cost=template.install_cost,
        dsp_cost=template.dsp_cost,
        model=template.model,
        layout=template.layout,
        speaker_count=template.speaker_count,
        min_spl_db=min_spl,
        avg_spl_db=avg_spl,
        max_spl_db=max_spl,
        nonuniformity_db=nonuniformity,
        headroom_db=headroom,
        coverage_loss_db_p95=template.coverage_loss_db_p95,
        reason="达标" if not failures else "；".join(failures),
        speakers=speakers,
    )


def apply_uniform_headroom_boost(
    result: CandidateResult,
    field: np.ndarray,
    product_map: dict[str, Product],
    targets: dict,
) -> tuple[CandidateResult, np.ndarray]:
    required_boost = targets["min_spl_db"] + targets["min_headroom_db"] - result.min_spl_db
    if required_boost <= 1.0e-6:
        return result, field
    if result.nonuniformity_db > targets["max_nonuniformity_db"] + 1.0e-6:
        return result, field

    remaining_boosts = [
        max_allowed_gain(speaker, product_map) - float(speaker.gain_db)
        for speaker in result.speakers
    ]
    available_boost = min(remaining_boosts) if remaining_boosts else 0.0
    boost = min(required_boost + 0.15, available_boost)
    if boost <= 1.0e-6:
        return result, field

    boosted_speakers = [
        clone_speaker(speaker, gain_db=float(speaker.gain_db + boost))
        for speaker in result.speakers
    ]
    boosted_field = field + boost
    return rebuild_candidate_with_field(result, boosted_speakers, boosted_field, targets), boosted_field


def refine_fixed_plan_layout(
    layout_name_candidate: str,
    initial_speakers: list[Speaker],
    product_map: dict[str, Product],
    config: dict,
    receivers: np.ndarray,
    xs: list[float],
    ys: list[float],
    grid_indices: list[tuple[int, int]],
    progress_callback=None,
) -> tuple[list[Speaker], list[dict]]:
    room = config["room"]
    area = config["listener_area"]
    lx, ly, lz = room["length_m"], room["width_m"], room["height_m"]
    targets = config["targets"]
    x_min = max(0.35, area["x_min_m"] * 0.35)
    x_max = min(lx - 0.35, area["x_max_m"] + (lx - area["x_max_m"]) * 0.5)
    y_min = max(0.25, area["y_min_m"] * 0.35)
    y_max = min(ly - 0.25, area["y_max_m"] + (ly - area["y_max_m"]) * 0.5)
    z_min = max(area["ear_height_m"] + 0.7, min(lz - 0.35, lz * 0.36))
    z_max = max(area["ear_height_m"] + 0.9, lz - 0.35)
    desired_level = targets["min_spl_db"] + max(1.5, targets["min_headroom_db"])
    deadline = time.perf_counter() + float(config.get("optimizer_time_budget_s", 32.0))
    max_steps = max(1, min(20, int(config.get("optimizer_max_steps", 20))))

    centerline_indices: set[int] = set()
    model_indices: dict[str, list[int]] = {}
    for idx, speaker in enumerate(initial_speakers):
        model_indices.setdefault(speaker.model, []).append(idx)
    for indices in model_indices.values():
        if len(indices) % 2 == 1:
            center_idx = min(indices, key=lambda item_idx: abs(initial_speakers[item_idx].position[1] - ly / 2))
            centerline_indices.add(center_idx)

    pair_map: dict[int, tuple[int, int, str]] = {}
    used_pair_indices: set[int] = set()

    def is_ceiling_speaker(speaker: Speaker) -> bool:
        product = product_map[speaker.model]
        return speaker.layout_role.startswith("ceiling") or (product.coverage_v_deg >= 95 and product.continuous_spl_db <= 110)

    def aim_for_speaker(speaker: Speaker, position: tuple[float, float, float], fallback_aim: tuple[float, float, float]) -> tuple[float, float, float]:
        if is_ceiling_speaker(speaker):
            return (position[0], position[1], area["ear_height_m"])
        return fallback_aim

    xy_symmetry_orbits: list[list[int]] = []
    if "xy_symmetric" in layout_name_candidate:
        symmetry_groups = [
            [idx for idx, speaker in enumerate(initial_speakers) if not is_ceiling_speaker(speaker)],
            [idx for idx, speaker in enumerate(initial_speakers) if is_ceiling_speaker(speaker)],
        ]
        for group in symmetry_groups:
            cursor = 0
            while cursor < len(group):
                remaining = len(group) - cursor
                orbit_size = 4 if remaining >= 4 else 2 if remaining >= 2 else 1
                xy_symmetry_orbits.append(group[cursor:cursor + orbit_size])
                cursor += orbit_size

    def project_xy_symmetry(speakers: list[Speaker]) -> list[Speaker]:
        if not xy_symmetry_orbits:
            return speakers
        projected = list(speakers)
        center_x = lx / 2.0
        center_y = ly / 2.0
        for orbit in xy_symmetry_orbits:
            if len(orbit) == 1:
                idx = orbit[0]
                projected[idx] = clone_speaker(
                    projected[idx],
                    position=(center_x, center_y, projected[idx].position[2]),
                    aim=aim_for_speaker(
                        projected[idx],
                        (center_x, center_y, projected[idx].position[2]),
                        (center_x, center_y, area["ear_height_m"]),
                    ),
                )
                continue
            dx = float(np.mean([abs(projected[idx].position[0] - center_x) for idx in orbit]))
            dy = float(np.mean([abs(projected[idx].position[1] - center_y) for idx in orbit]))
            z = float(np.mean([projected[idx].position[2] for idx in orbit]))
            for idx in orbit:
                initial = initial_speakers[idx]
                sign_x = -1.0 if initial.position[0] < center_x else 1.0
                sign_y = 0.0 if abs(initial.position[1] - center_y) < 1.0e-6 else (-1.0 if initial.position[1] < center_y else 1.0)
                projected[idx] = clone_speaker(
                    projected[idx],
                    position=(center_x + sign_x * dx, center_y + sign_y * dy, z),
                    aim=aim_for_speaker(
                        projected[idx],
                        (center_x + sign_x * dx, center_y + sign_y * dy, z),
                        (center_x, center_y, area["ear_height_m"]),
                    ),
                )
        return projected

    for idx, speaker in enumerate(initial_speakers):
        if idx in used_pair_indices or idx in centerline_indices:
            continue
        role = speaker.layout_role
        counterpart_role = None
        side = ""
        if "left" in role:
            counterpart_role = role.replace("left", "right")
            side = "left"
        elif "right" in role:
            counterpart_role = role.replace("right", "left")
            side = "right"
        elif role.startswith("ceiling_zone_"):
            best_other = None
            best_distance = float("inf")
            for candidate_idx in range(idx + 1, len(initial_speakers)):
                other = initial_speakers[candidate_idx]
                if (
                    candidate_idx in used_pair_indices
                    or candidate_idx in centerline_indices
                    or other.model != speaker.model
                    or not other.layout_role.startswith("ceiling_zone_")
                ):
                    continue
                mirrored_y = abs((speaker.position[1] + other.position[1]) - ly)
                close_x = abs(speaker.position[0] - other.position[0])
                distance = mirrored_y + close_x
                if distance < best_distance and mirrored_y <= max(0.8, ly * 0.16) and close_x <= max(1.2, lx * 0.12):
                    best_other = other
                    best_distance = distance
            if best_other is not None:
                counterpart_role = best_other.layout_role
                side = "left" if speaker.position[1] <= ly / 2 else "right"
        if not counterpart_role:
            continue
        for other_idx in range(idx + 1, len(initial_speakers)):
            other = initial_speakers[other_idx]
            if other_idx not in centerline_indices and other.model == speaker.model and other.layout_role == counterpart_role:
                pair_map[idx] = (idx, other_idx, side)
                used_pair_indices.update({idx, other_idx})
                break

    def pack(speakers: list[Speaker]) -> np.ndarray:
        values = []
        for idx, speaker in enumerate(speakers):
            if idx in used_pair_indices and idx not in pair_map:
                continue
            max_gain = min(6.0, max(0.0, product_map[speaker.model].peak_spl_db - product_map[speaker.model].continuous_spl_db))
            if idx in pair_map:
                _left_idx, right_idx, _side = pair_map[idx]
                other = speakers[right_idx]
                y_offset = abs(speaker.position[1] - ly / 2)
                aim_y_offset = abs(speaker.aim[1] - ly / 2)
                values.extend([
                    (speaker.position[0] + other.position[0]) / 2,
                    y_offset,
                    (speaker.position[2] + other.position[2]) / 2,
                    (speaker.aim[0] + other.aim[0]) / 2,
                    aim_y_offset,
                    min(max_gain, max(-18.0, (speaker.gain_db + other.gain_db) / 2)),
                ])
            elif idx in centerline_indices:
                values.extend([
                    speaker.position[0],
                    ly / 2,
                    speaker.position[2],
                    speaker.aim[0],
                    ly / 2,
                    min(max_gain, max(-18.0, speaker.gain_db)),
                ])
            else:
                values.extend([
                    speaker.position[0],
                    speaker.position[1],
                    speaker.position[2],
                    speaker.aim[0],
                    speaker.aim[1],
                    min(max_gain, max(-18.0, speaker.gain_db)),
                ])
        return np.asarray(values, dtype=float)

    def unpack(vector: np.ndarray) -> list[Speaker]:
        speakers: list[Speaker | None] = [None] * len(initial_speakers)
        cursor = 0
        for idx, speaker in enumerate(initial_speakers):
            if idx in used_pair_indices and idx not in pair_map:
                continue
            values = vector[cursor:cursor + 6]
            cursor += 6
            if idx in pair_map:
                left_idx, right_idx, side = pair_map[idx]
                left_speaker = initial_speakers[left_idx]
                right_speaker = initial_speakers[right_idx]
                x, y_offset, z, aim_x, aim_y_offset, _gain = [float(value) for value in values]
                low_y = ly / 2 - y_offset
                high_y = ly / 2 + y_offset
                low_aim_y = ly / 2 - aim_y_offset
                high_aim_y = ly / 2 + aim_y_offset
                left_y, right_y = (low_y, high_y) if side != "right" else (high_y, low_y)
                left_aim_y, right_aim_y = (high_aim_y, low_aim_y) if side != "right" else (low_aim_y, high_aim_y)
                if is_ceiling_speaker(left_speaker):
                    aim_x = x
                    left_aim_y = left_y
                    right_aim_y = right_y
                speakers[left_idx] = clone_speaker(left_speaker, position=(x, left_y, z), aim=(aim_x, left_aim_y, area["ear_height_m"]))
                speakers[right_idx] = clone_speaker(right_speaker, position=(x, right_y, z), aim=(aim_x, right_aim_y, area["ear_height_m"]))
            elif idx in centerline_indices:
                position = (float(values[0]), ly / 2, float(values[2]))
                aim_x = position[0] if is_ceiling_speaker(speaker) else float(values[3])
                aim = (aim_x, ly / 2, area["ear_height_m"])
                speakers[idx] = clone_speaker(speaker, position=position, aim=aim)
            else:
                position = (float(values[0]), float(values[1]), float(values[2]))
                aim = (position[0], position[1], area["ear_height_m"]) if is_ceiling_speaker(speaker) else (float(values[3]), float(values[4]), area["ear_height_m"])
                speakers[idx] = clone_speaker(speaker, position=position, aim=aim)
        return project_xy_symmetry([speaker for speaker in speakers if speaker is not None])

    def spl_field_for(vector: np.ndarray) -> tuple[np.ndarray, list[Speaker]]:
        speakers = unpack(vector)
        shifted = np.zeros((len(speakers), len(receivers)), dtype=float)
        gains = unpack_gains(vector)
        for speaker_idx, speaker in enumerate(speakers):
            gain = gains[speaker_idx]
            product = product_map[speaker.model]
            pos = np.asarray(speaker.position, dtype=float)
            for receiver_idx, receiver in enumerate(receivers):
                dist = max(float(np.linalg.norm(receiver - pos)), 1.0)
                loss = angular_loss_db(speaker, receiver, product)
                shifted[speaker_idx, receiver_idx] = product.continuous_spl_db + gain - 20.0 * np.log10(dist) - loss
        field = 10.0 * np.log10(np.sum(10.0 ** (shifted / 10.0), axis=0) + EPS)
        return field, speakers

    def unpack_gains(vector: np.ndarray) -> list[float]:
        gains = [0.0] * len(initial_speakers)
        cursor = 0
        for idx, _speaker in enumerate(initial_speakers):
            if idx in used_pair_indices and idx not in pair_map:
                continue
            gain = float(vector[cursor + 5])
            if idx in pair_map:
                left_idx, right_idx, _side = pair_map[idx]
                gains[left_idx] = gain
                gains[right_idx] = gain
            else:
                gains[idx] = gain
            cursor += 6
        for orbit in xy_symmetry_orbits:
            orbit_gain = float(np.mean([gains[idx] for idx in orbit]))
            for idx in orbit:
                gains[idx] = orbit_gain
        return gains

    def engineering_penalty(speakers: list[Speaker]) -> float:
        penalty = layout_quality_penalty(speakers, config) * 1.6
        xy = np.asarray([speaker.position[:2] for speaker in speakers], dtype=float)
        initial_xy = np.asarray([speaker.position[:2] for speaker in initial_speakers], dtype=float)
        min_spacing = min(lx, ly) * 0.16
        for i in range(len(xy)):
            for j in range(i + 1, len(xy)):
                distance = float(np.linalg.norm(xy[i] - xy[j]))
                penalty += max(0.0, min_spacing - distance) ** 2 * 1.2
        for point, initial_point in zip(xy, initial_xy):
            drift = float(np.linalg.norm(point - initial_point))
            penalty += max(0.0, drift - min(lx, ly) * 0.28) ** 2 * 1.2
        return penalty

    def objective(vector: np.ndarray) -> float:
        if time.perf_counter() > deadline:
            raise OptimizationTimeBudgetExceeded()
        field, speakers = spl_field_for(vector)
        min_spl = float(np.min(field))
        max_spl = float(np.max(field))
        nonuniformity = max_spl - min_spl
        headroom = min_spl - targets["min_spl_db"]
        mean_error = float(np.mean((field - desired_level) ** 2))
        variance = float(np.var(field))
        standard_penalty = (
            max(0.0, targets["min_spl_db"] - min_spl) ** 2 * 4000.0
            + max(0.0, nonuniformity - targets["max_nonuniformity_db"]) ** 2 * 3200.0
            + max(0.0, targets["min_headroom_db"] - headroom) ** 2 * 5200.0
        )
        return (
            standard_penalty
            + nonuniformity * 18.0
            + variance * 5.0
            + mean_error * 0.2
            + engineering_penalty(speakers)
        )

    def vector_is_feasible(vector: np.ndarray) -> bool:
        field, _speakers = spl_field_for(vector)
        min_spl = float(np.min(field))
        nonuniformity = float(np.max(field) - min_spl)
        headroom = min_spl - targets["min_spl_db"]
        return (
            min_spl >= targets["min_spl_db"]
            and nonuniformity <= targets["max_nonuniformity_db"]
            and headroom >= targets["min_headroom_db"]
        )

    optimization_history: list[dict] = []
    best_recorded_value = float("inf")
    last_recorded_vector: np.ndarray | None = None

    def display_step_count(previous: np.ndarray | None, current: np.ndarray) -> int:
        if previous is None or len(previous) != len(current):
            return 1
        max_steps_needed = 1
        limits = (0.35, 0.35, 0.28, 0.45, 0.45, 1.2)
        variable_count = max(1, len(current) // 6)
        for group_idx in range(variable_count):
            offset = group_idx * 6
            for local_idx, limit in enumerate(limits):
                value_idx = offset + local_idx
                if value_idx >= len(current):
                    continue
                delta = abs(float(current[value_idx] - previous[value_idx]))
                max_steps_needed = max(max_steps_needed, int(math.ceil(delta / limit)))
        return max(1, min(10, max_steps_needed))

    def build_frame(vector: np.ndarray, value: float, label: str) -> dict:
        field, unpacked_speakers = spl_field_for(vector)
        gains = unpack_gains(vector)
        speakers_with_gain = [
            clone_speaker(speaker, gain_db=float(gains[idx]))
            for idx, speaker in enumerate(unpacked_speakers)
        ]
        min_spl = float(np.min(field))
        max_spl = float(np.max(field))
        avg_spl = float(10.0 * np.log10(np.mean(10.0 ** (field / 10.0)) + EPS))
        nonuniformity = max_spl - min_spl
        headroom = min_spl - targets["min_spl_db"]
        failures = build_candidate_failures(min_spl, nonuniformity, headroom, targets)
        return {
            "index": len(optimization_history),
            "label": label,
            "objective": round(float(value), 6),
            "metrics": {
                "feasible": not failures,
                "minSpl": round(min_spl, 6),
                "avgSpl": round(avg_spl, 6),
                "maxSpl": round(max_spl, 6),
                "nonuniformity": round(nonuniformity, 6),
                "headroom": round(headroom, 6),
                "reason": "达标" if not failures else "；".join(failures),
            },
            "speakers": serialize_speakers(speakers_with_gain),
            "grid": {
                "xs": xs,
                "ys": ys,
                "field": field_to_grid(field, xs, ys, grid_indices),
            },
        }

    def record_frame(vector: np.ndarray, label: str, force: bool = False) -> None:
        nonlocal best_recorded_value, deadline, last_recorded_vector
        if not progress_callback:
            return
        observer_started = time.perf_counter()
        clipped = clipped_vector(vector)
        try:
            value = objective(clipped)
        except OptimizationTimeBudgetExceeded:
            deadline += time.perf_counter() - observer_started
            return
        if not force and value >= best_recorded_value - 1.0e-5:
            deadline += time.perf_counter() - observer_started
            return
        step_count = display_step_count(last_recorded_vector, clipped)
        start_vector = last_recorded_vector.copy() if last_recorded_vector is not None and len(last_recorded_vector) == len(clipped) else clipped
        for step_idx in range(1, step_count + 1):
            ratio = step_idx / step_count
            display_vector = clipped_vector(start_vector + (clipped - start_vector) * ratio)
            display_label = label if step_count == 1 else f"{label} · {step_idx}/{step_count}"
            display_value = value if step_idx == step_count else objective(display_vector)
            frame = build_frame(display_vector, display_value, display_label)
            optimization_history.append(frame)
            progress_callback({"type": "frame", "frame": frame})
        last_recorded_vector = clipped.copy()
        best_recorded_value = min(best_recorded_value, float(value))
        deadline += time.perf_counter() - observer_started

    def constraint_min_spl(vector: np.ndarray) -> float:
        field, _speakers = spl_field_for(vector)
        return float(np.min(field) - targets["min_spl_db"])

    def constraint_uniformity(vector: np.ndarray) -> float:
        field, _speakers = spl_field_for(vector)
        return float(targets["max_nonuniformity_db"] - (np.max(field) - np.min(field)))

    def constraint_headroom(vector: np.ndarray) -> float:
        field, _speakers = spl_field_for(vector)
        return float(np.min(field) - targets["min_spl_db"] - targets["min_headroom_db"])

    def installation_bounds(speaker: Speaker) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
        role = speaker.layout_role
        if is_ceiling_speaker(speaker):
            return (max(0.8, area["x_min_m"] * 0.75), min(area["x_max_m"], lx * 0.9)), (y_min, y_max), (max(z_max - 0.12, z_min), z_max)
        if role.startswith("screen") or role.startswith("front"):
            return (0.35, min(1.2, lx - 0.35)), (y_min, y_max), (max(2.1, z_min), z_max)
        if "side_left" in role:
            return (max(0.8, area["x_min_m"] * 0.75), min(area["x_max_m"], lx * 0.86)), (0.25, min(1.0, ly * 0.16)), (max(2.1, z_min), z_max)
        if "side_right" in role:
            return (max(0.8, area["x_min_m"] * 0.75), min(area["x_max_m"], lx * 0.86)), (max(ly - 1.0, ly * 0.84), ly - 0.25), (max(2.1, z_min), z_max)
        return (x_min, x_max), (y_min, y_max), (z_min, z_max)

    bounds = []
    for idx, speaker in enumerate(initial_speakers):
        if idx in used_pair_indices and idx not in pair_map:
            continue
        max_gain = min(6.0, max(0.0, product_map[speaker.model].peak_spl_db - product_map[speaker.model].continuous_spl_db))
        xb, yb, zb = installation_bounds(speaker)
        is_ceiling_role = is_ceiling_speaker(speaker)
        aim_x_bounds = (area["x_min_m"], area["x_max_m"])
        if is_ceiling_role:
            listener_span_x = max(0.1, area["x_max_m"] - area["x_min_m"])
            aim_x_bounds = (area["x_min_m"] + listener_span_x * 0.22, area["x_max_m"] - listener_span_x * 0.22)
        if idx in pair_map:
            _left_idx, _right_idx, _side = pair_map[idx]
            max_y_offset = max(0.1, min(ly / 2 - y_min, y_max - ly / 2))
            max_aim_y_offset = max(0.0, min(ly / 2 - area["y_min_m"], area["y_max_m"] - ly / 2))
            min_y_offset = 0.25
            if is_ceiling_role:
                min_y_offset = min(max_y_offset, max(0.8, max_y_offset * 0.42))
                max_aim_y_offset = min(max_aim_y_offset, ly * 0.08)
            bounds.extend([
                xb,
                (min_y_offset, max_y_offset),
                zb,
                aim_x_bounds,
                (0.0, max_aim_y_offset),
                (-18.0, max_gain),
            ])
            continue
        if idx in centerline_indices:
            center_eps = 1.0e-6
            bounds.extend([
                xb,
                (ly / 2 - center_eps, ly / 2 + center_eps),
                zb,
                aim_x_bounds,
                (ly / 2 - center_eps, ly / 2 + center_eps),
                (-18.0, max_gain),
            ])
            continue
        bounds.extend([
            xb,
            yb,
            zb,
            aim_x_bounds,
            (area["y_min_m"], area["y_max_m"]),
            (-18.0, max_gain),
        ])

    def clipped_vector(values: np.ndarray) -> np.ndarray:
        clipped = np.asarray(values, dtype=float).copy()
        for pos, (lower, upper) in enumerate(bounds):
            clipped[pos] = clamp(float(clipped[pos]), float(lower), float(upper))
        return clipped

    def spread_start_vectors(base: np.ndarray) -> list[np.ndarray]:
        starts = [clipped_vector(base)]
        variable_count = len(bounds) // 6
        if variable_count <= 0:
            return starts
        for phase in (0.35,):
            vector = base.copy()
            for group_idx in range(variable_count):
                offset = group_idx * 6
                x_lower, x_upper = bounds[offset]
                y_lower, y_upper = bounds[offset + 1]
                aim_x_lower, aim_x_upper = bounds[offset + 3]
                aim_y_lower, aim_y_upper = bounds[offset + 4]
                ratio = (phase + group_idx / max(variable_count, 1)) % 1.0
                vector[offset] = x_lower + (x_upper - x_lower) * ratio
                if abs(y_upper - y_lower) > 1.0e-5:
                    vector[offset + 1] = y_lower + (y_upper - y_lower) * (0.5 if group_idx % 3 == 0 else ratio)
                vector[offset + 3] = aim_x_lower + (aim_x_upper - aim_x_lower) * (1.0 - ratio * 0.55)
                if abs(aim_y_upper - aim_y_lower) > 1.0e-5:
                    vector[offset + 4] = aim_y_lower + (aim_y_upper - aim_y_lower) * (0.5 if group_idx % 2 == 0 else 1.0 - ratio)
            starts.append(clipped_vector(vector))
        return starts

    constraints = [
        {"type": "ineq", "fun": constraint_min_spl},
        {"type": "ineq", "fun": constraint_uniformity},
        {"type": "ineq", "fun": constraint_headroom},
    ]
    initial = pack(initial_speakers)
    best_vector = clipped_vector(initial)
    best_value = objective(best_vector)
    record_frame(best_vector, "初始布点", force=True)
    if vector_is_feasible(best_vector):
        optimized = unpack(best_vector)
        optimized_gains = unpack_gains(best_vector)
        return [
            Speaker(
                speaker.model,
                speaker.position,
                speaker.aim,
                speaker.layout_role,
                float(optimized_gains[idx]),
                source_item_id=speaker.source_item_id,
                source_row_index=speaker.source_row_index,
                source_name=speaker.source_name,
                source_type=speaker.source_type,
                source_unit_index=speaker.source_unit_index,
                source_label=speaker.source_label,
            )
            for idx, speaker in enumerate(optimized)
        ], optimization_history

    feasible_vector = None
    for start_vector in spread_start_vectors(initial):
        try:
            def local_callback(vector: np.ndarray) -> None:
                record_frame(vector, f"局部优化 {len(optimization_history)}")
                if vector_is_feasible(vector):
                    raise FeasibleSolutionFound(clipped_vector(vector))

            local = minimize(
                objective,
                start_vector,
                method="SLSQP",
                bounds=bounds,
                constraints=constraints,
                callback=local_callback,
                options={"maxiter": max_steps, "ftol": 1.0e-5, "disp": False},
            )
            candidate_vector = local.x if local.success or np.isfinite(local.fun) else start_vector
            candidate_value = objective(candidate_vector)
            if vector_is_feasible(candidate_vector):
                feasible_vector = clipped_vector(candidate_vector)
                record_frame(feasible_vector, "达到国标，停止优化", force=True)
                break
        except FeasibleSolutionFound as found:
            feasible_vector = clipped_vector(found.vector)
            record_frame(feasible_vector, "达到国标，停止优化", force=True)
            break
        except OptimizationTimeBudgetExceeded:
            break
        if np.isfinite(candidate_value) and candidate_value < best_value:
            best_vector = clipped_vector(candidate_vector)
            best_value = candidate_value

    if feasible_vector is not None:
        best_vector = feasible_vector

    field, _speakers = spl_field_for(best_vector)
    constraints_met = (
        float(np.min(field)) >= targets["min_spl_db"]
        and float(np.max(field) - np.min(field)) <= targets["max_nonuniformity_db"]
        and float(np.min(field) - targets["min_spl_db"]) >= targets["min_headroom_db"]
    )
    variable_count = len(bounds) // 6
    if not constraints_met and variable_count <= 5 and max_steps >= 6 and time.perf_counter() < deadline:
        try:
            def global_callback(vector: np.ndarray, _convergence: float) -> bool:
                record_frame(vector, f"全局优化 {len(optimization_history)}")
                if vector_is_feasible(vector):
                    raise FeasibleSolutionFound(clipped_vector(vector))
                return False

            global_result = differential_evolution(
                objective,
                bounds=bounds,
                init="latinhypercube",
                maxiter=max(2, max_steps // 4),
                popsize=2,
                tol=0.03,
                polish=False,
                seed=17,
                workers=1,
                updating="immediate",
                callback=global_callback,
            )
            if vector_is_feasible(global_result.x):
                best_vector = clipped_vector(global_result.x)
                record_frame(best_vector, "达到国标，停止优化", force=True)
            elif np.isfinite(global_result.fun) and global_result.fun < best_value:
                best_vector = clipped_vector(global_result.x)
        except FeasibleSolutionFound as found:
            best_vector = clipped_vector(found.vector)
            record_frame(best_vector, "达到国标，停止优化", force=True)
        except OptimizationTimeBudgetExceeded:
            pass
    optimized_vector = best_vector
    optimized = unpack(optimized_vector)
    optimized_gains = unpack_gains(optimized_vector)
    optimized_speakers = [
        Speaker(
            speaker.model,
            speaker.position,
            speaker.aim,
            speaker.layout_role,
            float(optimized_gains[idx]),
            source_item_id=speaker.source_item_id,
            source_row_index=speaker.source_row_index,
            source_name=speaker.source_name,
            source_type=speaker.source_type,
            source_unit_index=speaker.source_unit_index,
            source_label=speaker.source_label,
        )
        for idx, speaker in enumerate(optimized)
    ]
    if not optimization_history or not optimization_history[-1]["metrics"]["feasible"]:
        record_frame(optimized_vector, "位置与指向优化完成", force=True)
    return optimized_speakers, optimization_history


def generate_fixed_plan_candidates(units: list[dict], product_map: dict[str, Product], config: dict) -> list[tuple[str, list[Speaker]]]:
    room = config["room"]
    area = config["listener_area"]
    lx, ly, lz = room["length_m"], room["width_m"], room["height_m"]
    z_wall = min(lz - 0.35, max(2.1, lz * 0.72))
    z_ceiling = max(area["ear_height_m"] + 0.8, lz - 0.35)
    ceiling_units = [
        unit
        for unit in units
        if "ceiling" in product_map[unit["model"]].model.lower()
        or product_map[unit["model"]].coverage_v_deg >= 95
        and product_map[unit["model"]].continuous_spl_db <= 110
    ]
    ceiling_ids = {id(unit) for unit in ceiling_units}
    wall_units = [unit for unit in units if id(unit) not in ceiling_ids]
    candidates: list[tuple[str, list[Speaker]]] = []
    wall_modes = ("xy_symmetric", "front_distributed", "uniform", "side_distributed_mid", "side_distributed_rear")
    ceiling_modes = ("xy_symmetric", "balanced", "uniform", "mid", "rear", "front")
    seen = set()
    for wall_mode in wall_modes:
        wall_speakers = fixed_wall_speakers(wall_units, wall_mode, lx, ly, z_wall, area)
        for ceiling_mode in ceiling_modes:
            ceiling_speakers = fixed_ceiling_speakers(ceiling_units, z_ceiling, lx, ly, area, ceiling_mode)
            speakers = [*wall_speakers, *ceiling_speakers]
            if not speakers:
                continue
            signature = tuple((speaker.model, tuple(round(v, 3) for v in speaker.position)) for speaker in speakers)
            if signature in seen:
                continue
            seen.add(signature)
            candidates.append((f"fixed_{wall_mode}_{ceiling_mode}_{len(speakers)}", speakers))
    return candidates


def make_fixed_speaker(unit: dict, position: tuple[float, float, float], aim: tuple[float, float, float], role: str) -> Speaker:
    return Speaker(
        unit["model"],
        position,
        aim,
        role,
        source_item_id=unit.get("source_item_id"),
        source_row_index=unit.get("source_row_index"),
        source_name=unit.get("source_name"),
        source_type=unit.get("source_type"),
        source_unit_index=unit.get("source_unit_index"),
        source_label=unit.get("source_label"),
    )


def symmetric_slots_1d(count: int, start: float, end: float) -> list[float]:
    if count <= 0:
        return []
    if count == 1 or abs(end - start) < 1.0e-6:
        return [(start + end) / 2]
    center = (start + end) / 2
    half = (end - start) / 2
    slots: list[float] = []
    if count % 2 == 1:
        slots.append(center)
    pair_count = count // 2
    for idx in range(pair_count):
        ratio = 1.0 if pair_count == 1 else 1.0 - idx / pair_count
        offset = half * ratio
        slots.extend([center - offset, center + offset])
    return slots[:count]


def group_units_for_symmetry(units: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    order: list[str] = []
    for unit in units:
        model = unit["model"]
        if model not in grouped:
            grouped[model] = []
            order.append(model)
        grouped[model].append(unit)
    ordered: list[dict] = []
    for model in order:
        ordered.extend(grouped[model])
    return ordered


def xy_symmetric_slots(count: int, lx: float, ly: float, area: dict) -> list[tuple[float, float]]:
    if count <= 0:
        return []
    center_x = lx / 2.0
    center_y = ly / 2.0
    max_dx = max(0.5, min(center_x - 0.5, (area["x_max_m"] - area["x_min_m"]) * 0.36))
    max_dy = max(0.5, min(center_y - 0.5, (area["y_max_m"] - area["y_min_m"]) * 0.36))
    slots: list[tuple[float, float]] = []
    remaining = count
    orbit_index = 0
    while remaining >= 4:
        scale = max(0.45, 1.0 - orbit_index * 0.22)
        dx = max_dx * scale
        dy = max_dy * scale
        slots.extend([
            (center_x - dx, center_y - dy),
            (center_x - dx, center_y + dy),
            (center_x + dx, center_y - dy),
            (center_x + dx, center_y + dy),
        ])
        remaining -= 4
        orbit_index += 1
    if remaining >= 2:
        dx = max_dx * max(0.4, 0.72 - orbit_index * 0.18)
        slots.extend([
            (center_x - dx, center_y),
            (center_x + dx, center_y),
        ])
        remaining -= 2
    if remaining == 1:
        slots.append((center_x, center_y))
    return slots[:count]


def fixed_wall_speakers(units: list[dict], mode: str, lx: float, ly: float, z: float, area: dict) -> list[Speaker]:
    if not units:
        return []
    units = group_units_for_symmetry(units)
    speakers: list[Speaker] = []
    ear = area["ear_height_m"]
    indoor_target = ((area["x_min_m"] + area["x_max_m"]) / 2, ly / 2, ear)
    rear_target = (0.72 * lx, ly / 2, ear)
    center_target = (0.55 * lx, ly / 2, ear)

    if mode == "xy_symmetric":
        slots = xy_symmetric_slots(len(units), lx, ly, area)
        target = (lx / 2, ly / 2, ear)
        return [
            make_fixed_speaker(unit, (float(x), float(y), z), target, f"xy_symmetric_{idx}")
            for idx, (unit, (x, y)) in enumerate(zip(units, slots), 1)
        ]

    if mode == "uniform":
        paired_units = list(units)
        if len(paired_units) % 2 == 1:
            center_unit = paired_units.pop(0)
            speakers.append(make_fixed_speaker(center_unit, (0.35, ly / 2, z), indoor_target, "screen_main_center"))
        pair_count = len(paired_units) // 2
        if pair_count <= 0:
            return speakers
        x_start = max(0.8, area["x_min_m"])
        x_end = min(lx - 0.8, area["x_max_m"])
        if pair_count == 1:
            xs = [(x_start + x_end) / 2]
        else:
            xs = np.linspace(x_start, x_end, pair_count).round(6).tolist()
        for pair_idx in range(pair_count):
            left_unit = paired_units[pair_idx * 2]
            right_unit = paired_units[pair_idx * 2 + 1]
            x = float(xs[pair_idx])
            speakers.append(make_fixed_speaker(left_unit, (x, 0.25, z), (x, ly / 2, ear), f"side_left_zone_{pair_idx + 1}"))
            speakers.append(make_fixed_speaker(right_unit, (x, ly - 0.25, z), (x, ly / 2, ear), f"side_right_zone_{pair_idx + 1}"))
        return speakers

    if mode == "front_distributed":
        ys = symmetric_slots_1d(len(units), max(0.6, ly * 0.18), min(ly - 0.6, ly * 0.82))
        for idx, (unit, y) in enumerate(zip(units, ys), 1):
            speakers.append(make_fixed_speaker(unit, (0.35, float(y), z), rear_target, f"front_zone_{idx}"))
        return speakers

    if mode.startswith("side_distributed"):
        paired_units = list(units)
        if len(paired_units) % 2 == 1:
            center_unit = paired_units.pop(0)
            speakers.append(make_fixed_speaker(center_unit, (0.35, ly / 2, z), center_target, "screen_main_center"))
        pair_count = max(1, int(math.ceil(len(paired_units) / 2)))
        x_start = max(0.8, lx * 0.12)
        x_end = min(lx - 0.8, lx * 0.88)
        if pair_count == 1:
            mode_focus = mode.rsplit("_", 1)[-1]
            focus_ratio = {"front": 0.32, "mid": 0.5, "rear": 0.68}.get(mode_focus, 0.5)
            xs = [x_start + (x_end - x_start) * focus_ratio]
        else:
            xs = symmetric_slots_1d(pair_count, x_start, x_end)
        for idx, unit in enumerate(paired_units):
            x = float(xs[min(idx // 2, len(xs) - 1)])
            is_left = idx % 2 == 0
            y = 0.25 if is_left else ly - 0.25
            target_y = ly * 0.58 if is_left else ly * 0.42
            speakers.append(make_fixed_speaker(unit, (x, y, z), (x, target_y, ear), f"side_{'left' if is_left else 'right'}_zone_{idx // 2 + 1}"))
        return speakers

    remaining = list(units)
    if len(remaining) == 1:
        speakers.append(make_fixed_speaker(remaining.pop(0), (0.35, ly / 2, z), center_target, "screen_main_center"))
    else:
        sep = min(ly - 1.0, ly * 0.72)
        y0, y1 = ly / 2 - sep / 2, ly / 2 + sep / 2
        speakers.append(make_fixed_speaker(remaining.pop(0), (0.35, y0, z), rear_target, "screen_main_left"))
        speakers.append(make_fixed_speaker(remaining.pop(0), (0.35, y1, z), rear_target, "screen_main_right"))
    if remaining:
        side = fixed_wall_speakers(remaining, "side_distributed", lx, ly, z, area)
        speakers.extend(side)
    return speakers


def fixed_ceiling_speakers(units: list[dict], z: float, lx: float, ly: float, area: dict, mode: str = "spread") -> list[Speaker]:
    if not units:
        return []
    units = group_units_for_symmetry(units)
    count = len(units)
    x_margin = max(area["x_min_m"], lx - area["x_max_m"])
    y_margin = max(area["y_min_m"], ly - area["y_max_m"])
    x_min = min(lx / 2, x_margin)
    x_max = max(lx / 2, lx - x_margin)
    y_min = min(ly / 2, y_margin)
    y_max = max(ly / 2, ly - y_margin)
    center_y = ly / 2
    if mode == "xy_symmetric":
        slots = xy_symmetric_slots(count, lx, ly, area)
        speakers: list[Speaker] = []
        for idx, (unit, slot) in enumerate(zip(units, slots), 1):
            x, y = float(slot[0]), float(slot[1])
            speakers.append(
                make_fixed_speaker(
                    unit,
                    (x, y, z),
                    (x, y, area["ear_height_m"]),
                    f"ceiling_zone_{idx}",
                )
            )
        return speakers

    if mode == "uniform":
        pair_count = count // 2
        x_start = min(lx - 0.8, max(0.8, area["x_min_m"]))
        x_end = max(0.8, min(lx - 0.8, area["x_max_m"]))
        y_offset = max(0.6, min(center_y - y_min, y_max - center_y) * 0.62)
        y_left = center_y - y_offset
        y_right = center_y + y_offset
        if pair_count <= 0:
            x_slots = []
        elif pair_count == 1:
            x_slots = [x_start + (x_end - x_start) * (0.34 if count % 2 == 1 else 0.5)]
        else:
            x_slots = np.linspace(x_start, x_end, pair_count).round(6).tolist()
        slots: list[tuple[float, float]] = []
        if count % 2 == 1:
            single_x = x_start + (x_end - x_start) * (0.68 if pair_count > 0 else 0.5)
            slots.append((single_x, center_y))
        for pair_idx in range(pair_count):
            x = float(x_slots[pair_idx])
            slots.extend([(x, y_left), (x, y_right)])
        speakers: list[Speaker] = []
        for idx, (unit, slot) in enumerate(zip(units, slots), 1):
            x, y = float(slot[0]), float(slot[1])
            speakers.append(make_fixed_speaker(unit, (x, y, z), (x, y, area["ear_height_m"]), f"ceiling_zone_{idx}"))
        return speakers

    y_sep = min(y_max - y_min, max(0.8, (y_max - y_min) * 0.72))
    y_left = center_y - y_sep / 2
    y_right = center_y + y_sep / 2
    pair_count = count // 2
    if pair_count == 1:
        focus_ratio = {"front": 0.28, "mid": 0.50, "rear": 0.72, "spread": 0.28, "balanced": 0.64}.get(mode, 0.5)
        pair_xs = [x_min + (x_max - x_min) * focus_ratio]
    else:
        pair_xs = symmetric_slots_1d(max(1, pair_count), x_min, x_max)
    slots: list[tuple[float, float]] = []
    if count % 2 == 1:
        if pair_count > 0:
            single_ratio = {"front": 0.76, "mid": 0.50, "rear": 0.24, "spread": 0.76, "balanced": 0.38}.get(mode, 0.5)
            single_x = x_min + (x_max - x_min) * single_ratio
        else:
            single_x = lx / 2
        slots.append((single_x, center_y))
    for pair_idx in range(pair_count):
        x = pair_xs[min(pair_idx, len(pair_xs) - 1)]
        slots.extend([(x, y_left), (x, y_right)])
    speakers: list[Speaker] = []
    for idx, (unit, slot) in enumerate(zip(units, slots), 1):
        x, y = float(slot[0]), float(slot[1])
        target = (x, y, area["ear_height_m"])
        speakers.append(make_fixed_speaker(unit, (x, y, z), target, f"ceiling_zone_{idx}"))
    return speakers


def preview_room(payload: dict) -> dict:
    config = build_config(payload)
    xs, ys, receivers, _grid_indices = build_receiver_grid(config)
    return {
        "config": config,
        "receivers": receivers.round(6).tolist(),
        "grid": {
            "xs": xs,
            "ys": ys,
        },
    }


def stage_eval_limit(stage_name: str, is_irregular: bool) -> int:
    if not is_irregular:
        return 10_000
    if stage_name == "screen_plus_side":
        return 360
    if stage_name == "screen_plus_ceiling":
        return 120
    return 10_000


def generate_dense_fill_candidates(catalog_items: list[dict], config: dict) -> list[tuple[str, list[Speaker]]]:
    room = config["room"]
    area = config["listener_area"]
    lx, ly, lz = room["length_m"], room["width_m"], room["height_m"]
    polygon = config.get("geometry", {}).get("polygon")
    z_wall = min(lz - 0.35, max(2.1, lz * 0.72))
    z_ceiling = max(area["ear_height_m"] + 0.8, lz - 0.35)
    mains = sorted(
        [item for item in catalog_items if item["role"] in {"main", "main_speech"}],
        key=lambda item: (
            0 if item["role"] == "main_speech" else 1,
            item["price"] / max(item["continuous_spl_db"] - 90.0, 1.0),
        ),
    )
    ceilings = sorted(
        [item for item in catalog_items if item["category"] == "ceiling"],
        key=lambda item: item["price"] / max(item["continuous_spl_db"] - 80.0, 1.0),
    )
    if not ceilings:
        return []

    base_mains: list[tuple[str, list[Speaker]]] = [("no_wall_main", [])]
    if mains:
        targets = screen_wall_targets(lx, ly, area)
        main_layouts = front_main_layouts(mains[0]["model"], lx, ly, z_wall, 0.35, targets, polygon)
        base_mains = [
            (name, speakers)
            for name, speakers in main_layouts
            if "_sep_0.72_" in name and "_aim_rear_mid" in name
        ][:1] or main_layouts[:1] or base_mains

    candidates = []
    for ceiling in ceilings[:1]:
        for spacing in dense_fill_spacings(lx, ly):
            ceiling_name, ceiling_speakers = dense_ceiling_layout(ceiling["model"], spacing, z_ceiling, area, polygon)
            if not ceiling_speakers:
                continue
            candidates.append((ceiling_name, ceiling_speakers))
            for main_name, main_speakers in base_mains:
                if main_speakers:
                    candidates.append((f"{main_name}_plus_{ceiling_name}", main_speakers + ceiling_speakers))
    return candidates


def dense_fill_spacings(lx: float, ly: float) -> list[float]:
    longest = max(lx, ly)
    spacings = [3.0, 2.4, 2.0, 1.6, 1.3, 1.1, 0.9]
    if longest > 28:
        spacings.insert(0, 3.6)
    return spacings


def dense_ceiling_layout(model: str, spacing: float, z: float, area: dict, polygon=None) -> tuple[str, list[Speaker]]:
    x_min, x_max = area["x_min_m"], area["x_max_m"]
    y_min, y_max = area["y_min_m"], area["y_max_m"]
    xs = np.arange(x_min, x_max + spacing * 0.5, spacing)
    ys = np.arange(y_min, y_max + spacing * 0.5, spacing)
    speakers = []
    for col_idx, x in enumerate(xs, 1):
        for row_idx, y in enumerate(ys, 1):
            if polygon and not point_in_polygon(float(x), float(y), polygon):
                continue
            target = (float(x), float(y), area["ear_height_m"])
            speakers.append(Speaker(model, (float(x), float(y), z), target, f"ceiling_dense_{col_idx}_{row_idx}"))
    return f"{len(speakers)}_dense_ceiling_{model}_{spacing:.1f}m", speakers


def generate_candidate_stages(catalog_items: list[dict], config: dict) -> list[tuple[str, list[tuple[str, list[Speaker]]]]]:
    room = config["room"]
    area = config["listener_area"]
    lx, ly, lz = room["length_m"], room["width_m"], room["height_m"]
    max_speakers = int(config["optimization"]["max_speakers"])
    z_wall = min(lz - 0.35, max(2.1, lz * 0.72))
    z_ceiling = max(area["ear_height_m"] + 0.8, lz - 0.35)
    front_x = 0.35
    side_y0 = 0.25
    side_y1 = ly - 0.25
    screen_targets = screen_wall_targets(lx, ly, area)
    polygon = config.get("geometry", {}).get("polygon")

    by_model = {item["model"]: item for item in catalog_items}
    mains = sorted(
        [item for item in catalog_items if item["role"] in {"main", "main_speech"}],
        key=lambda item: (
            0 if item["role"] == "main_speech" else 1,
            item["price"] / max(item["continuous_spl_db"] - 90.0, 1.0),
        ),
    )
    side_fills = [item for item in catalog_items if item["role"] in {"speech_fill", "main_speech", "main"}]
    ceilings = [item for item in catalog_items if item["category"] == "ceiling"]
    max_side_pairs = max(1, min(28 if polygon else 10, (max_speakers - 2) // 2))
    side_pair_counts = progressive_pair_counts(max_side_pairs)
    ceiling_counts = progressive_ceiling_counts(max_speakers)

    stages: list[tuple[str, list[tuple[str, list[Speaker]]]]] = []
    screen_main: list[tuple[str, list[Speaker]]] = []
    side_upgrade: list[tuple[str, list[Speaker]]] = []
    ceiling_upgrade: list[tuple[str, list[Speaker]]] = []
    ceiling_fallback: list[tuple[str, list[Speaker]]] = []

    # Preferred meeting-room skeleton: screen-wall left/right mains.
    for main in mains:
        for main_pair_name, main_pair in front_main_layouts(main["model"], lx, ly, z_wall, front_x, screen_targets, polygon):
            screen_main.append((main_pair_name, main_pair))
            is_side_seed = "_sep_0.72_" in main_pair_name and (
                "_aim_far_mid" in main_pair_name or "_aim_rear_mid" in main_pair_name
            )
            if not is_side_seed:
                continue

            # Upgrade path: add symmetric side fills before considering ceiling fills.
            for fill in side_fill_pool(side_fills):
                for pair_count in side_pair_counts:
                    for aim_mode in side_aim_modes(pair_count):
                        side_name, side_speakers = side_fill_layout(fill["model"], pair_count, lx, ly, z_wall, side_y0, side_y1, area, aim_mode, polygon)
                        speakers = main_pair + side_speakers
                        if len(speakers) <= max_speakers:
                            side_upgrade.append((f"{main_pair_name}_plus_{side_name}", speakers))

            # Last resort for low, wide rooms: screen mains plus ceiling fills.
            for ceiling in ceilings:
                for row_count, col_count in ceiling_grid_shapes(max_speakers - 2, lx, ly):
                    if row_count * col_count not in ceiling_counts:
                        continue
                    fill = ceiling_grid_layout(ceiling["model"], row_count, col_count, z_ceiling, area, polygon)[1]
                    speakers = main_pair + fill
                    if len(speakers) <= max_speakers:
                        ceiling_upgrade.append((f"{main_pair_name}_plus_{ceiling['model']}_{col_count}x{row_count}", speakers))

    # Pure ceiling grid is a fallback for spaces where wall-mounted schemes cannot satisfy uniformity.
    for ceiling in ceilings:
        for row_count, col_count in ceiling_grid_shapes(max_speakers, lx, ly):
            if row_count * col_count in ceiling_counts:
                ceiling_fallback.append(ceiling_grid_layout(ceiling["model"], row_count, col_count, z_ceiling, area, polygon))

    for stage_name, candidates in (
        ("screen_main", screen_main),
        ("screen_plus_side", side_upgrade),
        ("screen_plus_ceiling", ceiling_upgrade),
        ("ceiling_fallback", ceiling_fallback),
    ):
        unique: dict[str, tuple[str, list[Speaker]]] = {}
        for name, speakers in candidates:
            if speakers and all(speaker.model in by_model for speaker in speakers):
                unique.setdefault(name, (name, speakers))
        if unique:
            stages.append((stage_name, list(unique.values())))
    return stages


def side_fill_pool(items: list[dict]) -> list[dict]:
    role_rank = {"main_speech": 0, "speech_fill": 1, "main": 2}
    pool = [
        item
        for item in items
        if item["role"] in role_rank and item["category"] != "ceiling"
    ]
    return sorted(
        pool,
        key=lambda item: (
            role_rank.get(item["role"], 9),
            item["price"] / max(item["continuous_spl_db"] - 90.0, 1.0),
            -item["coverage_h_deg"],
        ),
    )[:6]


def progressive_pair_counts(max_pairs: int) -> list[int]:
    if max_pairs <= 1:
        return [1]
    counts = {1, 2, max_pairs}
    if max_pairs >= 4:
        counts.add(4)
    if max_pairs >= 8:
        counts.add(8)
    if max_pairs >= 12:
        counts.add(12)
    if max_pairs >= 18:
        counts.add(18)
    if max_pairs >= 24:
        counts.add(24)
    return sorted(count for count in counts if 1 <= count <= max_pairs)


def progressive_ceiling_counts(max_speakers: int) -> set[int]:
    base = {4, 6, 8, 12, 16, 20, 24, 30, 36, 42, 48, 54, 60, 72, 80, 96}
    return {count for count in base if count <= max_speakers}


def side_aim_modes(pair_count: int) -> tuple[str, ...]:
    if pair_count <= 2:
        return ("center", "cross")
    return ("center",)


def screen_wall_targets(lx: float, ly: float, area: dict) -> list[tuple[str, tuple[float, float, float]]]:
    ear = area["ear_height_m"]
    return [
        ("far_mid", (0.62 * lx, ly / 2, ear)),
        ("rear_mid", (0.78 * lx, ly / 2, ear)),
        ("wide_mid", (0.58 * lx, ly / 2, ear)),
    ]


def front_main_layouts(model: str, lx: float, ly: float, z: float, front_x: float, targets: list[tuple[str, tuple[float, float, float]]], polygon=None) -> list[tuple[str, list[Speaker]]]:
    layouts = []
    for sep_ratio in (0.55, 0.72):
        sep = min(ly - 1.0, ly * sep_ratio)
        y0, y1 = ly / 2 - sep / 2, ly / 2 + sep / 2
        if polygon:
            bounds = polygon_y_bounds_at_x(front_x, polygon)
            if not bounds:
                continue
            y_min, y_max = bounds
            y0 = max(y_min + 0.35, min(y0, y_max - 0.35))
            y1 = max(y_min + 0.35, min(y1, y_max - 0.35))
            if y1 <= y0:
                continue
        for target_name, target in targets:
            left_target = target
            right_target = (target[0], ly - target[1], target[2])
            layouts.append(
                (
                    f"screen_main_{model}_sep_{sep_ratio:.2f}_aim_{target_name}",
                    [
                        Speaker(model, (front_x, y0, z), left_target, "screen_main_left"),
                        Speaker(model, (front_x, y1, z), right_target, "screen_main_right"),
                    ],
                )
            )
    return layouts


def side_fill_layout(model: str, pair_count: int, lx: float, ly: float, z: float, side_y0: float, side_y1: float, area: dict, aim_mode: str, polygon=None) -> tuple[str, list[Speaker]]:
    speakers = []
    ratios = np.linspace(0.16, 0.92, pair_count)
    for pair_idx, ratio in enumerate(ratios, 1):
        x = lx * float(ratio)
        y_left, y_right = side_y0, side_y1
        if polygon:
            bounds = polygon_y_bounds_at_x(x, polygon)
            if not bounds:
                continue
            y_min, y_max = bounds
            if y_max - y_min < 0.8:
                continue
            y_left, y_right = y_min + 0.25, y_max - 0.25
        if aim_mode == "cross":
            left_target = (min(area["x_max_m"], x + 0.08 * lx), ly * 0.62, area["ear_height_m"])
            right_target = (min(area["x_max_m"], x + 0.08 * lx), ly * 0.38, area["ear_height_m"])
        else:
            left_target = (x, ly / 2, area["ear_height_m"])
            right_target = left_target
        speakers.append(Speaker(model, (x, y_left, z), left_target, f"side_left_zone_{pair_idx}"))
        speakers.append(Speaker(model, (x, y_right, z), right_target, f"side_right_zone_{pair_idx}"))
    return f"{len(speakers)}_side_fill_{model}_{pair_count}_pairs_aim_{aim_mode}", speakers


def ceiling_grid_shapes(max_speakers: int, lx: float, ly: float) -> list[tuple[int, int]]:
    shapes = []
    if max_speakers < 4:
        return shapes
    max_rows = 8 if max_speakers > 60 else 4
    for rows in range(2, max_rows + 1):
        max_cols = max_speakers // rows
        for cols in range(2, max_cols + 1):
            count = rows * cols
            if count > max_speakers:
                continue
            ratio = (cols / rows) / max(lx / ly, 0.1)
            if 0.35 <= ratio <= 2.4:
                shapes.append((rows, cols))
    return sorted(set(shapes), key=lambda item: (item[0] * item[1], item[1]))


def ceiling_grid_layout(model: str, row_count: int, col_count: int, z: float, area: dict, polygon=None) -> tuple[str, list[Speaker]]:
    xs = np.linspace(area["x_min_m"], area["x_max_m"], col_count)
    ys = np.linspace(area["y_min_m"], area["y_max_m"], row_count)
    speakers = []
    for col_idx, x in enumerate(xs, 1):
        for row_idx, y in enumerate(ys, 1):
            if polygon and not point_in_polygon(float(x), float(y), polygon):
                continue
            target = (float(x), float(y), area["ear_height_m"])
            speakers.append(Speaker(model, (float(x), float(y), z), target, f"ceiling_col_{col_idx}_row_{row_idx}"))
    return f"{len(speakers)}_ceiling_{model}_{col_count}x{row_count}", speakers


def polygon_y_bounds_at_x(x: float, polygon: list[list[float]] | list[tuple[float, float]]) -> tuple[float, float] | None:
    intersections = []
    count = len(polygon)
    for idx in range(count):
        x0, y0 = polygon[idx]
        x1, y1 = polygon[(idx + 1) % count]
        if abs(x1 - x0) < 1.0e-9:
            if abs(x - x0) < 1.0e-6:
                intersections.extend([y0, y1])
            continue
        if min(x0, x1) <= x <= max(x0, x1):
            ratio = (x - x0) / (x1 - x0)
            if 0.0 <= ratio <= 1.0:
                intersections.append(y0 + ratio * (y1 - y0))
    unique = sorted({round(value, 6) for value in intersections})
    if len(unique) < 2:
        return None
    return float(unique[0]), float(unique[-1])


def layout_name(speakers: list[Speaker]) -> str:
    return f"{speakers[0].model}_{'_'.join(speaker.layout_role for speaker in speakers)}"


def evaluate_mixed_layout(
    layout_name: str,
    speakers: list[Speaker],
    product_map: dict[str, Product],
    config: dict,
    receivers: np.ndarray,
) -> tuple[CandidateResult, np.ndarray]:
    targets = config["targets"]
    opt = config["optimization"]
    base_spl = np.zeros((len(speakers), len(receivers)), dtype=float)
    losses = []
    for speaker_idx, speaker in enumerate(speakers):
        product = product_map[speaker.model]
        for receiver_idx, receiver in enumerate(receivers):
            pos = np.asarray(speaker.position)
            dist = max(float(np.linalg.norm(receiver - pos)), 1.0)
            loss = angular_loss_db(speaker, receiver, product)
            losses.append(loss)
            base_spl[speaker_idx, receiver_idx] = product.continuous_spl_db - 20.0 * np.log10(dist) - loss

    max_gain_boost = min(
        max(0.0, product_map[speaker.model].peak_spl_db - product_map[speaker.model].continuous_spl_db)
        for speaker in speakers
    )
    gain_max = min(6.0, max_gain_boost)
    gain_vectors = optimize_individual_gains(
        base_spl,
        targets,
        gain_max,
        initial_gains=tuple(float(speaker.gain_db) for speaker in speakers),
    )

    best_score = None
    best_field = None
    best_gains = None
    for gains in gain_vectors:
        shifted = base_spl + np.asarray(gains)[:, None]
        field = 10.0 * np.log10(np.sum(10.0 ** (shifted / 10.0), axis=0) + EPS)
        min_spl = float(np.min(field))
        max_spl = float(np.max(field))
        nonuniformity = max_spl - min_spl
        headroom = min_spl - targets["min_spl_db"]
        violation = (
            max(0.0, targets["min_spl_db"] - min_spl) * 4.0
            + max(0.0, nonuniformity - targets["max_nonuniformity_db"]) * 3.0
            + max(0.0, targets["min_headroom_db"] - headroom) * 2.0
        )
        score = (violation, nonuniformity, max(0.0, max_spl - targets["min_spl_db"]), -headroom)
        if best_score is None or score < best_score:
            best_score = score
            best_field = field
            best_gains = gains

    assert best_field is not None
    assert best_gains is not None
    speakers_with_gain = [
        Speaker(
            speaker.model,
            speaker.position,
            speaker.aim,
            speaker.layout_role,
            float(gain),
            source_item_id=speaker.source_item_id,
            source_row_index=speaker.source_row_index,
            source_name=speaker.source_name,
            source_type=speaker.source_type,
            source_unit_index=speaker.source_unit_index,
            source_label=speaker.source_label,
        )
        for speaker, gain in zip(speakers, best_gains)
    ]
    min_spl = float(np.min(best_field))
    max_spl = float(np.max(best_field))
    avg_spl = float(10.0 * np.log10(np.mean(10.0 ** (best_field / 10.0)) + EPS))
    nonuniformity = max_spl - min_spl
    headroom = min_spl - targets["min_spl_db"]
    failures = []
    if min_spl < targets["min_spl_db"]:
        failures.append(f"最低声压级不足 {targets['min_spl_db']:.1f} dB")
    if nonuniformity > targets["max_nonuniformity_db"]:
        failures.append(f"声场不均匀度超过 {targets['max_nonuniformity_db']:.1f} dB")
    if headroom < targets["min_headroom_db"]:
        failures.append(f"最低点余量低于 {targets['min_headroom_db']:.1f} dB")
        if best_gains and all(gain >= gain_max - 1.0e-3 for gain in best_gains):
            failures.append("全部音箱增益已达当前型号峰值上限")

    product_cost = sum(product_map[speaker.model].price for speaker in speakers)
    install_cost = opt["installation_cost_per_speaker"] * len(speakers)
    dsp_cost = opt["dsp_cost_if_more_than_two_speakers"] if len(speakers) > 2 else 0.0
    models = "+".join(sorted({speaker.model for speaker in speakers}))
    result = CandidateResult(
        feasible=not failures,
        total_cost=product_cost + install_cost + dsp_cost,
        product_cost=product_cost,
        install_cost=install_cost,
        dsp_cost=dsp_cost,
        model=models,
        layout=layout_name,
        speaker_count=len(speakers),
        min_spl_db=min_spl,
        avg_spl_db=avg_spl,
        max_spl_db=max_spl,
        nonuniformity_db=nonuniformity,
        headroom_db=headroom,
        coverage_loss_db_p95=float(np.percentile(losses, 95)),
        reason="达标" if not failures else "；".join(failures),
        speakers=speakers_with_gain,
    )
    return result, best_field


def optimize_pair_gains_fast(base_spl: np.ndarray, targets: dict) -> list[tuple[float, ...]]:
    count = base_spl.shape[0]
    pair_count = max(1, count // 2)
    gain_grid = np.arange(-30.0, 0.1, 1.5)
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

    for _ in range(3):
        improved = False
        for pair_idx in range(pair_count):
            first = 2 * pair_idx
            second = min(first + 1, count - 1)
            best_gain = gains[first]
            best_score = score_for(gains)
            for gain in gain_grid:
                trial = gains.copy()
                trial[first] = gain
                trial[second] = gain
                trial_score = score_for(trial)
                if trial_score < best_score:
                    best_score = trial_score
                    best_gain = gain
            if best_gain != gains[first]:
                gains[first] = best_gain
                gains[second] = best_gain
                improved = True
        if not improved:
            break

    equal_gains = [tuple(float(gain) for _ in range(count)) for gain in (-24.0, -18.0, -12.0, -6.0, -3.0, 0.0)]
    return [tuple(float(value) for value in gains), *equal_gains]


def optimize_individual_gains(
    base_spl: np.ndarray,
    targets: dict,
    max_gain: float,
    initial_gains: tuple[float, ...] | None = None,
) -> list[tuple[float, ...]]:
    count = base_spl.shape[0]
    gain_grid = np.arange(-18.0, max_gain + 0.01, 1.5)
    if initial_gains and len(initial_gains) == count:
        gains = np.asarray([min(max_gain, max(-18.0, value)) for value in initial_gains], dtype=float)
    else:
        gains = np.full(count, min(max_gain, 0.0), dtype=float)

    def score_for(candidate_gains: np.ndarray) -> tuple[float, float, float, float]:
        shifted = base_spl + candidate_gains[:, None]
        combined = 10.0 * np.log10(np.sum(10.0 ** (shifted / 10.0), axis=0) + EPS)
        min_spl = float(np.min(combined))
        max_spl = float(np.max(combined))
        nonuniformity = max_spl - min_spl
        headroom = min_spl - targets["min_spl_db"]
        standard_penalty = (
            max(0.0, targets["min_spl_db"] - min_spl) * 40.0
            + max(0.0, nonuniformity - targets["max_nonuniformity_db"]) * 32.0
            + max(0.0, targets["min_headroom_db"] - headroom) * 16.0
        )
        return standard_penalty, nonuniformity, -min_spl, -headroom

    for _ in range(6):
        improved = False
        for idx in range(count):
            best_gain = gains[idx]
            best_score = score_for(gains)
            for gain in gain_grid:
                trial = gains.copy()
                trial[idx] = float(gain)
                trial_score = score_for(trial)
                if trial_score < best_score:
                    best_score = trial_score
                    best_gain = float(gain)
            if best_gain != gains[idx]:
                gains[idx] = best_gain
                improved = True
        if not improved:
            break

    equal_gains = [tuple(float(gain) for _ in range(count)) for gain in (-12.0, -6.0, 0.0, max_gain)]
    candidates = [tuple(float(value) for value in gains), *equal_gains]
    if initial_gains and len(initial_gains) == count:
        candidates.insert(0, tuple(float(min(max_gain, max(-18.0, value))) for value in initial_gains))
    return candidates


def violation_score(result, config: dict) -> tuple[float, float]:
    targets = config["targets"]
    score = (
        max(0.0, targets["min_spl_db"] - result.min_spl_db) * 4.0
        + max(0.0, result.nonuniformity_db - targets["max_nonuniformity_db"]) * 3.0
        + max(0.0, targets["min_headroom_db"] - result.headroom_db) * 2.0
    )
    return score, result.total_cost


def pick_display_candidates(results: list[CandidateResult], limit: int) -> list[CandidateResult]:
    selected = list(results[: min(4, limit)])
    selected_keys = {(item.model, item.layout) for item in selected}
    covered_models = set()
    for item in selected:
        covered_models.update(item.model.split("+"))

    for item in results:
        models = set(item.model.split("+"))
        key = (item.model, item.layout)
        if key in selected_keys or models <= covered_models:
            continue
        selected.append(item)
        selected_keys.add(key)
        covered_models.update(models)
        if len(selected) >= limit:
            return selected

    for item in results:
        key = (item.model, item.layout)
        if key in selected_keys:
            continue
        selected.append(item)
        selected_keys.add(key)
        if len(selected) >= limit:
            break
    return selected[:limit]


def priority_penalty(result) -> int:
    layout = result.layout
    if layout.startswith("screen_main") and "_plus_" not in layout:
        return 0
    if "_plus_" in layout and "side_fill" in layout:
        return 1
    if "_plus_" in layout:
        return 2
    return 3


def result_order_key(result) -> tuple[int, int, float, float, float]:
    return (
        0 if result.feasible else 1,
        priority_penalty(result),
        result.total_cost,
        result.nonuniformity_db,
        -result.headroom_db,
    )


def serialize_speakers(speakers: list[Speaker]) -> list[dict]:
    return [
        {
            "model": speaker.model,
            "position": speaker.position,
            "aim": speaker.aim,
            "role": speaker.layout_role,
            "gainDb": speaker.gain_db,
            "yawDeg": speaker_angles(speaker)[0],
            "pitchDeg": speaker_angles(speaker)[1],
            "sourceItemId": speaker.source_item_id,
            "sourceRowIndex": speaker.source_row_index,
            "sourceName": speaker.source_name,
            "sourceType": speaker.source_type,
            "sourceUnitIndex": speaker.source_unit_index,
            "sourceLabel": speaker.source_label,
        }
        for speaker in speakers
    ]


def build_optimization_frame(
    result: CandidateResult,
    field: np.ndarray,
    xs: list[float],
    ys: list[float],
    grid_indices: list[tuple[int, int]],
    label: str,
    index: int,
) -> dict:
    return {
        "index": index,
        "label": label,
        "metrics": {
            "feasible": result.feasible,
            "minSpl": result.min_spl_db,
            "avgSpl": result.avg_spl_db,
            "maxSpl": result.max_spl_db,
            "nonuniformity": result.nonuniformity_db,
            "headroom": result.headroom_db,
            "reason": result.reason,
        },
        "speakers": serialize_speakers(result.speakers),
        "grid": {
            "xs": xs,
            "ys": ys,
            "field": field_to_grid(field, xs, ys, grid_indices),
        },
    }


def serialize_result(result, include_speakers: bool = True, field: list[list[float]] | None = None) -> dict:
    data = {
        "feasible": result.feasible,
        "totalCost": result.total_cost,
        "productCost": result.product_cost,
        "installCost": result.install_cost,
        "dspCost": result.dsp_cost,
        "model": result.model,
        "layout": result.layout,
        "speakerCount": result.speaker_count,
        "minSpl": result.min_spl_db,
        "avgSpl": result.avg_spl_db,
        "maxSpl": result.max_spl_db,
        "nonuniformity": result.nonuniformity_db,
        "headroom": result.headroom_db,
        "reason": result.reason,
    }
    if include_speakers:
        data["speakers"] = serialize_speakers(result.speakers)
    if field is not None:
        data["field"] = field
    return data


def speaker_angles(speaker: Speaker) -> tuple[float, float]:
    pos = np.asarray(speaker.position, dtype=float)
    aim = np.asarray(speaker.aim, dtype=float)
    vec = aim - pos
    yaw = float(np.degrees(np.arctan2(vec[1], vec[0])))
    horizontal = float(np.linalg.norm(vec[:2]))
    pitch = float(np.degrees(np.arctan2(vec[2], horizontal)))
    return round(yaw, 2), round(pitch, 2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/api/products":
            self.send_json({"products": product_payload()})
            return
        super().do_GET()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_POST(self):
        if self.path not in {"/api/optimize", "/api/simulate", "/api/room_preview"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if self.path == "/api/room_preview":
                self.send_json(preview_room(payload))
            else:
                self.send_json(optimize(payload))
        except Exception as exc:  # noqa: BLE001
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    print("Serving optimizer UI at http://127.0.0.1:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
