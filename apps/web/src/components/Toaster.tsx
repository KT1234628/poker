'use client';

import { uuid } from '@/lib/uuid';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import clsx from 'clsx';

export type ToastKind = 'info' | 'success' | 'warn' | 'error' | 'celebrate';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  ttlMs?: number;
  action?: { label: string; href?: string; onClick?: () => void };
  emoji?: string;
}

interface Ctx {
  push: (t: Omit<Toast, 'id'>) => void;
}

const ToastCtx = createContext<Ctx>({ push: () => {} });

export function useToast() { return useContext(ToastCtx); }

const KIND: Record<ToastKind, string> = {
  info: 'border-white/20 bg-black/85',
  success: 'border-green-500/60 bg-green-950/90',
  warn: 'border-yellow-500/60 bg-yellow-950/80',
  error: 'border-red-500/60 bg-red-950/80',
  celebrate: 'border-gold-500/80 bg-gradient-to-br from-gold-900/80 to-black/90',
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uuid();
    const ttl = t.ttlMs ?? 4500;
    setItems(arr => [...arr, { ...t, id, ttlMs: ttl }]);
    if (ttl > 0) setTimeout(() => setItems(arr => arr.filter(x => x.id !== id)), ttl);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2">
        {items.map(t => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur',
              KIND[t.kind],
            )}
          >
            {t.emoji && <span className="text-2xl">{t.emoji}</span>}
            <div className="flex-1">
              <p className="font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-white/80">{t.body}</p>}
            </div>
            {t.action && (
              t.action.href ? (
                <a href={t.action.href} className="self-center rounded bg-white/10 px-2 py-1 text-xs font-bold uppercase hover:bg-white/20">
                  {t.action.label}
                </a>
              ) : (
                <button onClick={t.action.onClick} className="self-center rounded bg-white/10 px-2 py-1 text-xs font-bold uppercase hover:bg-white/20">
                  {t.action.label}
                </button>
              )
            )}
            <button
              onClick={() => setItems(arr => arr.filter(x => x.id !== t.id))}
              className="self-start text-white/50 hover:text-white"
              aria-label="Dismiss"
            >×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Helper for non-React modules to push
let externalPush: ((t: Omit<Toast, 'id'>) => void) | null = null;
export function setExternalToaster(fn: (t: Omit<Toast, 'id'>) => void) { externalPush = fn; }
export function toast(t: Omit<Toast, 'id'>) { externalPush?.(t); }

export function ToasterBridge() {
  const { push } = useToast();
  useEffect(() => { setExternalToaster(push); return () => setExternalToaster(() => undefined); }, [push]);
  return null;
}
