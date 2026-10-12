# Lab 3, Part 2 — the QGIS work, and what it found

Part 2 of the handout is marked on the **centroid comparison**, so it was done
in QGIS 4.2.3 on this machine, through QGIS's own Processing algorithms rather
than reimplemented. Everything below is reproducible from the repository.

## The answer

> **Sibi** (Balochistan) is the district whose centroid falls outside it. The
> centre of mass sits **0.02402° (about 2.7 km) outside** the boundary, in
> **Harnai**.
>
> `Report/checkpoint2_sibi_qgis.png`, exported from QGIS, is **Checkpoint 2**.
> `Report/checkpoint2_sibi_centroid_vs_point_on_surface.png` is the same finding
> drawn with matplotlib from the same two QGIS layers.

Sibi is a crescent: a long arm reaches north-east, so the balance point of the
shape falls in the notch on the western side, in Harnai, rather than in the body
of the district. **One district in 160 does this.** The next closest centroids
are Nagar (0.0093° *inside*) and Nankana Sahib (0.0119° *inside*), so Sibi is not
a marginal case.

## Running it

Two scripts, both run with **QGIS's own Python**, not the system one. They set
`PROJ_DATA` and add QGIS's `python/plugins` to `sys.path` themselves, because
QGIS's bundled Python needs to be told where those are when it starts outside
the QGIS application.

```
APP=/Applications/QGIS-final-4_2_3.app

# the point layer the page fetches
QT_QPA_PLATFORM=offscreen $APP/Contents/MacOS/python lab3/make_point_layer_qgis.py

# both point layers plus the checkpoint 2 figure
QT_QPA_PLATFORM=offscreen $APP/Contents/MacOS/python lab3/qgis_part2.py
```

What the second script prints:

```
running native:pointonsurface ...   -> 160 points
running native:centroids ...        -> 160 points
largest disagreement committed vs QGIS Point on Surface: 0.00000704 deg (Jhelum Valley)
identical to 5 decimal places: YES
Sibi:
  centroid            67.94474, 29.76147
  point on surface    68.25013, 29.72711
  centroid inside its own district? NO
  distance outside the boundary: 0.02402 deg
  the centroid lands in: Harnai
```

## Doing it by hand in the QGIS GUI

The scripts call the same algorithms the menus call, so the GUI route gives the
same answer and is worth walking through once:

1. Drag `lab3/data/districts.geojson` into QGIS.
2. **Vector ▸ Geometry Tools ▸ Centroids** — this is `native:centroids`.
3. **Vector ▸ Geometry Tools ▸ Point on Surface** — `native:pointonsurface` (on
   older builds, search the Processing Toolbox with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>).
4. Select Sibi in the attribute table and **Zoom to Layer**, then zoom in on the
   north-east corner, where the two points separate.
5. Style them differently. **Use a Circle or Square marker, not a Cross** — see
   the first note below.
6. Screenshot. That is Checkpoint 2.

`lab3/sibi_centroid_comparison.qgz` is the QGIS project for that comparison, so
opening it in the QGIS application gives the same layout by hand.

## Three things QGIS 4 actually does, found while doing this

These are worth recording because each one produced a wrong figure first.

**1. A `Cross` or `Cross2` marker renders only its stroke.** It ignores its fill
and takes its colour from `setStrokeColor()`, so `setFillColor(red)` plus
`setStrokeColor(white)` on a cross draws a **white** cross — invisible on a white
page. The symbol is there in the legend, apparently empty, and nothing is drawn
on the map. Circle, Square, Triangle, Diamond and Pentagon all render filled
normally. The figure therefore uses a red **square** for the centroid rather than
the usual red X.

**2. `QgsLayoutItemMap` does not inherit the project's layers.** A map item added
to a layout exports a blank frame until `setLayers()` is called on it, even
though the layers are in the project and `refresh()` has been called. The first
attempt at the figure came out with two empty frames and only the title.

**3. `QgsLayoutItemScaleBar` collapses in PyQt6.** It sizes its segments through
`QSizeF`, which in PyQt6 is integer-based, so a 25 mm segment is rounded to 25
*pixels* — the bar draws at no width and its numbers pile up on one another
(`5,000 10,000 m`). The figure draws the bar from the map's own scale instead:
at 1:397,892, 10 km is 25.13 mm, and two rectangles and two labels place it
exactly.

None of these are bugs in the lab's data or in the dashboard; they are all in the
QGIS layout API, and all three are worked around in `qgis_part2.py`.

## The exported layers

| File | What it is | Features |
|---|---|---|
| `data/district_points.geojson` | **the point layer the page fetches**, written by `native:pointonsurface`, rounded to 5 dp | 160 |
| `data/qgis_centroids.geojson` | `native:centroids` — the comparison layer | 160 |
| `data/qgis_point_on_surface.geojson` | `native:pointonsurface`, as QGIS wrote it | 160 |

**Committed point layer: 160 features, 55,113 bytes (53.8 KB).** The points
inherit every attribute of their district, including `pop_2023`, and all 160 fall
inside their own district.

## Why the point layer is not shapely's `representative_point()`

An earlier version of this file built the point layer with shapely, on the
assumption that QGIS's Point on Surface and shapely's `representative_point()`
were the same point. **They are not, and the difference is large:**

| | QGIS `native:pointonsurface` | shapely `representative_point()` |
|---|---|---|
| Method | a point guaranteed to lie inside, by the algorithm QGIS implements | the pole of inaccessibility — centre of the largest inscribed circle |
| Largest disagreement | **0.877° on Gwadar** | |
| Sibi | 68.25013, 29.72711 | the same to 5 dp |

Running QGIS's own algorithm moved **all 160** of the earlier points. So the
committed layer is now QGIS's output, not an approximation of it, and
`qgis_part2.py` checks the two against each other on every run: the largest
remaining difference is 7e-6°, which is the 5-decimal rounding and nothing else.

`check_point_layer.py` still works and still prints the Sibi evidence, using
shapely only to read the geometries:

```
python3 lab3/check_point_layer.py
```
