# Web GIS Laboratory

**GIS874 Web GIS**
Institute of Geographical Information Systems
School of Civil and Environmental Engineering
National University of Sciences and Technology, Islamabad

| | |
|---|---|
| Name | Zaid Younas |
| Reg # | 537865 |
| Submitted to | Dr. Shahid Nawaz Khan |

> **All labs now live in one repository:** <https://github.com/zayd0123/webgis-537865>
>
> The Lab 01 handout specifies that this is the semester project and every later
> lab adds a commit to it, so Labs 1, 2 and 3 were consolidated there as `lab1/`,
> `lab2/` and `lab3/`, with a landing page at <https://zayd0123.github.io/webgis-537865/>.
>
> This repository is kept unchanged so the Lab 2 URL already submitted still
> resolves. Its content is identical to `lab2/` and `lab3/` in the canonical one.

Two labs live in this repository. Each one sits in a folder below the lab it
builds on, so nothing already published has moved.

| Lab | Source | Published | Report |
|---|---|---|---|
| 2 — District Explorer | [`index.html`](index.html) at the root | <https://zayd0123.github.io/webgis-lab-537865/> | [`report.md`](report.md) |
| 3 — District Dashboard | [`lab3/index.html`](lab3/index.html) | <https://zayd0123.github.io/webgis-lab-537865/lab3/> | [`lab3/report.md`](lab3/report.md) |

## Lab 2 — District Explorer

A web map of Pakistan's 160 districts. The page lets a user pick a province from
a drop-down, redraws the map with only those districts, shades each district by
its 2023 census population, and shows the district's attributes when clicked.

## Lab 3 — District Dashboard

The Lab 2 map grown into a small dashboard: a choice of three basemaps through a
layer control, districts shaded by population **density** rather than by the
population count, an info panel that reports the district under the pointer,
population drawn a second time as proportional circles in a pane of their own,
map events that can be switched on and off, and a measurement of what SVG and
canvas rendering cost.

One note for anyone opening it. The Carto Positron basemap the lab specifies was
put behind an API key after the handout was written, so it returned "API KEY
REQUIRED" placeholder tiles as a `200 OK`. That is fixed: a free Carto Basemaps
key is used via `?key=`, and the watermark is gone. Carto requires local hosts
to have a key of their own, so `lab3/app.js` holds two free keys and picks one
by hostname: the published site and localhost both render the basemap with no
changes needed.
[`lab3/report.md`](lab3/report.md) §0 has the measurements and the details.

The Part 2 point layer was built in QGIS 4.2.3 with the **Point on Surface**
tool, and the centroid comparison came out of the same run:
[`lab3/QGIS.md`](lab3/QGIS.md) records the Sibi finding, the commands, and three
QGIS 4 layout behaviours worth knowing about.

## The data

`data/districts.geojson` holds 160 district polygons with five attributes:
`district`, `province`, `pcode`, `pop_2023` and `area_km2`. Lab 3 copies that
file to `lab3/data/` and adds `district_points.geojson`, one point per district.

The boundaries are the Pakistan Common Operational Dataset for administrative
boundaries (admin level 2), published by OCHA on the Humanitarian Data Exchange
and sourced from the World Food Programme. The population column is from the
Pakistan Bureau of Statistics Population and Housing Census 2023, matched to the
boundaries by district name.

The 2023 census did not cover Azad Kashmir or Gilgit-Baltistan, so the 24
districts there have no population value, and Lehri in Balochistan is not listed
separately in the census tables either. That is 25 districts with no value, and
the maps draw them in grey rather than as thinly populated.

## Running it locally

The pages must be served over `http://`, not opened as a file, because they
fetch the GeoJSON at runtime and a browser blocks that request under `file://`.

```
python3 -m http.server 5500
```

Then open <http://127.0.0.1:5500/> for Lab 2, and
<http://127.0.0.1:5500/lab3/index.html> for Lab 3.
