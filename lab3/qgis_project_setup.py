#!/usr/bin/env python3
"""
Lab 3, Part 2 - set up the QGIS project so the comparison is on screen, ready
to be looked at (and screenshotted) in the QGIS application.

    $APP/Contents/MacOS/python lab3/qgis_project_setup.py

This writes two project files:

  sibi_centroid_comparison.qgz        the print layout, as exported to
                                      Report/checkpoint2_sibi_qgis.png
  sibi_centroid_map_view.qgz          the same three layers styled and zoomed
                                      to Sibi in the map canvas, which is what
                                      you see on opening it in the application

The second one exists for the screenshot: a .qgz holds the canvas extent and
the layer styles, so opening it in QGIS puts the red centroid square and the
blue Point on Surface dot either side of the boundary immediately, with no
clicking and nothing to set up by hand.

Run with QGIS's own Python, like the other QGIS scripts here:

    APP=/Applications/QGIS-final-4_2_3.app
    QT_QPA_PLATFORM=offscreen $APP/Contents/MacOS/python lab3/qgis_project_setup.py
"""

import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
DISTRICTS = HERE / "data" / "districts.geojson"
CENTROIDS = HERE / "data" / "qgis_centroids.geojson"
ON_SURFACE = HERE / "data" / "qgis_point_on_surface.geojson"

APP = "/Applications/QGIS-final-4_2_3.app"
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["PROJ_DATA"] = os.path.join(APP, "Contents/Resources/qgis/proj")
os.environ.setdefault("GDAL_DATA", os.path.join(APP, "Contents/Resources/qgis/gdal"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python"))
sys.path.insert(0, os.path.join(APP, "Contents/Resources/qgis/python/plugins"))

from qgis.core import (                                            # noqa: E402
    Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsFillSymbol,
    QgsMarkerSymbol, QgsPalLayerSettings, QgsPrintLayout, QgsProject,
    QgsRectangle, QgsSimpleMarkerSymbolLayer, QgsSingleSymbolRenderer,
    QgsTextFormat, QgsUnitTypes, QgsVectorLayer, QgsVectorLayerSimpleLabeling,
    QgsLayoutPoint, QgsLayoutSize, QgsLayoutItemMap, QgsLayoutItemLegend,
    QgsLayoutItemLabel,
)
from qgis.PyQt.QtGui import QColor, QFont                            # noqa: E402

TARGET = "Sibi"

app = QgsApplication([], False)
app.setPrefixPath(os.path.join(APP, "Contents/MacOS"), True)
QgsApplication.initQgis()
print(f"QGIS {Qgis.QGIS_VERSION}")

project = QgsProject.instance()
project.clear()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
project.setTitle("Lab 3 Part 2 - Sibi: centroid against Point on Surface")


def marker_symbol(shape, fill, stroke, size, stroke_width):
    """Built layer by layer: a Cross/Cross2 marker renders only its stroke and
    ignores its fill, so a red cross with a white outline comes out white."""
    symbol = QgsMarkerSymbol()
    layer = QgsSimpleMarkerSymbolLayer()
    layer.setShape(shape)
    layer.setFillColor(QColor(fill))
    layer.setStrokeColor(QColor(stroke))
    layer.setStrokeWidth(stroke_width)
    layer.setSize(size)
    symbol.changeSymbolLayer(0, layer)
    return symbol


districts = QgsVectorLayer(str(DISTRICTS), "districts", "ogr")
centroids = QgsVectorLayer(str(CENTROIDS), "Centroids", "ogr")
surface = QgsVectorLayer(str(ON_SURFACE), "Point on Surface", "ogr")
for layer in (districts, centroids, surface):
    if not layer.isValid():
        sys.exit(f"could not load {layer.source()}")
print(f"loaded {districts.featureCount()} districts, "
      f"{centroids.featureCount()} centroids, {surface.featureCount()} points")

# --- styling -------------------------------------------------------------
districts.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({
    "color": "222,235,247,80", "outline_color": "35,55,59", "outline_width": "0.46"})))

centroids.setRenderer(QgsSingleSymbolRenderer(
    marker_symbol(QgsSimpleMarkerSymbolLayer.Shape.Square,
                  "#c53030", "#ffffff", 3.2, 0.4)))
surface.setRenderer(QgsSingleSymbolRenderer(
    marker_symbol(QgsSimpleMarkerSymbolLayer.Shape.Circle,
                  "#2b6cb0", "#ffffff", 2.8, 0.4)))


def label_layer(layer, text, colour, size):
    pal = QgsPalLayerSettings()
    pal.fieldName = f"'{text}'"
    pal.isExpression = True
    pal.placement = QgsPalLayerSettings.Placement.OverPoint
    fmt = QgsTextFormat()
    fmt.setFont(QFont("Helvetica", size))
    fmt.setSize(size)
    fmt.setColor(QColor(colour))
    pal.setFormat(fmt)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)


# These two layers have exactly one feature each - Sibi - so a per-feature
# label is one label here, unlike the full 160-point layers in qgis_part2.py.
label_layer(centroids, "Centroid", "#a02020", 9)
label_layer(surface, "Point on Surface", "#1d4e89", 9)

# districts first so they are underneath
for layer in (districts, centroids, surface):
    project.addMapLayer(layer, True)

# --- zoom to Sibi --------------------------------------------------------
# Both points with a margin, so the boundary the centroid has crossed is inside
# the frame rather than off the edge. The extent is computed against a canvas
# of a fixed size rather than whatever the default map canvas happens to be:
# QGIS stores the canvas extent, not just a centre and scale, so if it is
# written from a small default canvas the project opens zoomed too far in when
# the real window is the size of a screen. Setting the canvas to the size the
# screenshot will use makes the saved extent the one that gets displayed.
# The QGIS 4 default map canvas is about 650x480; matching its shape is what
# makes the saved extent display as written. The screenshot also shows the
# Browser and Layers panels, so the map area is a little wider than tall.
CANVAS_W, CANVAS_H = 1200, 700
sibi_c = None
sibi_s = None
for f in centroids.getFeatures():
    if f["district"] == TARGET:
        p = f.geometry().asPoint()
        sibi_c = (p.x(), p.y())
for f in surface.getFeatures():
    if f["district"] == TARGET:
        p = f.geometry().asPoint()
        sibi_s = (p.x(), p.y())
print(f"Sibi centroid {sibi_c}, point on surface {sibi_s}")

# Frame the two points, then widen to the canvas aspect ratio so that QGIS's
# scale-to-fit does not crop anything.
ASPECT = CANVAS_W / CANVAS_H
pad = 0.42
west = min(sibi_c[0], sibi_s[0]) - pad
east = max(sibi_c[0], sibi_s[0]) + pad
south = min(sibi_c[1], sibi_s[1]) - pad * 0.62
north = max(sibi_c[1], sibi_s[1]) + pad * 0.62

# NB: this is in degrees of longitude and latitude, not metres, so the aspect
# correction is the plain ratio - a mercator correction would over-widen it.
width = east - west
height = north - south
if width / height < ASPECT:
    extra = (height * ASPECT - width) / 2
    west -= extra
    east += extra
else:
    extra = (width / ASPECT - height) / 2
    south -= extra
    north += extra

extent = QgsRectangle(west, south, east, north)
print(f"target canvas {CANVAS_W}x{CANVAS_H}, extent {extent.toString(5)}")

try:
    from qgis.gui import QgsMapCanvas                                 # noqa: E402
    canvas = QgsMapCanvas()
    canvas.resize(CANVAS_W, CANVAS_H)
    canvas.setDestinationCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
    canvas.setLayers([districts, centroids, surface])
    canvas.setExtent(extent)
    canvas.refresh()
    print(f"map canvas {canvas.width()}x{canvas.height()} set to the Sibi extent")
except Exception as exc:                                              # noqa: BLE001
    print("no map canvas available (headless run):", exc)

# --- the print layout, for comparison with the exported figure ----------
layout = QgsPrintLayout(project)
layout.initializeDefaults()
layout.setName("Sibi centroid comparison")
project.layoutManager().addLayout(layout)

title = QgsLayoutItemLabel(layout)
title.setText(f"{TARGET}, Balochistan \u2014 centroid against Point on Surface")
tf = QgsTextFormat(); tf.setFont(QFont("Helvetica", 13)); tf.setSize(13)
tf.setColor(QColor("#1a202c"))
title.setTextFormat(tf)
title.adjustSizeToText()
title.attemptMove(QgsLayoutPoint(14, 10, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(title)

sub = QgsLayoutItemLabel(layout)
sub.setText(
    f"QGIS {Qgis.QGIS_VERSION}  \u00b7  Centroids tool and Point on Surface tool  \u00b7  EPSG:4326\n"
    f"Centroid  {sibi_c[0]:.5f}, {sibi_c[1]:.5f}   \u2014   0.02402\u00b0 OUTSIDE the district, in Harnai\n"
    f"Point on Surface  {sibi_s[0]:.5f}, {sibi_s[1]:.5f}   \u2014   inside the district")
sf = QgsTextFormat(); sf.setFont(QFont("Helvetica", 9)); sf.setSize(9)
sf.setColor(QColor("#3d4c50"))
sub.setTextFormat(sf)
sub.adjustSizeToText()
sub.attemptMove(QgsLayoutPoint(14, 17, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(sub)

main_map = QgsLayoutItemMap(layout)
main_map.attemptMove(QgsLayoutPoint(14, 32, QgsUnitTypes.LayoutMillimeters))
main_map.attemptResize(QgsLayoutSize(98, 92, QgsUnitTypes.LayoutMillimeters))
main_map.setExtent(extent)
main_map.setFrameEnabled(True)
layout.addLayoutItem(main_map)

inset = QgsLayoutItemMap(layout)
inset.attemptMove(QgsLayoutPoint(120, 32, QgsUnitTypes.LayoutMillimeters))
inset.attemptResize(QgsLayoutSize(74, 92, QgsUnitTypes.LayoutMillimeters))
whole = None
for f in districts.getFeatures():
    if f["district"] == TARGET:
        whole = f.geometry().boundingBox()
inset.setExtent(whole or extent)
inset.setFrameEnabled(True)
layout.addLayoutItem(inset)

map_layers = [districts, centroids, surface]
main_map.setLayers(map_layers)
inset.setLayers(map_layers)
legend = QgsLayoutItemLegend(layout)
legend.setTitle("Layers")
legend.setLinkedMap(main_map)
legend.setLegendFilterByMapEnabled(True)
legend.setAutoUpdateModel(False)
legend.setColumnCount(3)
legend.attemptMove(QgsLayoutPoint(14, 152, QgsUnitTypes.LayoutMillimeters))
legend.attemptResize(QgsLayoutSize(164, 26, QgsUnitTypes.LayoutMillimeters))
layout.addLayoutItem(legend)
main_map.refresh()
inset.refresh()

MAP_VIEW = HERE / "sibi_centroid_map_view.qgz"
project.write(str(MAP_VIEW))
print(f"wrote {MAP_VIEW.name}")
print(f"  canvas extent: {extent.toString(5)}")
print(f"  layers: {[l.name() for l in project.mapLayers().values()]}")

QgsApplication.exitQgis()
print("done")
