/**
 * Image registry - manages loaded images
 */

import type { LoadedImage } from '../types.js';
import { loadImage, parseImageSpec } from './loader.js';

/**
 * Registry of loaded images
 */
class ImageRegistry {
  private images = new Map<string, LoadedImage>();
  private loading = new Map<string, Promise<LoadedImage>>();

  /**
   * Get a loaded image by spec
   */
  get(spec: string): LoadedImage | undefined {
    const { name } = parseImageSpec(spec);
    return this.images.get(name);
  }

  /**
   * Check if an image is loaded
   */
  has(spec: string): boolean {
    const { name } = parseImageSpec(spec);
    return this.images.has(name);
  }

  /**
   * Load an image (or return cached)
   */
  async load(spec: string): Promise<LoadedImage> {
    const { name } = parseImageSpec(spec);

    // Return cached
    const cached = this.images.get(name);
    if (cached) {
      return cached;
    }

    // Return in-progress load
    const inProgress = this.loading.get(name);
    if (inProgress) {
      return inProgress;
    }

    // Start loading
    const loadPromise = loadImage(spec).then((image) => {
      this.images.set(name, image);
      this.loading.delete(name);
      return image;
    });

    this.loading.set(name, loadPromise);
    return loadPromise;
  }

  /**
   * Preload an image
   */
  async preload(spec: string): Promise<void> {
    await this.load(spec);
  }

  /**
   * Clear a specific image from cache
   */
  clear(spec: string): void {
    const { name } = parseImageSpec(spec);
    this.images.delete(name);
    this.loading.delete(name);
  }

  /**
   * Clear all cached images
   */
  clearAll(): void {
    this.images.clear();
    this.loading.clear();
  }

  /**
   * Get all loaded image names
   */
  getLoadedNames(): string[] {
    return Array.from(this.images.keys());
  }
}

// Global singleton registry
let globalRegistry: ImageRegistry | null = null;

/**
 * Get the global image registry
 */
export function getImageRegistry(): ImageRegistry {
  if (!globalRegistry) {
    globalRegistry = new ImageRegistry();
  }
  return globalRegistry;
}

/**
 * Create a new isolated image registry
 */
export function createImageRegistry(): ImageRegistry {
  return new ImageRegistry();
}

export { ImageRegistry };
