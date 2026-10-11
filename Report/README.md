# Checkpoint screenshots

Ten images covering the nine checkpoints. `report.md` references every one of
them by the filenames below, so editing is not needed — replacing a file with an
updated screenshot is enough, as long as the name stays the same.

| File | Checkpoint | What it shows |
|---|---|---|
| `checkpoint1.png` | 1 | VS Code: `webgis-lab` with `index.html`, `style.css`, `app.js` and the empty `data` folder |
| `checkpoint2.png` | 2 | QGIS: versions A and D drawn together, with a magnified inset showing the lost detail |
| `checkpoint3.png` | 3 | The five structure answers and the first coordinate pair |
| `checkpoint4.png` | 4 | The three source files, and the page on `127.0.0.1:5500` |
| `checkpoint5.png` | 5 | Console: `features: 160`, the expanded first feature, and the seven provinces |
| `checkpoint6.png` | 6 | Network tab: `districts.geojson` at 916 kB / 12 ms, with a tile Preview open |
| `checkpoint7.png` | 7 | Shaded map, legend visible, popup open on Killa Saifullah |
| `checkpoint8.png` | 8 | Both states: all provinces (160 districts) and Khyber Pakhtunkhwa (35 districts) |
| `checkpoint9a.png` | 9 | The comparison table and the answers to questions 1 and 2 |
| `checkpoint9b.png` | 9 | The 1/cos² table, the answer to question 3, and the projected layers in QGIS |

Checkpoint 8 is one image holding both states — the handout asks for two, and a
single stacked image satisfies that. Checkpoint 9 needs two, since the answer
spans more than one page.

## Filenames are case sensitive

GitHub and GitHub Pages treat `Checkpoint1.png` and `checkpoint1.png` as
different files. On macOS the filesystem usually does not, so a wrong-case name
can look correct locally and break once published. Keep them exactly as above.

## Size

These ten images total about 12 MB. That is acceptable, but if you want to trim
it, `checkpoint6.png` and `checkpoint8.png` are the two largest and both compress
well with no visible loss:

```
sips -Z 1600 -s format png checkpoint6.png --out checkpoint6.png
```

`-Z 1600` caps the longest side at 1600 pixels.
