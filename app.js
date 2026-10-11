// District Explorer - Web GIS Lab 2
//
// Structure follows the lab's own order:
//   §5-6  the map, the bounds, the fetch
//   §7    drawing the layer
//   §8    classification, popups, legend
//   §9    the province filter
// -----------------------------------------------------------------------

// §6.1 / §6.2 - the map, held inside Pakistan ---------------------------
const pakistanLimits = L.latLngBounds([21.5, 58.5], [39.0, 80.5]);

const map = L.map('map', {
  maxBounds: pakistanLimits,
  maxBoundsViscosity: 1.0,
  minZoom: 5
}).setView([30.3753, 69.3451], 5);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Declared on window so the DevTools Console can reach it. A plain
// `let districts` is scoped to this script, so the Console cannot see it until
// loadData() has finished - which makes §6.4's commands throw "districts is not
// defined" if you run them too early.
window.districts = null;
window.layer = null;

// §8.1 - five classes, four break values ---------------------------------
// A manual classification. Changing the breaks changes the map's message,
// which is why they belong in the report alongside the map.
function show(value) {
  if (value === null || value === undefined || value === '') {
    return 'not recorded';
  }
  return typeof value === 'number' ? value.toLocaleString() : value;
}

function colourFor(population) {
  // Missing is not the same as small. This line is what stops the 25 districts
  // with no census value from falling through to the lowest class and being
  // read as thinly populated rather than as unrecorded.
  if (population === null || population === undefined) return '#c9cfd1';
  if (population > 3000000) return '#7f2704';
  if (population > 1500000) return '#d94801';
  if (population > 750000) return '#f16913';
  if (population > 300000) return '#fd8d3c';
  return '#fdd0a2';
}

function styleFor(feature) {
  return {
    color: '#ffffff',
    weight: 1,
    fillColor: colourFor(feature.properties.pop_2023),
    fillOpacity: 0.8
  };
}

// §7.1 / §8.2 - draw the layer, with a popup on every district -----------
function draw(features) {
  // Removed first: L.geoJSON(...).addTo(map) adds a layer, it does not replace
  // one. Without this, filtering would stack layers and slow the map down with
  // every change.
  if (layer) {
    map.removeLayer(layer);
  }

  layer = L.geoJSON(
    { type: 'FeatureCollection', features: features },
    {
      style: styleFor,

      // A callback, not a call. Leaflet runs this once per feature as the layer
      // is built. Every value goes through show() so one missing attribute
      // costs one popup line rather than the whole map.
      onEachFeature: function (feature, featureLayer) {
        const p = feature.properties;
        featureLayer.bindPopup(
          '<strong>' + show(p.district) + '</strong><br>' +
          'Province: ' + show(p.province) + '<br>' +
          'Population: ' + show(p.pop_2023) + '<br>' +
          'Area: ' + show(p.area_km2) + ' km<sup>2</sup>'
        );
      }
    }
  ).addTo(map);

  // Skipped when the selection is empty: an empty layer has no bounds and
  // Leaflet throws "Bounds are not valid", stopping the rest of the function.
  if (features.length > 0) {
    map.fitBounds(layer.getBounds());
  }

  document.getElementById('count').textContent = features.length + ' districts';
}

// §8.3 - the legend ------------------------------------------------------
const legend = L.control({ position: 'bottomright' });

legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  const breaks = [0, 300000, 750000, 1500000, 3000000];
  const labels = ['under 300k', '300k to 750k', '750k to 1.5m',
                  '1.5m to 3m', 'over 3m'];
  for (let i = 0; i < breaks.length; i++) {
    div.innerHTML +=
      '<i style="background: ' + colourFor(breaks[i] + 1) + '"></i> ' +
      labels[i] + '<br>';
  }
  div.innerHTML +=
    '<i style="background: ' + colourFor(null) + '"></i> no census data';
  return div;
};

legend.addTo(map);

// §9.1 - build the drop-down from the data -------------------------------
// Not typed by hand, so it stays correct if the data changes. The same map and
// Set combination tried in the Console in §6.4.
function fillProvinceList() {
  const select = document.getElementById('province');
  const provinces = [...new Set(
    districts.features.map(f => f.properties.province)
  )].sort();
  for (const name of provinces) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
}

// §9.2 - react to the user ----------------------------------------------
// Find an element, listen for an event, filter the data, redraw.
document.getElementById('province')
  .addEventListener('change', function (event) {
    const chosen = event.target.value;
    const subset = chosen === 'all'
      ? districts.features
      : districts.features.filter(
          f => f.properties.province === chosen
        );
    draw(subset);
  });

// §6.3 - fetch the file --------------------------------------------------
async function loadData() {
  const response = await fetch('data/districts.geojson');
  if (!response.ok) {
    console.error('Request failed with status ', response.status);
    return;
  }
  window.districts = await response.json();
  console.log('features:', districts.features.length);
  console.log('first feature:', districts.features[0]);
  console.log('properties:', districts.features[0].properties);

  fillProvinceList();
  draw(districts.features);
}

loadData();
