# ⚛️ Frontend Dev Helper - BioClock Project

## React 19 + Vite Best Practices

### Project Structure
```
web/src/
├── components/     # Reusable UI components
│   ├── ui/        # Base components (Button, Card, Input, etc.)
│   └── Layout.jsx # Main layout wrapper
├── pages/         # Page components
├── hooks/         # Custom React hooks
├── context/       # React Context providers
├── services/      # API services
└── lib/           # Utilities
```

### Component Patterns

#### 1. Using Tailwind CSS v4 with @theme
```jsx
// Define custom theme in index.css
@theme {
  --color-primary: #6366F1;
  --color-primary-hover: #818CF8;
  --radius-lg: 16px;
}

// Use in components
const Button = ({ children, variant = 'primary' }) => (
  <button 
    className={`
      px-5 py-2.5 rounded-lg font-medium
      bg-[--color-primary] hover:bg-[--color-primary-hover]
      text-white transition-all duration-200
      shadow-lg hover:shadow-xl hover:-translate-y-0.5
    `}
  >
    {children}
  </button>
);
```

#### 2. Glass Effect Component
```jsx
export const GlassCard = ({ children, className = '', glow = false }) => (
  <div 
    className={`
      bg-white/[0.05] backdrop-blur-xl
      border border-white/10
      rounded-2xl
      shadow-[0_8px_32px_rgba(0,0,0,0.3)]
      ${glow ? 'shadow-[0_0_40px_rgba(99,102,241,0.15)]' : ''}
      ${className}
    `}
  >
    {children}
  </div>
);
```

#### 3. Animated Stat Card
```jsx
import { motion } from 'framer-motion';

export const StatCard = ({ title, value, icon: Icon, trend }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="
      relative overflow-hidden
      p-6 rounded-2xl
      bg-gradient-to-br from-white/8 to-white/[0.02]
      border border-white/10
      backdrop-blur-xl
    "
  >
    {/* Ambient gradient */}
    <div className="
      absolute -top-12 -right-12 w-32 h-32
      bg-gradient-to-br from-indigo-500/20 to-cyan-500/5
      rounded-full blur-3xl
    "/>
    
    <div className="relative z-10">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{title}</p>
        <Icon className="w-5 h-5 text-indigo-400" />
      </div>
      <p className="text-3xl font-bold mt-2 bg-gradient-to-r from-white to-slate-300 bg-clip-text">
        {value}
      </p>
      {trend && (
        <span className={`
          inline-flex items-center text-xs font-medium mt-2
          ${trend > 0 ? 'text-emerald-400' : 'text-red-400'}
        `}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
        </span>
      )}
    </div>
  </motion.div>
);
```

#### 4. Data Table Component
```jsx
import { motion } from 'framer-motion';

export const DataTable = ({ columns, data, onRowClick }) => (
  <div className="overflow-x-auto rounded-xl border border-white/10">
    <table className="w-full">
      <thead>
        <tr className="bg-white/5">
          {columns.map((col) => (
            <th 
              key={col.key}
              className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {data.map((row, i) => (
          <motion.tr
            key={row.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onRowClick?.(row)}
            className="hover:bg-white/5 transition-colors cursor-pointer"
          >
            {columns.map((col) => (
              <td key={col.key} className="px-4 py-4 text-sm">
                {col.render ? col.render(row[col.key], row) : row[col.key]}
              </td>
            ))}
          </motion.tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

#### 5. Status Badge
```jsx
export const StatusBadge = ({ status }) => {
  const config = {
    active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    inactive: { bg: 'bg-slate-500/20', text: 'text-slate-400', dot: 'bg-slate-400' },
    pending: { bg: 'bg-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' },
    error: { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
  }[status] || config.inactive;

  return (
    <span className={`
      inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
      text-xs font-medium
      ${config.bg} ${config.text}
    `}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`} />
      {status}
    </span>
  );
};
```

#### 6. Loading Skeleton
```jsx
export const Skeleton = ({ className = '' }) => (
  <div 
    className={`
      bg-gradient-to-r from-slate-800/50 via-slate-700/50 to-slate-800/50
      bg-[length:200%_100%]
      animate-[shimmer_1.5s_ease-in-out_infinite]
      rounded-lg
      ${className}
    `}
  />
);

export const TableSkeleton = ({ rows = 5, cols = 4 }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-4">
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} className="h-4 flex-1" />
        ))}
      </div>
    ))}
  </div>
);
```

## State Management

### Auth Context Pattern
```jsx
import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback(async (credentials) => {
    try {
      const response = await api.post('/auth/login', credentials);
      setUser(response.data.user);
      localStorage.setItem('token', response.data.token);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('token');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

## API Service Pattern
```jsx
// lib/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 10000,
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

## Animation Constants

```js
// lib/animations.js
export const springConfig = {
  type: 'spring',
  stiffness: 260,
  damping: 20,
};

export const easeConfig = {
  duration: 0.3,
  ease: [0.22, 1, 0.36, 1], // Custom spring-like easing
};

export const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

export const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  show: { 
    opacity: 1, 
    y: 0,
    transition: easeConfig,
  },
};
```

## Performance Tips

1. **Lazy Loading Components**
```jsx
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Reports = lazy(() => import('./pages/Reports'));

<Suspense fallback={<LoadingSkeleton />}>
  <Dashboard />
</Suspense>
```

2. **Memoization**
```jsx
import { memo, useMemo, useCallback } from 'react';

const ExpensiveList = memo(({ items, onSelect }) => {
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.value - a.value),
    [items]
  );
  
  const handleSelect = useCallback((id) => onSelect(id), [onSelect]);
  
  return /* ... */;
});
```

3. **Virtual Scrolling for Large Lists**
```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

const VirtualList = ({ items }) => {
  const parentRef = useRef();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });
  
  return /* ... */;
};
```

## Common Patterns

### Modal/Dialog
```jsx
import { Dialog } from './components/ui/modal';

const MyModal = ({ isOpen, onClose }) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <Dialog.Panel className="max-w-md mx-auto p-6">
      <Dialog.Title className="text-lg font-semibold">
        Confirm Action
      </Dialog.Title>
      <Dialog.Description className="mt-2 text-slate-400">
        Are you sure you want to proceed?
      </Dialog.Description>
      <div className="mt-4 flex gap-3 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary">Confirm</Button>
      </div>
    </Dialog.Panel>
  </Dialog>
);
```

### Form with React Hook Form
```jsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
});

export const UserForm = ({ onSubmit, defaultValues }) => {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input {...register('name')} error={errors.name?.message} />
      <Input {...register('email')} error={errors.email?.message} />
      <Button type="submit">Save</Button>
    </form>
  );
};
```
