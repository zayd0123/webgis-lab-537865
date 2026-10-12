#!/usr/bin/env bash
#
# Lab 3, Part 1 - capture Checkpoint 1: VS Code showing the lab3 folder with
# its three files and data/districts.geojson.
#
#   bash lab3/capture_vscode_folder.sh [outPng]
#
# Opens the folder in the real VS Code, waits for the window, and captures it
# with `screencapture -l <windowId>`. The window id comes from
# CGWindowListCopyWindowInfo via CoreGraphics, so no Accessibility permission
# is needed; the window is raised with `open -a` so it is not occluded.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LAB="$REPO/lab3"
OUT="${1:-$LAB/Report/checkpoint1_vscode_project_folder.png}"

VSCODE_APP="/Applications/Visual Studio Code.app"
CODE_CLI="/usr/local/bin/code"
[ -x "$CODE_CLI" ] || CODE_CLI="$VSCODE_APP/Contents/Resources/app/bin/code"

if [ ! -d "$LAB" ]; then
  echo "lab3 folder not found at $LAB" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"

echo "opening $LAB in VS Code ..."
# --reuse-window so repeated runs do not pile up windows; index.html is opened
# so the editor is showing a real file rather than the welcome tab.
"$CODE_CLI" --reuse-window "$LAB" "$LAB/index.html" >/dev/null 2>&1 || true

# give VS Code time to start, restore the previous workspace, and paint
sleep 12
open -a "$VSCODE_APP"
sleep 4

echo "finding the VS Code window ..."
WIN_ID="$(
python3 - <<'PY'
import ctypes, json

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

def key(n):
    return cf.CFStringCreateWithCString(None, n.encode(), 0)

def sval(d, n):
    v = cf.CFDictionaryGetValue(d, key(n))
    if not v:
        return None
    b = ctypes.create_string_buffer(2048)
    return b.value.decode() if cf.CFStringGetCString(v, b, 2048, 0x08000100) else None

def ival(d, n):
    v = cf.CFDictionaryGetValue(d, key(n))
    if not v:
        return None
    out = ctypes.c_longlong(0)
    cf.CFNumberGetValue(v, 4, ctypes.byref(out))
    return out.value

arr = cg.CGWindowListCopyWindowInfo(1, 0)
found = []
for i in range(cf.CFArrayGetCount(arr)):
    d = cf.CFArrayGetValueAtIndex(arr, i)
    owner = sval(d, 'kCGWindowOwnerName') or ''
    if 'Code' in owner and ival(d, 'kCGWindowLayer') == 0:
        found.append({'id': ival(d, 'kCGWindowNumber'),
                      'name': sval(d, 'kCGWindowName') or '',
                      'owner': owner})
# prefer a window that names the project, else the first Code window
pick = next((w for w in found if 'lab3' in w['name'] or 'webgis' in w['name']),
            found[0] if found else None)
print(pick['id'] if pick else '')
PY
)"

if [ -z "$WIN_ID" ]; then
  echo "no VS Code window found to capture" >&2
  exit 1
fi
echo "capturing window $WIN_ID ..."
screencapture -x -o -l "$WIN_ID" "$OUT"
echo "wrote $OUT ($(stat -f%z "$OUT") bytes)"
