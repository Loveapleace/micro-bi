export interface CanvasViewport {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  pixelRatio: number;
}

/** Match final screen pixels, while bounding the cost of extreme editor magnification. */
export function canvasPixelRatio(dpr: number, scaleX: number, scaleY: number): number {
  const density = (Number.isFinite(dpr) && dpr > 0 ? dpr : 1) * Math.max(scaleX, scaleY);
  return Math.min(4, Number.isFinite(density) && density > 0 ? density : 1);
}

export function readCanvasViewport(element: HTMLElement): CanvasViewport | undefined {
  // A layout read may observe a short-lived DPR before the shared timer/media event does.
  // Synchronize it so a fast round-trip back to the previous DPR is not mistaken for "unchanged".
  synchronizeDensity?.();
  const width = element.clientWidth, height = element.clientHeight;
  if (!width || !height || !element.getBoundingClientRect().width) return;
  let matrix = new DOMMatrix();
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const zoomText = style.getPropertyValue('zoom');
    const zoom = parseFloat(zoomText) / (zoomText.includes('%') ? 100 : 1);
    if (style.transform !== 'none') matrix = new DOMMatrix(style.transform).multiply(matrix);
    if (Number.isFinite(zoom) && zoom > 0 && zoom !== 1) matrix = new DOMMatrix().scale(zoom).multiply(matrix);
  }
  const scaleX = Math.hypot(matrix.m11, matrix.m12, matrix.m13);
  const scaleY = Math.hypot(matrix.m21, matrix.m22, matrix.m23);
  return { width, height, scaleX, scaleY, pixelRatio: canvasPixelRatio(window.devicePixelRatio, scaleX, scaleY) };
}

const densityListeners = new Set<() => void>();
let stopDensityMonitor: (() => void) | undefined;
let synchronizeDensity: (() => void) | undefined;

/** One numeric DPR check per second for all tables; some browsers omit resolution-change events. */
function observeDevicePixelRatio(listener: () => void): () => void {
  densityListeners.add(listener);
  if (!stopDensityMonitor) {
    let current = window.devicePixelRatio;
    let resolution: MediaQueryList;
    const check = () => {
      if (current === window.devicePixelRatio) return;
      current = window.devicePixelRatio;
      resolution.removeEventListener('change', check);
      resolution = matchMedia(`(resolution: ${current}dppx)`);
      resolution.addEventListener('change', check);
      for (const update of densityListeners) update();
    };
    resolution = matchMedia(`(resolution: ${current}dppx)`);
    resolution.addEventListener('change', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    synchronizeDensity = check;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') check(); }, 1000);
    stopDensityMonitor = () => {
      window.clearInterval(timer);
      resolution.removeEventListener('change', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      synchronizeDensity = undefined;
    };
  }
  return () => {
    densityListeners.delete(listener);
    if (!densityListeners.size) { stopDensityMonitor?.(); stopDensityMonitor = undefined; }
  };
}

/** Layout, ancestor transforms and monitor DPR changes share one coalesced frame. */
export function observeCanvasViewport(element: HTMLElement, update: (view: CanvasViewport | undefined) => void): () => void {
  let closed = false, frame = 0, last: CanvasViewport | undefined;
  const schedule = () => {
    if (closed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (closed) return;
      const next = readCanvasViewport(element);
      if (!next) { if (last) { last = undefined; update(undefined); } return; }
      if (last && next.width === last.width && next.height === last.height &&
          Math.abs(next.pixelRatio - last.pixelRatio) < 0.0001 && Math.abs(next.scaleX - last.scaleX) < 0.0001 && Math.abs(next.scaleY - last.scaleY) < 0.0001) return;
      last = next; update(next);
    });
  };
  const stopDensity = observeDevicePixelRatio(schedule);
  const resize = new ResizeObserver(schedule);
  resize.observe(element);
  const mutation = new MutationObserver(schedule);
  const ancestors: HTMLElement[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    ancestors.push(node);
    mutation.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
    node.addEventListener('transitionend', schedule);
    node.addEventListener('animationend', schedule);
  }
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  schedule();
  return () => {
    closed = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
    stopDensity();
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    for (const node of ancestors) { node.removeEventListener('transitionend', schedule); node.removeEventListener('animationend', schedule); }
  };
}
