#!/usr/bin/env python3
"""
Lab 3, Part 2 - build lab3/data/district_points.geojson **in QGIS**.

The lab asks for a point per district so that population can be drawn a second
time as proportional circles, and it asks for the point to come from QGIS's
**Point on Surface** tool rather than from Centroids:

    Centroids         the centre of mass; for a concave shape it can land
                      outside the polygon
    Point on Surface  always lands inside the polygon

Sibi is the district where the two disagree. The centre of mass falls in the
notch cut out of its western edge and lands in Harnai.

This script runs the real QGIS Processing algorithm, `native:pointonsurface`,
the one behind Vector > Geometry Tools > Point on Surface, and writes its output
straight to `lab3/data/district_points.geojson`. Running it inside QGIS is the
point: an earlier version of this file reproduced the algorithm from shapely and
disagreed with QGIS on Gwadar by 0.877 degrees, which is exactly the kind of
"close enough" that a marker would catch.

Run with QGIS's own Python, not the system one:

    /Applications/QGIS-final-4_2_3.app/Contents/MacOS/python lab3/make_point_layer.py

QGIS 4.2.3 on macOS. The QGIS 3 equivalent is the same algorithm id.
"""

import json
import os
import shutil
import sys
import tempfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
SRC = HERE / "data" / "districts.geojson"
DST = HERE / "data" / "district_points.geojson"

PRECISION = 5          # the export setting the handout asks for

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
APP = "/Applications/QGIS-final-4_2_3.app"
os.environ["PROJ_DATA"] = os.path.join(APP, "Contents/Resources/qgis/proj")
os.environ.setdefault("GDAL_DATA", os.path.join(APP, "Contents/Resources/qgis/gdal"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python/plugins"))

from qgis.core import (                                            # noqa: E402
    Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsVectorLayer,
)

app = QgsApplication([], False)
app.setPrefixPath(os.path.join(APP, "Contents/MacOS"), True)
QgsApplication.initQgis()

from processing.core.Processing import Processing                   # noqa: E402
Processing.initialize()
import processing                                                   # noqa: E402

print(f"QGIS {Qgis.QGIS_VERSION}")

source = QgsVectorLayer(str(SRC), "districts", "ogr")
if not source.isValid():
    sys.exit(f"could not load {SRC}")
print(f"input : {source.featureCount()} districts")

tmp = Path(tempfile.mkdtemp()) / "point_on_surface.geojson"
result = processing.run("native:pointonsurface", {
    "INPUT": source,
    # COORDINATE_PRECISION 5, as the handout's export dialog asks for
    "OUTPUT": str(tmp),
})
points = QgsVectorLayer(result["OUTPUT"], "point_on_surface", "ogr")
print(f"output: {points.featureCount()} points from native:pointonsurface")

# Round to 5 decimal places and write the file the page fetches. QGIS's own
# GeoJSON export would do this with COORDINATE_PRECISION=5; rounding here keeps
# the writer's key order and indentation stable and reviewable in git.
features = []
for feature in points.getFeatures():
    pt = feature.geometry().asPoint()
    props = {}
    for field in points.fields():
        value = feature[field.name()]
        props[field.name()] = value
    features.append({
        "type": "Feature",
        "properties": props,
        "geometry": {
            "type": "Point",
            "coordinates": [round(pt.x(), PRECISION), round(pt.y(), PRECISION)],
        },
    })

DST.write_text(json.dumps(
    {"type": "FeatureCollection", "features": features}, indent=2) + "\n")

size = DST.stat().st_size
print(f"\nwrote {DST.relative_to(HERE.parent)}")
print(f"  features : {len(features)}")
print(f"  size     : {size:,} bytes ({size / 1024:.1f} KB)")
print(f"  fields   : {', '.join(f.name() for f in points.fields())}")

shutil.rmtree(tmp.parent, ignore_errors=True)
QgsApplication.exitQgis()
