# 🚀 Productivity Helper - BioClock Project

## Quick Reference

### Available Commands
```bash
# Development
npm run dev              # Run frontend dev server
npm run build            # Production build
npm run lint             # Code linting

# Server (from root)
npm run server:dev       # Run backend dev server
```

### Project Locations
- **Frontend**: `D:/laragon/www/fingerprint/web/`
- **Backend**: `D:/laragon/www/fingerprint/server/`
- **Design System**: `web/src/index.css`

### Key Dependencies
- React 18 with Vite
- Tailwind CSS v4
- Framer Motion (animations)
- Radix UI (accessible components)
- TanStack Query (data fetching)
- Lucide React (icons)

## Common Tasks

### 1. Adding a New Page
```bash
# 1. Create the page component
touch web/src/pages/ExamplePage.jsx

# 2. Add route in App.jsx
import ExamplePage from './pages/ExamplePage';
<Route path="/example" element={<ExamplePage />} />
```

### 2. Creating a New Component
```bash
# 1. Create in ui folder
touch web/src/components/ui/NewComponent.jsx

# 2. Export from index
# Add to web/src/components/ui/index.ts:
export { NewComponent } from './NewComponent';
```

### 3. Adding New API Endpoint
```bash
# 1. Create route in server
# server/routes/example.routes.js

# 2. Add controller
# server/controllers/example.controller.js

# 3. Register route in server/index.js
```

## Tips & Tricks

### Faster Development
1. Use `clsx` for conditional classes:
```jsx
import { clsx } from 'clsx';
className={clsx(
  "px-4 py-2 rounded-lg",
  isActive && "bg-indigo-500",
  isDisabled && "opacity-50"
)}
```

2. Use `tailwind-merge` for component classes:
```jsx
import { twMerge } from 'tailwind-merge';
className={twMerge("base-classes", customClass)}
```

### Code Snippets

#### Toast Notification
```jsx
import { toast } from 'sonner';

toast.success('User created successfully!');
toast.error('Failed to save changes');
toast.info('Processing your request...');
```

#### Debounced Search
```jsx
import { useState, useEffect } from 'react';

const useDebounce = (value, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return debouncedValue;
};
```

#### Date Formatting
```jsx
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

dayjs().format('MMM D, YYYY');        // Oct 12, 2026
dayjs().fromNow();                      // 2 hours ago
dayjs().startOf('day').fromNow();      // a few seconds ago
```

## Troubleshooting

### CSS Not Updating?
```bash
cd web
rm -rf node_modules/.vite
npm run dev
```

### Port Already in Use?
```bash
# Find and kill the process
netstat -ano | findstr :5173
taskkill /PID <pid> /F
```

### Database Connection Issues?
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Check Redis
redis-cli ping
```

## Git Workflow
```bash
# Create feature branch
git checkout -b feature/new-feature

# Commit with clear message
git commit -m "feat: add user profile page"

# Push and create PR
git push -u origin feature/new-feature
```

## Performance Checklist
- [ ] Lazy load routes
- [ ] Memoize expensive computations
- [ ] Use proper key in lists
- [ ] Optimize images (WebP format)
- [ ] Enable code splitting
- [ ] Remove unused imports
- [ ] Use proper image sizing
- [ ] Implement proper error boundaries
