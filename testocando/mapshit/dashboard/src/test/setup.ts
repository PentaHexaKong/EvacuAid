import "@testing-library/jest-dom/vitest"

const localStorageValues = new Map<string, string>()
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    get length() { return localStorageValues.size },
    clear: () => { localStorageValues.clear() },
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    key: (index: number) => [...localStorageValues.keys()][index] ?? null,
    removeItem: (key: string) => { localStorageValues.delete(key) },
    setItem: (key: string, value: string) => { localStorageValues.set(key, value) },
  } satisfies Storage,
})

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { configurable: true, value: ResizeObserverStub })
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: ResizeObserverStub })
Object.defineProperty(window, "scrollTo", { configurable: true, value: () => undefined })
Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
