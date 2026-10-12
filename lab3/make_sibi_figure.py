#!/usr/bin/env python3
"""
Lab 3, Part 2 - the figure for "which district's centroid falls outside it?".

Draws Sibi's boundary with both candidate points on it, so the difference
between Centroids and Point on Surface is visible without opening QGIS. The
QGIS screenshot in the report is still the one that counts; this is the same
finding, at a scale where it can be seen.

    python3 lab3/make_sibi_figure.py
"""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import Point, shape
from shapely.ops import nearest_points

HERE = Path(__file__).resolve().parent
DISTRICTS = HERE / "data" / "districts.geojson"
OUT = HERE / "Report" / "checkpoint2_sibi_centroid_vs_point_on_surface.png"
TARGET = "Sibi"


def main() -> None:
    features = json.loads(DISTRICTS.read_text())["features"]
    feature = next(f for f in features if f["properties"]["district"] == TARGET)
    geom = shape(feature["geometry"])

    centroid = geom.centroid
    xmin, ymin, xmax, ymax = geom.bounds
    candidate = Point((xmin + xmax) / 2, (ymin + ymax) / 2)
    on_surface = candidate if geom.contains(candidate) else nearest_points(candidate, geom)[1]

    fig, ax = plt.subplots(figsize=(9, 8), dpi=140)

    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    for poly in polys:
        xs, ys = poly.exterior.xy
        ax.fill(xs, ys, facecolor="#deebf7", edgecolor="#23373b", linewidth=1.4, zorder=1)

    # the neighbouring district the centroid actually lands in, for context
    point_geom = Point(centroid.x, centroid.y)
    for other in features:
        if other["properties"]["district"] == TARGET:
            continue
        og = shape(other["geometry"])
        if og.contains(point_geom):
            for poly in (og.geoms if og.geom_type == "MultiPolygon" else [og]):
                xs, ys = poly.exterior.xy
                ax.fill(xs, ys, facecolor="#fdd0a2", edgecolor="#c05621",
                        linewidth=1.0, alpha=.7, zorder=0)
            ax.annotate(
                "the centre of mass lands in\n" + other["properties"]["district"],
                xy=(centroid.x, centroid.y), xytext=(centroid.x - 0.62, centroid.y - 0.30),
                fontsize=9, color="#9c4221",
                arrowprops=dict(arrowstyle="->", color="#9c4221", lw=1.1),
                zorder=5)

    ax.plot(*centroid.xy, marker="X", markersize=13, color="#c53030",
            markeredgecolor="white", markeredgewidth=1.2, zorder=4,
            label="Centroids - centre of mass (outside the district)")
    ax.plot(*on_surface.xy, marker="o", markersize=11, color="#2b6cb0",
            markeredgecolor="white", markeredgewidth=1.2, zorder=4,
            label="Point on Surface - inside the district")

    # how far outside, and the shortest way back in
    back = nearest_points(centroid, geom)[1]
    ax.plot([centroid.x, back.x], [centroid.y, back.y], linestyle=":", color="#4a5568",
            linewidth=1.4, zorder=3)
    ax.annotate(f"{centroid.distance(geom.boundary):.4f}° outside the boundary",
                xy=((centroid.x + back.x) / 2, (centroid.y + back.y) / 2),
                xytext=(centroid.x - 0.05, centroid.y + 0.20),
                fontsize=9, color="#4a5568", ha="right",
                arrowprops=dict(arrowstyle="-", color="#4a5568", lw=.8), zorder=5)

    ax.set_title(f"{TARGET}, Balochistan - the one district whose centroid\n"
                 f"falls outside its own boundary (160 districts tested)",
                 fontsize=12)
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    ax.legend(loc="lower right", fontsize=9, framealpha=.95)
    ax.set_aspect(1 / 0.86)          # rough cos(latitude) correction, so the shape is not stretched
    ax.grid(alpha=.15, linewidth=.6)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    OUT.parent.mkdir(exist_ok=True)
    fig.tight_layout()
    fig.savefig(OUT)
    print("wrote", OUT.relative_to(HERE.parent))

    # the numbers that go in the report and the answers
    print(f"  {TARGET} centroid        {centroid.x:.4f}, {centroid.y:.4f}")
    print(f"  {TARGET} point on surface {on_surface.x:.4f}, {on_surface.y:.4f}")
    print(f"  centroid is {centroid.distance(geom.boundary):.4f} degrees outside")
    print(f"  that is about {centroid.distance(geom.boundary) * 111.32:.1f} km "
          f"from the nearest edge")


if __name__ == "__main__":
    main()
