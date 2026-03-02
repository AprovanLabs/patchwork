import type { EntityLink, LinkExtractor } from "./types.js";

export class LinkExtractorRegistry {
  private extractors: Map<string, LinkExtractor> = new Map();

  register(name: string, extractor: LinkExtractor): void {
    this.extractors.set(name, extractor);
  }

  unregister(name: string): void {
    this.extractors.delete(name);
  }

  get(name: string): LinkExtractor | undefined {
    return this.extractors.get(name);
  }

  has(name: string): boolean {
    return this.extractors.has(name);
  }

  list(): string[] {
    return Array.from(this.extractors.keys());
  }

  extractAll(content: string, sourceUri: string): EntityLink[] {
    const allLinks: EntityLink[] = [];
    const seen = new Set<string>();

    for (const extractor of this.extractors.values()) {
      const links = extractor.extract(content, sourceUri);
      for (const link of links) {
        const key = `${link.type}:${link.targetUri}`;
        if (!seen.has(key)) {
          seen.add(key);
          allLinks.push(link);
        }
      }
    }

    return allLinks;
  }
}
