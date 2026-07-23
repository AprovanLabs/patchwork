export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function getElementPath(el: HTMLElement): string {
  const path: string[] = [];
  // Widgets live in their own frame document; stop at *that* body.
  const root = el.ownerDocument.body;
  let current: HTMLElement | null = el;

  while (current && current !== root) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    // Add nth-child for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

export function getElementXPath(el: HTMLElement): string {
  const parts: string[] = [];
  const doc = el.ownerDocument;
  let current: HTMLElement | null = el;

  while (current && current !== doc.body && current !== doc.documentElement) {
    let part = current.tagName.toLowerCase();

    // If element has an id, use it as anchor
    if (current.id) {
      parts.unshift(`//*[@id="${current.id}"]`);
      break;
    }

    // Calculate position among siblings of same tag
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        part += `[${index}]`;
      }
    }

    parts.unshift(part);
    current = current.parentElement;
  }

  // If we didn't find an id anchor, start from root
  if (!parts[0]?.startsWith('//*[@id')) {
    parts.unshift('');
  }

  return parts.join('/') || '//' + el.tagName.toLowerCase();
}
