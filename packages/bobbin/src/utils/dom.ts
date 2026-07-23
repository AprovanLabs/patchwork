/** The window that owns `el` — widgets live in a frame, not the host page. */
export function ownerView(el: Element): Window {
  return el.ownerDocument.defaultView ?? window;
}

export function computedStyleOf(el: Element): CSSStyleDeclaration {
  return ownerView(el).getComputedStyle(el);
}

/**
 * Widget previews mount in same-origin iframes, so an element's own
 * getBoundingClientRect() is relative to its frame — not the host viewport the
 * fixed-position overlays are painted in. Shift it back through the frame chain.
 */
export function viewportRect(el: Element): DOMRect {
  const rect = el.getBoundingClientRect();
  let x = rect.left;
  let y = rect.top;
  let frame = ownerView(el).frameElement;
  while (frame) {
    const frameRect = frame.getBoundingClientRect();
    x += frameRect.left;
    y += frameRect.top;
    frame = ownerView(frame).frameElement;
  }
  return new DOMRect(x, y, rect.width, rect.height);
}

/**
 * The documents that make up `root`: its own, plus every same-origin frame
 * nested inside it. Cross-origin frames are simply skipped.
 */
export function frameDocuments(root: Element): Document[] {
  const docs = [root.ownerDocument];
  for (const frame of root.querySelectorAll('iframe')) {
    const doc = (() => {
      try {
        return frame.contentDocument;
      } catch {
        return null;
      }
    })();
    if (doc?.documentElement) docs.push(...frameDocuments(doc.documentElement));
  }
  return docs;
}

/** `container.contains(el)`, but crossing frame boundaries. */
export function containsAcrossFrames(container: Element, el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (container.contains(current)) return true;
    current = ownerView(current).frameElement;
  }
  return false;
}

export function applyStyleToElement(
  el: HTMLElement,
  property: string,
  value: string,
): void {
  el.style.setProperty(property, value);
}

export function enableContentEditable(el: HTMLElement, enabled: boolean): void {
  if (enabled) {
    el.contentEditable = 'true';
    // Recursively enable for text nodes
    const textElements = el.querySelectorAll(
      'p, span, h1, h2, h3, h4, h5, h6, a, li, td, th, label, div',
    );
    textElements.forEach((child) => {
      if (child instanceof HTMLElement && child.childNodes.length > 0) {
        // Only make editable if it has direct text content
        for (const node of child.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            child.contentEditable = 'true';
            break;
          }
        }
      }
    });
  } else {
    el.contentEditable = 'false';
    const textElements = el.querySelectorAll('[contenteditable="true"]');
    textElements.forEach((child) => {
      if (child instanceof HTMLElement) {
        child.contentEditable = 'false';
      }
    });
  }
}
