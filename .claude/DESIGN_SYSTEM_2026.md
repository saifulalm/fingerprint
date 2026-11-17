# 🎨 BioClock Design System v3.0 - 2026 Edition

## Design Vision

Modern dark-themed dashboard dengan sentuhan futuristik yang menggabungkan:
- **Glassmorphism 2.0** - Frosted glass dengan depth
- **Aurora Gradients** - Dynamic mesh gradients
- **Micro-interactions** - Smooth spring animations
- **Neomorphic accents** - Subtle 3D depth effects

---

## Color System

### Primary Palette: "Cosmic Night"

```css
:root {
  /* Background Layers */
  --bg-deep:        #050810;      /* Deepest background */
  --bg-base:        #080B14;      /* Main background */
  --bg-elevated:    #0F172A;      /* Elevated surfaces */
  --bg-surface:     #1E293B;      /* Cards, panels */
  --bg-hover:       #273449;      /* Hover states */
  
  /* Primary - Indigo Core */
  --primary-50:     #eef2ff;
  --primary-100:    #e0e7ff;
  --primary-200:    #c7d2fe;
  --primary-300:    #a5b4fc;
  --primary-400:    #818cf8;
  --primary-500:    #6366f1;
  --primary-600:    #4f46e5;
  --primary-700:    #4338ca;
  --primary-800:    #3730a3;
  --primary-900:    #312e81;
  
  /* Accent - Cyan Energy */
  --accent-400:     #22d3ee;
  --accent-500:     #06b6d4;
  --accent-600:     #0891b2;
  
  /* Secondary - Violet Glow */
  --violet-400:     #a78bfa;
  --violet-500:     #8b5cf6;
  --violet-600:     #7c3aed;
  
  /* Semantic Colors */
  --success-400:    #34d399;
  --success-500:    #10b981;
  --success-glow:   rgba(16, 185, 129, 0.4);
  
  --warning-400:    #fbbf24;
  --warning-500:    #f59e0b;
  --warning-glow:   rgba(245, 158, 11, 0.4);
  
  --danger-400:     #f87171;
  --danger-500:     #ef4444;
  --danger-glow:    rgba(239, 68, 68, 0.4);
  
  --info-400:       #38bdf8;
  --info-500:       #0ea5e9;
  --info-glow:      rgba(14, 165, 233, 0.4);
  
  /* Text Hierarchy */
  --text-primary:   #f8fafc;
  --text-secondary: #e2e8f0;
  --text-muted:     #94a3b8;
  --text-subtle:    #64748b;
  --text-inverse:   #0f172a;
  
  /* Borders */
  --border-subtle:  rgba(255, 255, 255, 0.06);
  --border-light:   rgba(255, 255, 255, 0.1);
  --border-medium:   rgba(255, 255, 255, 0.15);
  --border-focus:   rgba(99, 102, 241, 0.5);
}
```

---

## Typography System

### Font Stack
```css
:root {
  --font-display: 'Clash Display', 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-numeric: 'Tabular Nums', 'Inter', sans-serif;
}
```

### Type Scale
```css
:root {
  /* Display - Hero sections */
  --text-display: clamp(3rem, 6vw, 4.5rem);
  --text-display-lg: clamp(4rem, 8vw, 6rem);
  
  /* Headlines */
  --text-h1: 2.5rem;    /* 40px - Page titles */
  --text-h2: 2rem;      /* 32px - Section headers */
  --text-h3: 1.5rem;    /* 24px - Card titles */
  --text-h4: 1.25rem;   /* 20px - Subsection */
  --text-h5: 1.125rem;  /* 18px - Component titles */
  
  /* Body */
  --text-lg: 1.125rem;  /* 18px - Large body */
  --text-base: 1rem;    /* 16px - Body text */
  --text-sm: 0.875rem;   /* 14px - Secondary text */
  --text-xs: 0.75rem;    /* 12px - Captions */
  --text-xxs: 0.6875rem; /* 11px - Labels */
  
  /* Line Heights */
  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  
  /* Font Weights */
  --font-thin: 100;
  --font-light: 300;
  --font-regular: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  --font-extrabold: 800;
}
```

---

## Spacing System

```css
:root {
  /* Base unit: 4px */
  --space-0: 0;
  --space-0-5: 0.125rem;  /* 2px */
  --space-1: 0.25rem;     /* 4px */
  --space-1-5: 0.375rem;  /* 6px */
  --space-2: 0.5rem;      /* 8px */
  --space-2-5: 0.625rem;  /* 10px */
  --space-3: 0.75rem;     /* 12px */
  --space-3-5: 0.875rem;  /* 14px */
  --space-4: 1rem;        /* 16px */
  --space-5: 1.25rem;     /* 20px */
  --space-6: 1.5rem;      /* 24px */
  --space-7: 1.75rem;     /* 28px */
  --space-8: 2rem;        /* 32px */
  --space-9: 2.25rem;     /* 36px */
  --space-10: 2.5rem;     /* 40px */
  --space-12: 3rem;       /* 48px */
  --space-14: 3.5rem;     /* 56px */
  --space-16: 4rem;       /* 64px */
  --space-20: 5rem;       /* 80px */
  --space-24: 6rem;       /* 96px */
}
```

---

## Border Radius

```css
:root {
  --radius-none: 0;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 20px;
  --radius-3xl: 24px;
  --radius-full: 9999px;
  
  /* Semantic */
  --radius-button: var(--radius-lg);
  --radius-card: var(--radius-xl);
  --radius-input: var(--radius-md);
  --radius-badge: var(--radius-full);
  --radius-avatar: var(--radius-full);
}
```

---

## Shadows System

```css
:root {
  /* Subtle - For elevated elements */
  --shadow-sm: 
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 1px 3px rgba(0, 0, 0, 0.2);
  
  /* Medium - Cards, dropdowns */
  --shadow-md: 
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 2px 4px -1px rgba(0, 0, 0, 0.2);
  
  /* Large - Modals, popovers */
  --shadow-lg: 
    0 10px 15px -3px rgba(0, 0, 0, 0.4),
    0 4px 6px -2px rgba(0, 0, 0, 0.2);
  
  /* XL - Floating elements */
  --shadow-xl: 
    0 20px 25px -5px rgba(0, 0, 0, 0.5),
    0 10px 10px -5px rgba(0, 0, 0, 0.2);
  
  /* Glow Effects */
  --shadow-glow-primary: 0 0 30px rgba(99, 102, 241, 0.3);
  --shadow-glow-success: 0 0 20px rgba(16, 185, 129, 0.3);
  --shadow-glow-danger: 0 0 20px rgba(239, 68, 68, 0.3);
  --shadow-glow-warning: 0 0 20px rgba(245, 158, 11, 0.3);
  
  /* Inner Glow */
  --shadow-inner-glow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
```

---

## Animation & Motion

### Easing Functions
```css
:root {
  /* Spring-like curves */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-snappy: cubic-bezier(0.32, 0.72, 0, 1);
  
  /* Standard curves */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Duration Scale
```css
:root {
  --duration-instant: 50ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --duration-slower: 600ms;
}
```

### Animation Recipes
```css
/* 1. Hover Lift */
.hover-lift {
  transition: transform var(--duration-normal) var(--ease-spring),
              box-shadow var(--duration-normal) var(--ease-out);
}
.hover-lift:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-xl);
}

/* 2. Press Effect */
.press-effect:active {
  transform: scale(0.97);
  transition: transform var(--duration-instant) var(--ease-out);
}

/* 3. Fade In Up */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 4. Shimmer Loading */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.shimmer {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

/* 5. Pulse Glow */
@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 0 10px var(--success-glow);
  }
  50% {
    box-shadow: 0 0 25px var(--success-glow), 0 0 40px var(--success-glow);
  }
}
```

---

## Component Guidelines

### Cards

```jsx
// Glass Card Component
export const GlassCard = ({ 
  children, 
  className = '', 
  glow = false,
  hover = true 
}) => (
  <div 
    className={`
      relative overflow-hidden
      bg-gradient-to-br from-white/[0.08] to-white/[0.02]
      backdrop-blur-xl
      border border-white/10
      rounded-2xl
      ${hover ? 'hover-lift' : ''}
      ${glow ? 'shadow-[0_0_50px_rgba(99,102,241,0.15)]' : ''}
      ${className}
    `}
  >
    {/* Subtle inner border highlight */}
    <div className="absolute inset-px rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    {children}
  </div>
);

// Bento Card
export const BentoCard = ({ span = 1, children, className = '' }) => (
  <div 
    className={`
      ${span === 'wide' ? 'col-span-2' : ''}
      ${span === 'tall' ? 'row-span-2' : ''}
      ${span === 'large' ? 'col-span-2 row-span-2' : ''}
      ${className}
    `}
  >
    {children}
  </div>
);
```

### Buttons

```jsx
export const Button = ({ 
  children, 
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  ...props 
}) => {
  const variants = {
    primary: 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-lg shadow-indigo-500/25',
    secondary: 'bg-white/10 hover:bg-white/15 text-white border border-white/10',
    ghost: 'hover:bg-white/5 text-slate-300',
    danger: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white',
    success: 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  
  return (
    <button
      disabled={loading}
      className={`
        inline-flex items-center justify-center gap-2
        font-semibold rounded-xl
        transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        press-effect
        ${variants[variant]}
        ${sizes[size]}
      `}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};
```

### Inputs

```jsx
export const Input = ({ 
  label,
  error,
  icon: Icon,
  className = '',
  ...props 
}) => (
  <div className={className}>
    {label && (
      <label className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
      </label>
    )}
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
      )}
      <input
        className={`
          w-full px-4 py-3 rounded-xl
          bg-white/[0.05] border border-white/10
          text-white placeholder-slate-500
          transition-all duration-200
          focus:outline-none focus:border-indigo-500/50
          focus:ring-2 focus:ring-indigo-500/20
          focus:bg-white/[0.08]
          ${Icon ? 'pl-11' : ''}
          ${error ? 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/20' : ''}
        `}
        {...props}
      />
    </div>
    {error && (
      <p className="mt-1.5 text-xs text-red-400">{error}</p>
    )}
  </div>
);
```

### Badges

```jsx
export const Badge = ({ 
  children, 
  variant = 'default',
  size = 'md',
  dot = false 
}) => {
  const variants = {
    default: 'bg-white/10 text-slate-300',
    primary: 'bg-indigo-500/20 text-indigo-300',
    success: 'bg-emerald-500/20 text-emerald-300',
    warning: 'bg-amber-500/20 text-amber-300',
    danger: 'bg-red-500/20 text-red-300',
    info: 'bg-cyan-500/20 text-cyan-300',
  };
  
  return (
    <span className={`
      inline-flex items-center gap-1.5
      font-medium rounded-full
      ${variants[variant]}
      ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}
    `}>
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${
          variant === 'success' ? 'bg-emerald-400' :
          variant === 'warning' ? 'bg-amber-400' :
          variant === 'danger' ? 'bg-red-400' :
          variant === 'info' ? 'bg-cyan-400' :
          'bg-white/50'
        } animate-pulse`} />
      )}
      {children}
    </span>
  );
};
```

### Status Indicator

```jsx
export const StatusDot = ({ status, pulse = true }) => {
  const colors = {
    online: 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]',
    offline: 'bg-slate-500',
    busy: 'bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.5)]',
    away: 'bg-orange-500',
    error: 'bg-red-500 shadow-[0_0_8px_rgba(248,113,113,0.5)]',
  };
  
  return (
    <span 
      className={`
        inline-block w-2.5 h-2.5 rounded-full
        ${colors[status] || colors.offline}
        ${pulse ? 'animate-pulse' : ''}
      `}
    />
  );
};
```

---

## Layout Patterns

### Dashboard Grid

```jsx
export const DashboardGrid = ({ children }) => (
  <div className="
    grid grid-cols-12 gap-4
    auto-rows-[minmax(180px,auto)]
  ">
    {children}
  </div>
);

// Usage
<DashboardGrid>
  <StatCard className="col-span-3" />
  <StatCard className="col-span-3" />
  <StatCard className="col-span-3" />
  <StatCard className="col-span-3" />
  
  <ChartCard className="col-span-8 row-span-2" />
  <ActivityCard className="col-span-4 row-span-2" />
  
  <TableCard className="col-span-12" />
</DashboardGrid>
```

### Sidebar Layout

```css
.sidebar {
  width: 260px;
  min-height: 100vh;
  background: linear-gradient(180deg, #0a0f1a 0%, #0d1320 100%);
  border-right: 1px solid var(--border-subtle);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 10px;
  color: var(--text-muted);
  transition: all var(--duration-fast) var(--ease-out);
}

.sidebar-item:hover {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-secondary);
}

.sidebar-item.active {
  background: rgba(99, 102, 241, 0.15);
  color: var(--primary-400);
  border: 1px solid rgba(99, 102, 241, 0.2);
}
```

---

## Empty & Error States

### Empty State
```jsx
export const EmptyState = ({ 
  icon: Icon,
  title,
  description,
  action 
}) => (
  <div className="text-center py-16 px-6">
    <div className="
      w-16 h-16 rounded-2xl
      bg-gradient-to-br from-slate-800 to-slate-900
      flex items-center justify-center mx-auto mb-4
    ">
      <Icon className="w-8 h-8 text-slate-500" />
    </div>
    <h3 className="text-lg font-semibold text-slate-300">{title}</h3>
    <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
      {description}
    </p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

// Usage
<EmptyState
  icon={Users}
  title="No users found"
  description="Try adjusting your search or filter to find what you're looking for."
  action={<Button>Add User</Button>}
/>
```

### Error State
```jsx
export const ErrorState = ({ 
  title = "Something went wrong",
  message,
  onRetry 
}) => (
  <div className="text-center py-12 px-6">
    <div className="
      w-14 h-14 rounded-full
      bg-red-500/10 border border-red-500/20
      flex items-center justify-center mx-auto mb-4
    ">
      <AlertCircle className="w-7 h-7 text-red-400" />
    </div>
    <h3 className="text-lg font-semibold text-slate-200">{title}</h3>
    <p className="text-sm text-slate-400 mt-1">{message}</p>
    {onRetry && (
      <Button variant="secondary" onClick={onRetry} className="mt-4">
        Try Again
      </Button>
    )}
  </div>
);
```

---

## Visual Effects

### Mesh Gradient Background
```css
.mesh-gradient {
  position: relative;
  background: var(--bg-base);
}

.mesh-gradient::before {
  content: '';
  position: absolute;
  inset: 0;
  background: 
    radial-gradient(ellipse 80% 50% at 20% 40%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 60%, rgba(6, 182, 212, 0.1) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 50% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 50%);
  pointer-events: none;
}
```

### Glass Overlay
```css
.glass-overlay {
  background: rgba(8, 11, 20, 0.7);
  backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

### Noise Texture
```css
.noise {
  position: relative;
}

.noise::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
}
```

---

## Inspiration Sources

### Design Platforms
- **Dribbble** - Search: "dashboard 2026", "admin panel dark", "glassmorphism"
- **Behance** - Search: "SaaS dashboard", "data visualization"
- **Awwwards** - Web design showcase
- **UI Sources** - Component inspiration
- **Collect UI** - Daily UI inspiration

### Color & Tools
- **Coolors.co** - Palette generator
- **Hypercolor.dev** - Tailwind gradients
- **Meshgradient.com** - Mesh backgrounds
- **Glassmorphism.com** - Glass effects
- **Easing.tips** - Animation curves

### Icon Libraries (already in project)
- **Lucide React** - Primary icons
- **Phosphor Icons** - Duotone style
- **Tabler Icons** - Line icons

### 3D & Visual Assets
- **Spline** - 3D web experiences
- **Poly Pizza** - AI 3D assets
- **Storyset** - Animated illustrations
- **Undraw** - Open source illustrations

---

## Implementation Checklist

### Phase 1: Core Components
- [ ] Button (all variants)
- [ ] Input (text, password, search)
- [ ] Card (glass, elevated)
- [ ] Badge (all variants)
- [ ] Modal/Dialog
- [ ] Dropdown/Select
- [ ] Table
- [ ] Tabs

### Phase 2: Layout Components
- [ ] Sidebar (with responsive)
- [ ] Header/Topbar
- [ ] Dashboard Grid
- [ ] Page Container

### Phase 3: Feedback Components
- [ ] Toast notifications
- [ ] Loading skeleton
- [ ] Empty state
- [ ] Error state
- [ ] Progress indicators

### Phase 4: Advanced
- [ ] DataTable with sorting/filtering
- [ ] Charts integration
- [ ] Drag and drop
- [ ] Rich text editor
- [ ] Date picker
- [ ] File upload

---

*Last Updated: October 2026*
*Version: 3.0*
