#!/usr/bin/env python3
"""
Lab 3, Part 2 - do the QGIS work in QGIS, and export the figure.

Runs inside QGIS's own Python, not the system one:

    QT_QPA_PLATFORM=offscreen \
    /Applications/QGIS-final-4_2_3.app/Contents/MacOS/python lab3/qgis_part2.py

What it does, in the same order the handout walks through:

  1. loads lab3/data/districts.geojson
  2. runs the real QGIS Processing algorithm **Point on Surface**
     (native:pointonsurface) - the same tool as the Processing Toolbox entry
  3. runs the **Centroids** tool, through QgsGeometry.centroid() on the source
     geometries, which is what Vector > Geometry Tools > Centroids calls
  4. compares the two against the committed district_points.geojson, so the
     claim that the committed points are QGIS's is checked rather than asserted
  5. composes a print layout - district boundary, both point layers, legend,
     scale bar - and exports it as the checkpoint 2 figure

QGIS 4.2.3 on macOS. QGIS 4 names the API Qgis; on QGIS 3 the same script needs
`from qgis.PyQt.QtCore import ...` instead of `from qgis.PyQt...`, and
Qgis.QGIS_VERSION becomes Qgis.QGIS_VERSION in both.
"""

import json
import math
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
DISTRICTS = HERE / "data" / "districts.geojson"
COMMITTED_POINTS = HERE / "data" / "district_points.geojson"
CENTROIDS_OUT = HERE / "data" / "qgis_centroids.geojson"
SURFACE_OUT = HERE / "data" / "qgis_point_on_surface.geojson"
FIGURE = HERE / "Report" / "checkpoint2_sibi_qgis.png"
PROJECT = HERE / "sibi_centroid_comparison.qgz"

TARGET = "Sibi"
SCALE = 1_500_000          # 1:1.5 M - Sibi fills an A4 sheet at this scale

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

# QGIS's bundled Python needs to be told where its PROJ database and its
# plugins live when it is started outside the QGIS application itself.
APP = "/Applications/QGIS-final-4_2_3.app"
os.environ["PROJ_DATA"] = os.path.join(APP, "Contents/Resources/qgis/proj")
os.environ.setdefault("GDAL_DATA", os.path.join(APP, "Contents/Resources/qgis/gdal"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python/plugins"))

# ---------------------------------------------------------------- QGIS set-up
from qgis.core import (                                            # noqa: E402
    QgsApplication, QgsCoordinateReferenceSystem, QgsFeature, QgsGeometry,
    QgsMarkerSymbol, QgsPrintLayout, QgsProject, QgsSimpleMarkerSymbolLayer,
    QgsRectangle, QgsSingleSymbolRenderer, QgsTextFormat,
    QgsUnitTypes, QgsVectorLayer, QgsLayoutSize,
    QgsLayoutPoint, QgsLayoutItemMap, QgsLayoutItemLegend, QgsLayoutItemLabel,
    QgsFillSymbol,
    QgsLayoutItemShape, QgsLayoutExporter,
)
from qgis.PyQt.QtCore import QCoreApplication, QPointF, QSizeF        # noqa: E402
from qgis.PyQt.QtGui import QColor, QFont                            # noqa: E402

QCoreApplication.setApplicationName("Lab3 Part 2")
app = QgsApplication([], False)
app.setPrefixPath("/Applications/QGIS-final-4_2_3.app/Contents/MacOS", True)
QgsApplication.initQgis()

from qgis.core import Qgis                                           # noqa: E402
print(f"QGIS {Qgis.QGIS_VERSION}")

project = QgsProject.instance()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))


def load(path: Path, name: str):
    layer = QgsVectorLayer(str(path), name, "ogr")
    if not layer.isValid():
        sys.exit(f"could not load {path}")
    return layer


districts = load(DISTRICTS, "districts")
print(f"loaded districts: {districts.featureCount()} features")

# --------------------------------------------------- 2. Point on Surface tool
if not project.addMapLayer(districts, False):
    pass

from processing.core.Processing import Processing                    # noqa: E402
Processing.initialize()
import processing                                                    # noqa: E402

# Both tools are run through the Processing framework, by the ids the
# Processing Toolbox uses. Vector > Geometry Tools > Point on Surface and
# Vector > Geometry Tools > Centroids call exactly these.
print("running native:pointonsurface ...")
surface_result = processing.run("native:pointonsurface", {
    "INPUT": districts,
    "OUTPUT": str(SURFACE_OUT),
})
layer_surface = QgsVectorLayer(surface_result["OUTPUT"], "Point on Surface", "ogr")
print(f"  -> {layer_surface.featureCount()} points")

print("running native:centroids ...")
centroid_result = processing.run("native:centroids", {
    "INPUT": districts,
    "ALL_PARTS": False,
    "OUTPUT": str(CENTROIDS_OUT),
})
layer_centroids = QgsVectorLayer(centroid_result["OUTPUT"], "Centroids", "ogr")
print(f"  -> {layer_centroids.featureCount()} points")

# ------------------------------------- 4. check the committed point layer
print("\nchecking the committed district_points.geojson against QGIS output ...")
committed = {f["properties"]["district"]: f["geometry"]["coordinates"]
             for f in json.loads(COMMITTED_POINTS.read_text())["features"]}

def by_district(layer):
    out = {}
    for f in layer.getFeatures():
        name = f["district"] if "district" in [x.name() for x in layer.fields()] \
            else f.attribute("district")
        out[name] = f.geometry().asPoint()
    return out

surface_pts = by_district(layer_surface)
centroid_pts = by_district(layer_centroids)

worst = 0.0
worst_name = None
for name, pt in surface_pts.items():
    if name not in committed:
        continue
    lon, lat = committed[name]
    d = math.hypot(pt.x() - lon, pt.y() - lat)
    if d > worst:
        worst, worst_name = d, name
print(f"  largest disagreement committed vs QGIS Point on Surface: "
      f"{worst:.8f} deg ({worst_name})")
print(f"  identical to 5 decimal places: "
      f"{'YES' if worst < 1e-5 else 'NO'}")

# the finding itself, checked in QGIS rather than in shapely
sibi_geom = None
for f in districts.getFeatures():
    if f["district"] == TARGET:
        sibi_geom = f.geometry()
        break
sibi_centroid = centroid_pts[TARGET]
sibi_surface = surface_pts[TARGET]
print(f"\n{TARGET}:")
print(f"  centroid        {sibi_centroid.x():.5f}, {sibi_centroid.y():.5f}")
print(f"  point on surface{sibi_surface.x():>13.5f}, {sibi_surface.y():.5f}")
print(f"  centroid inside its own district? "
      f"{'yes' if sibi_geom.contains(QgsGeometry.fromPointXY(sibi_centroid)) else 'NO'}")
print(f"  distance outside the boundary: {sibi_geom.distance(QgsGeometry.fromPointXY(sibi_centroid)):.5f} deg")

# ------------------------------------------------------------- 5. the figure
# The symbols are built layer by layer rather than with createSimple(), and the
# centroid is a square rather than an X, because of a real QGIS 4 behaviour:
# a Cross or Cross2 marker renders *only* its stroke and ignores its fill, so it
# takes its colour from setStrokeColor() and not from setFillColor(). Asking for
# a red cross with a white outline therefore draws a WHITE cross, which is
# invisible on a white page - the symbol is there, it simply cannot be seen.
# Circle, Square, Triangle, Diamond and Pentagon all render filled normally, so
# the two layers are told apart by shape and colour instead.
def marker_symbol(shape, fill, stroke, size, stroke_width):
    symbol = QgsMarkerSymbol()
    layer = QgsSimpleMarkerSymbolLayer()
    layer.setShape(shape)
    layer.setFillColor(QColor(fill))
    layer.setStrokeColor(QColor(stroke))
    layer.setStrokeWidth(stroke_width)
    layer.setSize(size)
    symbol.changeSymbolLayer(0, layer)
    return symbol


# a red square for the centroids, a blue dot for the point on surface
red = marker_symbol(QgsSimpleMarkerSymbolLayer.Shape.Square,
                    "#c53030", "#ffffff", 4.4, 0.4)
blue = marker_symbol(QgsSimpleMarkerSymbolLayer.Shape.Circle,
                     "#2b6cb0", "#ffffff", 3.8, 0.4)
layer_centroids.setRenderer(QgsSingleSymbolRenderer(red))
layer_surface.setRenderer(QgsSingleSymbolRenderer(blue))

# No layer labels here. A layer label draws once per feature, so labelling
# these two layers would print "Centroid" 160 times and "Point on Surface" 160
# times. The two names are placed on the layout instead, one per map, below.

# districts, unfilled with a dark outline, so the shape reads as a boundary
district_symbol = QgsFillSymbol.createSimple({
    "color": "222,235,247,60", "outline_color": "35,55,59",
    "outline_width": "0.5"})
districts.setRenderer(QgsSingleSymbolRenderer(district_symbol))

# Registration order decides the drawing order inside the map item: districts
# first so they are at the bottom, then the two point layers on top.
project.addMapLayer(districts, True)
project.addMapLayer(layer_centroids, True)
project.addMapLayer(layer_surface, True)

# the neighbouring district the centroid lands in, for the caption
nbr = None
for f in districts.getFeatures():
    if f["district"] != TARGET and f.geometry().contains(
            QgsGeometry.fromPointXY(sibi_centroid)):
        nbr = f["district"]
print(f"  the centroid lands in: {nbr}")

# ------------------------------------------------------------ the layout
layout = QgsPrintLayout(project)
layout.initializeDefaults()
layout.setName("Sibi centroid comparison - Lab 3 Part 2")
project.layoutManager().addLayout(layout)

# The close-up has to contain the boundary the centroid has crossed, so it is
# framed on the two points with a margin at each end rather than on either one:
# centred on the point on surface alone, the frame falls on the empty interior
# of the district and shows nothing.
pad = 0.11                       # degrees at each end, about 11 km
near = QgsRectangle(
    min(sibi_centroid.x(), sibi_surface.x()) - pad,
    min(sibi_centroid.y(), sibi_surface.y()) - pad * 0.57,
    max(sibi_centroid.x(), sibi_surface.x()) + pad,
    max(sibi_centroid.y(), sibi_surface.y()) + pad * 0.57)
far = sibi_geom.boundingBox()

title = QgsLayoutItemLabel(layout)
title.setText(f"{TARGET}, Balochistan \u2014 centroid against Point on Surface")
tf = QgsTextFormat()
tf.setFont(QFont("Helvetica", 13))
tf.setSize(13)
tf.setColor(QColor("#1a202c"))
title.setTextFormat(tf)
title.adjustSizeToText()
title.attemptMove(QgsLayoutPoint(14, 10, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(title)

sub = QgsLayoutItemLabel(layout)
sub.setText(
    f"QGIS {Qgis.QGIS_VERSION}  \u00b7  Centroids tool and Point on Surface tool  \u00b7  EPSG:4326\n"
    f"Centroid  {sibi_centroid.x():.5f}, {sibi_centroid.y():.5f}   \u2014   "
    f"{sibi_geom.distance(QgsGeometry.fromPointXY(sibi_centroid)):.4f}\u00b0 OUTSIDE the district, in {nbr}\n"
    f"Point on Surface  {sibi_surface.x():.5f}, {sibi_surface.y():.5f}   \u2014   inside the district")
sf = QgsTextFormat()
sf.setFont(QFont("Helvetica", 9))
sf.setSize(9)
sf.setColor(QColor("#3d4c50"))
sub.setTextFormat(sf)
sub.adjustSizeToText()
sub.attemptMove(QgsLayoutPoint(14, 17, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(sub)

# left: the two points close up
main_map = QgsLayoutItemMap(layout)
main_map.attemptMove(QgsLayoutPoint(14, 32, QgsUnitTypes.LayoutMillimeters))
main_map.attemptResize(QgsLayoutSize(98, 92, QgsUnitTypes.LayoutMillimeters))
main_map.setExtent(near)
main_map.setFrameEnabled(True)
layout.addLayoutItem(main_map)

# right: the whole district, which is what causes the problem
inset = QgsLayoutItemMap(layout)
inset.attemptMove(QgsLayoutPoint(120, 32, QgsUnitTypes.LayoutMillimeters))
inset.attemptResize(QgsLayoutSize(74, 92, QgsUnitTypes.LayoutMillimeters))
inset.setExtent(far)
inset.setFrameEnabled(True)
layout.addLayoutItem(inset)

# The labels are layout labels rather than layer labels on purpose. A layer
# label is drawn once per feature, so the point layers would put 160 copies of
# the same word on the maps; two layout labels say it once.
def place_at(text, colour, x, y, map_item):
    """Put a label beside a geographic coordinate on a map item."""
    item = QgsLayoutItemLabel(layout)
    item.setText(text)
    f = QgsTextFormat()
    f.setFont(QFont("Helvetica", 9))
    f.setSize(9)
    f.setColor(QColor(colour))
    item.setTextFormat(f)
    item.adjustSizeToText()
    layout.addLayoutItem(item)

    ext = map_item.extent()
    fx = (x - ext.xMinimum()) / ext.width()
    fy = (y - ext.yMinimum()) / ext.height()
    origin = map_item.pos()
    size = map_item.sizeWithUnits()
    item.attemptMove(QgsLayoutPoint(
        origin.x() + fx * size.width() + 2.2,
        origin.y() + (1 - fy) * size.height() - 3.6,
        QgsUnitTypes.LayoutMillimeters))
    return item


place_at("Centroid", "#a02020", sibi_centroid.x(), sibi_centroid.y(), main_map)
place_at("Point on Surface", "#1d4e89", sibi_surface.x(), sibi_surface.y(), main_map)

main_caption = QgsLayoutItemLabel(layout)
main_caption.setText("Close up: the red square sits in Harnai, outside the boundary;\n"
                     "the blue dot is inside Sibi.")
cf = QgsTextFormat(); cf.setFont(QFont("Helvetica", 8)); cf.setSize(8)
cf.setColor(QColor("#3d4c50"))
main_caption.setTextFormat(cf)
main_caption.adjustSizeToText()
main_caption.attemptMove(QgsLayoutPoint(14, 126, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(main_caption)

# The scale bar is two layout rectangles and two labels rather than
# QgsLayoutItemScaleBar. QgsLayoutItemScaleBar sizes its segments through
# QSizeF, and in PyQt6 QSizeF is integer-based: the 25 mm segment this map
# needs is rounded to 25 *pixels*, so the bar collapses to nothing and its
# numbers pile up on top of each other ("5,000 10,000 m"). Drawing the bar from
# the map's own scale avoids the whole problem and is exact.
km_per_mm = main_map.scale() / 1_000_000.0          # metres on the ground per mm
bar_mm = 10.0 / km_per_mm                           # a 10 km bar, in mm
bar_x, bar_y = 14.0, 137.0

bar_left = QgsLayoutItemShape(layout)
bar_left.setShapeType(QgsLayoutItemShape.Shape.Rectangle)
bar_left.setSymbol(QgsFillSymbol.createSimple(
    {"color": "35,55,59", "outline_color": "35,55,59", "outline_width": "0.2"}))
bar_left.attemptMove(QgsLayoutPoint(bar_x, bar_y, QgsUnitTypes.LayoutMillimeters))
bar_left.attemptResize(QgsLayoutSize(bar_mm, 1.8, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(bar_left)

bar_right = QgsLayoutItemShape(layout)
bar_right.setShapeType(QgsLayoutItemShape.Shape.Rectangle)
bar_right.setSymbol(QgsFillSymbol.createSimple(
    {"color": "255,255,255", "outline_color": "35,55,59", "outline_width": "0.2"}))
bar_right.attemptMove(QgsLayoutPoint(bar_x + bar_mm, bar_y, QgsUnitTypes.LayoutMillimeters))
bar_right.attemptResize(QgsLayoutSize(bar_mm, 1.8, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(bar_right)

for text, x in (("0", bar_x), ("10 km", bar_x + 2 * bar_mm)):
    tick = QgsLayoutItemLabel(layout)
    tick.setText(text)
    ttf = QgsTextFormat(); ttf.setFont(QFont("Helvetica", 8)); ttf.setSize(8)
    ttf.setColor(QColor("#3d4c50"))
    tick.setTextFormat(ttf)
    tick.adjustSizeToText()
    tick.attemptMove(QgsLayoutPoint(x - 1 if text == "0" else x - 6,
                                    bar_y - 4.2, QgsUnitTypes.LayoutMillimeters))
    layout.addLayoutItem(tick)

print(f"  scale bar drawn by hand: {bar_mm:.2f} mm per 10 km "
      f"(map scale 1:{main_map.scale():,.0f})")

inset_caption = QgsLayoutItemLabel(layout)
inset_caption.setText(
    f"All of {TARGET}. The long arm reaching north-east pulls\n"
    f"the centre of mass south-west, into the notch.")
inf = QgsTextFormat(); inf.setFont(QFont("Helvetica", 8)); inf.setSize(8)
inf.setColor(QColor("#3d4c50"))
inset_caption.setTextFormat(inf)
inset_caption.adjustSizeToText()
inset_caption.attemptMove(QgsLayoutPoint(120, 126, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(inset_caption)

legend = QgsLayoutItemLegend(layout)
legend.setTitle("Layers")
legend.setLinkedMap(main_map)
legend.setLegendFilterByMapEnabled(True)
legend.setColumnCount(3)
legend.attemptMove(QgsLayoutPoint(14, 152, QgsUnitTypes.LayoutMillimeters))
legend.attemptResize(QgsLayoutSize(164, 26, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(legend)

# A map item in a layout that has never been drawn is empty until it refreshes,
# and a fresh QgsLayoutItemMap does not pick the project's layers up on its own:
# without setLayers() the frame exports blank. Order matters, districts first.
map_layers = [districts, layer_centroids, layer_surface]
main_map.setLayers(map_layers)
inset.setLayers(map_layers)

# The legend follows the map item it is linked to, so it picks the same three
# layers up; it just needs to be told not to rebuild from the project instead.
legend.setAutoUpdateModel(False)

main_map.refresh()
inset.refresh()
legend.updateLegend()

FIGURE.parent.mkdir(exist_ok=True)
# the PNG driver will not overwrite, so clear the old export first
for stale in (FIGURE,):
    if stale.exists():
        stale.unlink()

exporter = QgsLayoutExporter(layout)
settings = QgsLayoutExporter.ImageExportSettings()
settings.dpi = 200
result = exporter.exportToImage(str(FIGURE), settings)
print(f"\nexported figure: {FIGURE.name}  (result={result})")
if FIGURE.exists():
    print(f"  {FIGURE.stat().st_size:,} bytes")

project.write(str(PROJECT))
print(f"wrote project:   {PROJECT.name}")

QgsApplication.exitQgis()
print("\ndone")

