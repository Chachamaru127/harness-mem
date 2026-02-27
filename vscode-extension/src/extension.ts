/**
 * harness-mem VS Code Extension
 *
 * Provides a sidebar with memory search and timeline views.
 * Uses the harness-mem HTTP API directly (no external npm dependencies).
 */

import * as vscode from "vscode";
import * as crypto from "crypto";
import { HarnessMemApiClient, type SearchItem, type ObservationItem } from "./client";
import { getSearchHtml, getTimelineHtml } from "./webview";

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function getConfig() {
  const config = vscode.workspace.getConfiguration("harness-mem");
  const serverUrl = (config.get<string>("serverUrl") || "http://localhost:37888").trim();
  const defaultProject = (config.get<string>("defaultProject") || "").trim();
  const includePrivate = config.get<boolean>("includePrivate") || false;
  const project = defaultProject || vscode.workspace.workspaceFolders?.[0]?.name || "";
  return { serverUrl, project, includePrivate };
}

class SearchViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private timelineView?: TimelineViewProvider;

  constructor(
    private readonly extensionUri: vscode.Uri
  ) {}

  setTimelineView(provider: TimelineViewProvider): void {
    this.timelineView = provider;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const nonce = getNonce();
    webviewView.webview.html = getSearchHtml(nonce, webviewView.webview.cspSource);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; query?: string; id?: string }) => {
      if (message.type === "search" && message.query) {
        await this.handleSearch(message.query);
      }
      if (message.type === "showTimeline" && message.id) {
        await this.timelineView?.showTimeline(message.id);
      }
    });
  }

  private async handleSearch(query: string): Promise<void> {
    if (!this.view) return;

    const { serverUrl, project, includePrivate } = getConfig();
    const client = new HarnessMemApiClient(serverUrl);

    try {
      const result = await client.search({
        query,
        project: project || undefined,
        limit: 20,
        include_private: includePrivate,
      });

      if (result.ok) {
        this.view.webview.postMessage({
          type: "searchResults",
          items: result.items as SearchItem[],
        });
      } else {
        this.view.webview.postMessage({
          type: "error",
          error: result.error || "Unknown error",
        });
      }
    } catch (err) {
      this.view.webview.postMessage({
        type: "error",
        error: String(err),
      });
    }
  }

  async search(query: string): Promise<void> {
    await this.handleSearch(query);
  }
}

class TimelineViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const nonce = getNonce();
    webviewView.webview.html = getTimelineHtml(nonce, webviewView.webview.cspSource);
  }

  async showTimeline(observationId: string): Promise<void> {
    if (!this.view) return;

    const { serverUrl, includePrivate } = getConfig();
    const client = new HarnessMemApiClient(serverUrl);

    try {
      const result = await client.timeline({
        id: observationId,
        before: 3,
        after: 3,
        include_private: includePrivate,
      });

      if (result.ok) {
        const items = (result.items as ObservationItem[]).map((item) => ({
          ...item,
          isCurrent: item.id === observationId,
        }));

        this.view.webview.postMessage({
          type: "timelineResult",
          items,
        });

        // Focus timeline view
        await vscode.commands.executeCommand("harness-mem.timeline.focus");
      } else {
        this.view.webview.postMessage({
          type: "error",
          error: result.error || "Unknown error",
        });
      }
    } catch (err) {
      this.view.webview.postMessage({
        type: "error",
        error: String(err),
      });
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const searchProvider = new SearchViewProvider(context.extensionUri);
  const timelineProvider = new TimelineViewProvider(context.extensionUri);
  searchProvider.setTimelineView(timelineProvider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("harness-mem.search", searchProvider),
    vscode.window.registerWebviewViewProvider("harness-mem.timeline", timelineProvider)
  );

  // Command: Search (opens search panel)
  context.subscriptions.push(
    vscode.commands.registerCommand("harness-mem.search", async () => {
      await vscode.commands.executeCommand("harness-mem.search.focus");
      const query = await vscode.window.showInputBox({
        prompt: "Search memories",
        placeHolder: "Enter search query...",
      });
      if (query) {
        await searchProvider.search(query);
      }
    })
  );

  // Command: Show Timeline (for selected observation)
  context.subscriptions.push(
    vscode.commands.registerCommand("harness-mem.timeline", async () => {
      const id = await vscode.window.showInputBox({
        prompt: "Enter observation ID for timeline",
        placeHolder: "obs_...",
      });
      if (id) {
        await timelineProvider.showTimeline(id);
      }
    })
  );

  // Command: Configure Server
  context.subscriptions.push(
    vscode.commands.registerCommand("harness-mem.configureServer", async () => {
      const url = await vscode.window.showInputBox({
        prompt: "harness-mem server URL",
        value: getConfig().serverUrl,
      });
      if (url) {
        await vscode.workspace.getConfiguration("harness-mem").update(
          "serverUrl",
          url,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(`harness-mem: Server URL set to ${url}`);
      }
    })
  );

  // Check server health on activation (silent, for status bar)
  const { serverUrl } = getConfig();
  const client = new HarnessMemApiClient(serverUrl, 3000);
  client.health().then((result) => {
    if (!result.ok) {
      vscode.window.showWarningMessage(
        `harness-mem: Server not reachable at ${serverUrl}. Run 'harness-mem start' to start the server.`
      );
    }
  }).catch(() => {
    // Silent - server may not be running
  });
}

export function deactivate(): void {
  // No cleanup needed
}
