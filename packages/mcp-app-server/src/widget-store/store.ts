import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { LocalFileBackend } from "./local-backend.js";
import type { FSProvider, StoredWidget, StoredWidgetInfo, WidgetStoreOptions } from "./types.js";
import type { Manifest, VirtualFile } from "@aprovan/patchwork-compiler";

const WIDGETS_PREFIX = "widgets";
const FILES_SUBDIR = "files";
const RESOURCE_URI_PREFIX = "ui://widgets/";

function getDefaultStorageDir(): string {
  // Use WIDGET_STORE_PATH env var, or fall back to ~/.patchwork/widget-store
  return process.env["WIDGET_STORE_PATH"] ?? join(homedir(), ".patchwork", "widget-store");
}

interface StoredManifest extends Manifest {
  entry: string;
  createdAt: number;
}

/**
 * Persistent store for **raw, uncompiled** widget source files.
 *
 * Widgets are saved as their original `.tsx`/`.ts` files plus a `manifest.json`;
 * compilation happens in the browser via the shared `@aprovan/patchwork-compiler`
 * runtime when the widget is rendered. Layout:
 *
 * ```
 * widgets/<name>/<hash>/
 *   files/main.tsx
 *   files/price-card.tsx
 *   manifest.json   { ...manifest, entry, createdAt }
 * ```
 */
export class WidgetStore {
  private provider: FSProvider;
  private storageDir: string;

  constructor(options: WidgetStoreOptions = {}) {
    this.storageDir = resolve(options.storageDir ?? getDefaultStorageDir());
    this.provider = options.backend ?? new LocalFileBackend(this.storageDir);
  }

  private fullPath(virtualPath: string): string {
    return join(WIDGETS_PREFIX, virtualPath);
  }

  private async readFilesRecursive(dir: string, base = ""): Promise<VirtualFile[]> {
    const files: VirtualFile[] = [];
    let entries;
    try {
      entries = await this.provider.readdir(dir);
    } catch {
      return files;
    }
    for (const entry of entries) {
      const childDir = join(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...(await this.readFilesRecursive(childDir, relPath)));
      } else {
        const content = await this.provider.readFile(childDir);
        files.push({ path: relPath, content });
      }
    }
    return files;
  }

  async saveWidget(
    hash: string,
    files: VirtualFile[],
    manifest: Manifest,
    entry: string,
  ): Promise<StoredWidget> {
    const widgetDir = `${manifest.name}/${hash}`;
    const createdAt = Date.now();

    await Promise.all(
      files.map((file) =>
        this.provider.writeFile(
          this.fullPath(`${widgetDir}/${FILES_SUBDIR}/${file.path}`),
          file.content,
        ),
      ),
    );

    const storedManifest: StoredManifest = { ...manifest, entry, createdAt };
    await this.provider.writeFile(
      this.fullPath(`${widgetDir}/manifest.json`),
      JSON.stringify(storedManifest),
    );

    return {
      path: this.fullPath(widgetDir),
      resourceUri: `${RESOURCE_URI_PREFIX}${widgetDir}/view.html`,
      files,
      entry,
      manifest,
      createdAt,
    };
  }

  async getWidget(name: string, hash: string): Promise<StoredWidget | null> {
    const widgetDir = `${name}/${hash}`;
    const manifestVirtualPath = this.fullPath(`${widgetDir}/manifest.json`);

    const exists = await this.provider.exists(manifestVirtualPath);
    if (!exists) return null;

    const files = await this.readFilesRecursive(this.fullPath(`${widgetDir}/${FILES_SUBDIR}`));

    let manifest: Manifest;
    let entry = files[0]?.path ?? "main.tsx";
    let createdAt = Date.now();
    try {
      const raw = await this.provider.readFile(manifestVirtualPath);
      const parsed = JSON.parse(raw) as Partial<StoredManifest>;
      manifest = {
        name: (parsed.name as string) ?? name,
        version: (parsed.version as string) ?? "0.1.0",
        platform: parsed.platform ?? "browser",
        image: (parsed.image as string) ?? "@aprovan/patchwork-image-shadcn",
        description: parsed.description,
        services: parsed.services,
      };
      if (parsed.entry) entry = parsed.entry;
      if (typeof parsed.createdAt === "number") createdAt = parsed.createdAt;
    } catch {
      manifest = {
        name,
        version: "0.1.0",
        platform: "browser",
        image: "@aprovan/patchwork-image-shadcn",
      };
    }

    return {
      path: this.fullPath(widgetDir),
      resourceUri: `${RESOURCE_URI_PREFIX}${widgetDir}/view.html`,
      files,
      entry,
      manifest,
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

            let manifest: Partial<StoredManifest> = {};
            try {
              const raw = await this.provider.readFile(manifestVirtualPath);
              manifest = JSON.parse(raw) as Partial<StoredManifest>;
            } catch {
              continue;
            }

            results.push({
              path: this.fullPath(`${name}/${hash}`),
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
    return this.provider.exists(this.fullPath(`${name}/${hash}/manifest.json`));
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
