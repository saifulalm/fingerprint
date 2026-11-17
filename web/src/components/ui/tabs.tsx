import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs Component - Modern underline style with animation
 */
const TabsContext = React.createContext(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

const Tabs = React.forwardRef(({ className, value, onValueChange, defaultValue, children, ...props }, ref) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue || value);
  const currentValue = value !== undefined ? value : internalValue;
  const handleValueChange = (newValue) => {
    setInternalValue(newValue);
    onValueChange(newValue);
  };

  return (
    <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange }}>
      <div ref={ref} className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
});
Tabs.displayName = 'Tabs';

/**
 * Tabs List - Horizontal tab buttons
 */
const TabsList = React.forwardRef(({ className, variant = 'underline', children, ...props }, ref) => {
  const variants = {
    underline: 'border-b border-white/10',
    pills: 'bg-white/5 p-1 rounded-xl gap-1',
    boxed: 'border border-white/10 rounded-lg p-1 gap-1',
  };

  return (
    <div
      ref={ref}
      role="tablist"
      className={cn('inline-flex items-center', variants[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
});
TabsList.displayName = 'TabsList';

/**
 * Tabs Trigger - Individual tab button
 */
const TabsTrigger = React.forwardRef(({ className, value, disabled, variant = 'underline', children, ...props }, ref) => {
  const { value: selectedValue, onValueChange } = useTabsContext();
  const isSelected = selectedValue === value;

  const variants = {
    underline: cn(
      'relative px-4 py-2.5 text-sm font-semibold transition-colors',
      'text-[#8494AD] hover:text-[#94A3B8]',
      isSelected && 'text-[#F1F5F9]',
      isSelected && 'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-[#6366F1] after:to-[#818CF8] after:rounded-full'
    ),
    pills: cn(
      'px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200',
      'text-[#8494AD] hover:text-[#94A3B8] hover:bg-white/5',
      isSelected && 'bg-gradient-to-r from-[#6366F1] to-[#818CF8] text-white shadow-lg'
    ),
    boxed: cn(
      'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200',
      'text-[#8494AD] hover:text-[#94A3B8]',
      isSelected && 'bg-[#1E293B] text-[#F1F5F9] shadow-md'
    ),
  };

  return (
    <button
      ref={ref}
      role="tab"
      type="button"
      disabled={disabled}
      aria-selected={isSelected}
      className={cn(variants[variant], 'disabled:opacity-50 disabled:cursor-not-allowed', className)}
      onClick={() => onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
});
TabsTrigger.displayName = 'TabsTrigger';

/**
 * Tabs Content - Panel content for each tab
 */
const TabsContent = React.forwardRef(({ className, value, children, ...props }, ref) => {
  const { value: selectedValue } = useTabsContext();

  if (selectedValue !== value) return null;

  return (
    <div
      ref={ref}
      role="tabpanel"
      className={cn('mt-4 animate-in fade-in slide-in-from-top-2 duration-200', className)}
      {...props}
    >
      {children}
    </div>
  );
});
TabsContent.displayName = 'TabsContent';

/**
 * Quick Tabs - Simple tabs with icons
 */
function QuickTabs({ tabs, activeTab, onTabChange, className }) {
  return (
    <div className={cn('flex gap-2 p-1 bg-white/5 rounded-xl', className)}>
      {tabs.map((tab) => {
        const IconComponent = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              activeTab === tab.id
                ? 'bg-gradient-to-r from-[#6366F1] to-[#818CF8] text-white shadow-lg'
                : 'text-[#8494AD] hover:text-[#94A3B8] hover:bg-white/5'
            )}
          >
            {IconComponent && <IconComponent size={16} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, QuickTabs };
