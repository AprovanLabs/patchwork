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
