export function normalizeLegacyHash() {
  const { hash } = window.location
  if (hash && !hash.startsWith('#/')) {
    window.history.replaceState(window.history.state, '', `#/${hash.slice(1)}`)
  }
}
