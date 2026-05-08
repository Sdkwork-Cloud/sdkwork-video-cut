import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
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
  typeof value === 'object' && value !== null;

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

  const objectFitRef = useRef(videoObjectFit);
  useEffect(() => {
     objectFitRef.current = videoObjectFit;
     if (appRef.current && appRef.current.renderer) {
         appRef.current.resize();
     }
  }, [videoObjectFit]);

  const textsRef = useRef<PIXI.Container[]>([]);
  const selectedTextRef = useRef<PIXI.Container | null>(null);
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
  useEffect(() => { editingInfoRef.current = editingInfo; }, [editingInfo]);

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
           let targetRatioVal = videoDim.w / videoDim.h;
           if (aspectRatio && aspectRatio !== 'auto') {
               const parts = aspectRatio.split(':');
               if (parts.length === 2) targetRatioVal = Number(parts[0]) / Number(parts[1]);
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

  useImperativeHandle(ref, () => ({
    play: () => {
      if (videoRef.current) {
        videoRef.current.play();
        onPlayStateChange?.(true);
      }
    },
    pause: () => {
      if (videoRef.current) {
        videoRef.current.pause();
        onPlayStateChange?.(false);
      }
    },
    togglePlay,
    seek: (percent: number) => {
      if (videoRef.current && videoRef.current.duration) {
         videoRef.current.currentTime = videoRef.current.duration * percent;
      }
    },
    updateSelectedText: (props: Partial<{ text: string, fontSize: number, fill: string }>) => {
      if (selectedTextRef.current) {
         const wrapper = selectedTextRef.current;
         const t = findTextChild(wrapper, 'text');
         if (!t) return;
         if (props.text !== undefined) t.text = props.text;
         if (props.fontSize !== undefined) {
             t.style.fontSize = props.fontSize;
             wrapper.scale.set(1);
         }
         if (props.fill !== undefined) t.style.fill = props.fill;
         updateBorder(wrapper);

         // Fire callback to ensure UI is in sync
         if (onSelectText) {
            onSelectText({
                id: wrapper.label,
                text: t.text,
                fontSize: Math.round((Number(t.style.fontSize) || 32) * wrapper.scale.x),
                fill: Array.isArray(t.style.fill) ? String(t.style.fill[0]) : String(t.style.fill),
                x: Math.round(wrapper.x),
                y: Math.round(wrapper.y),
                rotation: wrapper.rotation,
                scale: wrapper.scale.x
            });
         }
      }
    }
  }));

  useEffect(() => {
    let app: PIXI.Application;
    let video: HTMLVideoElement;

    const initPixi = async () => {
      const containerElement = containerRef.current;
      if (!containerElement) return;
      app = new PIXI.Application();
      await app.init({
        resizeTo: containerElement,
        backgroundColor: 0x050505,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      app.canvas.style.position = 'absolute';
      app.canvas.style.left = '0';
      app.canvas.style.top = '0';
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      containerElement.appendChild(app.canvas);
      appRef.current = app;

      video = document.createElement('video');
      video.src = videoSrc;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      videoRef.current = video;

      containerElement.tabIndex = 0;

      video.addEventListener('loadedmetadata', () => {
        setVideoDim({ w: video.videoWidth, h: video.videoHeight });
        if (onVideoLoaded) {
            onVideoLoaded(video.videoWidth, video.videoHeight);
        }

        const texture = PIXI.Texture.from(video);
        const videoSprite = new PIXI.Sprite(texture);

        videoSprite.anchor.set(0.5);
        videoSprite.x = app.screen.width / 2;
        videoSprite.y = app.screen.height / 2;

        const lastScreenRef = { width: app.screen.width, height: app.screen.height };

        const updateScale = () => {
          const scaleX = app.screen.width / video.videoWidth;
          const scaleY = app.screen.height / video.videoHeight;
          const newScale = objectFitRef.current === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

          if (isFinite(newScale) && newScale > 0) {
            const oldScale = videoSprite.scale.x;
            const ratio = newScale / oldScale;
            videoSprite.scale.set(newScale);

            if (isFinite(ratio) && ratio > 0 && ratio !== 1) {
              const oldCenterX = lastScreenRef.width / 2;
              const oldCenterY = lastScreenRef.height / 2;
              const newCenterX = app.screen.width / 2;
              const newCenterY = app.screen.height / 2;

              textsRef.current.forEach(wrapper => {
                 const dx = wrapper.x - oldCenterX;
                 const dy = wrapper.y - oldCenterY;
                 wrapper.x = newCenterX + dx * ratio;
                 wrapper.y = newCenterY + dy * ratio;
                 wrapper.scale.set(wrapper.scale.x * ratio);
                 updateBorder(wrapper);
              });
            }
            lastScreenRef.width = app.screen.width;
            lastScreenRef.height = app.screen.height;
          }
        };
        updateScale();

        app.renderer.on('resize', () => {
          if (app) {
            videoSprite.x = app.screen.width / 2;
            videoSprite.y = app.screen.height / 2;
            app.stage.hitArea = new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height);
            updateScale();
          }
        });

        app.stage.addChild(videoSprite);
        app.stage.eventMode = 'dynamic';
        app.stage.hitArea = new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height);
        app.stage.sortableChildren = true;

        let lastTime = -1;
        app.ticker.add(() => {
           if(video.readyState >= 2) {
               if (video.currentTime !== lastTime) {
                   if (videoSprite.texture.source) {
                       videoSprite.texture.source.update();
                   } else {
                       videoSprite.texture.update();
                   }
                   lastTime = video.currentTime;
               }
           }
        });

        app.stage.on('pointerdown', (e) => {
           if (e.target === app.stage || e.target === videoSprite) {
                if (selectedTextRef.current) {
                    const border = findContainerChild(selectedTextRef.current, 'border');
                    if (border) border.visible = false;
                    selectedTextRef.current = null;
                    if (onSelectText) onSelectText(null);
                } else {
                    if (videoRef.current) {
                        if (videoRef.current.paused) {
                            videoRef.current.play();
                            onPlayStateChange?.(true);
                        } else {
                            videoRef.current.pause();
                            onPlayStateChange?.(false);
                        }
                    }
                }
           }
        });
      });

      video.addEventListener('timeupdate', () => {
        if(video.duration > 0 && onTimeUpdate) {
            onTimeUpdate(video.currentTime, video.duration);
        }
      });
    };

    initPixi();

    const handleKeyDown = (e: KeyboardEvent) => {
       if (editingInfoRef.current) return;
       if ((e.key === 'Backspace' || e.key === 'Delete') && selectedTextRef.current) {
           const idx = textsRef.current.indexOf(selectedTextRef.current);
           if (idx !== -1) textsRef.current.splice(idx, 1);
           selectedTextRef.current.destroy();
           selectedTextRef.current = null;
           if (onSelectText) onSelectText(null);
       }
    };

    if (containerRef.current) {
       containerRef.current.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (containerRef.current) {
         containerRef.current.removeEventListener('keydown', handleKeyDown);
      }
      if (video) {
        video.pause();
        video.src = '';
        video.load();
        videoRef.current = null;
      }
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      textsRef.current = [];
      selectedTextRef.current = null;
      if (dragPreviewRef.current) dragPreviewRef.current = null;
    };
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        onPlayStateChange?.(true);
      } else {
        videoRef.current.pause();
        onPlayStateChange?.(false);
      }
    }
  };

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
              if (handleDragging && appRef.current?.canvas) {
                  const canvas = appRef.current.canvas;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = appRef.current.screen.width / rect.width;
                  const scaleY = appRef.current.screen.height / rect.height;
                  const pt = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };

                  const dist = Math.hypot(pt.x - wrapper.x, pt.y - wrapper.y);
                  const ratio = dist / initialDist;
                  wrapper.scale.set(Math.max(0.1, initialScale * ratio));
                  updateBorder(wrapper);
              }
          };

          const onHandleUp = () => {
              if (handleDragging) {
                  handleDragging = false;
                  window.removeEventListener('pointermove', onHandleMove);
                  window.removeEventListener('pointerup', onHandleUp);
                  if (onSelectText) {
                      const textNode = wrapper.children.find((c) => c.label === 'text') as PIXI.Text;
                      if (textNode) {
                          onSelectText({
                              id: wrapper.label,
                              text: textNode.text,
                              fontSize: Math.round((Number(textNode.style.fontSize) || 32) * wrapper.scale.x),
                              fill: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill),
                              x: Math.round(wrapper.x),
                              y: Math.round(wrapper.y),
                              rotation: wrapper.rotation,
                              scale: wrapper.scale.x
                          });
                      }
                  }
              }
          };

          handle.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
              e.stopPropagation();
              handleDragging = true;
              initialScale = wrapper.scale.x;
              const pt = e.global;
              initialDist = Math.hypot(pt.x - wrapper.x, pt.y - wrapper.y);
              window.addEventListener('pointermove', onHandleMove);
              window.addEventListener('pointerup', onHandleUp);
          });
      });

      rotHandle.eventMode = 'dynamic';
      rotHandle.cursor = 'crosshair';

      let rotDragging = false;
      let initialRotation = 0;
      let initialAngle = 0;

      const onRotMove = (e: PointerEvent) => {
          if (rotDragging && appRef.current?.canvas) {
              const canvas = appRef.current.canvas;
              const rect = canvas.getBoundingClientRect();
              const scaleX = appRef.current.screen.width / rect.width;
              const scaleY = appRef.current.screen.height / rect.height;
              const pt = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };

              const currentAngle = Math.atan2(pt.y - wrapper.y, pt.x - wrapper.x);
              let newRot = initialRotation + (currentAngle - initialAngle);
              // Snap to 0, 90, 180, 270 degrees if within 5 degrees
              const snapThresh = Math.PI / 36; // 5 degrees
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
              if (onSelectText) {
                   const textNode = findTextChild(wrapper, 'text');
                   if (textNode) {
                       onSelectText({
                           id: wrapper.label,
                           text: textNode.text,
                           fontSize: Math.round((Number(textNode.style.fontSize) || 32) * wrapper.scale.x),
                           fill: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill),
                           x: Math.round(wrapper.x),
                           y: Math.round(wrapper.y),
                           rotation: wrapper.rotation,
                           scale: wrapper.scale.x
                       });
                   }
               }
          }
      };

      rotHandle.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
          e.stopPropagation();
          rotDragging = true;
          initialRotation = wrapper.rotation;
          const pt = e.global;
          initialAngle = Math.atan2(pt.y - wrapper.y, pt.x - wrapper.x);
          window.addEventListener('pointermove', onRotMove);
          window.addEventListener('pointerup', onRotUp);
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
      text.onViewUpdate();

      const padding = 16 / wrapper.scale.x;
      const tW = text.width / text.scale.x || 1;
      const tH = text.height / text.scale.y || 1;

      const w = tW + padding * 2;
      const h = tH + padding * 2;
      const vx = -tW / 2 - padding;
      const vy = -tH / 2 - padding;

      bg.rect(vx, vy, w, h);
      bg.stroke({ width: 2 / wrapper.scale.x, color: 0x3b82f6 });

      const hn = 12 / wrapper.scale.x;
      const sw = 2 / wrapper.scale.x;

      [tl, tr, bl, br].forEach((hg, i) => {
          let hx = vx, hy = vy;
          if (i === 1 || i === 3) hx = vx + w;
          if (i === 2 || i === 3) hy = vy + h;
          hg.circle(hx, hy, hn/2);
          hg.fill(0xffffff);
          hg.stroke({ width: sw, color: 0x3b82f6 });
      });

      const rotDist = 32 / wrapper.scale.x;
      rotLine.moveTo(0, vy);
      rotLine.lineTo(0, vy - rotDist);
      rotLine.stroke({ width: sw, color: 0x3b82f6 });

      rotHandle.circle(0, vy - rotDist, hn/2);
      rotHandle.fill(0xffffff);
      rotHandle.stroke({ width: sw, color: 0x3b82f6 });

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

      const textNode = findTextChild(wrapper, 'text');
      if (onSelectText && textNode) {
          onSelectText({
              id: wrapper.label,
              text: textNode.text,
              fontSize: Math.round((Number(textNode.style.fontSize) || 32) * wrapper.scale.x),
              fill: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill),
              x: Math.round(wrapper.x),
              y: Math.round(wrapper.y),
              rotation: wrapper.rotation,
              scale: wrapper.scale.x
          });
      }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!appRef.current || !containerRef.current) return;

    const canvas = appRef.current.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = appRef.current.screen.width / rect.width;
    const scaleY = appRef.current.screen.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

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
            dragPreviewRef.current.x = x;
            dragPreviewRef.current.y = y;
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
        if (plainData) {
            textContent = plainData;
        } else {
            return;
        }
    }

    if (!textContent) return;

    try {
      const app = appRef.current;
      const canvas = app.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = app.screen.width / rect.width;
      const scaleY = app.screen.height / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const style = new PIXI.TextStyle(
        toPixiTextStyleOptions(styleConfig, Math.max(app.screen.width * 0.04, 32)),
      );

      const wrapper = new PIXI.Container();
      wrapper.label = Math.random().toString(36).substring(7); // ID
      wrapper.x = x;
      wrapper.y = y;

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
        if (dragging && appRef.current && appRef.current.canvas) {
            const canvas = appRef.current.canvas;
            const rect = canvas.getBoundingClientRect();
            const scaleX = appRef.current.screen.width / rect.width;
            const scaleY = appRef.current.screen.height / rect.height;

            const ptX = (e.clientX - rect.left) * scaleX;
            const ptY = (e.clientY - rect.top) * scaleY;

            wrapper.x = ptX - dragOffset.x;
            wrapper.y = ptY - dragOffset.y;
        }
      };

      const onWindowUp = () => {
        if (dragging) {
            dragging = false;
            wrapper.cursor = 'move';
            wrapper.alpha = 1;
            window.removeEventListener('pointermove', onWindowMove);
            window.removeEventListener('pointerup', onWindowUp);
            if (onSelectText) {
                 const textNode = findTextChild(wrapper, 'text');
                 if (textNode) {
                     onSelectText({
                         id: wrapper.label,
                         text: textNode.text,
                         fontSize: Math.round((Number(textNode.style.fontSize) || 32) * wrapper.scale.x),
                         fill: Array.isArray(textNode.style.fill) ? String(textNode.style.fill[0]) : String(textNode.style.fill),
                         x: Math.round(wrapper.x),
                         y: Math.round(wrapper.y),
                         rotation: wrapper.rotation,
                         scale: wrapper.scale.x
                     });
                 }
             }
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

        window.addEventListener('pointermove', onWindowMove);
        window.addEventListener('pointerup', onWindowUp);
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
      currentEditingInfo.textNode.text = currentEditingInfo.text;
      currentEditingInfo.textNode.alpha = 1;

      updateBorder(currentEditingInfo.wrapper);
      const border = findContainerChild(currentEditingInfo.wrapper, 'border');
      if (border) border.visible = true;

      if (onSelectText) {
          onSelectText({
              id: currentEditingInfo.wrapper.label,
              text: currentEditingInfo.textNode.text,
              fontSize: Math.round((Number(currentEditingInfo.textNode.style.fontSize) || 32) * currentEditingInfo.wrapper.scale.x),
              fill: Array.isArray(currentEditingInfo.textNode.style.fill) ? String(currentEditingInfo.textNode.style.fill[0]) : String(currentEditingInfo.textNode.style.fill),
              x: Math.round(currentEditingInfo.wrapper.x),
              y: Math.round(currentEditingInfo.wrapper.y),
              rotation: currentEditingInfo.wrapper.rotation,
              scale: currentEditingInfo.wrapper.scale.x
          });
      }

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
              setEditingInfo({ ...editingInfo, text: e.target.value });
              editingInfo.textNode.text = e.target.value;
              updateBorder(editingInfo.wrapper);
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
