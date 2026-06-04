import { join, resolve } from "node:path";
import { LocalFileBackend } from "./local-backend.js";
import type { FSProvider, StoredWidget, StoredWidgetInfo, WidgetStoreOptions } from "./types.js";
import type { Manifest } from "@aprovan/patchwork-compiler";

const WIDGETS_PREFIX = "widgets";
const RESOURCE_URI_PREFIX = "ui://widgets/";
const DEFAULT_STORAGE_DIR = ".widget-store";

export class WidgetStore {
  private provider: FSProvider;
  private storageDir: string;

  constructor(options: WidgetStoreOptions = {}) {
    this.storageDir = resolve(options.storageDir ?? DEFAULT_STORAGE_DIR);
    this.provider = options.backend ?? new LocalFileBackend(this.storageDir);
  }

  private fullPath(virtualPath: string): string {
    return join(WIDGETS_PREFIX, virtualPath);
  }

  async saveWidget(
    hash: string,
    html: string,
    manifest: Manifest,
    entry?: string,
  ): Promise<StoredWidget> {
    const widgetDir = `${manifest.name}/${hash}`;
    const htmlVirtualPath = this.fullPath(`${widgetDir}/view.html`);
    const manifestVirtualPath = this.fullPath(`${widgetDir}/manifest.json`);

    await this.provider.writeFile(htmlVirtualPath, html);
    await this.provider.writeFile(
      manifestVirtualPath,
      JSON.stringify({
        ...manifest,
        hash,
        entry,
        createdAt: Date.now(),
      }),
    );

    return {
      path: htmlVirtualPath,
      resourceUri: `${RESOURCE_URI_PREFIX}${widgetDir}/view.html`,
      html,
      manifest,
      entry,
      createdAt: Date.now(),
    };
  }

  async getWidget(name: string, hash: string): Promise<StoredWidget | null> {
    const widgetDir = `${name}/${hash}`;
    const htmlVirtualPath = this.fullPath(`${widgetDir}/view.html`);
    const manifestVirtualPath = this.fullPath(`${widgetDir}/manifest.json`);

    const exists = await this.provider.exists(htmlVirtualPath);
    if (!exists) return null;

    const html = await this.provider.readFile(htmlVirtualPath);
    let manifest: Manifest;
    let entry: string | undefined;
    let createdAt = Date.now();

    try {
      const raw = await this.provider.readFile(manifestVirtualPath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      manifest = {
        name: parsed["name"] as string,
        version: parsed["version"] as string,
        platform: (parsed["platform"] as "browser" | "cli") ?? "browser",
        image: parsed["image"] as string,
        description: parsed["description"] as string | undefined,
        services: parsed["services"] as string[] | undefined,
      };
      entry = parsed["entry"] as string | undefined;
      createdAt = (parsed["createdAt"] as number) ?? Date.now();
    } catch {
      manifest = {
        name,
        version: "0.1.0",
        platform: "browser",
        image: "@aprovan/patchwork-image-shadcn",
      };
    }

    return {
      path: htmlVirtualPath,
      resourceUri: `${RESOURCE_URI_PREFIX}${widgetDir}/view.html`,
      html,
      manifest,
      entry,
      createdAt,
    };
  }

  async listWidgets(): Promise<StoredWidgetInfo[]> {
    const results: StoredWidgetInfo[] = [];
    const rootPath = this.fullPath("");

    try {
      const names = await this.provider.readdir(rootPath);
      for (const nameEntry of names) {
        if (!nameEntry.isDirectory()) continue;
        const name = nameEntry.name;

        try {
          const hashes = await this.provider.readdir(join(rootPath, name));
          for (const hashEntry of hashes) {
            if (!hashEntry.isDirectory()) continue;
            const hash = hashEntry.name;
            const manifestVirtualPath = this.fullPath(`${name}/${hash}/manifest.json`);

            let manifest: Partial<Manifest> & { entry?: string; createdAt?: number; hash?: string } = {};
            try {
              const raw = await this.provider.readFile(manifestVirtualPath);
              manifest = JSON.parse(raw) as Partial<Manifest> & {
                entry?: string;
                createdAt?: number;
                hash?: string;
              };
            } catch {
              continue;
            }

            results.push({
              path: this.fullPath(`${name}/${hash}/view.html`),
              resourceUri: `${RESOURCE_URI_PREFIX}${name}/${hash}/view.html`,
              name: manifest.name ?? name,
              version: manifest.version ?? "0.1.0",
              description: manifest.description,
              services: manifest.services,
              entry: manifest.entry,
              createdAt: manifest.createdAt ?? 0,
            });
          }
        } catch {
          continue;
        }
      }
    } catch {
      return results;
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteWidget(name: string, hash: string): Promise<boolean> {
    const widgetDir = this.fullPath(`${name}/${hash}`);
    const exists = await this.provider.exists(widgetDir);
    if (!exists) return false;

    await this.provider.rmdir(widgetDir, { recursive: true });
    return true;
  }

  async hasWidget(name: string, hash: string): Promise<boolean> {
    return this.provider.exists(this.fullPath(`${name}/${hash}/view.html`));
  }

  resourceUriFor(name: string, hash: string): string {
    return `${RESOURCE_URI_PREFIX}${name}/${hash}/view.html`;
  }

  async loadAll(): Promise<StoredWidget[]> {
    const infos = await this.listWidgets();
    const widgets: StoredWidget[] = [];

    for (const info of infos) {
      const uriPath = info.resourceUri.replace(RESOURCE_URI_PREFIX, "").replace(/\/view\.html$/, "");
      const parts = uriPath.split("/");
      const name = parts[0];
      const hash = parts[1];

      if (!name || !hash) continue;

      const widget = await this.getWidget(name, hash);
      if (widget) widgets.push(widget);
    }

    return widgets;
  }
}

let _instance: WidgetStore | null = null;

export function getWidgetStore(options?: WidgetStoreOptions): WidgetStore {
  if (!_instance) {
    _instance = new WidgetStore(options);
  }
  return _instance;
}

export function resetWidgetStore(): void {
  _instance = null;
}
