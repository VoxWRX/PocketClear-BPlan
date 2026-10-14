'use client';

/**
 * @file LockScreen.tsx
 * @description Full-screen security lock overlay for PocketClear.
 * Blocks workspace access when a local Argon2id PIN/password is configured
 * and the session is locked (either at startup, after inactivity, or manually).
 */

import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export function LockScreen() {
  const { isLocked, unlockWithPin, t, isRtl } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (!isLocked) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      const ok = await unlockWithPin(pin);
      if (!ok) {
        setError(t.lockScreen.invalidPin);
      } else {
        setPin('');
      }
    } catch {
      setError(t.lockScreen.invalidPin);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="lock-screen"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
    >
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 text-white p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-4">
          <div className="relative">
            <img
              src="/logo.jpg"
              alt={t.appName}
              className="w-16 h-16 rounded-2xl object-cover border border-slate-700 shadow-lg"
            />
            <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center absolute -bottom-1 -end-1 shadow-xs">
              <Lock className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
        <h1 className="text-xl font-bold text-center">{t.lockScreen.title}</h1>
        <p className="text-xs text-slate-400 text-center mt-1.5">
          {t.lockScreen.subtitle}
        </p>

        <form onSubmit={handleUnlock} className="mt-6 space-y-4">
          <input
            type="password"
            autoFocus
            data-testid="lock-screen-pin-input"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t.lockScreen.placeholder}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center text-lg font-mono tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {error && (
            <p
              data-testid="lock-screen-error"
              className="text-xs text-rose-400 text-center font-medium"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={verifying || !pin.trim()}
            data-testid="lock-screen-unlock-btn"
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-50"
          >
            {t.lockScreen.unlockBtn}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Argon2id Local Key Derivation</span>
        </div>
      </div>
    </div>
  );
}
