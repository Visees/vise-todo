'use strict'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]

const VIEWS = {
  all: { title: 'All tasks', sub: 'Everything on your list.' },
  today: { title: 'Today', sub: 'Due today or overdue.' },
  upcoming: { title: 'Upcoming', sub: 'Open tasks with a due date ahead.' },
  done: { title: 'Completed', sub: 'Tasks you have finished.' },
}
const STATUS = ['any', 'open', 'done']
const STATUS_LABEL = { any: 'Any', open: 'Open', done: 'Done' }
const SORTS = ['newest', 'due', 'az']
const SORT_LABEL = { newest: 'Newest', due: 'Due date', az: 'A–Z' }

const state = { user: null, todos: [], view: 'all', status: 'any', sort: 'newest', query: '', editing: null }

// ── API ─────────────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') showAuth()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { field: data.field })
  return data
}

let toastTimer
function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), 2400)
}

// ── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(choice) {
  if (choice === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
  try { localStorage.setItem('todo-theme', choice) } catch {}
  $$('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)))
}
$$('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)))
applyTheme(document.documentElement.dataset.theme || 'system')

// ── Auth ────────────────────────────────────────────────────────────────────
let mode = 'login'

function setMode(next) {
  mode = next
  const reg = mode === 'register'
  $('#auth-title').textContent = reg ? 'Create your account' : 'Sign in'
  $('#auth-lead').textContent = reg ? 'It takes a few seconds. You only need an email.' : 'Welcome back. Enter your details to see your tasks.'
  $('#auth-submit').textContent = reg ? 'Create account' : 'Sign in'
  $('#switch-text').textContent = reg ? 'Already have an account?' : 'No account yet?'
  $('#auth-switch').textContent = reg ? 'Sign in' : 'Create one'
  $('#row-name').hidden = !reg
  $('#f-password').autocomplete = reg ? 'new-password' : 'current-password'
  $('#f-password').placeholder = reg ? 'At least 8 characters' : ''
  clearAuthError()
}

function clearAuthError() {
  $('#auth-error').hidden = true
  $$('#auth-form .input').forEach((i) => i.removeAttribute('aria-invalid'))
}

$('#auth-switch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'))

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  clearAuthError()
  const btn = $('#auth-submit')
  const label = btn.textContent
  btn.disabled = true
  btn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…'
  try {
    const body = { email: $('#f-email').value, password: $('#f-password').value }
    if (mode === 'register') body.name = $('#f-name').value
    const { user } = await api(mode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body })
    $('#auth-form').reset()
    await showApp(user)
  } catch (err) {
    $('#auth-error').textContent = err.message
    $('#auth-error').hidden = false
    const field = err.field ? $(`#f-${err.field}`) : null
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus() }
  } finally {
    btn.disabled = false
    btn.textContent = label
  }
})

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: {} }).catch(() => {})
  showAuth()
})

function showAuth() {
  state.user = null
  state.todos = []
  $('#app-view').hidden = true
  $('#auth-view').hidden = false
  setMode('login')
  $('#f-email').focus()
}

async function showApp(user) {
  state.user = user
  $('#auth-view').hidden = true
  $('#app-view').hidden = false
  $('#user-name').textContent = user.name
  $('#user-email').textContent = user.email
  $('#user-avatar').textContent = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const { todos } = await api('/api/todos')
  state.todos = todos
  render()
  $('#new-title').focus()
}

// ── Dates ───────────────────────────────────────────────────────────────────
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => isoDay(new Date())
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return isoDay(d) }

function formatDue(iso) {
  if (!iso) return ''
  if (iso === today()) return 'Today'
  if (iso === tomorrow()) return 'Tomorrow'
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const opts = { day: 'numeric', month: 'short' }
  if (y !== new Date().getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString(undefined, opts)
}

function statusOf(t) {
  if (t.done) return { cls: 'badge-ok', text: 'Done' }
  if (t.due_date && t.due_date < today()) return { cls: 'badge-late', text: 'Overdue' }
  if (t.due_date === today()) return { cls: 'badge-wait', text: 'Due today' }
  return { cls: 'badge-neutral', text: 'Open' }
}

// ── Filtering ───────────────────────────────────────────────────────────────
function inView(t, view) {
  const now = today()
  if (view === 'today') return !t.done && t.due_date && t.due_date <= now
  if (view === 'upcoming') return !t.done && t.due_date && t.due_date > now
  if (view === 'done') return t.done
  return true
}

function visibleTodos() {
  const q = state.query.trim().toLowerCase()
  const rows = state.todos.filter((t) =>
    inView(t, state.view) &&
    (state.status === 'any' || (state.status === 'done') === t.done) &&
    (!q || t.title.toLowerCase().includes(q)))
  const byDue = (a, b) => (a.due_date ?? '9999') .localeCompare(b.due_date ?? '9999')
  const sorters = {
    newest: (a, b) => b.created_at - a.created_at,
    due: (a, b) => byDue(a, b) || b.created_at - a.created_at,
    az: (a, b) => a.title.localeCompare(b.title),
  }
  // Open tasks first, then the chosen order.
  return rows.sort((a, b) => Number(a.done) - Number(b.done) || sorters[state.sort](a, b))
}

// ── Render ──────────────────────────────────────────────────────────────────
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'

function rowEl(t) {
  const row = document.createElement('div')
  row.className = 'todo-row' + (t.done ? ' is-done' : '')
  row.setAttribute('role', 'listitem')
  row.dataset.id = t.id

  const c1 = document.createElement('div')
  const check = document.createElement('input')
  check.type = 'checkbox'
  check.className = 'check'
  check.checked = t.done
  check.setAttribute('aria-label', t.done ? `Mark "${t.title}" as open` : `Mark "${t.title}" as done`)
  check.addEventListener('change', () => update(t.id, { done: check.checked }))
  c1.append(check)

  const c2 = document.createElement('div')
  if (state.editing === t.id) {
    const input = document.createElement('input')
    input.className = 'input edit-input'
    input.value = t.title
    input.maxLength = 500
    input.setAttribute('aria-label', 'Edit task')
    const finish = (save) => {
      if (state.editing !== t.id) return
      state.editing = null
      const title = input.value.trim()
      if (save && title && title !== t.title) update(t.id, { title })
      else render()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
    c2.append(input)
    queueMicrotask(() => { input.focus(); input.select() })
  } else {
    c2.className = 'title'
    c2.textContent = t.title
    c2.title = t.title
    c2.addEventListener('dblclick', () => startEdit(t.id))
  }

  const c3 = document.createElement('div')
  c3.className = 'date'
  c3.textContent = formatDue(t.due_date)
  if (!t.due_date) { c3.textContent = '—'; c3.classList.add('muted') }

  const c4 = document.createElement('div')
  c4.className = 'col-status'
  const s = statusOf(t)
  c4.innerHTML = `<span class="badge ${s.cls}"></span>`
  c4.firstChild.textContent = s.text

  const c5 = document.createElement('div')
  c5.className = 'actions'
  const edit = document.createElement('button')
  edit.className = 'icon-btn'
  edit.innerHTML = ICON_EDIT
  edit.title = 'Edit'
  edit.setAttribute('aria-label', `Edit "${t.title}"`)
  edit.addEventListener('click', () => startEdit(t.id))
  const del = document.createElement('button')
  del.className = 'icon-btn danger'
  del.innerHTML = ICON_TRASH
  del.title = 'Delete'
  del.setAttribute('aria-label', `Delete "${t.title}"`)
  del.addEventListener('click', () => remove(t.id))
  c5.append(edit, del)

  row.append(c1, c2, c3, c4, c5)
  return row
}

function render() {
  const view = VIEWS[state.view]
  $('#page-title').textContent = view.title
  $('#page-sub').textContent = view.sub
  $('#crumb').textContent = view.title
  document.title = `${view.title} · Todo`
  $$('[data-view]').forEach((b) => b.dataset.view === state.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'))

  for (const key of Object.keys(VIEWS)) {
    const n = state.todos.filter((t) => inView(t, key) && (key === 'done' || !t.done)).length
    $(`[data-count="${key}"]`).textContent = n || ''
  }

  $('#pill-status-value').textContent = STATUS_LABEL[state.status]
  $('#pill-status').classList.toggle('pill-active', state.status !== 'any')
  $('#pill-sort-value').textContent = SORT_LABEL[state.sort]
  $('#pill-sort').classList.toggle('pill-active', state.sort !== 'newest')

  const rows = visibleTodos()
  const list = $('#list')
  list.replaceChildren(...rows.map(rowEl))

  const filtered = state.query || state.status !== 'any'
  $('#empty').hidden = rows.length > 0
  $('.list-head').hidden = rows.length === 0
  if (!rows.length) {
    $('#empty-title').textContent = filtered ? 'No matching tasks' : state.view === 'done' ? 'Nothing completed yet' : 'Nothing here'
    $('#empty-text').textContent = filtered ? 'Try another search or clear the filters.' : state.view === 'done' ? 'Tick a task and it shows up here.' : 'Add a task above to get started.'
  }

  const open = state.todos.filter((t) => !t.done).length
  const done = state.todos.length - open
  $('#foot-left').textContent = `${open} open · ${done} completed`
  $('#foot-right').textContent = rows.length ? `1–${rows.length} of ${rows.length}` : '0 of 0'
  $('#clear-done').disabled = done === 0
}

// ── Actions ─────────────────────────────────────────────────────────────────
function startEdit(id) { state.editing = id; render() }

async function update(id, patch) {
  try {
    const { todo } = await api(`/api/todos/${id}`, { method: 'PATCH', body: patch })
    state.todos = state.todos.map((t) => (t.id === id ? todo : t))
  } catch (err) { toast(err.message) }
  render()
}

async function remove(id) {
  const t = state.todos.find((x) => x.id === id)
  try {
    await api(`/api/todos/${id}`, { method: 'DELETE' })
    state.todos = state.todos.filter((x) => x.id !== id)
    render()
    toast(`Deleted "${t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}"`)
  } catch (err) { toast(err.message) }
}

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $('#new-title')
  const title = input.value.trim()
  if (!title) return input.focus()
  try {
    const due = $('#new-due').value || (state.view === 'today' ? today() : null)
    const { todo } = await api('/api/todos', { method: 'POST', body: { title, due_date: due } })
    state.todos.unshift(todo)
    input.value = ''
    $('#new-due').value = ''
    render()
  } catch (err) { toast(err.message) }
  input.focus()
})

$('#clear-done').addEventListener('click', async () => {
  const n = state.todos.filter((t) => t.done).length
  if (!confirm(`Delete ${n} completed task${n === 1 ? '' : 's'}?`)) return
  try {
    await api('/api/todos/clear-completed', { method: 'POST', body: {} })
    state.todos = state.todos.filter((t) => !t.done)
    render()
    toast(`Removed ${n} completed task${n === 1 ? '' : 's'}`)
  } catch (err) { toast(err.message) }
})

$$('[data-view]').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view
  $('#app-view').classList.remove('drawer-open')
  render()
}))

$('#pill-status').addEventListener('click', () => {
  state.status = STATUS[(STATUS.indexOf(state.status) + 1) % STATUS.length]
  render()
})
$('#pill-sort').addEventListener('click', () => {
  state.sort = SORTS[(SORTS.indexOf(state.sort) + 1) % SORTS.length]
  render()
})
$('#search').addEventListener('input', (e) => { state.query = e.target.value; render() })

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.user) {
    e.preventDefault()
    $('#search').focus()
    $('#search').select()
  }
  if (e.key === 'Escape') $('#app-view').classList.remove('drawer-open')
})

$('#menu-btn').addEventListener('click', () => $('#app-view').classList.add('drawer-open'))
$('#scrim').addEventListener('click', () => $('#app-view').classList.remove('drawer-open'))

// ── Start ───────────────────────────────────────────────────────────────────
api('/api/me').then(({ user }) => (user ? showApp(user) : showAuth())).catch(showAuth)
