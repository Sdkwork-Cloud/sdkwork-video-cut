import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 px-4 py-3 min-w-[300px] bg-[#111] border border-[#333] rounded-xl shadow-2xl shadow-black/50 animate-in slide-in-from-right-8 fade-in duration-300"
          >
            {t.type === 'success' && <CheckCircle2 size={18} className="text-green-500 shrink-0" />}
            {t.type === 'error' && <AlertCircle size={18} className="text-red-500 shrink-0" />}
            {t.type === 'info' && <Info size={18} className="text-blue-500 shrink-0" />}
            <span className="text-[13px] text-gray-200 flex-1">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="text-gray-500 hover:text-white shrink-0 outline-none"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
