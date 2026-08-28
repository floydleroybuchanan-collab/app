import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/player.tsx", import.meta.url), "utf8");
const boundarySource = await readFile(new URL("../src/components/ErrorBoundary.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("player.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const boundaryAst = ts.createSourceFile("ErrorBoundary.tsx", boundarySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function attribute(element, name) {
  const attr = element.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
  return attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
}
const playerBoundary = find(ast, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "ErrorBoundary");
const fallback = attribute(playerBoundary, "fallback");
const retryButton = find(fallback, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "Pressable");
const retryAction = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "retryAfterCrash");
const routeEffect = find(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
  node.arguments[0]?.getText(ast).includes("const routeChannelId = String(params.channelId"));
const boundaryReset = find(boundaryAst, node => ts.isPropertyDeclaration(node) && node.name.getText(boundaryAst) === "reset");

function evaluate(expression, scope) {
  scope.exports = {};
  const code = ts.transpileModule("exports.callback = (" + expression + ");", {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, scope);
  return scope.exports.callback;
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute actual callback bodies and the ErrorBoundary reset body. This
// verifies async ordering and JSX wiring, not a React Native renderer/TV.
function crashFixture() {
  const release = deferred();
  const calls = [];
  const notices = [];
  const boundary = {
    props: {}, state: { hasError: true },
    setState(value) { this.state = { ...this.state, ...value }; calls.push("boundary-reset"); },
  };
  let pending = false;
  const scope = {
    crashRetryInFlightRef: { current: false }, exitInFlightRef: { current: false },
    mountedRef: { current: true }, generationRef: { current: 2 },
    exitRouteRef: { current: { pathname: "/player", focused: true, revision: 0 } },
    setCrashRetryPending(value) { pending = value; },
    stopAllPlaybackSessions() { calls.push("stop"); return release.promise; },
    setStatus() {}, setFailReason() {},
    setRetryToken() { calls.push("remount"); },
    showNotice(message) { notices.push(message); },
  };
  const reset = evaluate("function () " + boundaryReset.initializer.body.getText(boundaryAst), scope);
  scope.reset = () => reset.call(boundary);
  const onReset = attribute(playerBoundary, "onReset");
  if (onReset) boundary.props.onReset = evaluate(onReset.getText(ast), scope);
  if (retryAction) scope.retryAfterCrash = evaluate(retryAction.initializer.arguments[0].getText(ast), scope);
  const press = evaluate(attribute(retryButton, "onPress").getText(ast), scope);
  return { press, release, calls, notices, boundary, scope, pending: () => pending };
}

function routeFixture() {
  const release = deferred();
  const calls = [];
  const notices = [];
  const scope = {
    params: { channelId: "new-channel" },
    lastRouteChannelIdRef: { current: "old-channel" }, channelIdRef: { current: "old-channel" },
    mountedRef: { current: true }, exitInFlightRef: { current: true },
    exitRouteRef: { current: { pathname: "/player", focused: true, channelId: "new-channel", revision: 0 } },
    waitForFullscreenRelease() { calls.push("wait"); return release.promise; },
    changeChannel(id) { calls.push("channel:" + id); },
    setStatus() {}, setFailReason() {}, showNotice(message) { notices.push(message); },
  };
  const run = evaluate(routeEffect.arguments[0].getText(ast), scope);
  return { release, calls, notices, scope, run };
}

test("crash Retry never resets ErrorBoundary or remounts before completed native cleanup", async () => {
  for (const status of ["completed", "failed", "superseded"]) {
    const f = crashFixture();
    f.press();
    assert.deepEqual(f.calls, ["stop"], status + ": no synchronous ErrorBoundary reset");
    assert.equal(f.boundary.state.hasError, true);
    assert.equal(f.pending(), true);
    f.release.resolve(status === "failed" ? { status, error: new Error("release blocked") } : { status });
    await flush();
    assert.equal(f.pending(), false);
    assert.equal(f.boundary.state.hasError, status !== "completed");
    assert.deepEqual(f.calls, status === "completed" ? ["stop", "remount", "boundary-reset"] : ["stop"]);
    assert.equal(f.notices.length, status === "failed" ? 1 : 0);
  }
});

test("repeated crash Retry presses issue one stop and become available again after a failed attempt", async () => {
  const f = crashFixture();
  f.press(); f.press();
  assert.deepEqual(f.calls, ["stop"]);
  f.release.resolve({ status: "failed", error: new Error("release blocked") });
  await flush();
  assert.equal(f.scope.crashRetryInFlightRef.current, false);
  f.press();
  await flush();
  assert.deepEqual(f.calls, ["stop", "stop"]);
  assert.equal(f.boundary.state.hasError, true);
});

test("a new tune, route, exit or unmount cancels delayed crash Retry without resetting children", async () => {
  for (const invalidate of [
    scope => { scope.generationRef.current += 1; },
    scope => { scope.exitRouteRef.current.revision += 1; },
    scope => { scope.exitInFlightRef.current = true; },
    scope => { scope.mountedRef.current = false; },
  ]) {
    const f = crashFixture();
    f.press();
    invalidate(f.scope);
    f.release.resolve({ status: "completed" });
    await flush();
    assert.deepEqual(f.calls, ["stop"]);
    assert.equal(f.boundary.state.hasError, true);
    assert.equal(f.notices.length, 0);
    assert.equal(f.scope.crashRetryInFlightRef.current, false);
  }
});

test("replacement-route tuning requires a completed stop and only reports a current failed request", async () => {
  for (const status of ["completed", "failed", "superseded"]) {
    const f = routeFixture();
    const cleanup = f.run();
    assert.deepEqual(f.calls, ["wait"]);
    f.scope.exitInFlightRef.current = false;
    f.release.resolve(status === "failed" ? { status, error: new Error("release blocked") } : { status });
    await flush();
    assert.deepEqual(f.calls, status === "completed" ? ["wait", "channel:new-channel"] : ["wait"]);
    assert.equal(f.notices.length, status === "failed" ? 1 : 0);
    cleanup?.();
    if (status === "failed") {
      f.run();
      assert.deepEqual(f.calls, ["wait"], "a status render must not retry the failed route automatically");
    }
  }
});

test("stale replacement-route completion cannot tune or display an error on another screen", async () => {
  for (const status of ["completed", "failed"]) {
    const f = routeFixture();
    const cleanup = f.run();
    f.scope.exitInFlightRef.current = false;
    f.scope.exitRouteRef.current.pathname = "/guide";
    f.release.resolve(status === "failed" ? { status, error: new Error("release blocked") } : { status });
    await flush();
    assert.deepEqual(f.calls, ["wait"]);
    assert.equal(f.notices.length, 0);
    cleanup?.();
  }
});

test("replacement-route cleanup cancellation blocks later tuning even on the same route", async () => {
  const f = routeFixture();
  const cleanup = f.run();
  cleanup();
  f.scope.exitInFlightRef.current = false;
  f.release.resolve({ status: "completed" });
  await flush();
  assert.deepEqual(f.calls, ["wait"]);
  assert.equal(f.notices.length, 0);
});

test("PlayerScreen does not use ErrorBoundary's synchronous onReset to wait for native release", () => {
  assert.equal(attribute(playerBoundary, "onReset"), undefined);
  assert.equal(attribute(retryButton, "disabled"), undefined, "the busy TV action must retain native focus");
  const accessibility = evaluate(attribute(retryButton, "accessibilityState").getText(ast), { crashRetryPending: true });
  assert.equal(accessibility.busy, true);
  assert.equal(accessibility.disabled, true);
  assert.match(attribute(retryButton, "onPress").getText(ast), /retryAfterCrash\(reset\)/);
});
