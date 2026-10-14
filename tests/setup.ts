import { beforeAll } from 'vitest';

beforeAll(() => {
  // Polyfill ResizeObserver for Recharts ResponsiveContainer in JSDOM
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: {
                width: 500,
                height: 220,
                top: 0,
                left: 0,
                bottom: 220,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              },
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this
        );
      }
      unobserve() {}
      disconnect() {}
    };
  }

  if (typeof HTMLElement !== 'undefined') {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 220,
    });
    HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 500,
      height: 220,
      top: 0,
      left: 0,
      bottom: 220,
      right: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  // Polyfill matchMedia for system theme detection in JSDOM
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});
