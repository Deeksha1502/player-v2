import { useEffect, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { useTelemetry } from '../../context/useTelemetry';
import './image-viewer.css';

/**
 * Image zoom / click-to-enlarge, ported from the Angular web-component.
 *
 * Mirrors:
 *   - section-player.component.ts:setImageZoom()          (magnify icon + open)
 *   - section-player.component.ts:setImageHeightWidthClass() (portrait/landscape)
 *   - section-player.component.ts:zoomIn/zoomOut/closeZoom()
 *
 * Angular queries the whole document after each slide change; here we scope the
 * pass to a container ref and re-run on DOM mutations (covering late-rendered
 * solution content), which reproduces the same runtime result.
 */

export type Orientation = 'portrait' | 'landscape' | 'neutral';

export interface ImageZoomState {
  open: boolean;
  src: string;
  orientation: Orientation;
  /** Zoom percentage; starts at 100, +/-10 per step, min 100 (Angular parity). */
  zoom: number;
}

const INITIAL: ImageZoomState = { open: false, src: '', orientation: 'neutral', zoom: 100 };

/** Portrait if taller than wide, landscape if wider, else neutral (Angular rule). */
function orientationOf(img: HTMLImageElement): Orientation {
  const h = img.naturalHeight || img.clientHeight;
  const w = img.naturalWidth || img.clientWidth;
  if (h > w) return 'portrait';
  if (h < w) return 'landscape';
  return 'neutral';
}

export function useImageZoom(
  containerRef: RefObject<HTMLElement>,
  deps: unknown[] = [],
) {
  const [state, setState] = useState<ImageZoomState>(INITIAL);
  const { logInteraction } = useTelemetry();

  // Angular parity (section-player.component.ts:1374/1392/1398/1412 —
  // eventName.zoomClicked/zoomInClicked/zoomOutClicked/zoomCloseClicked).
  const openViewer = useCallback((img: HTMLImageElement) => {
    logInteraction('zoom_clicked');
    setState({ open: true, src: img.src, orientation: orientationOf(img), zoom: 100 });
  }, [logInteraction]);

  const close = useCallback(() => {
    logInteraction('zoom_close_clicked');
    setState((s) => ({ ...s, open: false, zoom: 100 }));
  }, [logInteraction]);
  const zoomIn = useCallback(() => {
    logInteraction('zoom_in_clicked');
    setState((s) => ({ ...s, zoom: s.zoom + 10 }));
  }, [logInteraction]);
  // Mirrors Angular zoomOut(): only steps down while above 100%.
  const zoomOut = useCallback(() => {
    logInteraction('zoom_out_clicked');
    setState((s) => (s.zoom > 100 ? { ...s, zoom: s.zoom - 10 } : s));
  }, [logInteraction]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Mirrors setImageZoom() + setImageHeightWidthClass(): decorate every
    // data-asset-variable <img> with an orientation class + a magnify icon.
    const decorate = () => {
      const images = root.querySelectorAll<HTMLImageElement>('img[data-asset-variable]');
      images.forEach((image) => {
        if (image.dataset.zoomBound === 'true') return;
        image.dataset.zoomBound = 'true';
        image.classList.add('option-image');

        const applyOrientation = () => {
          image.classList.remove('portrait', 'landscape', 'neutral');
          image.classList.add(orientationOf(image));
        };
        if (image.complete) applyOrientation();
        else image.addEventListener('load', applyOrientation, { once: true });

        const icon = document.createElement('div');
        icon.className = 'magnify-icon';
        icon.onclick = (event) => {
          event.stopPropagation();
          openViewer(image);
        };
        if (image.parentNode) {
          // Ensure the icon anchors to a positioned parent.
          const parent = image.parentElement;
          if (parent && getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
          }
          image.parentNode.insertBefore(icon, image.nextSibling);
        }
      });
    };

    decorate();
    // Re-decorate when solution/hint content mounts later.
    const observer = new MutationObserver(() => decorate());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { state, close, zoomIn, zoomOut };
}
