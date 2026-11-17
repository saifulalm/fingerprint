# CLAUDE.md - System & Development Guidelines

## 1. System Architecture & Tech Stack

### Backend Stack
- **Runtime & Framework:** Node.js v18+ (ES Modules / ESM), Express.js
- **Database & Storage:** PostgreSQL (Connection Pooling via `pg`), Redis (Caching & Session Store)
- **Real-Time Communications:** Socket.IO v4
- **Auth & Security:** JWT (Access & Refresh Tokens), Helmet, CORS, Rate-Limiting, Joi Validation
- **Logging & Monitoring:** Winston (Structured JSON Logs), Sentry Error Tracking

### Frontend Stack
- **Framework & Build Tool:** React 19, Vite
- **UI Libraries & Styling:** Material UI (MUI) v7 / Tailwind CSS v4, Lucide React Icons
- **State & Data Fetching:** React Context API, Axios (Interceptors, Token Refresh Logic)
- **Forms & Validation:** React Hook Form, Yup / Zod
- **Data Visualization & Feats:** Recharts, Sonner (Toast notifications)

---

## 2. Core Architectural Principles

### Backend (Express & Node.js)
1. **Strict MVC Pattern:** Decouple routes, controllers, services, and models. Controllers handle HTTP layer; services handle pure business logic.
2. **Asynchronous Flow Control:** Always use `async/await`. Wrap controllers in an `asyncHandler` middleware to funnel exceptions directly to a centralized error handling middleware.
3. **Validation First:** Validate incoming payload (`req.body`, `req.params`, `req.query`) using Joi before hitting any service or controller method.
4. **Security Hardening:** Always sanitize input data, use parameterized queries to prevent SQL injection, hash passwords using `bcrypt`/`argon2`, and apply strict security headers via Helmet.

### Frontend (React 19 & Vite)
1. **Modular Component Structure:** Group code by feature/domain (Feature-based structure) rather than flat folder organization.
2. **State Hygiene:** Keep local state localized. Use Context API only for global concerns (Auth, Theme). Prefer React 19 primitives where applicable.
3. **API Layer Abstraction:** All API requests must go through an Axios instance with centralized request/response interceptors for auth headers and global 401/500 handling.

---

## 3. UI/UX & Design Standards (Production-Grade)

- **Design System Tokens:** Use a consistent color palette (Primary, Neutral, Semantic states), unified border radius (`8px` / `12px`), and strict spacing system (multiples of `4px` or `8px`).
- **Typography Hierarchy:** Establish clear font weight and size contrasts (H1–H6, Body, Caption) for visual hierarchy and improved readability.
- **Micro-Interactions & Motion:** Incorporate subtle loading skeletons (`Skeleton`), smooth transitions on hover/focus, and dynamic feedback (loading spinners, disabled button states).
- **Error & Empty States:** Never leave screens blank. Always provide empty state illustrations/placeholders and graceful error boundary fallbacks.
- **Accessibility (a11y):** Ensure high contrast ratios, semantic HTML tags (`main`, `nav`, `section`, `article`), and proper `aria-labels` on interactive elements.

---

## 4. Code Quality & Formatting Rules

- **Module System:** Strict ES Modules (`import / export`). Never use CommonJS (`require`).
- **Clean Code & DRY:** Pure functional components, small single-responsibility functions, and custom hooks for complex UI logic.
- **Zero Monolithic Files:** Break down components larger than 250 lines into sub-components.
- **Error Handling:** Every asynchronous operation must have explicit `try/catch` or error boundary handling, accompanied by user-friendly Sonner toast alerts.

---

## 5. Development Workflows & Commands

### Useful CLI Commands
- `npm run dev` - Run full stack locally
- `npm run build` - Production build (Vite & Server check)
- `npm run lint` - Code linting and style checks
- `npm test` - Execute unit/integration test suites