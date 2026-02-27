/**
 * HTML generation for VS Code Webview panels
 */

/** Generate the HTML for the search panel */
export function getSearchHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Search</title>
  <style>
    body {
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .search-bar {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    input {
      flex: 1;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #ccc);
      border-radius: 2px;
      outline: none;
      font-size: inherit;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    button {
      padding: 4px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: inherit;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .result-item {
      padding: 6px;
      margin-bottom: 4px;
      border-left: 2px solid var(--vscode-textLink-foreground);
      background: var(--vscode-list-hoverBackground);
      cursor: pointer;
      border-radius: 0 2px 2px 0;
    }
    .result-item:hover {
      background: var(--vscode-list-activeSelectionBackground);
    }
    .result-title {
      font-weight: bold;
      font-size: 0.9em;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .result-content {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      max-height: 60px;
      overflow: hidden;
    }
    .result-meta {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .status {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 4px 0;
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="search-bar">
    <input type="text" id="query" placeholder="Search memories..." autofocus>
    <button id="searchBtn">Search</button>
  </div>
  <div id="status" class="status">Type to search memories.</div>
  <div id="results"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const queryInput = document.getElementById('query');
    const searchBtn = document.getElementById('searchBtn');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');

    function search() {
      const query = queryInput.value.trim();
      if (!query) return;
      statusEl.textContent = 'Searching...';
      resultsEl.innerHTML = '';
      vscode.postMessage({ type: 'search', query });
    }

    searchBtn.addEventListener('click', search);
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') search();
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'searchResults') {
        statusEl.textContent = message.items.length
          ? \`\${message.items.length} result(s)\`
          : 'No results found.';
        resultsEl.innerHTML = message.items.map((item) => \`
          <div class="result-item" data-id="\${item.id}">
            <div class="result-title">\${escapeHtml(item.title || item.id)}</div>
            <div class="result-content">\${escapeHtml((item.content || '').slice(0, 200))}</div>
            <div class="result-meta">\${escapeHtml(item.created_at || '')}</div>
          </div>
        \`).join('');

        document.querySelectorAll('.result-item').forEach((el) => {
          el.addEventListener('click', () => {
            vscode.postMessage({ type: 'showTimeline', id: el.dataset.id });
          });
        });
      }
      if (message.type === 'error') {
        statusEl.className = 'status error';
        statusEl.textContent = 'Error: ' + message.error;
      }
    });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
}

/** Generate the HTML for the timeline panel */
export function getTimelineHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Timeline</title>
  <style>
    body {
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .obs-item {
      padding: 6px;
      margin-bottom: 6px;
      border-left: 2px solid var(--vscode-textLink-foreground);
      background: var(--vscode-list-hoverBackground);
      border-radius: 0 2px 2px 0;
    }
    .obs-item.current {
      border-color: var(--vscode-activityBarBadge-background);
      background: var(--vscode-list-activeSelectionBackground);
    }
    .obs-title {
      font-weight: bold;
      font-size: 0.9em;
      margin-bottom: 2px;
    }
    .obs-content {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .obs-meta {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .status {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      padding: 4px 0;
    }
    .placeholder {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      padding: 8px 0;
    }
  </style>
</head>
<body>
  <div id="status" class="status">Click a search result to view its timeline.</div>
  <div id="timeline"></div>

  <script nonce="${nonce}">
    const timelineEl = document.getElementById('timeline');
    const statusEl = document.getElementById('status');

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'timelineResult') {
        const items = message.items;
        statusEl.textContent = items.length + ' observation(s)';
        timelineEl.innerHTML = items.map((item) => \`
          <div class="obs-item \${item.isCurrent ? 'current' : ''}">
            <div class="obs-title">\${escapeHtml(item.title || item.id)}</div>
            <div class="obs-content">\${escapeHtml((item.content || '').slice(0, 300))}</div>
            <div class="obs-meta">\${escapeHtml(item.created_at || '')}</div>
          </div>
        \`).join('');
      }
      if (message.type === 'error') {
        statusEl.textContent = 'Error: ' + message.error;
      }
    });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
}
