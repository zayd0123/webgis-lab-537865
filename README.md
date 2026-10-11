# District Explorer

Web GIS Laboratory 2 — a web map of Pakistan's districts.

**GIS874 Web GIS**
Institute of Geographical Information Systems
School of Civil and Environmental Engineering
National University of Sciences and Technology, Islamabad

| | |
|---|---|
| Name | Zaid Younas |
| Reg # | 537865 |
| Submitted to | Dr. Shahid Nawaz Khan |

## What this is

A web map of Pakistan's 160 districts. The page lets a user pick a province from
a drop-down, redraws the map with only those districts, shades each district by
its 2023 census population, and shows the district's attributes when clicked.

## Files

| Path | What it holds |
|---|---|
| `index.html` | the structure of the page |
| `style.css` | how the page looks |
| `app.js` | what the page does |
| `data/districts.geojson` | the district layer the map draws |
| `report.md` | the measurement report and answers |

## The data

`data/districts.geojson` holds 160 district polygons with five attributes:
`district`, `province`, `pcode`, `pop_2023` and `area_km2`.

The boundaries are the Pakistan Common Operational Dataset for administrative
boundaries (admin level 2), published by OCHA on the Humanitarian Data Exchange
and sourced from the World Food Programme. The population column is from the
Pakistan Bureau of Statistics Population and Housing Census 2023, matched to the
boundaries by district name.

The 2023 census did not cover Azad Kashmir or Gilgit-Baltistan, so the 24
districts there have no population value, and Lehri in Balochistan is not listed
separately in the census tables either. That is 25 districts with no value, and
the map draws them in grey rather than as thinly populated.

## Running it locally

The page must be served over `http://`, not opened as a file, because it fetches
the GeoJSON at runtime and a browser blocks that request under `file://`.

```
python3 -m http.server 5500
```

Then open <http://127.0.0.1:5500>.

## Published

<https://zayd0123.github.io/webgis-lab-537865/>
