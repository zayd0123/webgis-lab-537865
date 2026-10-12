#!/usr/bin/env python3
"""
Evidence for Lab 3, Part 2: which district's centroid falls outside it?

Run this and paste the output into the report. It works on the same
districts.geojson the QGIS screenshots are taken from.

    python3 lab3/check_point_layer.py
"""

import json
from pathlib import Path

from shapely.geometry import shape

SOURCE = Path(__file__).resolve().parent / "data" / "districts.geojson"

rows = []
for feature in json.loads(SOURCE.read_text())["features"]:
    geom = shape(feature["geometry"])
    centroid = geom.centroid
    inside = geom.contains(centroid)
    rows.append(
        {
            "district": feature["properties"]["district"],
            "province": feature["properties"]["province"],
            "inside": inside,
            # how far the centre of mass sits from the boundary, in degrees
            "clearance": centroid.distance(geom.boundary),
            "centroid": (round(centroid.x, 4), round(centroid.y, 4)),
            "on_surface": (round(geom.representative_point().x, 4),
                           round(geom.representative_point().y, 4)),
        }
    )

outside = [r for r in rows if not r["inside"]]
inside = sorted((r for r in rows if r["inside"]), key=lambda r: r["clearance"])

print(f"districts tested: {len(rows)}")
print(f"centroids OUTSIDE their own district: {len(outside)}\n")

for r in outside:
    print(f"  DISTRICT  {r['district']} ({r['province']})")
    print(f"    centroid        {r['centroid'][0]}, {r['centroid'][1]}")
    print(f"    point on surface{r['on_surface'][0]:>10}, {r['on_surface'][1]}")
    print(f"    the centroid lies {r['clearance']:.4f} degrees outside the boundary")
    print("    -> the circle for this district is drawn in its neighbour")

print("\nfive closest centroids that are still inside (for comparison):")
for r in inside[:5]:
    print(f"  {r['district']:<20} {r['province']:<18} {r['clearance']:.4f} deg from the edge")
