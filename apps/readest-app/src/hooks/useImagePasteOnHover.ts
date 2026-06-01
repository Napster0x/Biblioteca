import { useCallback, useEffect, useRef } from 'react';

/**
 * Track hover on the returned element via `onMouseEnter` / `onMouseLeave`,
 * and on every paste event on `document` look for an image in the clipboard.
 * If the user is currently hovering the element AND the clipboard carries an
 * image, call `onImage(file, name)` and `preventDefault()` the paste.
 *
 * Why a document-level listener: Chromium does NOT fire `paste` events on
 * non-editable elements (a `<button>` or `<div>` with `tabIndex` is not a
 * paste target). The earlier "focus on hover + onPaste" approach only worked
 * in jsdom, not in the real browser. Listening on `document` and keying off
 * hover state works regardless of which element has focus — including when
 * the user is in a sibling `<textarea>` or `contenteditable`.
 *
 * Text pastes are intentionally NOT intercepted. If the clipboard has no
 * image, the document paste is a no-op for us and the browser's default
 * paste behavior runs as normal.
 */
export function useImagePasteOnHover(onImage: (file: File, name: string) => void): {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
} {
  const isHoveringRef = useRef(false);

  const onMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
  }, []);

  const onMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
  }, []);

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (!isHoveringRef.current) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        // Pasted clipboard files often have no name; default so the on-disk
        // file gets a real extension and the user sees a friendly filename.
        const name = file.name || 'pasted.png';
        event.preventDefault();
        onImage(file, name);
        return;
      }
    };

    document.addEventListener('paste', handler);
    return () => {
      document.removeEventListener('paste', handler);
    };
  }, [onImage]);

  return { onMouseEnter, onMouseLeave };
}
