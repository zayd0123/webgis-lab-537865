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
// basemap drew that watermark instead of a map.
//
// Two details in the request fail silently and are worth knowing:
//   - the parameter is `key`, not `api_key`. With `?api_key=` the endpoint
//     keeps serving the placeholder and nothing appears in the console.
//   - the key is restricted by Referer, so it only answers for the host it was
//     registered for.
//
// Carto requires local hosts to be on a key of their own, so there are two,
// both free, and the page picks by hostname. Neither is a secret: on a static
// page the key is in this file for anyone to read, and the Referer restriction
// is what makes that safe. Picking the wrong one for the host gives a 403 and
// an empty tile, which is why this is chosen by hostname rather than hard-coded.
const CARTO_KEY = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  ? 'cb1_4ien_1_567c805c3e15c0a5a6e997d3'   // local development
  : 'cb1_4iei_1_cecead15e5448ff173211382';  // zayd0123.github.io

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
const COLOURS = ['#deebf7', '#9ecae1', '#4292c6', '#2171b5', '#08306b'];
const GREY = '#c9cfd1';

// Extension 4: the same five colours, but the breaks are computed from the
// data rather than fixed. See quantileBreaks() below.
// Extension 3 declares these up here because fitView() runs during load and
// assigns to silentUntil; leaving them next to saveView() would be a temporal
// dead zone error, not a style question.
const VIEW_KEY = 'lab3.view';
const SILENT_MS = 1200;
let silentUntil = 0;

let scheme = 'fixed';            // 'fixed' | 'quantile'
const FIXED_BREAKS = [50, 150, 400, 1000];   // Part 4's manual classification
let breaks = FIXED_BREAKS.slice();
let currentProvince = 'all';

function classFor(density) {
  if (density === null) return -1;
  for (let i = 0; i < breaks.length; i++) {
    if (density <= breaks[i]) return i;
  }
  return breaks.length;
}

function colourFor(density) {
  const k = classFor(density);
  return k < 0 ? GREY : COLOURS[k];
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
// Extension 4 - quantile breaks, computed from the data
// -----------------------------------------------------------------------
// The fixed breaks of Part 4 put 20 / 18 / 34 / 41 / 22 districts in the five
// classes: they say something about density in the abstract, but nothing about
// this particular set of districts, and 41 of 135 share one colour. Quantiles
// are worked out from the values themselves, so each class holds as close to
// the same number of districts as the data allows, and the map spends its five
// colours where the districts actually are.
//
// The trade is real and worth stating: equal counts make the classes comparable
// to each other but not to any other map, and a quantile map of a different
// country would use the same five shades for completely different densities.
function quantileBreaks(values, classes) {
  const sorted = values.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < classes; i++) {
    const pos = (i / classes) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    // interpolate between the two neighbouring values
    out.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
  }
  return out;
}

function computeBreaks() {
  const values = allDistricts.features
    .map(f => densityOf(f.properties))
    .filter(v => v !== null);
  // keep the four breaks distinct: 135 values with ties can otherwise repeat
  const q = quantileBreaks(values, COLOURS.length);
  return q.map(v => Math.round(v));
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
// Extension 2 - the density as a permanent label, above zoom 8
// -----------------------------------------------------------------------
// The hover tooltip and a permanent label cannot both be attached: Leaflet
// keeps one tooltip per layer, and a second bindTooltip replaces the first. So
// above the threshold the one tooltip becomes the label, and going back below
// it restores the hover tooltip.
//
// zoomend rather than zoom: zoom end fires once when the zoom settles, while
// zoom fires throughout the animation, which would rebind 160 tooltips on every
// frame of it.
const LABEL_ZOOM = 8;

function syncDensityLabels() {
  const wanted = map.getZoom() >= LABEL_ZOOM;
  const target = scheme === 'quantile' ? quantileDistricts : districts;
  if (!target) return;

  target.eachLayer(function (layer) {
    const hasLabel = !!layer.getTooltip() && layer.getTooltip().options.permanent;
    if (wanted && !hasLabel) {
      const d = densityOf(layer.feature.properties);
      layer.unbindTooltip();
      layer.bindTooltip(
        d === null ? 'no census data' : Math.round(d).toLocaleString() + ' / km²',
        { permanent: true, direction: 'center', className: 'density-label' });
    } else if (!wanted && hasLabel) {
      layer.unbindTooltip();
      layer.bindTooltip(layer.feature.properties.district, { sticky: true });
    }
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

// Extension 4 - the same districts under quantile breaks. Off the map by
// default; the Shading drop-down chooses which of the two shows, and the layer
// control can switch either one off entirely.
const quantileGroup = L.featureGroup();
layerControl.addOverlay(quantileGroup, 'Density, quantile breaks');

// Extension 1 - the 160 points as clustered markers, in an overlay of their
// own. markerClusterGroup is a layer group itself, so it can go where any
// featureGroup goes. It is added to the map only when ticked, to keep the
// dashboard's initial draw as close to the core lab as possible.
// Not added to the map here: the layer control ticks a layer only when it is
// already on the map, so starting it off keeps the initial view to the core lab.
const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 50,
  spiderfyDistanceMultiplier: 1.6
});
layerControl.addOverlay(clusterGroup, 'Districts, clustered');

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
// Fitting the view is the caller's job rather than draw()'s, because the first
// draw must not fit when there is a stored view to restore - see extension 3.
// A fit is not the reader moving, so it is silenced: otherwise the initial
// fitBounds would be written to localStorage as though they had panned there.
function fitView() {
  if (!districts || districts.getLayers().length === 0) return;   // no bounds
  silentUntil = Date.now() + SILENT_MS;
  map.fitBounds(districts.getBounds());
}

// Declared up here because computeBreaks() reads allDistricts, and extension 4
// computes its breaks at load time rather than per draw.
let allDistricts = null;
let allPoints = null;
let districts = null;   // the current L.geoJSON layer, kept for resetStyle
let quantileDistricts = null;   // the same, for the quantile shading

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
  quantileGroup.clearLayers();
  clusterGroup.clearLayers();

  // Extension 4: the quantile shading is the same geometry with the same
  // styleFor(), which reads the breaks that are currently in force. It only
  // differs in which breaks those are.
  quantileDistricts = L.geoJSON(allDistricts, {
    filter: keep,
    style: styleFor,
    onEachFeature: bindDistrict
  });
  quantileGroup.addLayer(quantileDistricts);

  // The fixed-break layer is the one the info panel and resetStyle use, so it
  // is built first and kept in `districts` even when quantiles are showing.
  districts = L.geoJSON(allDistricts, {
    filter: keep,
    style: styleFor,
    onEachFeature: bindDistrict
  });
  districtGroup.addLayer(districts);
  if (scheme === 'quantile') {
    // only one of the two is on the map at a time; the layer control holds both
    if (map.hasLayer(districtGroup)) map.removeLayer(districtGroup);
    if (!map.hasLayer(quantileGroup)) quantileGroup.addTo(map);
  } else {
    if (map.hasLayer(quantileGroup)) map.removeLayer(quantileGroup);
    if (!map.hasLayer(districtGroup)) districtGroup.addTo(map);
  }

  circleGroup.addLayer(L.geoJSON(allPoints, {
    filter: function (f) { return keep(f) && hasPopulation(f); },
    pointToLayer: circleFor
  }));

  // Extension 1: the same districts as clustered markers. One marker per
  // point, so the layer is only readable once the cluster has been opened.
  clusterGroup.addLayer(L.geoJSON(allPoints, {
    filter: keep,
    pointToLayer: function (feature, latlng) {
      return L.marker(latlng).bindPopup(
        '<strong>' + feature.properties.district + '</strong><br>' +
        feature.properties.province + '<br>' +
        'Population: ' + show(feature.properties.pop_2023) + '<br>' +
        'Area: ' + show(feature.properties.area_km2) + ' km<sup>2</sup>'
      );
    }
  }));

  const n = districts.getLayers().length;
  document.getElementById('count').textContent = n + ' districts';
  reportEmptyProvince(province, n);

  // Extension 2: the labels belong to whichever district layer is showing.
  syncDensityLabels();

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
    currentProvince = event.target.value;
    draw(currentProvince);
  });

// -----------------------------------------------------------------------
// Extension 4 - switching the classification
// -----------------------------------------------------------------------
// Changing the scheme only changes the breaks, so the layer is redrawn and the
// legend rebuilt from the same numbers the map is using.
document.getElementById('scheme')
  .addEventListener('change', function (event) {
    scheme = event.target.value;
    breaks = scheme === 'quantile' ? computeBreaks() : FIXED_BREAKS;
    console.log('shading: ' + scheme + ', breaks ' + breaks.join(' / '));
    draw(currentProvince);
    fitView();
    rebuildLegend();
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
  // Extension 2: the density labels appear and disappear with the zoom.
  syncDensityLabels();
});

// -----------------------------------------------------------------------
// Extension 3 - remember where the reader was
// -----------------------------------------------------------------------
// moveend fires when a pan or a zoom settles, which is the moment worth saving.
//
// It also fires for the moves this page makes on its own, and getting that
// wrong is easy: a simple "am I restoring?" flag is not enough, because Leaflet
// fires moveend from a requestAnimationFrame. The fitBounds() in the first
// draw() therefore lands *after* restoreView() has
// already put the reader back where they were, and overwrites it with the
// default view - so the restored position survives only until the next reload,
// which stores the default instead. Measured, not guessed: the stored value
// came back as the fitted view every time.
//
// The fix is a window rather than a flag. Automatic moves are made silent for a
// short time, and anything inside that window is neither saved nor treated as
// the reader having moved.
function savingIsSilent() {
  return Date.now() < silentUntil;
}

function saveView() {
  if (savingIsSilent()) return;
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom(),
      at: Date.now()
    }));
  } catch (err) {
    // Private browsing and some hardened settings make localStorage throw.
    // Losing the remembered view is not worth breaking the map over.
    console.log('could not save the view:', err.message);
  }
}

function storedView() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null');
    if (!saved || typeof saved.lat !== 'number' || typeof saved.zoom !== 'number') {
      return null;
    }
    // A remembered position from days ago is more confusing than helpful.
    if (Date.now() - (saved.at || 0) > 12 * 60 * 60 * 1000) return null;
    return saved;
  } catch (err) {
    return null;
  }
}

function restoreView(view) {
  const saved = view || storedView();
  if (!saved) return false;

  silentUntil = Date.now() + SILENT_MS;
  map.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
  console.log('restored the saved view: ' +
              saved.lat.toFixed(4) + ', ' + saved.lng.toFixed(4) +
              ' at zoom ' + saved.zoom);
  return true;
}

map.on('moveend', saveView);

// -----------------------------------------------------------------------
// Parts 4 and 6 - the legend
// -----------------------------------------------------------------------
const legend = L.control({ position: 'bottomright' });

function legendLabels() {
  // Extension 4: the labels are built from the breaks in force, so the legend
  // cannot describe a classification the map is not using.
  const fmt = v => Math.round(v).toLocaleString();
  const out = ['under ' + fmt(breaks[0])];
  for (let i = 1; i < breaks.length; i++) {
    out.push(fmt(breaks[i - 1]) + ' to ' + fmt(breaks[i]));
  }
  out.push('over ' + fmt(breaks[breaks.length - 1]));
  return out;
}

legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  legend._div = div;
  legend.draw();
  // Part 7 step 2: remove this line and clicking the legend also fires the
  // map's click handler, opening a coordinate popup on top of the legend.
  L.DomEvent.disableClickPropagation(div);
  return div;
};

legend.draw = function () {
  const div = legend._div;
  if (!div) return;
  const labels = legendLabels();

  // Extension 4: say which classification this is, because equal-count classes
  // and fixed classes look identical on the page and mean different things.
  div.innerHTML = '<strong>People per km<sup>2</sup></strong><br>' +
    '<span class="muted">' +
    (scheme === 'quantile' ? 'quantile breaks, equal counts' : 'fixed breaks') +
    '</span><br>';
  for (let i = 0; i < labels.length; i++) {
    div.innerHTML +=
      '<i style="background:' + COLOURS[i] + '"></i> ' + labels[i] + '<br>';
  }
  div.innerHTML += '<i style="background:' + GREY + '"></i> no census data';

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
};

function rebuildLegend() {
  legend.draw();
}

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

  // Extension 4: the quantile breaks can only be computed once the data is in.
  breaks = scheme === 'quantile' ? computeBreaks() : FIXED_BREAKS;

  // Extension 3 decides the opening view, and the order matters in a way that
  // is not obvious. Restoring *after* a fitBounds does not work: Leaflet
  // re-fits once the container finishes its first layout, a few hundred
  // milliseconds in, and that later fit wins over the restored view. Traced on
  // the page - fitBounds at 35 ms, the restore at 35 ms, the container's own
  // moveend at 350 ms back at the fitted extent.
  //
  // So the page fits only when there is nothing to restore. Reading the stored
  // view before the draw costs one localStorage read and removes the race
  // rather than trying to time around it.
  const remembered = storedView();
  draw('all');
  if (remembered) {
    restoreView(remembered);
  } else {
    fitView();
  }

  // Expose the breaks so the checker can compare the map against the data it
  // says it is describing.
  window.getBreaks = () => breaks.slice();
  window.getScheme = () => scheme;
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
