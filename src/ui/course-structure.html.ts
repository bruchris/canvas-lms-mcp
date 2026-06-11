// Self-contained widget for `view_course_structure`. The host injects a CallToolResult
// into a known sink (e.g., `window.openai.toolResult`); the widget renders an
// interactive tree without making any network requests. CSP intentionally empty.
export const COURSE_STRUCTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Course Structure</title>
<style>
  :root {
    color-scheme: light dark;
    --fg: #1f2328;
    --fg-muted: #6e7781;
    --bg: #ffffff;
    --bg-subtle: #f6f8fa;
    --border: #d0d7de;
    --accent: #0969da;
    --warn: #9a6700;
    --pill-bg: #eaeef2;
    --pill-fg: #1f2328;
    --pill-on-bg: #0969da;
    --pill-on-fg: #ffffff;
    --unpub-bg: #fff8c5;
    --unpub-fg: #7d4e00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e6edf3;
      --fg-muted: #8b949e;
      --bg: #0d1117;
      --bg-subtle: #161b22;
      --border: #30363d;
      --accent: #58a6ff;
      --warn: #d29922;
      --pill-bg: #21262d;
      --pill-fg: #e6edf3;
      --pill-on-bg: #1f6feb;
      --pill-on-fg: #ffffff;
      --unpub-bg: #3a2c00;
      --unpub-fg: #f0c674;
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
  .modules { display: flex; flex-direction: column; gap: 8px; }
  details.module {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }
  details.module > summary {
    padding: 8px 12px;
    background: var(--bg-subtle);
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  details.module > summary::-webkit-details-marker { display: none; }
  details.module > summary::before {
    content: "▶";
    font-size: 10px;
    color: var(--fg-muted);
    transition: transform 0.15s ease;
  }
  details.module[open] > summary::before { transform: rotate(90deg); }
  .module-title { font-weight: 600; }
  .module-meta { color: var(--fg-muted); font-size: 12px; }
  ul.items { list-style: none; margin: 0; padding: 4px 12px 8px 28px; }
  ul.items li {
    padding: 4px 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  ul.items li.hidden { display: none; }
  .type-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--fg-muted);
    min-width: 84px;
  }
  .item-title { color: var(--accent); text-decoration: none; }
  .item-title:hover { text-decoration: underline; }
  .item-title.no-link { color: var(--fg); }
  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .badge.unpublished { background: var(--unpub-bg); color: var(--unpub-fg); }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    border: 1px dashed var(--border);
    border-radius: 6px;
  }
  .empty code {
    background: var(--bg-subtle);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
</head>
<body>
<div id="root" class="empty">Loading course structure…</div>
<script>
(function () {
  'use strict';

  var ITEM_TYPES = [
    'Assignment',
    'Page',
    'Quiz',
    'File',
    'Discussion',
    'ExternalUrl',
    'ExternalTool',
    'SubHeader',
  ];

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

  function extractStructure(result) {
    if (!result || typeof result !== 'object') return null;
    // Some hosts pass the CallToolResult envelope, others pass the parsed payload directly.
    if (Array.isArray(result.modules) && result.summary) return result;
    if (Array.isArray(result.content)) {
      for (var i = 0; i < result.content.length; i++) {
        var block = result.content[i];
        if (block && block.type === 'text' && typeof block.text === 'string') {
          try {
            var parsed = JSON.parse(block.text);
            if (parsed && Array.isArray(parsed.modules) && parsed.summary) return parsed;
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
    renderEmpty('Open this tool in a host that supports MCP Apps to see the interactive course structure tree.');
  }

  function renderUnexpectedShape() {
    renderEmpty('Unexpected payload shape — expected get_course_structure response.');
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

  function renderStructure(data) {
    var root = document.getElementById('root');
    root.className = '';
    root.textContent = '';

    var summary = data.summary || {};
    var itemsByType = summary.items_by_type || {};
    var typeChips = ITEM_TYPES.filter(function (t) {
      return Object.prototype.hasOwnProperty.call(itemsByType, t);
    });

    // Summary header.
    var summaryEl = el('div', { class: 'summary' }, [
      el('strong', { text: (summary.total_modules || 0) + ' modules' }),
      el('span', { text: (summary.total_items || 0) + ' items' }),
    ]);
    if (typeChips.length) {
      var byType = typeChips
        .map(function (t) {
          return t + ': ' + itemsByType[t];
        })
        .join(' • ');
      summaryEl.appendChild(el('span', { class: 'by-type', text: byType }));
    }
    root.appendChild(summaryEl);

    // Controls: search + filter chips.
    var search = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search items by title…',
      'aria-label': 'Search items by title',
    });

    var activeTypes = {};
    var chipEls = {};
    var chipsContainer = el('div', { class: 'chips' });
    typeChips.forEach(function (t) {
      var chip = el('button', { class: 'chip', type: 'button', text: t });
      chipEls[t] = chip;
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
    root.appendChild(el('div', { class: 'controls' }, [search, chipsContainer]));

    // Module tree.
    var modulesContainer = el('div', { class: 'modules' });
    var itemNodes = [];

    (data.modules || []).forEach(function (mod) {
      var moduleDetails = el('details', { class: 'module' });
      moduleDetails.open = true;
      var headerLabel = mod.name || 'Module ' + (mod.id != null ? mod.id : '');
      var moduleMeta = '';
      var itemsCount = Array.isArray(mod.items) ? mod.items.length : 0;
      moduleMeta = itemsCount + (itemsCount === 1 ? ' item' : ' items');
      if (mod.state && mod.state !== 'active') moduleMeta += ' • ' + mod.state;
      var moduleSummary = el('summary', null, [
        el('span', { class: 'module-title', text: headerLabel }),
        el('span', { class: 'module-meta', text: moduleMeta }),
      ]);
      moduleDetails.appendChild(moduleSummary);

      var itemList = el('ul', { class: 'items' });
      (mod.items || []).forEach(function (item) {
        var titleNode;
        if (item.html_url) {
          titleNode = el('a', {
            class: 'item-title',
            href: item.html_url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: item.title || '(untitled)',
          });
        } else {
          titleNode = el('span', { class: 'item-title no-link', text: item.title || '(untitled)' });
        }
        var children = [el('span', { class: 'type-tag', text: item.type || 'Unknown' }), titleNode];
        if (item.published === false) {
          children.push(el('span', { class: 'badge unpublished', text: 'unpublished' }));
        }
        var li = el('li', null, children);
        li.dataset.type = item.type || '';
        li.dataset.title = (item.title || '').toLowerCase();
        itemList.appendChild(li);
        itemNodes.push(li);
      });
      moduleDetails.appendChild(itemList);
      modulesContainer.appendChild(moduleDetails);
    });
    root.appendChild(modulesContainer);

    function applyFilter() {
      var q = search.value.trim().toLowerCase();
      var typeKeys = Object.keys(activeTypes);
      var hasTypeFilter = typeKeys.length > 0;
      for (var i = 0; i < itemNodes.length; i++) {
        var node = itemNodes[i];
        var typeOk = !hasTypeFilter || !!activeTypes[node.dataset.type];
        var textOk = !q || node.dataset.title.indexOf(q) !== -1;
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
    var structure = extractStructure(payload);
    if (!structure) {
      renderUnexpectedShape();
      return;
    }
    try {
      renderStructure(structure);
    } catch (err) {
      console.error('view_course_structure render error', err);
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
