export interface FLIPState {
  rect: DOMRect;
  opacity: number;
}

export function measureElement(el: HTMLElement): FLIPState {
  return {
    rect: el.getBoundingClientRect(),
    opacity: parseFloat(getComputedStyle(el).opacity),
  };
}

export function animateFLIP(
  el: HTMLElement,
  from: FLIPState,
  to: FLIPState,
  duration = 150,
): void {
  const deltaX = from.rect.left - to.rect.left;
  const deltaY = from.rect.top - to.rect.top;
  const deltaW = from.rect.width / to.rect.width;
  const deltaH = from.rect.height / to.rect.height;

  el.animate(
    [
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${deltaW}, ${deltaH})`,
        opacity: from.opacity,
      },
      {
        transform: 'translate(0, 0) scale(1, 1)',
        opacity: to.opacity,
      },
    ],
    {
      duration,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  );
}
