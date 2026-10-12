// District Dashboard - Web GIS Lab 3
//
// The blocks below are labelled with the Part of the handout that adds them,
// so this file can be read against the lab text.
//
//   Part 3   the map through its options, three basemaps, a layer control
//   Part 4   the density choropleth, its group, the fetch, the legend
//   Part 5   hover highlighting and the info panel
//   Part 6   proportional circles, in a pane of their own
//   Part 7   map events that can be switched on and off
//   Part 8   the province drop-down            (extension)
//   Part 9   SVG or canvas, and timing it      (extension)
// -----------------------------------------------------------------------

// Part 9 (extension): open the page as index.html?canvas and every vector is
// drawn onto a canvas instead of into SVG elements.
const useCanvas = new URLSearchParams(window.location.search).has('canvas');

// -----------------------------------------------------------------------
// Part 3 - the map, its options, and three basemaps
// -----------------------------------------------------------------------
// In Lab 2 the map was created and then setView was called. Here every
// setting is an option instead, so the map is never in an unconstrained
// state, not even for the first frame.
const map = L.map('map', {
  center: [30.3753, 69.3451],
  zoom: 5,
  // The whole country fits at 5; further out would show only the neighbours.
  minZoom: 5,
  // The boundaries were simplified to about 100 m, so they stop looking
  // right well before street level.
  maxZoom: 14,
  // Pakistan with about two degrees to spare on each side.
  maxBounds: [[21.5, 58.5], [39.0, 80.5]],
  maxBoundsViscosity: 1.0,
  // Part 9: SVG by default, canvas when the query string asks for it.
  preferCanvas: useCanvas
});

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

// The handout's three basemaps, kept as it publishes them.
//
// Carto has since put its basemaps behind an API key: without one, Positron
// returns a 256 px "API KEY REQUIRED" placeholder as a 200 OK, so the default
// basemap drew that watermark instead of a map. The parameter is `key` - not
// `api_key`, which is silently ignored and keeps serving the placeholder - and
// the key is restricted by Referer to the published site, so it only works on
// zayd0123.github.io. Locally, swap in the localhost key from the Carto
// dashboard, or this basemap will 403 and Leaflet will draw an empty tile.
// The URL template, the subdomains and the attribution are otherwise untouched.
const CARTO_KEY = 'cb1_4iei_1_cecead15e5448ff173211382';

const positron = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY, {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});

// Esri's template is {y}/{x}, the other way round from the two above. Leaflet
// fills whichever placeholders it finds, in the order they appear, so this has
// to be copied exactly as the provider publishes it.
const imagery = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri'
});

// Positron is the default because a thematic layer is drawn on top of it: a
// busy basemap competes with the shading, a quiet grey one does not.
positron.addTo(map);

// The second argument is the overlays. It starts empty; Parts 4 and 6 add to
// it. The control is kept in a variable because that is the only way to add an
// overlay later.
const layerControl = L.control.layers(
  {
    'Light (Carto Positron)': positron,
    'OpenStreetMap': osm,
    'Satellite (Esri)': imagery
  },
  {},
  { collapsed: false }
).addTo(map);

L.control.scale({ imperial: false }).addTo(map);

// -----------------------------------------------------------------------
// Part 4 - shade by density, a rate, not by population, a count
// -----------------------------------------------------------------------
// Lab 2 coloured districts by population. A large district holds many people
// simply because it is large, so that shading largely repeated the districts'
// areas. A choropleth colours areas, so the value behind the colour must be
// one that does not grow with area. Population is a count; it belongs on
// symbols whose size follows the count, which is Part 6.
function show(value) {
  if (value === null || value === undefined || value === '') {
    return 'not recorded';
  }
  return typeof value === 'number' ? value.toLocaleString() : value;
}

// Density is not stored in the file. It is worked out from the two attributes
// that are, every time a district is styled.
function densityOf(p) {
  if (p.pop_2023 === null || p.pop_2023 === undefined) return null;
  return p.pop_2023 / p.area_km2;
}

// Missing is not the same as small: with an explicit branch for null, the 25
// districts with no census value are grey rather than pale blue.
function colourFor(density) {
  if (density === null) return '#c9cfd1';
  if (density > 1000) return '#08306b';
  if (density >  400) return '#2171b5';
  if (density >  150) return '#4292c6';
  if (density >   50) return '#9ecae1';
  return '#deebf7';
}

function styleFor(feature) {
  return {
    color: '#ffffff',
    weight: 1,
    fillColor: colourFor(densityOf(feature.properties)),
    fillOpacity: 0.8
  };
}

// -----------------------------------------------------------------------
// Part 5 - an info panel that follows the pointer
// -----------------------------------------------------------------------
// A popup costs the user a click and covers the map. A panel in the corner
// costs nothing: it reports whatever is under the pointer.
const info = L.control({ position: 'topright' });

info.onAdd = function () {
  this._div = L.DomUtil.create('div', 'info');
  // The panel sits inside the map container. Without the first call, clicking
  // the panel also clicks the map underneath (Part 7 shows that); without the
  // second, scrolling over it zooms the map.
  L.DomEvent.disableClickPropagation(this._div);
  L.DomEvent.disableScrollPropagation(this._div);
  this.update();
  return this._div;
};

// update() is not a Leaflet method - it is an ordinary method added to the
// control. Nothing calls it until this code does. Called with no argument it
// shows the resting message.
info.update = function (p) {
  const zoom = '<div class="muted">Zoom level ' + map.getZoom() + '</div>';
  if (!p) {
    this._div.innerHTML = '<h4>District</h4>' +
      '<div class="muted">Hover over a district</div>' + zoom;
    return;
  }
  const d = densityOf(p);
  this._div.innerHTML =
    '<h4>' + p.district + '</h4>' +
    p.province + '<br>' +
    'Population: ' + show(p.pop_2023) + '<br>' +
    'Area: ' + show(p.area_km2) + ' km<sup>2</sup><br>' +
    'Density: ' + (d === null ? 'not recorded'
                              : Math.round(d).toLocaleString() + ' per km<sup>2</sup>') +
    zoom;
};

info.addTo(map);

// -----------------------------------------------------------------------
// Part 5 - hover highlighting and click to zoom
// -----------------------------------------------------------------------
function highlight(e) {
  e.target.setStyle({ weight: 3, color: '#1a202c', fillOpacity: 0.95 });
  // Otherwise the thick outline is half hidden under the neighbouring
  // polygons, which are drawn after it.
  e.target.bringToFront();
  info.update(e.target.feature.properties);
}

function unhighlight(e) {
  // resetStyle re-runs styleFor for that one district, so the original colour
  // never has to be stored anywhere. It belongs to the L.geoJSON layer, which
  // is why draw() keeps a reference to it.
  districts.resetStyle(e.target);
  info.update();
}

function zoomToDistrict(e) {
  map.fitBounds(e.target.getBounds(), { padding: [20, 20] });
}

function bindDistrict(feature, layer) {
  layer.bindTooltip(feature.properties.district, { sticky: true });
  layer.on({
    mouseover: highlight,
    mouseout: unhighlight,
    click: zoomToDistrict
  });
}

// -----------------------------------------------------------------------
// Part 6 - population as proportional circles, in a pane of their own
// -----------------------------------------------------------------------
// Polygons and circle markers are both vector paths, so by default both go
// into overlayPane and whichever is drawn later covers the other. Hovering a
// district calls bringToFront, which would lift it over the circles. A pane
// with a higher z-index settles the order once: overlayPane is 400 and
// markerPane 600, so 450 puts the circles above every polygon and below
// markers, tooltips and popups.
map.createPane('symbols');
map.getPane('symbols').style.zIndex = 450;

// The eye compares the AREA of a circle, and area grows with the square of the
// radius. If the radius followed population, a district with four times the
// people would look sixteen times larger. The square root makes area follow
// population. Lahore, at about 13 million, gets a radius of about 22 pixels.
function radiusFor(population) {
  return Math.sqrt(population) / 160;
}

function circleFor(feature, latlng) {
  return L.circleMarker(latlng, {
    pane: 'symbols',
    radius: radiusFor(feature.properties.pop_2023),
    color: '#7c2d12',
    weight: 1,
    fillColor: '#f97316',
    fillOpacity: 0.7
  }).bindTooltip(
    feature.properties.district + ': ' +
    feature.properties.pop_2023.toLocaleString()
  );
}

// Two districts have no census value but are not null either; the filter has
// to drop those too, or radiusFor() would be handed undefined and the layer
// would fail to draw.
function hasPopulation(feature) {
  const pop = feature.properties.pop_2023;
  return pop !== null && pop !== undefined;
}

// -----------------------------------------------------------------------
// Parts 4 and 6 - the layer control holds groups
// -----------------------------------------------------------------------
// The control needs one object to switch on and off, but Part 8 rebuilds the
// district layer every time the province changes, and a control pointing at a
// layer that has been thrown away switches nothing. A group stays put while
// its contents change.
const districtGroup = L.featureGroup().addTo(map);
layerControl.addOverlay(districtGroup, 'Population density');

const circleGroup = L.featureGroup().addTo(map);
layerControl.addOverlay(circleGroup, 'Population');

// Part 6 - metres on the ground against pixels on the screen
const nust = [33.6423, 72.9906];
const nustGroup = L.featureGroup([
  // L.circle takes metres, so it shrinks and grows with the zoom
  L.circle(nust, { radius: 25000, color: '#0f766e', weight: 2, fillOpacity: 0.08 }),
  // L.circleMarker takes pixels, so it stays the same size on screen
  L.circleMarker(nust, { radius: 6, color: '#0f766e', fillColor: '#0f766e', fillOpacity: 1 })
]).bindTooltip('NUST H-12: a 25 km circle and a 6 pixel circleMarker');
layerControl.addOverlay(nustGroup, 'NUST, 25 km');

// -----------------------------------------------------------------------
// Part 4 - draw the layers, keeping only the chosen province
// -----------------------------------------------------------------------
let allDistricts = null;
let allPoints = null;
let districts = null;   // the current L.geoJSON layer, kept for resetStyle

function draw(province) {
  const t0 = performance.now();   // Part 9: timing

  // The filter hook: L.geoJSON calls this once per feature and never draws a
  // feature it returns false for. keep reads province from the call to draw()
  // that created it, so the same function serves every province.
  const keep = function (feature) {
    return province === 'all' || feature.properties.province === province;
  };

  districtGroup.clearLayers();
  circleGroup.clearLayers();

  districts = L.geoJSON(allDistricts, {
    filter: keep,
    style: styleFor,
    onEachFeature: bindDistrict
  });
  districtGroup.addLayer(districts);

  circleGroup.addLayer(L.geoJSON(allPoints, {
    filter: function (f) { return keep(f) && hasPopulation(f); },
    pointToLayer: circleFor
  }));

  const n = districts.getLayers().length;
  // Skipped when the selection is empty: an empty layer has no bounds and
  // Leaflet throws "Bounds are not valid".
  if (n > 0) {
    map.fitBounds(districts.getBounds());
  }
  document.getElementById('count').textContent = n + ' districts';
  reportEmptyProvince(province, n);

  // Part 9: how long did that take? Median of five reloads goes in the report.
  console.log('draw(' + province + '): ' + n + ' districts in ' +
              (performance.now() - t0).toFixed(1) + ' ms, ' +
              (useCanvas ? 'canvas' : 'SVG'));

  return n;
}

// -----------------------------------------------------------------------
// Part 8 (extension) - the province drop-down
// -----------------------------------------------------------------------
function fillProvinceList() {
  const select = document.getElementById('province');
  const provinces = [...new Set(
    allDistricts.features.map(f => f.properties.province)
  )].sort();
  for (const name of provinces) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

document.getElementById('province')
  .addEventListener('change', function (event) {
    draw(event.target.value);
  });

// Part 8 asks whether the dashboard should tell the user when a layer has
// nothing to draw. It should: selecting Gilgit Baltistan gives 14 shaded
// districts and no circles at all, and without a word from the page that
// reads as a bug rather than as missing census data.
function reportEmptyProvince(province, districtCount) {
  const note = document.getElementById('count');
  if (province === 'all') return;

  const withPop = allDistricts.features.filter(
    f => f.properties.province === province && hasPopulation(f)
  ).length;

  if (withPop === 0) {
    note.textContent = districtCount +
      ' districts - no census data for ' + province + ', so no circles';
  }
}

// -----------------------------------------------------------------------
// Part 7 - map events, and switching a handler on and off
// -----------------------------------------------------------------------
// A named function, so map.off can find the very function that map.on was
// given. An anonymous function has no name and no variable holding it, so
// nothing passed to off could ever match it and the handler could never be
// removed.
function showCoordinates(e) {
  L.popup()
    .setLatLng(e.latlng)
    .setContent(e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4))
    .openOn(map);
}

document.getElementById('coords')
  .addEventListener('change', function (event) {
    if (event.target.checked) {
      map.on('click', showCoordinates);
    } else {
      map.off('click', showCoordinates);
    }
  });

// zoomend fires once, when a zoom finishes. zoom would fire continuously
// during the animation.
map.on('zoomend', function () {
  info.update();
});

// -----------------------------------------------------------------------
// Parts 4 and 6 - the legend
// -----------------------------------------------------------------------
const legend = L.control({ position: 'bottomright' });

legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  const breaks = [0, 50, 150, 400, 1000];
  const labels = ['under 50', '50 to 150', '150 to 400', '400 to 1,000', 'over 1,000'];

  div.innerHTML = '<strong>People per km<sup>2</sup></strong><br>';
  for (let i = 0; i < breaks.length; i++) {
    div.innerHTML +=
      '<i style="background:' + colourFor(breaks[i] + 1) + '"></i> ' +
      labels[i] + '<br>';
  }
  div.innerHTML += '<i style="background:' + colourFor(null) + '"></i> no census data';

  // Part 6: three reference circles, drawn with the same radiusFor() the map
  // itself uses, so the legend cannot disagree with the symbols. They sit
  // nested on one base line and each is labelled by a leader line.
  const sizes = [10000000, 4000000, 1000000];
  const rMax = radiusFor(sizes[0]);
  const pad = 6;
  const base = pad + 2 * rMax;
  let svg = '<svg width="' + (2 * rMax + 75) + '" height="' + (base + 2) + '">';
  for (const s of sizes) {
    const r = radiusFor(s);
    const top = base - 2 * r;
    svg += '<circle cx="' + (rMax + 1) + '" cy="' + (base - r) + '" r="' + r +
           '" fill="#f97316" fill-opacity=".2" stroke="#7c2d12"/>' +
           '<line x1="' + (rMax + 1) + '" y1="' + top + '" x2="' + (2 * rMax + 14) +
           '" y2="' + top + '" stroke="#7c2d12" stroke-width=".6"/>' +
           '<text x="' + (2 * rMax + 17) + '" y="' + (top + 3.5) +
           '" font-size="10">' + (s / 1000000) + ' million</text>';
  }
  svg += '</svg>';
  div.innerHTML += '<div class="circles"><strong>Population</strong>' + svg + '</div>';

  // Part 7 step 2: remove this line and clicking the legend also fires the
  // map's click handler, opening a coordinate popup on top of the legend.
  L.DomEvent.disableClickPropagation(div);
  return div;
};

legend.addTo(map);

// -----------------------------------------------------------------------
// Part 4 - load both files, then draw
// -----------------------------------------------------------------------
async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(path + ': status ' + response.status);
  }
  return response.json();
}

async function loadData() {
  try {
    // Promise.all starts both requests at once and waits for both. Two awaits
    // in a row would fetch the second file only after the first had arrived.
    [allDistricts, allPoints] = await Promise.all([
      loadJSON('data/districts.geojson'),
      loadJSON('data/district_points.geojson')
    ]);
  } catch (err) {
    console.error('Could not load the data.', err);
    document.getElementById('count').textContent = 'data failed to load';
    return;
  }

  fillProvinceList();
  draw('all');
}

// Declared on window so the DevTools Console can reach them while the page is
// being marked; a plain const is scoped to this script.
window.map = map;
window.layerControl = layerControl;
window.districtGroup = districtGroup;
window.circleGroup = circleGroup;
window.getAllDistricts = () => allDistricts;
window.getAllPoints = () => allPoints;

loadData();
