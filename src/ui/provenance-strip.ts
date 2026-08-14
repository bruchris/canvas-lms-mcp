// Widget-side removal of the provenance fence annotations.
//
// Design: docs/superpowers/specs/2026-08-11-bru-2104-provenance-fencing.md §8.3
// (BRU-2183). The model-facing boundary wraps Canvas-authored text in fence
// markers so the model reads it as data. Those markers are addressed to the
// model; a human looking at an MCP Apps widget must never see them. This is the
// widget half of that contract, and it is what allows the two UI-bound tools to
// be fenced at all.

import { MARKER_CLOSE, MARKER_OPEN_PREFIX, MARKER_OPEN_SUFFIX } from './../provenance/markers'

/**
 * The longest label the widget will honour. Server labels come from
 * `src/provenance/fields.ts` and are short phrases ("submission body", the
 * longest today is 25 characters); `tests/ui/provenance-strip.test.ts` asserts
 * every one of them fits, so raising a label past this bound fails CI rather
 * than silently leaving markers on screen.
 */
const MAX_LABEL_LENGTH = 64

/**
 * ES5 source for the widget-side strip, interpolated into both widget HTMLs.
 *
 * It is a **source string rather than a function** for the same reason the
 * account-notifications sanitiser policy is: the widgets ship as self-contained
 * HTML documents and cannot import anything, yet the logic has to be executed
 * by a test to be worth having. `tests/ui/provenance-strip.test.ts` runs this
 * exact string. A TypeScript twin of the algorithm would go green while the
 * shipped widget was broken.
 *
 * The marker literals are interpolated from `src/provenance/markers.ts` — the
 * single compatibility surface (§5.2). They are never re-declared here, so the
 * server and the widgets cannot drift apart.
 *
 * Exposes `stripFences`, `stripFencesDeep` and `isFenceLabel` into the
 * enclosing scope.
 */
export const PROVENANCE_STRIP_JS = `
  // --- Provenance fence stripping (BRU-2104 §8.3) ---------------------------
  // Generated from src/ui/provenance-strip.ts. Marker literals come from
  // src/provenance/markers.ts; do not hand-edit them here.
  var FENCE_OPEN_PREFIX = ${JSON.stringify(MARKER_OPEN_PREFIX)};
  var FENCE_OPEN_SUFFIX = ${JSON.stringify(MARKER_OPEN_SUFFIX)};
  var FENCE_CLOSE = ${JSON.stringify(MARKER_CLOSE)};
  var FENCE_MAX_LABEL = ${MAX_LABEL_LENGTH};

  // A label is a server-controlled literal naming the kind of text. Bounding it
  // is what keeps the strip exact: without this, marker-shaped text arriving
  // from anywhere could pair its own opening bracket with a genuine suffix far
  // away and delete everything in between.
  function isFenceLabel(label) {
    return label.length > 0 && label.length <= FENCE_MAX_LABEL &&
      label.indexOf('[') === -1 && label.indexOf(']') === -1 &&
      label.indexOf('\\n') === -1 && label.indexOf('\\r') === -1;
  }

  // Remove complete server fences, leaving the enclosed value and every other
  // character untouched. An unmatched or malformed marker is left visible on
  // purpose: it means something bypassed the boundary, and that should be loud.
  function stripFences(text) {
    if (typeof text !== 'string') return text;
    var out = '';
    var copied = 0;
    var searchFrom = 0;
    var changed = false;

    while (searchFrom < text.length) {
      var openAt = text.indexOf(FENCE_OPEN_PREFIX, searchFrom);
      if (openAt === -1) break;
      var labelAt = openAt + FENCE_OPEN_PREFIX.length;
      var suffixAt = text.indexOf(FENCE_OPEN_SUFFIX, labelAt);
      if (suffixAt === -1) break;
      if (!isFenceLabel(text.slice(labelAt, suffixAt))) {
        // Not a fence we authored. Resume after this opening bracket so a real
        // fence later in the string is still found.
        searchFrom = labelAt;
        continue;
      }
      var contentAt = suffixAt + FENCE_OPEN_SUFFIX.length;
      var closeAt = text.indexOf(FENCE_CLOSE, contentAt);
      if (closeAt === -1) break;

      // fence() joins with a single space, fenceBlock() with a single newline.
      // Exactly one separator comes off each side; the value's own padding stays.
      var start = contentAt;
      var end = closeAt;
      if (start < end && (text.charAt(start) === ' ' || text.charAt(start) === '\\n')) start++;
      if (end > start && (text.charAt(end - 1) === ' ' || text.charAt(end - 1) === '\\n')) end--;

      out += text.slice(copied, openAt) + text.slice(start, end);
      copied = closeAt + FENCE_CLOSE.length;
      searchFrom = copied;
      changed = true;
    }

    return changed ? out + text.slice(copied) : text;
  }

  // Copy-on-read walk over a parsed tool payload. Copies rather than mutates:
  // the payload belongs to the host, and a widget has no business editing it.
  function stripFencesDeep(value) {
    if (typeof value === 'string') return stripFences(value);
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(stripFencesDeep(value[i]));
      return arr;
    }
    if (value && typeof value === 'object') {
      var obj = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          obj[key] = stripFencesDeep(value[key]);
        }
      }
      return obj;
    }
    return value;
  }
`
