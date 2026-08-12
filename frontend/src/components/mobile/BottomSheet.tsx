import { useEffect, useRef, useState } from 'react';
import { X } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { hapticLight } from '@/lib/haptics';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const titleId = 'bottom-sheet-title';

  useEffect(() => {
    if (open) {
      setDragY(0);
      document.body.style.overflow = 'hidden';
      hapticLight();
      const t = window.setTimeout(() => sheetRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
    document.body.style.overflow = '';
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0]?.clientY ?? 0;
    setDragging(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!dragging) return;
    const diff = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (diff > 0) setDragY(diff);
  }

  function handleTouchEnd() {
    setDragging(false);
    if (dragY > 100) {
      hapticLight();
      onClose();
    } else {
      setDragY(0);
    }
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl shadow-2xl outline-none transition-transform duration-300 max-h-[85vh] flex flex-col',
          dragging && 'transition-none'
        )}
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
      >
        {/* Drag handle — drag starts here only, so swiping scrollable content scrolls instead of dragging */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex w-full cursor-grab touch-none justify-center pt-2 pb-1 active:cursor-grabbing"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </button>
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 pb-3 border-b">
            <h3 id={titleId} className="text-base font-semibold">{title}</h3>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {/* Content */}
        <div className="overflow-y-auto flex-1 p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
