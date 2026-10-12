#!/usr/bin/env python3
"""
Lab 3, Part 2 - build lab3/data/district_points.geojson.

The lab asks for a point per district so that population can be drawn a second
time as proportional circles. Two tools do this in QGIS:

    Centroids         the centre of mass; for a concave shape it can land
                      outside the polygon
    Point on Surface  always lands inside the polygon

Sibi is the district where the two disagree: its centre of mass falls in the
notch cut out of its western edge and ends up in the neighbouring district.

The repository's districts.geojson was exported from QGIS with 5 decimal
places, so this script reproduces QGIS's "Point on Surface" here rather than
using shapely's representative_point(). The two agree for 159 of the 160
districts but differ by up to 0.88 degrees on Gwadar, whose coastline is
concave, so the algorithm matters and QGIS's is the one the screenshots show.

QGIS POLYGON_POINT_ON_SURFACE:
    x = (xmin + xmax) / 2,  y = (ymin + ymax) / 2
    -- the centre of the bounding box, which for a curved shape can fall
       outside -- then the nearest point on the polygon if it does.

Input    lab3/data/districts.geojson   (160 districts, 5 dp)
Output   lab3/data/district_points.geojson
"""

import json
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import nearest_points

HERE = Path(__file__).resolve().parent
SRC = HERE / "data" / "districts.geojson"
DST = HERE / "data" / "district_points.geojson"

PRECISION = 5          # the export setting the handout asks for


def point_on_surface(geom: "BaseGeometry") -> Point:
    """QGIS's Point on Surface algorithm."""
    xmin, ymin, xmax, ymax = geom.bounds
    candidate = Point((xmin + xmax) / 2.0, (ymin + ymax) / 2.0)
    if geom.contains(candidate):
        return candidate
    # nearest point on the boundary of the polygon
    return nearest_points(candidate, geom)[1]


def main() -> None:
    districts = json.loads(SRC.read_text())

    features = []
    for feature in districts["features"]:
        geom = shape(feature["geometry"])
        pt = point_on_surface(geom)
        features.append(
            {
                "type": "Feature",
                # Point on Surface inherits every attribute of its district,
                # including pop_2023, which is what radiusFor() sizes by.
                "properties": feature["properties"],
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(pt.x, PRECISION),
                        round(pt.y, PRECISION),
                    ],
                },
            }
        )

    out = {"type": "FeatureCollection", "features": features}
    DST.write_text(json.dumps(out, indent=2) + "\n")

    size = DST.stat().st_size
    print(f"wrote {DST.relative_to(HERE.parent)}")
    print(f"  features : {len(features)}")
    print(f"  size     : {size:,} bytes ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
