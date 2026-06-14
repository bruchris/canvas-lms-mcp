// Self-contained widget for `view_account_notifications`. The host injects a
// CallToolResult into a known sink (e.g., `window.openai.toolResult`); the widget
// renders an interactive panel of institution announcements without making any
// network requests. Announcement `message` bodies are institution-authored HTML
// and are rendered through an allowlist sanitizer (no script execution, no remote
// resource loads). CSP intentionally empty.
export const ACCOUNT_NOTIFICATIONS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Institution Announcements</title>
<style>
  :root {
    color-scheme: light dark;
    --fg: #1f2328;
    --fg-muted: #6e7781;
    --bg: #ffffff;
    --bg-subtle: #f6f8fa;
    --border: #d0d7de;
    --accent: #0969da;
    --pill-bg: #eaeef2;
    --pill-fg: #1f2328;
    --pill-on-bg: #0969da;
    --pill-on-fg: #ffffff;
    --info-bg: #ddf4ff;
    --info-fg: #0550ae;
    --warn-bg: #fff8c5;
    --warn-fg: #7d4e00;
    --question-bg: #fbefff;
    --question-fg: #6639ba;
    --error-bg: #ffebe9;
    --error-fg: #cf222e;
    --calendar-bg: #dafbe1;
    --calendar-fg: #1a7f37;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e6edf3;
      --fg-muted: #8b949e;
      --bg: #0d1117;
      --bg-subtle: #161b22;
      --border: #30363d;
      --accent: #58a6ff;
      --pill-bg: #21262d;
      --pill-fg: #e6edf3;
      --pill-on-bg: #1f6feb;
      --pill-on-fg: #ffffff;
      --info-bg: #0c2d6b;
      --info-fg: #a5d6ff;
      --warn-bg: #3a2c00;
      --warn-fg: #f0c674;
      --question-bg: #2c1e44;
      --question-fg: #d2a8ff;
      --error-bg: #4c1118;
      --error-fg: #ffaba8;
      --calendar-bg: #0f3d22;
      --calendar-fg: #7ee2a8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.5;
  }
  .summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 8px 12px;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .summary strong { font-size: 15px; }
  .summary .by-type { color: var(--fg-muted); }
  .controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .search {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .search:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    border: 1px solid var(--border);
    background: var(--pill-bg);
    color: var(--pill-fg);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .chip.on { background: var(--pill-on-bg); color: var(--pill-on-fg); border-color: transparent; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    padding: 10px 12px;
  }
  .card.hidden { display: none; }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .subject { font-weight: 600; font-size: 15px; }
  .type-badge {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 999px;
    text-transform: capitalize;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }
  .type-badge.info { background: var(--info-bg); color: var(--info-fg); }
  .type-badge.warn { background: var(--warn-bg); color: var(--warn-fg); }
  .type-badge.question { background: var(--question-bg); color: var(--question-fg); }
  .type-badge.error { background: var(--error-bg); color: var(--error-fg); }
  .type-badge.calendar { background: var(--calendar-bg); color: var(--calendar-fg); }
  .type-badge.neutral { background: var(--pill-bg); color: var(--pill-fg); }
  .dates { color: var(--fg-muted); font-size: 12px; margin-top: 2px; }
  .msg { margin-top: 8px; overflow-wrap: anywhere; }
  .msg p { margin: 0 0 8px; }
  .msg p:last-child { margin-bottom: 0; }
  .msg a { color: var(--accent); }
  .msg ul, .msg ol { margin: 0 0 8px; padding-left: 20px; }
  .msg pre {
    background: var(--bg-subtle);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
  }
  .msg code { background: var(--bg-subtle); padding: 1px 4px; border-radius: 3px; }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    border: 1px dashed var(--border);
    border-radius: 6px;
  }
</style>
</head>
<body>
<div id="root" class="empty">Loading announcements…</div>
<script>
(function () {
  'use strict';

  // Canvas account_notification icon values.
  var TYPE_INFO = {
    information: { cls: 'info', label: 'information' },
    warning: { cls: 'warn', label: 'warning' },
    question: { cls: 'question', label: 'question' },
    error: { cls: 'error', label: 'error' },
    calendar: { cls: 'calendar', label: 'calendar' }
  };
  var TYPE_ORDER = ['information', 'warning', 'question', 'error', 'calendar'];

  // Allowlist sanitizer: only these inline/structural tags survive; everything else
  // is either dropped entirely (scripts, styles, embeds) or unwrapped to its text.
  var ALLOWED_TAGS = {
    A: 1, ABBR: 1, B: 1, BLOCKQUOTE: 1, BR: 1, CODE: 1, DD: 1, DIV: 1, DL: 1,
    DT: 1, EM: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HR: 1, I: 1, LI: 1,
    OL: 1, P: 1, PRE: 1, SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, U: 1, UL: 1
  };
  var DROP_TAGS = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1,
    TEMPLATE: 1, NOSCRIPT: 1, FORM: 1, INPUT: 1, BUTTON: 1, IMG: 1, SVG: 1
  };

  function readPayload() {
    // Multi-sink probe: try documented hosts in order, fall back to a known shim variable.
    try {
      var openai = window.openai;
      if (openai && openai.toolResult) return openai.toolResult;
    } catch (_) {}
    try {
      if (window.__MCP_TOOL_RESULT__) return window.__MCP_TOOL_RESULT__;
    } catch (_) {}
    return null;
  }

  function looksLikeNotifications(value) {
    if (!Array.isArray(value)) return false;
    if (value.length === 0) return true;
    var first = value[0];
    return !!first && typeof first === 'object' &&
      ('subject' in first || 'message' in first || 'icon' in first);
  }

  function extractNotifications(result) {
    if (looksLikeNotifications(result)) return result;
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
      for (var i = 0; i < result.content.length; i++) {
        var block = result.content[i];
        if (block && block.type === 'text' && typeof block.text === 'string') {
          try {
            var parsed = JSON.parse(block.text);
            if (looksLikeNotifications(parsed)) return parsed;
          } catch (_) {}
        }
      }
    }
    return null;
  }

  function renderEmpty(message) {
    var root = document.getElementById('root');
    root.className = 'empty';
    root.textContent = '';
    var p = document.createElement('div');
    p.textContent = message;
    root.appendChild(p);
  }

  function renderUnsupportedHost() {
    renderEmpty('Open this tool in a host that supports MCP Apps to see the interactive announcements panel.');
  }

  function renderUnexpectedShape() {
    renderEmpty('Unexpected payload shape — expected list_account_notifications response.');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i] != null) node.appendChild(children[i]);
      }
    }
    return node;
  }

  function safeUrl(value) {
    var v = (value == null ? '' : String(value)).trim();
    if (/^https?:\\/\\//i.test(v)) return v;
    if (/^mailto:/i.test(v)) return v;
    return null;
  }

  function sanitizeInto(source, target) {
    var nodes = source.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var child = nodes[i];
      if (child.nodeType === 3) {
        target.appendChild(document.createTextNode(child.nodeValue));
      } else if (child.nodeType === 1) {
        var tag = child.tagName;
        if (ALLOWED_TAGS[tag]) {
          var clean = document.createElement(tag.toLowerCase());
          if (tag === 'A') {
            var href = safeUrl(child.getAttribute('href'));
            if (href) {
              clean.setAttribute('href', href);
              clean.setAttribute('target', '_blank');
              clean.setAttribute('rel', 'noopener noreferrer');
            }
          }
          sanitizeInto(child, clean);
          target.appendChild(clean);
        } else if (!DROP_TAGS[tag]) {
          // Unknown but harmless container (e.g. TABLE/TD): unwrap, keep text.
          sanitizeInto(child, target);
        }
        // DROP_TAGS are skipped entirely — their contents never reach the DOM.
      }
      // Comments and other node types are ignored.
    }
  }

  function renderMessage(html) {
    var container = el('div', { class: 'msg' });
    var raw = html == null ? '' : String(html);
    try {
      var doc = new DOMParser().parseFromString(raw, 'text/html');
      sanitizeInto(doc.body, container);
    } catch (_) {
      container.textContent = raw;
    }
    return container;
  }

  function formatDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return d.toISOString();
    }
  }

  function dateRange(note) {
    var start = formatDate(note.start_at);
    var end = formatDate(note.end_at);
    if (start && end) return 'Active ' + start + ' – ' + end;
    if (start) return 'Starts ' + start;
    if (end) return 'Ends ' + end;
    return null;
  }

  function render(notifications) {
    var root = document.getElementById('root');
    root.className = '';
    root.textContent = '';

    var counts = {};
    notifications.forEach(function (note) {
      var icon = note && note.icon;
      if (TYPE_INFO[icon]) counts[icon] = (counts[icon] || 0) + 1;
    });
    var presentTypes = TYPE_ORDER.filter(function (t) {
      return Object.prototype.hasOwnProperty.call(counts, t);
    });

    // Summary header.
    var total = notifications.length;
    var summaryEl = el('div', { class: 'summary' }, [
      el('strong', { text: total + (total === 1 ? ' announcement' : ' announcements') })
    ]);
    if (presentTypes.length) {
      var byType = presentTypes.map(function (t) { return t + ': ' + counts[t]; }).join(' • ');
      summaryEl.appendChild(el('span', { class: 'by-type', text: byType }));
    }
    root.appendChild(summaryEl);

    // Controls: search + type filter chips.
    var search = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search announcements by subject…',
      'aria-label': 'Search announcements by subject'
    });

    var activeTypes = {};
    var chipsContainer = el('div', { class: 'chips' });
    presentTypes.forEach(function (t) {
      var chip = el('button', { class: 'chip', type: 'button', text: t });
      chip.addEventListener('click', function () {
        if (activeTypes[t]) {
          delete activeTypes[t];
          chip.classList.remove('on');
        } else {
          activeTypes[t] = true;
          chip.classList.add('on');
        }
        applyFilter();
      });
      chipsContainer.appendChild(chip);
    });

    var controlsChildren = [search];
    if (presentTypes.length) controlsChildren.push(chipsContainer);
    root.appendChild(el('div', { class: 'controls' }, controlsChildren));

    // Announcement cards.
    var cardsContainer = el('div', { class: 'cards' });
    var cardNodes = [];

    notifications.forEach(function (note) {
      var icon = note && note.icon;
      var typeInfo = TYPE_INFO[icon];
      var badgeCls = typeInfo ? typeInfo.cls : 'neutral';
      var badgeLabel = typeInfo ? typeInfo.label : (icon || 'announcement');

      var head = el('div', { class: 'card-head' }, [
        el('span', { class: 'type-badge ' + badgeCls, text: badgeLabel }),
        el('span', { class: 'subject', text: (note && note.subject) || '(no subject)' })
      ]);

      var children = [head];
      var range = dateRange(note || {});
      if (range) children.push(el('div', { class: 'dates', text: range }));
      if (note && note.message) children.push(renderMessage(note.message));

      var card = el('div', { class: 'card' }, children);
      card.dataset.type = (icon || '');
      card.dataset.subject = ((note && note.subject) || '').toLowerCase();
      cardsContainer.appendChild(card);
      cardNodes.push(card);
    });
    root.appendChild(cardsContainer);

    function applyFilter() {
      var q = search.value.trim().toLowerCase();
      var typeKeys = Object.keys(activeTypes);
      var hasTypeFilter = typeKeys.length > 0;
      for (var i = 0; i < cardNodes.length; i++) {
        var node = cardNodes[i];
        var typeOk = !hasTypeFilter || !!activeTypes[node.dataset.type];
        var textOk = !q || node.dataset.subject.indexOf(q) !== -1;
        node.classList.toggle('hidden', !(typeOk && textOk));
      }
    }

    search.addEventListener('input', applyFilter);
  }

  function init() {
    var payload = readPayload();
    if (payload == null) {
      renderUnsupportedHost();
      return;
    }
    var notifications = extractNotifications(payload);
    if (!notifications) {
      renderUnexpectedShape();
      return;
    }
    if (notifications.length === 0) {
      renderEmpty('No active institution announcements.');
      return;
    }
    try {
      render(notifications);
    } catch (err) {
      console.error('view_account_notifications render error', err);
      renderUnexpectedShape();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
</body>
</html>`
