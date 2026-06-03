export interface ShimOptions {
  namespaces: string[];
  extAppsVersion?: string;
}

const DEFAULT_EXT_APPS_VERSION = "^1.7.3";

export function generateServiceShim(options: ShimOptions): string {
  const {
    namespaces,
    extAppsVersion = DEFAULT_EXT_APPS_VERSION,
  } = options;

  if (namespaces.length === 0) return "";

  const namespacesJson = JSON.stringify(namespaces);
  const importUrl = `https://esm.sh/@modelcontextprotocol/ext-apps@${extAppsVersion}`;

  return `
import { App } from '${importUrl}';

const __patchwork_app = new App({ name: 'patchwork-widget', version: '0.1.0' });
const __patchwork_ready = __patchwork_app.connect().catch(function(err) {
  console.error('[patchwork] Failed to connect to host:', err);
});

function __patchwork_createNamespaceProxy(namespace) {
  return new Proxy({}, {
    get: function(target, prop) {
      if (typeof prop !== 'string') return undefined;
      return function __patchwork_serviceCall(args) {
        var toolName = namespace + '__' + prop;
        return __patchwork_ready.then(function() {
          return __patchwork_app.callServerTool({ name: toolName, arguments: args || {} });
        }).then(function(result) {
          if (result.isError) {
            var errorMsg = result.content && result.content[0] && result.content[0].text
              ? result.content[0].text
              : 'Service call failed: ' + namespace + '.' + prop;
            throw new Error(errorMsg);
          }
          var textContent = result.content && result.content.find(function(c) { return c.type === 'text'; });
          if (textContent) {
            try { return JSON.parse(textContent.text); }
            catch (e) { return textContent.text; }
          }
          return result;
        });
      };
    }
  });
}

var __patchwork_namespaces = ${namespacesJson};
for (var __i = 0; __i < __patchwork_namespaces.length; __i++) {
  var __ns = __patchwork_namespaces[__i];
  window[__ns] = __patchwork_createNamespaceProxy(__ns);
}
`;
}
