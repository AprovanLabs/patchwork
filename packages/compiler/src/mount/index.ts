export { mountEmbedded, reloadEmbedded } from "./embedded.js";
export {
  mountIframe,
  reloadIframe,
  disposeIframeBridge,
  DEV_SANDBOX,
} from "./iframe.js";
export {
  createHttpProxy,
  createFieldAccessProxy,
  generateNamespaceGlobals,
  injectNamespaceGlobals,
  removeNamespaceGlobals,
  extractNamespaces,
  ParentBridge,
  createIframeProxy,
  generateIframeBridgeScript,
} from "./bridge.js";
