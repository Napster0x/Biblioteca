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

      // Path 1 — synchronous clipboardData.items (works in Chromium).
      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (!item || item.kind !== 'file' || !item.type.startsWith('image/')) continue;
          const file = item.getAsFile();
          if (!file) continue;
          // Pasted clipboard files often have no name; default so the on-disk
          // file gets a real extension and the user sees a friendly filename.
          const name = file.name || 'pasted.png';
          event.preventDefault();
          onImage(file, name);
          return;
        }
      }

      // Path 2 — async navigator.clipboard.read() (works in WebKitGTK 2.42+
      // and modern browsers that don't expose images via clipboardData.items).
      navigator.clipboard
        ?.read()
        .then((clipboardItems) => {
          for (const item of clipboardItems) {
            const imageType = item.types.find((t) => t.startsWith('image/'));
            if (!imageType) continue;
            item.getType(imageType).then((blob) => {
              // Stop the original paste event now that we found an image
              // via the async path. We cannot call preventDefault() after the
              // fact, so the text paste may already have happened — the image
              // read is still useful for the dictionary.
              const file = new File([blob], 'pasted.png', { type: blob.type });
              onImage(file, 'pasted.png');
            });
            break;
          }
        })
        .catch(() => {
          // Clipboard read denied or unavailable — silently fall through.
          // The file picker ("adjuntador de archivos") remains available.
        });
    };

    document.addEventListener('paste', handler);
    return () => {
      document.removeEventListener('paste', handler);
    };
  }, [onImage]);

  return { onMouseEnter, onMouseLeave };
}
