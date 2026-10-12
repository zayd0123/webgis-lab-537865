#!/usr/bin/env bash
#
# Lab 3, Part 2 - capture Checkpoint 2 from the QGIS APPLICATION itself.
#
#   bash lab3/capture_qgis_app.sh [outPng]
#
# Opens lab3/sibi_centroid_map_view.qgz in QGIS and captures its window, so the
# figure shows the real application: the Browser and Layers panels with
# Centroids and Point on Surface ticked, the styled map canvas, the coordinate
# readout and the scale in the status bar.
#
# The window is captured with `screencapture -l <windowId>`, the id coming from
# CGWindowListCopyWindowInfo through CoreGraphics, so no Accessibility
# permission is needed. This is what a screenshot utility produces for a single
# window; the app is not involved.
#
# If you would rather use your own screenshot utility, open the same project in
# QGIS and shoot the window - the project carries the styles and the extent, so
# there is nothing to set up by hand.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LAB="$REPO/lab3"
PROJECT="$LAB/sibi_centroid_map_view.qgz"
OUT="${1:-$LAB/Report/checkpoint2_sibi_qgis_application.png}"
QGIS_APP="/Applications/QGIS-final-4_2_3.app"

mkdir -p "$(dirname "$OUT")"

if [ ! -f "$PROJECT" ]; then
  echo "$PROJECT is missing - run lab3/qgis_project_setup.py first" >&2
  exit 1
fi

echo "opening $PROJECT in QGIS ..."
open -a "$QGIS_APP" "$PROJECT"
# QGIS has to start, restore the project and redraw. The redraw is the slow
# part, and guessing at a delay catches it mid-restore, so the window is probed
# until two captures in a row come out the same size: that means the canvas has
# stopped repainting and the saved extent is on screen.
sleep 20

open -a "$QGIS_APP"
sleep 3

find_window() {
python3 - <<'PY'
import ctypes

cg = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

cg.CGWindowListCopyWindowInfo.restype = ctypes.c_void_p
cg.CGWindowListCopyWindowInfo.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
cf.CFArrayGetCount.restype = ctypes.c_long
cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
cf.CFDictionaryGetValue.restype = ctypes.c_void_p
cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
cf.CFStringGetCString.restype = ctypes.c_bool
cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
cf.CFNumberGetValue.restype = ctypes.c_bool
cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p]


def key(name):
    return cf.CFStringCreateWithCString(None, name.encode(), 0)


def sval(d, name):
    v = cf.CFDictionaryGetValue(d, key(name))
    if not v:
        return None
    buf = ctypes.create_string_buffer(2048)
    return buf.value.decode() if cf.CFStringGetCString(v, buf, 2048, 0x08000100) else None


def ival(d, name):
    v = cf.CFDictionaryGetValue(d, key(name))
    if not v:
        return None
    out = ctypes.c_longlong(0)
    cf.CFNumberGetValue(v, 4, ctypes.byref(out))
    return out.value


windows = cg.CGWindowListCopyWindowInfo(1, 0)
for i in range(cf.CFArrayGetCount(windows)):
    d = cf.CFArrayGetValueAtIndex(windows, i)
    owner = sval(d, 'kCGWindowOwnerName') or ''
    if 'QGIS' in owner and ival(d, 'kCGWindowLayer') == 0:
        print(ival(d, 'kCGWindowNumber'))
        break
PY
}

WIN_ID=""
for _ in $(seq 1 12); do
  WIN_ID="$(find_window)"
  [ -n "$WIN_ID" ] && break
  sleep 2
done

if [ -z "$WIN_ID" ]; then
  echo "no QGIS window found to capture" >&2
  exit 1
fi

PROBE="$(mktemp -t lab3qgis)"
PROBE="$PROBE.png"
prev=0
for attempt in $(seq 1 12); do
  sleep 5
  screencapture -x -o -l "$WIN_ID" "$PROBE" 2>/dev/null
  now="$(stat -f%z "$PROBE" 2>/dev/null || echo 0)"
  # two captures the same size to within a tenth of a percent means the canvas
  # has stopped repainting, so the project's extent has been restored
  diff=$(( now > prev ? now - prev : prev - now ))
  if [ "$prev" -gt 100000 ] && [ "$diff" -lt $(( prev / 1000 )) ]; then
    echo "map settled after about $(( attempt * 5 + 20 ))s"
    break
  fi
  prev="$now"
done
rm -f "$PROBE"

echo "capturing QGIS window $WIN_ID ..."
screencapture -x -o -l "$WIN_ID" "$OUT"
echo "wrote $OUT ($(stat -f%z "$OUT") bytes)"

WIN_ID="$(
python3 - <<'PY'
import ctypes

cg = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')

cg.CGWindowListCopyWindowInfo.restype = ctypes.c_void_p
cg.CGWindowListCopyWindowInfo.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
cf.CFArrayGetCount.restype = ctypes.c_long
cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
cf.CFDictionaryGetValue.restype = ctypes.c_void_p
cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
cf.CFStringGetCString.restype = ctypes.c_bool
cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
cf.CFNumberGetValue.restype = ctypes.c_bool
cf.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p]


def key(name):
    return cf.CFStringCreateWithCString(None, name.encode(), 0)


def sval(d, name):
    v = cf.CFDictionaryGetValue(d, key(name))
    if not v:
        return None
    buf = ctypes.create_string_buffer(2048)
    return buf.value.decode() if cf.CFStringGetCString(v, buf, 2048, 0x08000100) else None


def ival(d, name):
    v = cf.CFDictionaryGetValue(d, key(name))
    if not v:
        return None
    out = ctypes.c_longlong(0)
    cf.CFNumberGetValue(v, 4, ctypes.byref(out))
    return out.value


windows = cg.CGWindowListCopyWindowInfo(1, 0)
for i in range(cf.CFArrayGetCount(windows)):
    d = cf.CFArrayGetValueAtIndex(windows, i)
    owner = sval(d, 'kCGWindowOwnerName') or ''
    if 'QGIS' in owner and ival(d, 'kCGWindowLayer') == 0:
        print(ival(d, 'kCGWindowNumber'))
        break
PY
)"

if [ -z "$WIN_ID" ]; then
  echo "no QGIS window found to capture" >&2
  exit 1
fi

echo "capturing QGIS window $WIN_ID ..."
screencapture -x -o -l "$WIN_ID" "$OUT"
echo "wrote $OUT ($(stat -f%z "$OUT") bytes)"
