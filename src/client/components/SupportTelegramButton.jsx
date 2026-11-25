import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const QR_URL = '/images/telegram-support-qr-clean.png?v=1.0.33';
const POS_STORAGE_KEY = 'easychat_tg_assistive_pos_v1';
const BTN_SIZE = 44;
const EDGE_MARGIN = 12;

function getSafeBounds() {
  if (typeof window === 'undefined') {
    return { minX: EDGE_MARGIN, maxX: 300, minY: 64, maxY: 500 };
  }
  const w = window.innerWidth || 360;
  const h = window.innerHeight || 640;
  const isMobileViewport = w < 768;
  return {
    minX: EDGE_MARGIN,
    maxX: Math.max(EDGE_MARGIN, w - BTN_SIZE - EDGE_MARGIN),
    minY: isMobileViewport ? 56 : 16,
    maxY: Math.max(64, h - BTN_SIZE - (isMobileViewport ? 88 : 16))
  };
}

function loadInitialPos() {
  const b = getSafeBounds();
  try {
    const raw = window.localStorage?.getItem(POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return {
          x: Math.min(Math.max(parsed.x, b.minX), b.maxX),
          y: Math.min(Math.max(parsed.y, b.minY), b.maxY)
        };
      }
    }
  } catch (_) {}
  return { x: b.maxX, y: b.maxY };
}

export default function SupportTelegramButton({ hiddenOnMobile = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => loadInitialPos());
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    moved: false
  });

  useEffect(() => {
    if (hiddenOnMobile && open) setOpen(false);
  }, [hiddenOnMobile, open]);

  useEffect(() => {
    const onResize = () => {
      const b = getSafeBounds();
      setPos((cur) => {
        const snapRight = cur.x + BTN_SIZE / 2 >= (window.innerWidth || 360) / 2;
        return {
          x: snapRight ? b.maxX : b.minX,
          y: Math.min(Math.max(cur.y, b.minY), b.maxY)
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false
    };
    setDragging(true);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active || (d.pointerId != null && e.pointerId !== d.pointerId)) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) >= 6) {
      d.moved = true;
    }
    if (!d.moved) return;
    const b = getSafeBounds();
    const nextX = Math.min(Math.max(d.origX + dx, b.minX), b.maxX);
    const nextY = Math.min(Math.max(d.origY + dy, b.minY), b.maxY);
    setPos({ x: nextX, y: nextY });
  };

  const finishDrag = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const wasMoved = d.moved;
    d.active = false;
    d.pointerId = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) {}

    if (!wasMoved) {
      setOpen((v) => !v);
      return;
    }
    const b = getSafeBounds();
    const w = window.innerWidth || 360;
    const curX = Math.min(Math.max(d.origX + (e.clientX - d.startX), b.minX), b.maxX);
    const curY = Math.min(Math.max(d.origY + (e.clientY - d.startY), b.minY), b.maxY);
    const snapX = curX + BTN_SIZE / 2 < w / 2 ? b.minX : b.maxX;
    const snapped = { x: snapX, y: curY };
    setPos(snapped);
    try { window.localStorage?.setItem(POS_STORAGE_KEY, JSON.stringify(snapped)); } catch (_) {}
  };

  // Smart QR dialog position so it never clips off-screen
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 640;
  const dialogW = 256;
  const dialogH = 340;
  const dialogLeft = Math.min(
    Math.max(pos.x + BTN_SIZE / 2 < vw / 2 ? pos.x : pos.x + BTN_SIZE - dialogW, 12),
    Math.max(12, vw - dialogW - 12)
  );
  const openAbove = pos.y > vh / 2;
  const dialogTop = openAbove
    ? Math.max(16, pos.y - dialogH - 12)
    : Math.min(Math.max(16, vh - dialogH - 16), pos.y + BTN_SIZE + 12);

  return createPortal(
    <React.Fragment>
      <style>{`
        @keyframes crmTelegramRipple {
          0% { transform: scale(1); opacity: 0.72; }
          70% { transform: scale(1.95); opacity: 0.16; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .crm-tg-ripple-1 { animation: crmTelegramRipple 2.4s cubic-bezier(0, 0, 0.2, 1) infinite; }
      `}</style>
      <div
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${BTN_SIZE}px`,
          height: `${BTN_SIZE}px`,
          touchAction: 'none',
          transition: dragging ? 'none' : 'left 240ms cubic-bezier(0.22, 1, 0.36, 1), top 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={`fixed z-[80] select-none items-center justify-center ${hiddenOnMobile ? 'hidden md:flex' : 'flex'} ${dragging ? 'opacity-100 scale-105' : 'opacity-85 hover:opacity-100'}`}
      >
        {!dragging && (
          <span
            aria-hidden="true"
            className="crm-tg-ripple-1 pointer-events-none absolute inset-0 rounded-full bg-[#229ED9]/45 ring-1 ring-[#38bdf8]/60"
          />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-label="Hỗ trợ khách hàng qua Telegram (kéo để di chuyển)"
          title="Kéo để di chuyển · Bấm để mở hỗ trợ Telegram"
          className="relative flex h-11 w-11 cursor-grab active:cursor-grabbing items-center justify-center rounded-full bg-slate-900/75 p-1 backdrop-blur-md shadow-[0_4px_18px_rgba(15,23,42,0.35)] ring-2 ring-white/45"
        >
          <span className="flex h-full w-full items-center justify-center rounded-full bg-[#229ED9] text-white shadow-inner">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path d="M9.04 15.31l-.38 5.32c.54 0 .78-.23 1.06-.5l2.55-2.44 5.28 3.87c.97.53 1.66.25 1.92-.89L22.9 4.02c.31-1.42-.51-1.98-1.45-1.63L2.7 9.62c-1.39.54-1.37 1.32-.24 1.67l4.69 1.46L18.2 6.18c.51-.34.98-.15.6.19L9.04 15.31z" />
            </svg>
          </span>
        </button>
      </div>
      {open && (
        <React.Fragment>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Hỗ trợ qua Telegram"
            style={{ left: `${dialogLeft}px`, top: `${dialogTop}px` }}
            className="fixed z-[9995] w-64 rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-slate-900"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Hỗ trợ EasyChat</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng"
                className="rounded-full px-1.5 text-lg leading-6 text-slate-400 hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
              >
                ×
              </button>
            </div>
            <img
              src={QR_URL}
              alt="Mã QR Telegram hỗ trợ EasyChat"
              className="aspect-[4/5] w-full rounded-xl border border-black/5 object-cover dark:border-white/10"
            />
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Mở app Telegram và quét mã để được hỗ trợ</p>
          </div>
        </React.Fragment>
      )}
    </React.Fragment>,
    document.body
  );
}
