# Frontend Audit Report — Hikvision Fingerprint Attendance System

**Project:** React 18 + Vite frontend  
**Files audited:** 12 pages, 2 components, 1 service, 1 context, 1 hook, 1 CSS entry  
**Scope:** `web/src/pages/*.jsx`, `web/src/components/*.jsx`, `web/src/services/api.js`, `web/src/context/*.jsx`, `web/src/hooks/*.js`

---

## 1. Routing Architecture

**File:** `App.jsx`  
**Router:** React Router v6 (`BrowserRouter`, `Routes`, `Route`)

All routes are wrapped in a single `ProtectedRoute` wrapper (checks `localStorage.getItem('fp_token')`).

| Route | Component | Description |
|---|---|---|
| `/login` | `LoginPage` | Public |
| `/` (redirect → `/dashboard`) | `Layout` → `DashboardPage` | Protected |
| `/dashboard` | `Layout` → `DashboardPage` | Protected |
| `/admin` | `Layout` → `AdminDashboardPage` | Protected |
| `/attendance` | `Layout` → `AttendancePage` | Protected |
| `/rekap` | `Layout` → `RekapPage` | Protected |
| `/devices` | `Layout` → `DevicesPage` | Protected |
| `/users` | `Layout` → `UsersPage` | Protected |
| `/employees` | `Layout` → `EmployeesPage` | Protected |
| `/whatsapp` | `Layout` → `WhatsAppPage` | Protected |
| `/reports` | `Layout` → `ReportsPage` | Protected |
| `/scheduler` | `Layout` → `SchedulerPage` | Protected |
| `/settings` | `Layout` → `SettingsPage` | Protected |
| `*` (catch-all) | Redirect → `/dashboard` | — |

**Pattern:** Nested routes via `<Outlet>` in `Layout`. Context (`{t, lang}`) passed via `useOutletContext`.

---

## 2. State Management

No formal state library. Three patterns observed:

- **Per-page `useState`** — Primary pattern. Each page manages its own local state.
- **`localStorage`** — Token (`fp_token`), language preference (`fp_lang`).
- **React Context** — `ToastContext` (global toast notifications). Used via `useToast()` hook.
- **Route context** — `{t, lang, toggleLang, user}` passed down via `Outlet context`.

No Redux, Zustand, or Jotai. No global app state beyond toast and auth token.

---

## 3. i18n Approach

**File:** `hooks/useLang.js` (exports `useLang()` hook)

Single-file, hook-based i18n with ~200 translation keys covering `id` and `en`.

- **`lang`**: `'id'` or `'en'`, persisted to `localStorage fp_lang`.
- **`t(key)`**: Fallback chain: current lang → `LANGS.id` → returns key itself.
- **`toggleLang()`**: Toggles between `'id'` and `'en'`.
- **Usage pattern**: `{lang === 'id' ? 'teks ID' : 'text EN'}` inline in JSX, OR `t('key')` for translated labels.

**Translation scope:** nav labels, filter labels, table headers, empty states, toast messages, modal titles, button labels, page titles.

**Gap:** Not all user-facing strings use `t()` — many pages have hardcoded Indonesian strings inline.

---

## 4. API Service Layer

**File:** `services/api.js`

```js
const api = axios.create({ baseURL: '/api', timeout: 60000 });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('fp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(res => res, err => {
  if (err.response?.status === 401) {
    localStorage.removeItem('fp_token');
    window.location.href = '/login';
  }
  return Promise.reject(err);
});
```

**Key observations:**
- Axios instance with base URL `/api`, 60s timeout.
- Auto-attaches JWT Bearer token from `localStorage fp_token` to every request.
- Global 401 interceptor redirects to `/login`.
- Pages use TWO patterns for API calls: (a) `import api from '../services/api.js'` (Axios), and (b) **inline `useApi()` hooks** with raw `fetch` + manual header injection.

**Inconsistent API usage detected:**
- `DashboardPage`, `AttendancePage`, `DevicesPage`, `RekapPage`, `SettingsPage`, `UsersPage` → use `import api` (Axios).
- `ReportsPage`, `SchedulerPage`, `EmployeesPage`, `WhatsAppPage`, `AdminDashboardPage` → define local `useApi()` with raw `fetch`.
- `LoginPage` → raw `fetch` directly, no import.
- This creates duplicated auth-injection logic across 4 pages.

**API endpoints called:**

| Endpoint | Method | Used by |
|---|---|---|
| `/api/auth/login` | POST | `LoginPage` |
| `/api/auth/me` | GET | `Layout`, `LoginPage` |
| `/api/auth/logout` | POST | `Layout` |
| `/api/attendance` | POST | `DashboardPage`, `AttendancePage` |
| `/api/attendance/rekap` | POST | `RekapPage` |
| `/api/devices` | GET | `Layout`, `AdminDashboardPage`, `DevicesPage` |
| `/api/devices/users` | GET | `UsersPage` |
| `/api/devices/users/refresh` | POST | `UsersPage`, `EmployeesPage` |
| `/api/employees` | GET | `EmployeesPage` |
| `/api/employees/:id` | PUT/DELETE | `EmployeesPage` |
| `/api/admin/dashboard` | GET | `AdminDashboardPage` |
| `/api/report/preview` | POST | `ReportsPage` |
| `/api/report/email` | POST | `ReportsPage` |
| `/api/report/whatsapp` | POST | `ReportsPage` |
| `/api/report/export` | GET | `ReportsPage` |
| `/api/scheduler` | GET/POST | `SchedulerPage` |
| `/api/scheduler/:id` | PUT/DELETE | `SchedulerPage` |
| `/api/scheduler/:id/toggle` | POST | `SchedulerPage` |
| `/api/scheduler/:id/trigger` | POST | `SchedulerPage` |
| `/api/settings` | GET/PUT | `SettingsPage` |
| `/api/settings/test-email` | POST | `SettingsPage` |
| `/api/settings/test-report` | POST | `SettingsPage` |
| `/api/whatsapp/status` | GET | `WhatsAppPage` |
| `/api/whatsapp/connect` | POST | `WhatsAppPage` |
| `/api/whatsapp/disconnect` | POST | `WhatsAppPage` |
| `/api/whatsapp/send` | POST | `WhatsAppPage` |

---

## 5. Component Inventory

### 5.1 Layout (`components/Layout.jsx`)

- **Type:** Route wrapper / shell
- **Exports:** `Sidebar`, `Layout` (default)
- **Sidebar:** Fixed dark nav with logo, 10 nav links, per-device online status dots, user section, logout button
- **Topbar:** Mobile hamburger button (opens sidebar), lang toggle (ID/EN), refresh button
- **Device status:** Fetches `/api/devices` on mount, displays live online/offline dots per device
- **Auth:** Fetches `/api/auth/me` on mount; redirects to `/login` on failure
- **Context:** `{ t, lang, toggleLang, user }` passed to all child routes via `<Outlet context={...}/>`
- **Mobile:** Sidebar overlay + drawer on small screens, hamburger toggle

### 5.2 Shared Components (`components/Shared.jsx`)

Exports 4 reusable components:
- **`StatCard`** — Metric tile with icon, colored accent top bar, value/label/sub. Color variants: blue/green/red/purple/cyan/orange.
- **`FilterBar`** — Card-wrapped filter row wrapper, accepts children and optional submit button
- **`SectionHeader`** — Title + optional subtitle wrapper
- **`LoadingOverlay`** — Absolute-positioned loading spinner overlay

### 5.3 Toast Context (`context/ToastContext.jsx`)

- Provides `toast(msg, type, sub)` via `useToast()` hook
- Types: `success`, `error`, `info`, `warning`
- Auto-dismiss after 4200ms
- Renders fixed bottom-center toast stack

---

## 6. Page-by-Page Analysis

### 6.1 `LoginPage` (`pages/LoginPage.jsx`)

**Purpose:** Authentication gateway  
**Lines:** ~380

| Aspect | Detail |
|---|---|
| State | `username`, `password`, `error`, `loading`, `showPw`, `success` |
| Effects | Checks existing token → `GET /api/auth/me` → redirect if valid |
| Auth flow | `POST /api/auth/login` → stores token as `fp_token` → navigates `/` |
| Validation | Client-side: required username + password, with inline error messages |
| Design | Glassmorphism card with animated gradient orbs, grid pattern, gradient submit button with state transitions (idle → loading → success) |
| Features | Show/hide password toggle, animated error shake, success feedback before redirect |

**Inline styles.** No external CSS classes. `@keyframes`: spin, float, pulse, shake.

---

### 6.2 `DashboardPage` (`pages/DashboardPage.jsx`)

**Purpose:** Main attendance overview with stats + charts  
**Lines:** ~300

| Aspect | Detail |
|---|---|
| State | `loading`, `stats`, `data[]`, `startDate`, `endDate`, `device`, `selectedEvent`, `tab` |
| API | `POST /api/attendance` with date range, device filter, page=1, pageSize=50 |
| Effects | Auto-loads on mount with default yesterday date range |
| Charts | Uses `react-chartjs-2` (`Bar`), registers Chart.js components |
| Tabs | `stats` (verify mode + daily breakdown), `chart` (hourly bar), `activity` (table) |
| Client-side processing | Hour-bucket aggregation for bar chart, verify mode distribution, day-bucket aggregation |
| Detail modal | Clickable rows open `EventDetailModal` showing 18 fields |
| Date presets | "Hari Ini", "Pekan Ini", "Bulan Ini" quick filter buttons |

---

### 6.3 `AdminDashboardPage` (`pages/AdminDashboardPage.jsx`)

**Purpose:** System-wide admin overview — stats, device health, scheduler status, audit log  
**Lines:** ~560

| Aspect | Detail |
|---|---|
| State | `data`, `loading`, `refreshing`, `tab`, `deviceInfo` |
| API | Parallel `GET /api/admin/dashboard` + `GET /api/devices` |
| Stats | 6 `StatCard`: total records, today, 7-day, unique employees, schedule ratio, avg/day |
| Tabs | `overview`, `devices`, `scheduler`, `audit` |
| Overview sub-panels | TrendChart (14-day Masuk/Keluar bars), VerifyModeChart (horizontal bars), System Info, Quick Actions |
| Devices tab | `DeviceStatusCard` grid — shows online/offline, model/serial/firmware if online, error if offline |
| Scheduler tab | `ScheduleCard` list for schedules from dashboard API |
| Audit tab | `AuditRow` list with action icon/color coding (login, logout, export, email, sync, schedule, whatsapp) |
| Quick Actions | Links to dashboard, reports, scheduler, settings |

**Inline styles.** No external CSS classes. Custom bar chart (pure JSX, no chart library).

---

### 6.4 `AttendancePage` (`pages/AttendancePage.jsx`)

**Purpose:** Paginated detailed attendance log with full-field event data  
**Lines:** ~840

| Aspect | Detail |
|---|---|
| State | `loading`, `data[]`, `stats`, `page`, `totalPages`, `total`, `startDate`, `endDate`, `device`, `filterName`, `pageSize`, `selected` |
| API | `POST /api/attendance` with full filter payload |
| Filters | Date range (from/to), device dropdown (all/masuk/keluar), name search, page size (25/50/100/200) |
| Pagination | Custom prev/next + numbered buttons (max 7 shown), shows `from–to of total` |
| Stats bar | 5-column grid: Total, Masuk, Keluar, Karyawan, Hari Aktif |
| Table columns | `#`, Karyawan (avatar+name+ID), Tanggal, Jam, Hari, Arah (Masuk/Keluar badge), Verifikasi mode badge, Pintu, Kartu, Tipe, Device, ID |
| Verify mode colors | Fingerprint=#7C3AED, Kartu=#3B82F6, Wajah=#F97316, Password=#6B7280 |
| Row interaction | Hover highlight, click opens `DetailModal` |
| DetailModal | Full event detail: 20+ fields in 2-column grid, header with avatar initial + direction badge |

**Inline styles.** No external CSS classes.

---

### 6.5 `RekapPage` (`pages/RekapPage.jsx`)

**Purpose:** Per-employee attendance summary with daily breakdown  
**Lines:** ~200

| Aspect | Detail |
|---|---|
| State | `loading`, `data[]`, `startDate`, `endDate`, `device` |
| API | `POST /api/attendance/rekap` |
| Default date | Yesterday to yesterday (both defaults) |
| Layout | `FilterBar` → responsive card grid (360px min-width) |
| Summary banner | Spans full width, shows employee count + date range |
| Per-employee card (`RekapCard`) | Gradient header (blue), meta row (entry/exit device IDs + date range), stats row (4 columns), daily pills (up to 5 shown), expand toggle, daily detail table |
| Daily pills | Date + day + jamMasuk + jamKeluar + duration per day |
| Detail table | Date, Day, First In, Last Out, All In (comma-separated), All Out, Duration, Total |

---

### 6.6 `DevicesPage` (`pages/DevicesPage.jsx`)

**Purpose:** Display status of configured fingerprint devices  
**Lines:** ~135

| Aspect | Detail |
|---|---|
| State | `devices{}`, `loading` |
| API | `GET /api/devices` |
| Device list | 2 hardcoded device slots: `masuk` (Fingerprint Masuk, green) and `keluar` (Fingerprint Keluar, red) |
| Online state | Device name, model, serial, firmware in 2×2 grid |
| Offline state | Error message card |
| Loading state | 2 skeleton cards with spinner |

**Inline styles.** Uses CSS classes: `.card`, `.badge`, `.badge-dot`, `.spinner`.

---

### 6.7 `EmployeesPage` (`pages/EmployeesPage.jsx`)

**Purpose:** Manage employee names — sync from Hikvision devices, add/edit/delete locally  
**Lines:** ~900

| Aspect | Detail |
|---|---|
| State | `employees[]`, `loading`, `syncing`, `search`, `tab`, `showModal`, `editing`, `syncResult` |
| API | `GET /api/employees` (list), `POST /api/devices/users/refresh` (sync), `POST/PUT /api/employees` (add/edit), `DELETE /api/employees/:id` (delete) |
| Tabs | `list` (employee cards), `info` (info panel) |
| Merge logic | Client-side merge by `employeeNo` — groups rows from masuk+keluar devices into one card |
| Warning system | Employees with `"ID X"` names get yellow warning border + banner |
| Search | Filters by name, employeeNo, or cardNo |
| EmployeeCard | Avatar with deterministic color from name hash, edit + delete action buttons |
| EmployeeModal | Add/edit form: employeeNo (disabled when editing), name, device, cardNo |
| Sync result | Shows cached user count from sync response |

**Inline styles.** CSS classes: `.card`, `.spinner`, `.empty-state`, `.spin`. Media queries for responsive grid.

---

### 6.8 `ReportsPage` (`pages/ReportsPage.jsx`)

**Purpose:** Generate and deliver attendance reports — preview, download, email, WhatsApp  
**Lines:** ~410

| Aspect | Detail |
|---|---|
| State | `startDate`, `endDate`, `workStart`, `workEnd`, `detectLate`, `recipients`, `reportLang`, `previewHtml`, `previewOpen`, `loading{}` (per action) |
| API | `POST /api/report/preview`, `POST /api/report/email`, `POST /api/report/whatsapp`, `GET /api/report/export?format=excel/pdf` |
| Local `useApi()` hook | fetch wrapper with Bearer token |
| Date presets | "Hari Ini" and "7 Hari" quick buttons |
| Late detection toggle | Custom toggle switch component; reveals `WorkHoursConfig` with time pickers |
| Report lang | Indonesia / English toggle buttons |
| Action buttons | Excel (green), PDF (blue), Preview (purple), Email (blue), WhatsApp (orange) |
| Download pattern | `fetch` → `blob` → `URL.createObjectURL` → programmatic `<a>` click → `revokeObjectURL` |
| Preview modal | Fixed overlay with `<iframe srcDoc={previewHtml}>` sandbox |
| Feature info card | 6 feature bullets in 2-column grid |
| Inline toast | Fixed bottom toast for feedback |

---

### 6.9 `SchedulerPage` (`pages/SchedulerPage.jsx`)

**Purpose:** CRUD for automated report delivery schedules (cron-based)  
**Lines:** ~775

| Aspect | Detail |
|---||
| State | `schedules[]`, `loading`, `showForm`, `editSchedule`, `actionLoading{}`, `toast` |
| API | `GET /scheduler`, `POST /scheduler` (create), `PUT /scheduler/:id` (update), `DELETE /scheduler/:id`, `POST /scheduler/:id/toggle`, `POST /scheduler/:id/trigger` |
| Local `useApi()` hook | fetch wrapper with Bearer token |
| Cron presets | 7 presets: daily 07:00/08:00, weekday 07:00/08:00, Monday 07:00, Friday 16:00, monthly 1st 07:00 |
| Period options | yesterday, last_week, last_month, last_7d, last_30d |
| Channel options | email, whatsapp, both |
| `ScheduleForm` | Inline form with all fields; validates name + cron + recipients; saves on submit |
| Schedule list | Per-item: name + channel badge + status badge, cron expression, recipients, last run/error, action buttons (toggle/play/edit/delete) |
| Toast | Fixed bottom position, 4s auto-dismiss |

---

### 6.10 `SettingsPage` (`pages/SettingsPage.jsx`)

**Purpose:** System configuration — SMTP/Email, WhatsApp, General  
**Lines:** ~1200

| Aspect | Detail |
|---|---|
| State | `activeTab`, `settings{}`, `loading`, `saving`, `toast`, `showGuide`, test email/report loading + recipient |
| API | `GET /settings`, `PUT /settings`, `POST /settings/test-email`, `POST /settings/test-report` |
| Tabs | email, whatsapp, general |
| Field rendering | Dynamic via `FIELD_DEFS` object — supports types: text, number, checkbox, select, password |
| `PasswordField` | Show/hide toggle, monospace when visible |
| `CheckboxField` | Custom styled checkbox with label + hint |
| SMTP Guide modal | Comprehensive SMTP provider guide with Gmail, Zoho, SendGrid, Mailgun — includes step-by-step instructions and security tips |
| Test actions | "Test Koneksi" (test-email) + "Test Laporan" (test-report) buttons in email tab |
| WhatsApp tab | Info card directing to Fonnte/WaBlas gateway |
| General tab | Tip card about work hours config |

---

### 6.11 `UsersPage` (`pages/UsersPage.jsx`)

**Purpose:** List users from device API — raw Hikvision data  
**Lines:** ~320

| Aspect | Detail |
|---|---|
| State | `users[]`, `loading`, `refreshing` |
| API | `GET /api/devices/users`, `POST /api/devices/users/refresh` |
| Table columns | `#`, Nama (avatar), Tipe (Administrator/Normal/Tamu badge), ID Masuk, ID Keluar, Berlaku Hingga |
| Client-side grouping | Groups by `u.name` to show merged view |
| Refresh | Triggers device user refresh + reloads |

**Inline styles.** Uses CSS classes: `.card`, `.table-wrap`, `.badge`, `.empty-state`, `.spinner`.

---

### 6.12 `WhatsAppPage` (`pages/WhatsAppPage.jsx`)

**Purpose:** WhatsApp gateway integration — connect/disconnect/send messages  
**Lines:** ~600

| Aspect | Detail |
|---|---|
| State | `status`, `deviceInfo`, `loading`, `logs[]`, `sendLoading`, `phone`, `message`, `sendResult` |
| API | `GET /api/whatsapp/status`, `POST /api/whatsapp/connect`, `POST /api/whatsapp/disconnect`, `POST /api/whatsapp/send` |
| Status polling | `setInterval(fetchStatus, 3000)` — 3-second polling for connection status |
| Status values | `connected`, `disconnected`, `connecting`, `error` |
| Status config | Color-coded: green/red/orange/purple |
| Connection log | Last 20 entries, newest-first, type-colored dots |
| Send panel | Phone + textarea → `POST /api/whatsapp/send` |
| Layout | Status card (full width), then 2-column: Send panel + Log panel |

---

## 7. Styling Approach

**Global CSS:** `index.css` — CSS custom properties (design tokens), base reset, utility classes.

### Design Tokens (CSS Variables)
```css
--primary: #1E40AF;     --primary-light: #3B82F6;
--success: #16A34A;     --danger: #DC2626;
--warning: #D97706;     --purple: #7C3AED;     --cyan: #0891B2;
--bg: #F1F5F9;          --surface: #FFFFFF;
--border: #E2E8F0;     --text: #0F172A;
--text-sub: #64748B;   --text-muted: #94A3B8;
--radius: 12px;        --radius-sm: 8px;
--sidebar-bg: #0F172A;
```

### Global Component Classes
- **Buttons:** `.btn`, `.btn-primary`, `.btn-success`, `.btn-danger`, `.btn-outline`, `.btn-ghost`, `.btn-sm`, `.btn-icon`
- **Card:** `.card` — white surface, rounded, bordered, shadow
- **Badge:** `.badge`, `.badge-success`, `.badge-danger`, `.badge-blue`, `.badge-orange`, `.badge-purple`, `.badge-gray`, `.badge-cyan`, `.badge-dot`
- **Form:** `.form-group`, `.form-label`, `.form-control`
- **Table:** `.table-wrap`, `table`, `thead`, `tbody` — styled with uppercase headers, hover rows
- **Loading:** `.spinner` (border animation), `.loading-overlay` (absolute positioned)
- **Toast:** `.toast-container`, `.toast`, `.toast-icon`, `.toast-msg`, `.toast-sub`

### Per-Page Styling Patterns
| Page | Approach |
|---|---|
| `LoginPage` | 100% inline styles + `<style>` tag with `@keyframes` |
| `DashboardPage` | Inline styles + `react-chartjs-2` |
| `AdminDashboardPage` | Inline styles + custom JSX bar chart |
| `AttendancePage` | Inline styles + `.card` / `.form-*` / `.badge` / `.table-wrap` |
| `RekapPage` | Inline styles + `FilterBar` (Shared) |
| `DevicesPage` | CSS classes + minimal inline |
| `EmployeesPage` | CSS classes + inline + media queries in `<style>` tag |
| `ReportsPage` | Inline styles |
| `SchedulerPage` | Inline styles + `<style>` tag |
| `SettingsPage` | Inline styles + `<style>` tag |
| `UsersPage` | CSS classes + inline |
| `WhatsAppPage` | Inline styles + `<style>` tag |

### Sidebar (Layout)
Sidebar-specific CSS via Layout's `<style>` tag:
```css
.sidebar { background: #0F172A; width: 260px; height: 100vh; ... }
.sidebar-logo { padding: 20px 16px; border-bottom: 1px solid #1E293B; ... }
.sidebar-nav { padding: 12px 8px; flex: 1; overflow-y: auto; }
.sidebar-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; ... }
.sidebar-nav-item.active { background: #1D4ED8; color: white; ... }
.sidebar-device-dot { width: 8px; height: 8px; border-radius: 50%; ... }
.sidebar-device-dot.online { background: #22C55E; }
.sidebar-device-dot.offline { background: #EF4444; }
.sidebar-footer { padding: 12px 16px; border-top: 1px solid #1E293B; }
.topbar { height: 56px; background: white; border-bottom: 1px solid #E2E8F0; ... }
.layout { display: flex; }
.layout-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.layout-content { flex: 1; overflow-y: auto; padding: 20px; }
```

---

## 8. Key Issues & Observations

### Critical
1. **Dual API patterns** — Axios (`import api`) vs raw `fetch` with local `useApi()` are used inconsistently across 10 pages. The `services/api.js` Axios client exists but is not the universal pattern. Should standardize all pages to use the Axios client.

2. **Inline styles everywhere** — Most pages use 100% inline `style={{}}` JSX objects. This makes maintenance, theming, and CSS reuse difficult. Only `Layout` and `LoginPage` use `<style>` tags for animations; other pages don't even do that. No CSS Modules, no Tailwind, no styled-components.

3. **No error boundaries** — API failures are logged to console or show as blank states. No toast for failed loads (only for failed actions).

### Moderate
4. **i18n incomplete** — ~60% of user-facing strings use `t()` via `useLang`. The rest are hardcoded Indonesian text. Not all pages even import `useLang` or destructure `t`.

5. **Hardcoded device list** — `DevicesPage` and `AdminDashboardPage` hardcode only 2 devices (`masuk`, `keluar`). No dynamic device discovery.

6. **WhatsApp polling** — `setInterval` every 3s for status. No cleanup of stale intervals if component unmounts. `fetchStatus` has no dependency array on its `useEffect`.

7. **Token verification on every protected route load** — `Layout` calls `/api/auth/me` on mount; `LoginPage` also calls it on mount to check existing session. Two separate auth checks on every full-page load.

8. **No loading skeleton for pages** — `AdminDashboardPage` has a spinner; `DashboardPage` shows empty state while loading; most other pages show blank or use `.spinner` class. Inconsistent loading UX.

9. **`UsersPage` vs `EmployeesPage` overlap** — Both pages show device users with slight differences. `UsersPage` fetches `/api/devices/users`, `EmployeesPage` fetches `/api/employees`. Functionality overlaps significantly.

### Minor
10. **AdminDashboardPage unused variable** — `let offset = 0;` in `VerifyModeChart` is declared but never used.

11. **`UsersPage` references `t('page.users.title')`** but `page.users` keys don't exist in `useLang.js` — falls back to raw key string.

12. **Mixed content types in API responses** — Some endpoints return `{ data: [...] }` (Axios response wrapper), others return raw array `[]`. Pages handle this inconsistently: `data.data || []` vs `Array.isArray(data) ? data : []`.

13. **`EmployeesPage` InfoPanel** has a CJK character (优先) in the Indonesian text — copy-paste artifact from Chinese.

14. **No route-level code splitting** — All pages are in the initial bundle. For a 12-page app this is acceptable, but worth noting for future growth.

---

## 9. Summary Table

| Page | Lines | API calls | Charts | i18n | Modal | Key State |
|---|---|---|---|---|---|---|
| LoginPage | ~380 | auth | 0 | partial | 0 | form/loading/success |
| DashboardPage | ~300 | attendance | Bar (chartjs) | partial | 1 (detail) | stats/data/tabs |
| AdminDashboardPage | ~560 | admin+dashboard+devices | JSX bar+pie | no | 0 | data/stats/tabs |
| AttendancePage | ~840 | attendance | 0 | no | 1 (detail) | data/pagination/filters |
| RekapPage | ~200 | attendance/rekap | 0 | t() | 0 | data/filters |
| DevicesPage | ~135 | devices | 0 | t() | 0 | devices{} |
| EmployeesPage | ~900 | employees+devices | 0 | no | 1 (add/edit) | employees/search/tabs |
| ReportsPage | ~410 | report/* | 0 | inline | 1 (preview iframe) | filters/loading per action |
| SchedulerPage | ~775 | scheduler/* | 0 | no | 1 (inline form) | schedules/loading/toast |
| SettingsPage | ~1200 | settings/* | 0 | no | 1 (SMTP guide modal) | settings/activeTab |
| UsersPage | ~320 | devices/users | 0 | t() (broken) | 0 | users{} |
| WhatsAppPage | ~600 | whatsapp/* | 0 | t() | 0 | status/logs/sendForm |
