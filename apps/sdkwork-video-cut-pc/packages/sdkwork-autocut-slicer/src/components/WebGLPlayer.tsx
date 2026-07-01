import React, { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as PIXI from 'pixi.js';
import { reportAutoCutDiagnostic } from '@sdkwork/autocut-services';

type TextEffectFill = string | string[];

interface TextEffectStroke {
  color: string;
  width: number;
}

interface TextEffectDropShadow {
  color: string;
  blur: number;
  angle: number;
  distance: number;
  alpha: number;
}

export interface TextEffectStyle {
  fill: TextEffectFill;
  stroke?: TextEffectStroke;
  dropShadow?: TextEffectDropShadow;
  fillGradientType?: 0 | 1;
  fontFamily?: string;
  fontWeight?: PIXI.TextStyleFontWeight;
  fontStyle?: PIXI.TextStyleFontStyle;
  fontSize?: number;
  letterSpacing?: number;
}

export interface TextEffectDragPayload {
  textContent: string;
  styleConfig?: TextEffectStyle;
}

type EditableTextWrapper = PIXI.Container & {
  lastClickTime?: number;
};

const DEFAULT_TEXT_EFFECT_STYLE: TextEffectStyle = {
  fill: '#ffffff',
  stroke: { color: '#000000', width: 4 },
  fontFamily: 'system-ui',
  fontWeight: 'bold',
  dropShadow: { color: '#000000', blur: 4, angle: Math.PI / 4, distance: 4, alpha: 0.8 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasViewUpdate = (node: PIXI.Text): boolean =>
  typeof (node as unknown as Record<string, unknown>).onViewUpdate === 'function';

const isTextEffectDragPayload = (value: unknown): value is TextEffectDragPayload =>
  isRecord(value) &&
  typeof value.textContent === 'string' &&
  (value.styleConfig === undefined || isRecord(value.styleConfig));

const findTextChild = (container: PIXI.Container, label: string) =>
  container.children.find((child): child is PIXI.Text => child.label === label && child instanceof PIXI.Text) ?? null;

const findGraphicsChild = (container: PIXI.Container, label: string) =>
  container.children.find((child): child is PIXI.Graphics => child.label === label && child instanceof PIXI.Graphics) ?? null;

const findContainerChild = (container: PIXI.Container, label: string) =>
  container.children.find((child): child is PIXI.Container => child.label === label && child instanceof PIXI.Container) ?? null;

const createGradientFill = (colors: string[], fillGradientType: 0 | 1 | undefined) =>
  new PIXI.FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: fillGradientType === 1 ? { x: 1, y: 0 } : { x: 0, y: 1 },
    colorStops: colors.map((color, index) => ({
      offset: colors.length === 1 ? 0 : index / (colors.length - 1),
      color,
    })),
    textureSpace: 'local',
  });

const toPixiTextStyleOptions = (styleConfig: TextEffectStyle, fontSize: number): PIXI.TextStyleOptions => {
  const options: PIXI.TextStyleOptions = {
    fill: Array.isArray(styleConfig.fill)
    ? createGradientFill(styleConfig.fill, styleConfig.fillGradientType)
    : styleConfig.fill,
    fontSize,
  };
  if (styleConfig.stroke) options.stroke = styleConfig.stroke;
  if (styleConfig.dropShadow) options.dropShadow = styleConfig.dropShadow;
  if (styleConfig.fontFamily) options.fontFamily = styleConfig.fontFamily;
  if (styleConfig.fontWeight) options.fontWeight = styleConfig.fontWeight;
  if (styleConfig.fontStyle) options.fontStyle = styleConfig.fontStyle;
  if (styleConfig.letterSpacing !== undefined) options.letterSpacing = styleConfig.letterSpacing;
  return options;
};

export interface WebGLPlayerRef {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (progress: number) => void;
  updateSelectedText: (props: Partial<{ text: string, fontSize: number, fill: string }>) => void;
}

export const WebGLPlayerDragState: { currentEffect: TextEffectDragPayload | null } = { currentEffect: null };

let textIdCounter = 0;

const BORDER_COLOR = 0x3b82f6;
const BORDER_PADDING = 16;
const HANDLE_SIZE = 12;
const ROT_HANDLE_DISTANCE = 32;
const MIN_SCALE = 0.1;
const SNAP_THRESHOLD = Math.PI / 36;
const MAX_DPI = 2;
const MAX_TEXT_LENGTH = 1000;

interface WebGLPlayerProps {
  videoSrc: string;
  aspectRatio?: string;
  videoObjectFit?: 'contain' | 'cover';
  onVideoLoaded?: (width: number, height: number) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onSelectText?: (info: { id: string; text: string; fontSize: number; fill: string; x?: number; y?: number; rotation?: number; scale?: number } | null) => void;
}

export const WebGLPlayer = forwardRef<WebGLPlayerRef, WebGLPlayerProps>(({ videoSrc, onTimeUpdate, onPlayStateChange, aspectRatio, videoObjectFit = 'contain', onVideoLoaded, onSelectText }, ref) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onPlayStateChangeRef = useRef(onPlayStateChange);
  onPlayStateChangeRef.current = onPlayStateChange;
  const onVideoLoadedRef = useRef(onVideoLoaded);
  onVideoLoadedRef.current = onVideoLoaded;
  const onSelectTextRef = useRef(onSelectText);
  onSelectTextRef.current = onSelectText;

  const [videoState, setVideoState] = useState<'loading' | 'ready' | 'error'>('loading');

  const notifyTextSelected = useCallback((wrapper: PIXI.Container) => {
    const textNode = findTextChild(wrapper, 'text');
    if (!textNode) return;
    onSelectTextRef.current?.({
      id: wrapper.label,
      text: textNode.text,
      fontSize: Math.round((Number(textNode.style.fontSize) || 32) * wrapper.scale.x),
      fill: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill),
      x: Math.round(wrapper.x),
      y: Math.round(wrapper.y),
      rotation: wrapper.rotation,
      scale: wrapper.scale.x,
    });
  }, []);

  const clientToPixi = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!appRef.current?.canvas) return null;
    const canvas = appRef.current.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = appRef.current.screen.width / rect.width;
    const scaleY = appRef.current.screen.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }, []);

  const objectFitRef = useRef(videoObjectFit);
  useEffect(() => {
     objectFitRef.current = videoObjectFit;
     if (appRef.current && appRef.current.renderer) {
         appRef.current.resize();
     }
  }, [videoObjectFit]);

  const textsRef = useRef<PIXI.Container[]>([]);
  const selectedTextRef = useRef<PIXI.Container | null>(null);
  const activeWindowListenersRef = useRef<{move: ((e: PointerEvent) => void) | null, up: ((e: PointerEvent) => void) | null}>({move: null, up: null});
  const dragPreviewRef = useRef<PIXI.Text | null>(null);
  const [editingInfo, setEditingInfo] = useState<{
    wrapper: PIXI.Container,
    textNode: PIXI.Text,
    text: string,
    x: number,
    y: number,
    color: string,
    rotation: number,
    scale: number,
    fontFamily: string,
    fontSize: number
  } | null>(null);
  const editingInfoRef = useRef(editingInfo);
  editingInfoRef.current = editingInfo;

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoDim, setVideoDim] = useState({ w: 16, h: 9 });

  useEffect(() => {
    if (!parentRef.current) return;
    let animationFrameId: number;
    const observer = new ResizeObserver((entries) => {
       const entry = entries[0];
       if (!entry) return;
       const rect = entry.contentRect;
       if (rect.width === 0 || rect.height === 0) return;

       cancelAnimationFrame(animationFrameId);
       animationFrameId = requestAnimationFrame(() => {
           const safeDimW = videoDim.w > 0 ? videoDim.w : 16;
           const safeDimH = videoDim.h > 0 ? videoDim.h : 9;
           let targetRatioVal = safeDimW / safeDimH;
           if (aspectRatio && aspectRatio !== 'auto') {
               const parts = aspectRatio.split(':');
               if (parts.length === 2) {
                 const parsedRatio = Number(parts[0]) / Number(parts[1]);
                 if (Number.isFinite(parsedRatio) && parsedRatio > 0) targetRatioVal = parsedRatio;
               }
           }

           let w = rect.width;
           let h = w / targetRatioVal;
           if (h > rect.height) {
               h = rect.height;
               w = h * targetRatioVal;
           }

           setContainerSize({ width: w, height: h });

           if (appRef.current && appRef.current.renderer) {
               appRef.current.renderer.resize(w, h);
           }
       });
    });
    observer.observe(parentRef.current);
    return () => {
        observer.disconnect();
        cancelAnimationFrame(animationFrameId);
    };
  }, [aspectRatio, videoDim]);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        onPlayStateChangeRef.current?.(true);
      } else {
        videoRef.current.pause();
        onPlayStateChangeRef.current?.(false);
      }
    }
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (videoRef.current) {
        videoRef.current.play();
        onPlayStateChangeRef.current?.(true);
      }
    },
    pause: () => {
      if (videoRef.current) {
        videoRef.current.pause();
        onPlayStateChangeRef.current?.(false);
      }
    },
    togglePlay,
    seek: (percent: number) => {
      if (videoRef.current && videoRef.current.duration && Number.isFinite(percent)) {
         videoRef.current.currentTime = videoRef.current.duration * Math.max(0, Math.min(1, percent));
      }
    },
    updateSelectedText: (props: Partial<{ text: string, fontSize: number, fill: string }>) => {
      if (selectedTextRef.current) {
         const wrapper = selectedTextRef.current;
         const t = findTextChild(wrapper, 'text');
         if (!t) return;
         if (props.text !== undefined) t.text = props.text;
         if (props.fontSize !== undefined) {
             const currentVisualSize = (Number(t.style.fontSize) || 32) * wrapper.scale.x;
             const targetVisualSize = props.fontSize;
             const newScale = currentVisualSize > 0 ? wrapper.scale.x * (targetVisualSize / currentVisualSize) : wrapper.scale.x;
             const baseFontSize = newScale > 0 ? targetVisualSize / newScale : props.fontSize;
             t.style.fontSize = baseFontSize;
             wrapper.scale.set(newScale);
         }
         if (props.fill !== undefined) t.style.fill = props.fill;
         updateBorder(wrapper);
         notifyTextSelected(wrapper);
      }
    }
  }), [togglePlay]);

  useEffect(() => {
    let app: PIXI.Application | null = null;
    let video: HTMLVideoElement | null = null;
    let cancelled = false;
    setVideoState('loading');
    let handleVideoError: (() => void) | null = null;
    let handleLoadedMetadata: (() => void) | null = null;
    let handleTimeUpdate: (() => void) | null = null;
    let handleContextLost: ((e: Event) => void) | null = null;
    let handleRendererResize: (() => void) | null = null;
    let tickerFn: (() => void) | null = null;
    let handleStagePointerDown: ((e: PIXI.FederatedPointerEvent) => void) | null = null;

    const initPixi = async () => {
      const containerElement = containerRef.current;
      if (!containerElement || cancelled) return;
      try {
        app = new PIXI.Application();
        await app.init({
          resizeTo: containerElement,
          backgroundColor: 0x050505,
          resolution: Math.min(window.devicePixelRatio || 1, MAX_DPI),
          autoDensity: true,
        });
      } catch (err) {
        reportAutoCutDiagnostic('error', 'slicer.webgl.init', 'PIXI Application init failed', err);
        if (app) { try { app.destroy(true, { children: true, texture: true }); } catch {} app = null; }
        if (!cancelled) setVideoState('error');
        return;
      }

      if (cancelled) {
        try { app.destroy(true, { children: true, texture: true }); } catch {}
        return;
      }

      const appInstance = app;
      appInstance.canvas.style.position = 'absolute';
      appInstance.canvas.style.left = '0';
      appInstance.canvas.style.top = '0';
      appInstance.canvas.style.width = '100%';
      appInstance.canvas.style.height = '100%';
      containerElement.appendChild(appInstance.canvas);
      appRef.current = appInstance;

      handleContextLost = (e: Event) => {
        e.preventDefault();
        if (!cancelled) {
          setVideoState('error');
          reportAutoCutDiagnostic('error', 'slicer.webgl.context', 'WebGL context lost');
        }
      };
      appInstance.canvas.addEventListener('webglcontextlost', handleContextLost);

      video = document.createElement('video');
      video.src = videoSrc;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      videoRef.current = video;
      const videoElement = video;

      containerElement.tabIndex = 0;

      handleVideoError = () => {
         if (cancelled) return;
         if (!videoElement) return;
         reportAutoCutDiagnostic('error', 'slicer.webgl.video', 'Video load failed', videoElement.error);
         setVideoState('error');
       };

       handleLoadedMetadata = () => {
        if (cancelled) return;
        if (!videoElement) return;
        setVideoState('ready');
        const vw = videoElement.videoWidth || 16;
        const vh = videoElement.videoHeight || 9;
        setVideoDim(prev => (prev.w === vw && prev.h === vh) ? prev : { w: vw, h: vh });
        onVideoLoadedRef.current?.(vw, vh);

        const texture = PIXI.Texture.from(videoElement);
        const videoSprite = new PIXI.Sprite(texture);

        videoSprite.anchor.set(0.5);
        videoSprite.x = appInstance.screen.width / 2;
        videoSprite.y = appInstance.screen.height / 2;

        const lastScreenRef = { width: appInstance.screen.width, height: appInstance.screen.height };

        const updateScale = () => {
          const scaleX = appInstance.screen.width / vw;
          const scaleY = appInstance.screen.height / vh;
          const newScale = objectFitRef.current === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

          if (isFinite(newScale) && newScale > 0) {
            const oldScale = videoSprite.scale.x;
            const ratio = newScale / oldScale;
            videoSprite.scale.set(newScale);

            if (isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) > 1e-6) {
              const oldCenterX = lastScreenRef.width / 2;
              const oldCenterY = lastScreenRef.height / 2;
              const newCenterX = appInstance.screen.width / 2;
              const newCenterY = appInstance.screen.height / 2;

              textsRef.current.forEach(wrapper => {
                 const dx = wrapper.x - oldCenterX;
                 const dy = wrapper.y - oldCenterY;
                 wrapper.x = newCenterX + dx * ratio;
                 wrapper.y = newCenterY + dy * ratio;
                 wrapper.scale.set(wrapper.scale.x * ratio);
                 updateBorder(wrapper);
              });
            }
            lastScreenRef.width = appInstance.screen.width;
            lastScreenRef.height = appInstance.screen.height;
          }
        };
        updateScale();

        handleRendererResize = () => {
          if (appInstance && !cancelled) {
            videoSprite.x = appInstance.screen.width / 2;
            videoSprite.y = appInstance.screen.height / 2;
            appInstance.stage.hitArea = new PIXI.Rectangle(0, 0, appInstance.screen.width, appInstance.screen.height);
            updateScale();
          }
        };
        appInstance.renderer.on('resize', handleRendererResize);

        appInstance.stage.addChild(videoSprite);
        appInstance.stage.eventMode = 'dynamic';
        appInstance.stage.hitArea = new PIXI.Rectangle(0, 0, appInstance.screen.width, appInstance.screen.height);
        appInstance.stage.sortableChildren = true;

        let lastTime = -1;
        tickerFn = () => {
           if(videoElement.readyState >= 2) {
               if (videoElement.currentTime !== lastTime) {
                   if (videoSprite.texture.source) {
                       videoSprite.texture.source.update();
                   } else {
                       videoSprite.texture.update();
                   }
                   lastTime = videoElement.currentTime;
               }
           }
        };
        appInstance.ticker.add(tickerFn);

        handleStagePointerDown = (e: PIXI.FederatedPointerEvent) => {
           if (cancelled) return;
           if (e.target === appInstance.stage || e.target === videoSprite) {
                if (selectedTextRef.current) {
                    const border = findContainerChild(selectedTextRef.current, 'border');
                    if (border) border.visible = false;
                    selectedTextRef.current = null;
                    onSelectTextRef.current?.(null);
                } else {
                    if (videoRef.current) {
                        if (videoRef.current.paused) {
                            videoRef.current.play();
                            onPlayStateChangeRef.current?.(true);
                        } else {
                            videoRef.current.pause();
                            onPlayStateChangeRef.current?.(false);
                        }
                    }
                }
           }
        };
        appInstance.stage.on('pointerdown', handleStagePointerDown);
      };

      handleTimeUpdate = () => {
        if (cancelled) return;
        if (!videoElement) return;
        if(videoElement.duration > 0) {
            onTimeUpdateRef.current?.(videoElement.currentTime, videoElement.duration);
        }
      };

      video.addEventListener('error', handleVideoError);
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('timeupdate', handleTimeUpdate);
    };

    initPixi();

    const handleKeyDown = (e: KeyboardEvent) => {
       if (editingInfoRef.current) return;
       if (e.key === 'Escape' && selectedTextRef.current) {
           const border = findContainerChild(selectedTextRef.current, 'border');
           if (border) border.visible = false;
           selectedTextRef.current = null;
           onSelectTextRef.current?.(null);
           return;
       }
       if ((e.key === 'Backspace' || e.key === 'Delete') && selectedTextRef.current) {
           const listeners = activeWindowListenersRef.current;
           if (listeners.move) window.removeEventListener('pointermove', listeners.move);
           if (listeners.up) window.removeEventListener('pointerup', listeners.up);
           activeWindowListenersRef.current = {move: null, up: null};
           const idx = textsRef.current.indexOf(selectedTextRef.current);
           if (idx !== -1) textsRef.current.splice(idx, 1);
           selectedTextRef.current.destroy();
           selectedTextRef.current = null;
           onSelectTextRef.current?.(null);
       }
    };

    if (containerRef.current) {
       containerRef.current.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      cancelled = true;
      const listeners = activeWindowListenersRef.current;
      if (listeners.move) window.removeEventListener('pointermove', listeners.move);
      if (listeners.up) window.removeEventListener('pointerup', listeners.up);
      activeWindowListenersRef.current = { move: null, up: null };
      if (containerRef.current) {
         containerRef.current.removeEventListener('keydown', handleKeyDown);
      }
      if (video) {
        video.pause();
        if (handleVideoError) video.removeEventListener('error', handleVideoError);
        if (handleLoadedMetadata) video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        if (handleTimeUpdate) video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeAttribute('src');
        video.load();
        videoRef.current = null;
      }
      if (appRef.current) {
        if (handleContextLost) appRef.current.canvas.removeEventListener('webglcontextlost', handleContextLost);
        if (handleRendererResize) appRef.current.renderer.off('resize', handleRendererResize);
        if (tickerFn) appRef.current.ticker.remove(tickerFn);
        if (handleStagePointerDown) appRef.current.stage.off('pointerdown', handleStagePointerDown);
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      app = null;
      video = null;
      textsRef.current = [];
      selectedTextRef.current = null;
      if (dragPreviewRef.current) dragPreviewRef.current = null;
      setEditingInfo(null);
    };
  }, [videoSrc]);

  const addBorderToText = (wrapper: PIXI.Container) => {
      let border = new PIXI.Container();
      border.label = 'border';

      let bg = new PIXI.Graphics(); bg.label = 'bg'; bg.eventMode = 'none';
      let tl = new PIXI.Graphics(); tl.label = 'tl';
      let tr = new PIXI.Graphics(); tr.label = 'tr';
      let bl = new PIXI.Graphics(); bl.label = 'bl';
      let br = new PIXI.Graphics(); br.label = 'br';
      let rotLine = new PIXI.Graphics(); rotLine.label = 'rotLine'; rotLine.eventMode = 'none';
      let rotHandle = new PIXI.Graphics(); rotHandle.label = 'rotHandle';

      border.addChild(bg, tl, tr, bl, br, rotLine, rotHandle);
      wrapper.addChild(border);

      const resizeCursors = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize'] as const;
      [tl, tr, bl, br].forEach((handle, i) => {
          handle.eventMode = 'dynamic';
          handle.cursor = resizeCursors[i] ?? 'move';

          let handleDragging = false;
          let initialScale = 1;
          let initialDist = 1;

          const onHandleMove = (e: PointerEvent) => {
              if (handleDragging) {
                  const pt = clientToPixi(e.clientX, e.clientY);
                  if (!pt) return;

                  const dist = Math.hypot(pt.x - wrapper.x, pt.y - wrapper.y);
                  const ratio = dist / initialDist;
                  wrapper.scale.set(Math.max(MIN_SCALE, initialScale * ratio));
                  updateBorder(wrapper);
              }
          };

          const onHandleUp = () => {
              if (handleDragging) {
                  handleDragging = false;
                  window.removeEventListener('pointermove', onHandleMove);
                  window.removeEventListener('pointerup', onHandleUp);
                  activeWindowListenersRef.current = {move: null, up: null};
                  notifyTextSelected(wrapper);
              }
          };

          handle.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
              e.stopPropagation();
              handleDragging = true;
              initialScale = wrapper.scale.x;
              const pt = e.global;
              initialDist = Math.hypot(pt.x - wrapper.x, pt.y - wrapper.y);
              const prev = activeWindowListenersRef.current;
              if (prev.move) window.removeEventListener('pointermove', prev.move);
              if (prev.up) window.removeEventListener('pointerup', prev.up);
              window.addEventListener('pointermove', onHandleMove);
              window.addEventListener('pointerup', onHandleUp);
              activeWindowListenersRef.current = {move: onHandleMove, up: onHandleUp};
          });
      });

      rotHandle.eventMode = 'dynamic';
      rotHandle.cursor = 'crosshair';

      let rotDragging = false;
      let initialRotation = 0;
      let initialAngle = 0;

      const onRotMove = (e: PointerEvent) => {
          if (rotDragging) {
              const pt = clientToPixi(e.clientX, e.clientY);
              if (!pt) return;

              const currentAngle = Math.atan2(pt.y - wrapper.y, pt.x - wrapper.x);
              let newRot = initialRotation + (currentAngle - initialAngle);
              const snapThresh = SNAP_THRESHOLD;
              const snapPoints = [0, Math.PI/2, Math.PI, -Math.PI/2, -Math.PI];
              for(const snap of snapPoints) {
                  if (Math.abs(newRot - snap) < snapThresh) {
                      newRot = snap;
                      break;
                  }
              }
              wrapper.rotation = newRot;
          }
      };

      const onRotUp = () => {
          if (rotDragging) {
              rotDragging = false;
              window.removeEventListener('pointermove', onRotMove);
              window.removeEventListener('pointerup', onRotUp);
              activeWindowListenersRef.current = {move: null, up: null};
              notifyTextSelected(wrapper);
          }
      };

      rotHandle.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
          e.stopPropagation();
          rotDragging = true;
          initialRotation = wrapper.rotation;
          const pt = e.global;
          initialAngle = Math.atan2(pt.y - wrapper.y, pt.x - wrapper.x);
          const prev2 = activeWindowListenersRef.current;
          if (prev2.move) window.removeEventListener('pointermove', prev2.move);
          if (prev2.up) window.removeEventListener('pointerup', prev2.up);
          window.addEventListener('pointermove', onRotMove);
          window.addEventListener('pointerup', onRotUp);
          activeWindowListenersRef.current = {move: onRotMove, up: onRotUp};
      });

      updateBorder(wrapper);
  };

  const updateBorder = (wrapper: PIXI.Container) => {
      let border = findContainerChild(wrapper, 'border');
      let text = findTextChild(wrapper, 'text');
      if (!border || !text) return;

      let bg = findGraphicsChild(border, 'bg');
      let tl = findGraphicsChild(border, 'tl');
      let tr = findGraphicsChild(border, 'tr');
      let bl = findGraphicsChild(border, 'bl');
      let br = findGraphicsChild(border, 'br');
      let rotLine = findGraphicsChild(border, 'rotLine');
      let rotHandle = findGraphicsChild(border, 'rotHandle');

      if (!bg || !tl || !tr || !bl || !br || !rotLine || !rotHandle) return;

      bg.clear(); tl.clear(); tr.clear(); bl.clear(); br.clear(); rotLine.clear(); rotHandle.clear();

      // Update text to make sure texture width/height are correct
      if (hasViewUpdate(text)) {
        ((text as unknown as Record<string, unknown>).onViewUpdate as () => void)();
      }

      const padding = BORDER_PADDING / wrapper.scale.x;
      const rawTW = text.scale.x !== 0 ? text.width / text.scale.x : text.width;
      const rawTH = text.scale.y !== 0 ? text.height / text.scale.y : text.height;
      const tW = isFinite(rawTW) && rawTW > 0 ? rawTW : 1;
      const tH = isFinite(rawTH) && rawTH > 0 ? rawTH : 1;

      const w = tW + padding * 2;
      const h = tH + padding * 2;
      const vx = -tW / 2 - padding;
      const vy = -tH / 2 - padding;

      bg.rect(vx, vy, w, h);
      bg.stroke({ width: 2 / wrapper.scale.x, color: BORDER_COLOR });

      const hn = HANDLE_SIZE / wrapper.scale.x;
      const sw = 2 / wrapper.scale.x;

      [tl, tr, bl, br].forEach((hg, i) => {
          let hx = vx, hy = vy;
          if (i === 1 || i === 3) hx = vx + w;
          if (i === 2 || i === 3) hy = vy + h;
          hg.circle(hx, hy, hn/2);
          hg.fill(0xffffff);
          hg.stroke({ width: sw, color: BORDER_COLOR });
      });

      const rotDist = ROT_HANDLE_DISTANCE / wrapper.scale.x;
      rotLine.moveTo(0, vy);
      rotLine.lineTo(0, vy - rotDist);
      rotLine.stroke({ width: sw, color: BORDER_COLOR });

      rotHandle.circle(0, vy - rotDist, hn/2);
      rotHandle.fill(0xffffff);
      rotHandle.stroke({ width: sw, color: BORDER_COLOR });

      const hitBox = findGraphicsChild(wrapper, 'hitBox');
      if (hitBox) {
          hitBox.clear();
          hitBox.rect(vx - hn, vy - rotDist - hn, w + hn * 2, h + rotDist + hn * 2);
          hitBox.fill(0xffffff);
      }
  };

  const selectText = (wrapper: PIXI.Container) => {
      if (selectedTextRef.current && selectedTextRef.current !== wrapper) {
          const oldBorder = findContainerChild(selectedTextRef.current, 'border');
          if (oldBorder) oldBorder.visible = false;
          selectedTextRef.current.zIndex = 10;
      }
      selectedTextRef.current = wrapper;
      const newBorder = findContainerChild(wrapper, 'border');
      if (newBorder) newBorder.visible = true;
      wrapper.zIndex = 20;
      appRef.current?.stage.sortChildren();
      notifyTextSelected(wrapper);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!appRef.current || !containerRef.current) return;

    const pt = clientToPixi(e.clientX, e.clientY);
    if (!pt) return;

    if (WebGLPlayerDragState.currentEffect) {
        if (!dragPreviewRef.current) {
            const effect = WebGLPlayerDragState.currentEffect;
            let styleConfig: TextEffectStyle = { ...DEFAULT_TEXT_EFFECT_STYLE, ...effect.styleConfig };
            const app = appRef.current;
            const style = new PIXI.TextStyle(
              toPixiTextStyleOptions(styleConfig, Math.max(app.screen.width * 0.04, 32)),
            );
            const text = new PIXI.Text({ text: effect.textContent, style });
            text.anchor.set(0.5);
            text.alpha = 0.6;
            app.stage.addChild(text);
            dragPreviewRef.current = text;
        }

        if (dragPreviewRef.current) {
            dragPreviewRef.current.x = pt.x;
            dragPreviewRef.current.y = pt.y;
        }
    }
  };

  const handleDragLeave = () => {
    if (dragPreviewRef.current) {
        dragPreviewRef.current.destroy();
        dragPreviewRef.current = null;
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragPreviewRef.current) {
        dragPreviewRef.current.destroy();
        dragPreviewRef.current = null;
    }
    if (!appRef.current || !containerRef.current) return;

    let textContent = "";
    let styleConfig: TextEffectStyle = { ...DEFAULT_TEXT_EFFECT_STYLE };

    const jsonData = e.dataTransfer.getData("application/json");
    if (jsonData) {
        try {
            const parsed: unknown = JSON.parse(jsonData);
            if (!isTextEffectDragPayload(parsed)) return;
            textContent = parsed.textContent;
            if (parsed.styleConfig) {
               styleConfig = { ...styleConfig, ...parsed.styleConfig };
            }
        } catch(err) {
            reportAutoCutDiagnostic('warning', 'slicer.webgl.drop', 'Failed to parse JSON drop data', err);
        }
    } else {
        const plainData = e.dataTransfer.getData("text/plain");
        if (plainData && plainData.length <= MAX_TEXT_LENGTH) {
            textContent = plainData;
        } else {
            return;
        }
    }

    if (!textContent) return;

    try {
      const app = appRef.current;
      const pt = clientToPixi(e.clientX, e.clientY);
      if (!app || !pt) return;

      const style = new PIXI.TextStyle(
        toPixiTextStyleOptions(styleConfig, Math.max(app.screen.width * 0.04, 32)),
      );

      const wrapper = new PIXI.Container();
      wrapper.label = `text-${++textIdCounter}-${Date.now()}`;
      wrapper.x = pt.x;
      wrapper.y = pt.y;

      const hitBox = new PIXI.Graphics();
      hitBox.label = 'hitBox';
      hitBox.alpha = 0.001; // Translucent so it captures hit
      wrapper.addChild(hitBox);

      const textNode = new PIXI.Text({ text: textContent, style });
      textNode.label = 'text';
      textNode.anchor.set(0.5);
      wrapper.addChild(textNode);

      addBorderToText(wrapper);
      const border = findContainerChild(wrapper, 'border');
      if (border) border.visible = false;

      wrapper.eventMode = 'dynamic';
      wrapper.cursor = 'move';

      let dragging = false;
      let dragOffset = { x: 0, y: 0 };

      const onWindowMove = (e: PointerEvent) => {
        if (dragging) {
            const pt = clientToPixi(e.clientX, e.clientY);
            if (!pt) return;

            wrapper.x = pt.x - dragOffset.x;
            wrapper.y = pt.y - dragOffset.y;
        }
      };

      const onWindowUp = () => {
        if (dragging) {
            dragging = false;
            wrapper.cursor = 'move';
            wrapper.alpha = 1;
            window.removeEventListener('pointermove', onWindowMove);
            window.removeEventListener('pointerup', onWindowUp);
            activeWindowListenersRef.current = {move: null, up: null};
            notifyTextSelected(wrapper);
        }
      };

      wrapper.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        selectText(wrapper);

        const now = Date.now();
        const editableWrapper = wrapper as EditableTextWrapper;
        if (editableWrapper.lastClickTime && now - editableWrapper.lastClickTime < 300) {
            setEditingInfo({
               wrapper: wrapper,
               textNode: textNode,
               text: textNode.text,
               x: wrapper.x,
               y: wrapper.y,
               scale: wrapper.scale.x,
               rotation: wrapper.rotation,
               fontFamily: (textNode.style.fontFamily as string) || 'system-ui',
               fontSize: Number(textNode.style.fontSize) || 32,
               color: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill || '#ffffff')
            });
            textNode.alpha = 0;
            if (border) border.visible = false;
            return;
        }
        editableWrapper.lastClickTime = now;

        dragging = true;
        wrapper.alpha = 0.9;

        const localPt = event.global;
        dragOffset = { x: localPt.x - wrapper.x, y: localPt.y - wrapper.y };

        const prev3 = activeWindowListenersRef.current;
        if (prev3.move) window.removeEventListener('pointermove', prev3.move);
        if (prev3.up) window.removeEventListener('pointerup', prev3.up);
        window.addEventListener('pointermove', onWindowMove);
        window.addEventListener('pointerup', onWindowUp);
        activeWindowListenersRef.current = {move: onWindowMove, up: onWindowUp};
      });

      app.stage.addChild(wrapper);
      textsRef.current.push(wrapper);
      selectText(wrapper);

    } catch (err) {
      reportAutoCutDiagnostic('error', 'slicer.webgl.drop', 'Failed to create dropped text effect', err);
    }
  };

  const commitEdit = () => {
    if (editingInfoRef.current) {
      const currentEditingInfo = editingInfoRef.current;
      const trimmedText = currentEditingInfo.text.trim();
      currentEditingInfo.textNode.text = trimmedText || ' ';
      currentEditingInfo.textNode.alpha = 1;

      updateBorder(currentEditingInfo.wrapper);
      const border = findContainerChild(currentEditingInfo.wrapper, 'border');
      if (border) border.visible = true;

      notifyTextSelected(currentEditingInfo.wrapper);

      setEditingInfo(null);
    }
  };

  return (
    <div
      ref={parentRef}
      className="w-full h-full relative group rounded-lg overflow-hidden shadow-2xl border border-[#333] transition-all bg-[#050505] flex items-center justify-center p-2"
    >
      <div
        ref={containerRef}
        className="relative flex items-center justify-center outline-none cursor-pointer bg-black shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-[#222] touch-none"
        style={{ width: containerSize.width, height: containerSize.height }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      {videoState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {videoState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-red-400 text-sm text-center px-4">
            <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            <span>Video failed to load</span>
          </div>
        </div>
      )}
      {editingInfo && (
        <textarea
           autoFocus
           value={editingInfo.text}
           ref={el => {
              if (el) {
                 el.style.height = '0px';
                 el.style.height = (el.scrollHeight + 5) + 'px';
                 el.style.width = '0px';
                 el.style.width = (el.scrollWidth + 10) + 'px';
              }
           }}
           onChange={(e) => {
              const newText = e.target.value;
              setEditingInfo(prev => prev ? { ...prev, text: newText } : null);
              if (editingInfoRef.current) {
                editingInfoRef.current.textNode.text = newText;
                updateBorder(editingInfoRef.current.wrapper);
              }
           }}
           onBlur={commitEdit}
           onKeyDown={(e) => {
             e.stopPropagation();
             if (e.key === 'Enter' && !e.shiftKey) {
               e.preventDefault();
               commitEdit();
             }
           }}
           onPointerDown={(e) => e.stopPropagation()}
           onMouseDown={(e) => e.stopPropagation()}
           className="absolute pointer-events-auto resize-none bg-black/60 backdrop-blur-sm outline-none border border-blue-500 rounded px-2 py-0 text-center shadow-2xl custom-scrollbar"
           style={{
             left: `${(editingInfo.x / (appRef.current?.screen.width || 1)) * 100}%`,
             top: `${(editingInfo.y / (appRef.current?.screen.height || 1)) * 100}%`,
             transform: `translate(-50%, -50%) rotate(${editingInfo.rotation}rad) scale(${editingInfo.scale})`,
             color: editingInfo.color,
             fontSize: editingInfo.fontSize,
             fontFamily: editingInfo.fontFamily,
             fontWeight: 'bold',
             minWidth: '100px',
             whiteSpace: 'pre-wrap',
             overflow: 'hidden',
             zIndex: 50,
             lineHeight: 1.2
           }}
        />
      )}
      </div>
    </div>
  );
});

export default WebGLPlayer;
