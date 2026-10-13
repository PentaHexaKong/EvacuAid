const sidebar = document.getElementById('sidebar')
const collapse = document.getElementById('sidebar-collapse')
const toggle = document.getElementById('nav-toggle')
const header = document.querySelector('.app-header')
const page = document.getElementById('app-page-scroll')
const main = document.getElementById('main-content')
const backdrop = document.querySelector('.drawer-backdrop')
const group = document.querySelector('.nav-group')
const tree = document.querySelector('.nav-tree')
const mobile = window.matchMedia('(max-width:1023px)')
const links = [...sidebar.querySelectorAll('a.nav-item')]
const targets = { reports: 'ops-reports', assistance: 'ops-assistance', 'check-ins': 'ops-checkins', routes: 'ops-routes' }
const titles = { overview: 'Regional overview', operations: 'Field operations', about: 'About this data' }
let collapsed = false
let treeOpen = false
let drawerOpen = false
let backdropTimer
let backdropFrame
try { collapsed = localStorage.getItem('evacuaid.sidebar-collapsed') === 'true' } catch {}

function renderSidebar() {
  const compact = collapsed && !mobile.matches
  sidebar.classList.toggle('collapsed', compact)
  collapse.setAttribute('aria-label', compact ? 'Expand sidebar' : 'Collapse sidebar')
  collapse.setAttribute('aria-pressed', String(compact))
  for (const item of [...links, group]) {
    if (compact) item.title = item.getAttribute('aria-label') || item.textContent.trim()
    else item.removeAttribute('title')
  }
  const open = treeOpen && !compact
  group.setAttribute('aria-expanded', String(open))
  tree.classList.toggle('open', open)
  tree.inert = !open
  tree.setAttribute('aria-hidden', String(!open))
}

function setCollapsed(value) {
  collapsed = value
  try { localStorage.setItem('evacuaid.sidebar-collapsed', String(value)) } catch {}
  renderSidebar()
}

function closeDrawer() {
  if (!drawerOpen) return
  drawerOpen = false
  cancelAnimationFrame(backdropFrame)
  sidebar.classList.remove('open')
  backdrop.classList.remove('open')
  header.inert = false
  page.inert = false
  sidebar.inert = mobile.matches
  toggle.setAttribute('aria-expanded', 'false')
  toggle.focus({ preventScroll: true })
  backdropTimer = setTimeout(() => { backdrop.hidden = true }, 200)
}

function openDrawer() {
  if (!mobile.matches) return
  clearTimeout(backdropTimer)
  drawerOpen = true
  sidebar.inert = false
  sidebar.classList.add('open')
  backdrop.hidden = false
  backdrop.getBoundingClientRect()
  backdropFrame = requestAnimationFrame(() => backdrop.classList.add('open'))
  toggle.setAttribute('aria-expanded', 'true')
  header.inert = true
  page.inert = true
  links[0].focus({ preventScroll: true })
}

function route(initial = false) {
  const hash = location.hash.slice(1)
  const [requestedView, child, ...extra] = hash.split('/')
  const valid = Object.hasOwn(titles, requestedView) && !extra.length && (hash === requestedView || (requestedView === 'operations' && Object.hasOwn(targets, child)))
  const view = valid ? requestedView : 'overview'
  const section = valid && view === 'operations' ? child : undefined
  for (const el of document.querySelectorAll('.view')) el.hidden = el.dataset.view !== view
  for (const item of [...links, group]) item.removeAttribute('aria-current')
  const current = view === 'operations' && !section ? group : links.find(link => link.hash === '#' + view + (section ? '/' + section : ''))
  current.setAttribute('aria-current', 'page')
  group.classList.toggle('child-current', view === 'operations' && Boolean(section))
  if (view === 'operations') treeOpen = true
  renderSidebar()
  document.title = titles[view] + ' · EvacuAid Command Center'
  page.scrollTo({ top: 0, behavior: 'instant' })
  if (section) document.getElementById(targets[section]).scrollIntoView({ block: 'start', behavior: 'instant' })
  if (!initial) {
    if (drawerOpen) page.inert = false
    main.focus({ preventScroll: true })
  }
  closeDrawer()
  window.dispatchEvent(new CustomEvent('viewchange', { detail: { view } }))
}

collapse.addEventListener('click', () => setCollapsed(!collapsed))
group.addEventListener('click', () => {
  if (collapsed && !mobile.matches) {
    treeOpen = true
    setCollapsed(false)
  } else {
    treeOpen = !treeOpen
    renderSidebar()
  }
})
toggle.addEventListener('click', openDrawer)
backdrop.addEventListener('click', closeDrawer)
for (const link of links) link.addEventListener('click', () => { if (link.hash === location.hash) closeDrawer() })
document.addEventListener('keydown', event => {
  if (!drawerOpen) return
  if (event.key === 'Escape') { event.preventDefault(); closeDrawer() }
  if (event.key === 'Tab') {
    const items = [...sidebar.querySelectorAll('a,button')].filter(item => !item.closest('[inert]') && item.getClientRects().length)
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
})
mobile.addEventListener('change', () => {
  closeDrawer()
  sidebar.inert = mobile.matches
  renderSidebar()
})
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault()
  main.focus({ preventScroll: true })
  page.scrollTo({ top: 0, behavior: 'instant' })
})
window.addEventListener('hashchange', () => route())
sidebar.inert = mobile.matches
route(true)
