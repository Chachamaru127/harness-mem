/**
 * bun:test 用 DOM 環境セットアップ
 *
 * jsdom を使って document / localStorage / window などの
 * ブラウザ API を globalThis に注入する。
 * bunfig.toml の [test] preload で読み込まれる。
 *
 * 注意: globalThis.navigator は上書きしない。
 * jsdom の navigator.hardwareConcurrency が os.cpus() を呼び、
 * bun の os.cpus() が globalThis.navigator を参照して無限ループになるため。
 */

// DOM が既にある場合（ブラウザ環境等）はスキップ
if (typeof globalThis.document !== "undefined") {
  // already initialized
} else {
  const { JSDOM } = await import("jsdom");

  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
  });

  const { window } = dom;

  // Core DOM globals (navigator は除外 — 無限ループ防止)
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;

  // Storage
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;

  // DOM classes
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.NodeList = window.NodeList as unknown as typeof NodeList;
  globalThis.Text = window.Text;
  globalThis.Comment = window.Comment;
  globalThis.DocumentFragment = window.DocumentFragment;

  // Events
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.MessageEvent = window.MessageEvent;
  globalThis.EventTarget = window.EventTarget;
  globalThis.InputEvent = window.InputEvent;

  // Observers
  globalThis.MutationObserver = window.MutationObserver;

  // Range
  globalThis.Range = window.Range;
}
