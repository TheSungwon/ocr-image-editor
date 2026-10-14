
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type ImageFormat = "png" | "jpeg" | "webp";

const INITIAL_CORNERS: Point[] = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 네 모서리를 기준으로 원근 변환을 수행한다.
 * points 순서: 좌상단, 우상단, 우하단, 좌하단
 * maxDimension은 미리보기 계산량을 줄이기 위한 옵션이다.
 */
function warpPerspective(
  source: HTMLCanvasElement,
  points: Point[],
  maxDimension?: number
): HTMLCanvasElement {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const sourceContext = source.getContext("2d", {
    willReadFrequently: true,
  });

  if (!sourceContext || points.length !== 4) {
    throw new Error("원근 크롭을 처리할 수 없습니다.");
  }

  const p = points.map((point) => ({
    x: point.x * (sourceWidth - 1),
    y: point.y * (sourceHeight - 1),
  }));

  const [p0, p1, p2, p3] = p;

  const topWidth = distance(p0, p1);
  const bottomWidth = distance(p3, p2);
  const leftHeight = distance(p0, p3);
  const rightHeight = distance(p1, p2);

  let outputWidth = Math.max(
    2,
    Math.round(Math.max(topWidth, bottomWidth))
  );
  let outputHeight = Math.max(
    2,
    Math.round(Math.max(leftHeight, rightHeight))
  );

  if (maxDimension) {
    const scale = Math.min(
      1,
      maxDimension / Math.max(outputWidth, outputHeight)
    );

    outputWidth = Math.max(2, Math.round(outputWidth * scale));
    outputHeight = Math.max(2, Math.round(outputHeight * scale));
  }

  // 단위 정사각형의 좌표를 원본 이미지의 사각형에 대응시킨다.
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;

  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  const denominator = dx1 * dy2 - dx2 * dy1;

  let g = 0;
  let h = 0;

  if (Math.abs(denominator) > 1e-8) {
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;

  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  const sourcePixels = sourceContext.getImageData(
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  const output = document.createElement("canvas");
  output.width = outputWidth;
  output.height = outputHeight;

  const outputContext = output.getContext("2d", {
    willReadFrequently: true,
  });

  if (!outputContext) {
    throw new Error("미리보기 캔버스를 생성할 수 없습니다.");
  }

  const outputPixels = outputContext.createImageData(
    outputWidth,
    outputHeight
  );

  const src = sourcePixels.data;
  const dst = outputPixels.data;

  for (let y = 0; y < outputHeight; y++) {
    const v = y / (outputHeight - 1);

    for (let x = 0; x < outputWidth; x++) {
      const u = x / (outputWidth - 1);
      const divisor = g * u + h * v + 1;

      if (Math.abs(divisor) < 1e-8) continue;

      const sx = (a * u + b * v + c) / divisor;
      const sy = (d * u + e * v + f) / divisor;

      if (
        sx < 0 ||
        sy < 0 ||
        sx >= sourceWidth ||
        sy >= sourceHeight
      ) {
        continue;
      }

      const sourceX = clamp(Math.round(sx), 0, sourceWidth - 1);
      const sourceY = clamp(Math.round(sy), 0, sourceHeight - 1);

      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const outputIndex = (y * outputWidth + x) * 4;

      dst[outputIndex] = src[sourceIndex];
      dst[outputIndex + 1] = src[sourceIndex + 1];
      dst[outputIndex + 2] = src[sourceIndex + 2];
      dst[outputIndex + 3] = src[sourceIndex + 3];
    }
  }

  outputContext.putImageData(outputPixels, 0, 0);
  return output;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<number | null>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [rotation, setRotation] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [threshold, setThreshold] = useState(150);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [cropMode, setCropMode] = useState(false);
  const [corners, setCorners] = useState<Point[]>(INITIAL_CORNERS);
  const [showGrid, setShowGrid] = useState(true);
  const [compare, setCompare] = useState(false);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(0.92);
  const [error, setError] = useState("");

  const loadFile = useCallback((file?: File) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일을 선택하세요.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const nextImage = new Image();

    nextImage.onload = () => {
      setImage(nextImage);
      setFileName(file.name);
      setRotation(0);
      setGrayscale(false);
      setThresholdEnabled(false);
      setThreshold(150);
      setBrightness(100);
      setContrast(100);
      setCropMode(false);
      setCorners(INITIAL_CORNERS);
      setCompare(false);
      setError("");
      URL.revokeObjectURL(objectUrl);
    };

    nextImage.onerror = () => {
      setError("이미지를 불러오지 못했습니다.");
      URL.revokeObjectURL(objectUrl);
    };

    nextImage.src = objectUrl;
  }, []);

  // 회전 및 이미지 보정 결과를 편집용 캔버스에 렌더링한다.
  useEffect(() => {
    if (!image) return;

    const radians = (rotation * Math.PI) / 180;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;

    const rotatedWidth = Math.max(
      1,
      Math.ceil(
        Math.abs(sourceWidth * Math.cos(radians)) +
        Math.abs(sourceHeight * Math.sin(radians))
      )
    );

    const rotatedHeight = Math.max(
      1,
      Math.ceil(
        Math.abs(sourceWidth * Math.sin(radians)) +
        Math.abs(sourceHeight * Math.cos(radians))
      )
    );

    const base = document.createElement("canvas");
    base.width = rotatedWidth;
    base.height = rotatedHeight;

    const baseContext = base.getContext("2d", {
      willReadFrequently: true,
    });

    if (!baseContext) return;

    baseContext.translate(rotatedWidth / 2, rotatedHeight / 2);
    baseContext.rotate(radians);
    baseContext.filter = [
      `grayscale(${grayscale ? 1 : 0})`,
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
    ].join(" ");

    baseContext.drawImage(
      image,
      -sourceWidth / 2,
      -sourceHeight / 2,
      sourceWidth,
      sourceHeight
    );

    baseContext.filter = "none";

    if (thresholdEnabled) {
      const pixels = baseContext.getImageData(
        0,
        0,
        rotatedWidth,
        rotatedHeight
      );

      const data = pixels.data;

      for (let i = 0; i < data.length; i += 4) {
        const luminance =
          0.299 * data[i] +
          0.587 * data[i + 1] +
          0.114 * data[i + 2];

        const value = luminance >= threshold ? 255 : 0;

        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }

      baseContext.putImageData(pixels, 0, 0);
    }

    baseCanvasRef.current = base;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) return;

    if (compare) {
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      context.clearRect(0, 0, sourceWidth, sourceHeight);
      context.drawImage(image, 0, 0);
      return;
    }

    canvas.width = rotatedWidth;
    canvas.height = rotatedHeight;
    context.clearRect(0, 0, rotatedWidth, rotatedHeight);
    context.drawImage(base, 0, 0);

    if (cropMode) {
      // 크롭 영역의 외부를 어둡게 표시한다.
      context.save();
      context.beginPath();
      context.rect(0, 0, rotatedWidth, rotatedHeight);

      corners.forEach((point, index) => {
        const x = point.x * rotatedWidth;
        const y = point.y * rotatedHeight;

        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });

      context.closePath();
      context.fillStyle = "rgba(0, 0, 0, 0.42)";
      context.fill("evenodd");
      context.restore();

      context.save();
      context.beginPath();

      corners.forEach((point, index) => {
        const x = point.x * rotatedWidth;
        const y = point.y * rotatedHeight;

        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });

      context.closePath();
      context.strokeStyle = "#38bdf8";
      context.lineWidth = Math.max(2, rotatedWidth / 500);
      context.stroke();

      corners.forEach((point, index) => {
        const x = point.x * rotatedWidth;
        const y = point.y * rotatedHeight;
        const radius = Math.max(7, rotatedWidth / 100);

        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#0284c7";
        context.stroke();

        context.fillStyle = "#0369a1";
        context.font = `bold ${Math.max(12, radius * 1.3)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y);
      });

      context.restore();
    }

    if (showGrid) {
      context.save();
      context.strokeStyle = "rgba(56, 189, 248, 0.45)";
      context.lineWidth = Math.max(1, rotatedWidth / 1200);

      for (let i = 1; i < 3; i++) {
        const x = (rotatedWidth * i) / 3;
        const y = (rotatedHeight * i) / 3;

        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, rotatedHeight);
        context.stroke();

        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(rotatedWidth, y);
        context.stroke();
      }

      context.restore();
    }
  }, [
    image,
    rotation,
    grayscale,
    thresholdEnabled,
    threshold,
    brightness,
    contrast,
    cropMode,
    corners,
    showGrid,
    compare,
  ]);

  // 크롭 모서리가 움직일 때마다 미리보기를 갱신한다.
  useEffect(() => {
    if (!image || !cropMode || compare || !baseCanvasRef.current) return;

    const previewCanvas = previewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");

    if (!previewCanvas || !previewContext) return;

    try {
      const result = warpPerspective(
        baseCanvasRef.current,
        corners,
        1000
      );

      previewCanvas.width = result.width;
      previewCanvas.height = result.height;

      previewContext.clearRect(
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );

      previewContext.drawImage(result, 0, 0);
      setError("");
    } catch {
      setError("크롭 미리보기를 생성하지 못했습니다. 모서리 위치를 조정하세요.");
    }
  }, [image, cropMode, compare, corners, rotation, grayscale,
    thresholdEnabled, threshold, brightness, contrast]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!cropMode || compare) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };

    let nearestIndex = -1;
    let nearestDistance = Infinity;

    corners.forEach((point, index) => {
      const d = distance(point, pointer);

      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = index;
      }
    });

    if (nearestIndex !== -1 && nearestDistance < 0.09) {
      draggingRef.current = nearestIndex;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const index = draggingRef.current;

    if (index === null || !cropMode || compare) return;

    const rect = event.currentTarget.getBoundingClientRect();

    const point = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };

    setCorners((previous) =>
      previous.map((oldPoint, i) => (i === index ? point : oldPoint))
    );
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    draggingRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const downloadImage = () => {
    const source = baseCanvasRef.current;
    if (!source) return;

    try {
      // 크롭 모드라면 원본 해상도로 다시 변환한다.
      const output = cropMode
        ? warpPerspective(source, corners)
        : source;

      const mimeType =
        format === "jpeg"
          ? "image/jpeg"
          : format === "webp"
            ? "image/webp"
            : "image/png";

      output.toBlob(
        (blob) => {
          if (!blob) {
            setError("이미지 파일을 생성하지 못했습니다.");
            return;
          }

          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          const baseName =
            fileName.replace(/\.[^/.]+$/, "") || "edited-image";

          link.href = url;
          link.download = `${baseName}-edited.${format === "jpeg" ? "jpg" : format}`;
          link.click();

          URL.revokeObjectURL(url);
          setError("");
        },
        mimeType,
        format === "png" ? undefined : quality
      );
    } catch {
      setError("다운로드 파일을 생성하지 못했습니다. 크롭 영역을 확인하세요.");
    }
  };

  const resetSettings = () => {
    setRotation(0);
    setGrayscale(false);
    setThresholdEnabled(false);
    setThreshold(150);
    setBrightness(100);
    setContrast(100);
    setCropMode(false);
    setCorners(INITIAL_CORNERS);
    setShowGrid(true);
    setCompare(false);
    setError("");
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-5 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              OCR Image Editor
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              OCR 전처리를 위한 이미지 편집 도구
            </p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400"
          >
            이미지 열기
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => loadFile(event.target.files?.[0])}
      />

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          {!image ? (
            <div
              className="flex min-h-[420px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/60 p-8 text-center hover:border-sky-500"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                loadFile(event.dataTransfer.files?.[0]);
              }}
            >
              <div className="mb-4 text-4xl text-slate-500">+</div>
              <h2 className="text-lg font-semibold">이미지를 불러오세요</h2>
              <p className="mt-2 text-sm text-slate-400">
                클릭하거나 이미지 파일을 이 영역에 드롭하세요.
              </p>
              <p className="mt-4 text-xs text-slate-500">
                JPG, PNG, WebP 등 브라우저에서 지원하는 이미지
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{fileName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {image.naturalWidth} × {image.naturalHeight}px
                    {cropMode && !compare ? " · 4점 원근 크롭 모드" : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setCompare((value) => !value)}
                    className={`rounded-lg border px-3 py-2 text-xs ${compare
                        ? "border-sky-400 bg-sky-500/20 text-sky-300"
                        : "border-slate-700 bg-slate-900 text-slate-300"
                      }`}
                  >
                    {compare ? "편집 화면으로" : "원본 비교"}
                  </button>

                  <button
                    onClick={() => setShowGrid((value) => !value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300"
                  >
                    격자 {showGrid ? "끄기" : "켜기"}
                  </button>
                </div>
              </div>

              <div className="flex min-h-[300px] items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-black/40 p-3">
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="max-h-[65vh] max-w-full object-contain"
                  style={{
                    touchAction: "none",
                    cursor: cropMode && !compare ? "crosshair" : "default",
                  }}
                />
              </div>

              {cropMode && !compare && (
                <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">크롭 결과 미리보기</h2>
                      <p className="mt-1 text-xs text-slate-400">
                        위 이미지의 파란색 모서리 4개를 드래그하세요.
                      </p>
                    </div>

                    <button
                      onClick={() => setCorners(INITIAL_CORNERS)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      크롭 위치 초기화
                    </button>
                  </div>

                  <div className="flex min-h-[150px] items-center justify-center overflow-auto rounded-lg bg-black/40 p-3">
                    <canvas
                      ref={previewCanvasRef}
                      className="max-h-[55vh] max-w-full object-contain"
                    />
                  </div>
                </section>
              )}
            </>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-4 font-semibold">회전</h2>

            <div className="mb-2 flex items-center justify-between text-sm">
              <label htmlFor="rotation">회전 각도</label>
              <span className="font-mono text-sky-300">
                {rotation.toFixed(1)}°
              </span>
            </div>

            <input
              id="rotation"
              type="range"
              min="0"
              max="360"
              step="0.1"
              value={rotation}
              onChange={(event) => setRotation(Number(event.target.value))}
              disabled={!image}
              className="w-full accent-sky-500"
            />

            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>0°</span>
              <span>180°</span>
              <span>360°</span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setRotation((value) => (value - 1 + 360) % 360)}
                disabled={!image}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-40"
              >
                -1°
              </button>
              <button
                onClick={() => setRotation((value) => (value + 1) % 360)}
                disabled={!image}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-40"
              >
                +1°
              </button>
              <button
                onClick={() => setRotation(0)}
                disabled={!image}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-40"
              >
                초기화
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-4 font-semibold">이미지 보정</h2>

            <label className="mb-4 flex items-center justify-between gap-3 text-sm">
              그레이스케일
              <input
                type="checkbox"
                checked={grayscale}
                onChange={(event) => setGrayscale(event.target.checked)}
                disabled={!image}
                className="h-4 w-4 accent-sky-500"
              />
            </label>

            <label className="mb-4 flex items-center justify-between gap-3 text-sm">
              흑백 임계값 적용
              <input
                type="checkbox"
                checked={thresholdEnabled}
                onChange={(event) =>
                  setThresholdEnabled(event.target.checked)
                }
                disabled={!image}
                className="h-4 w-4 accent-sky-500"
              />
            </label>

            {thresholdEnabled && (
              <div className="mb-4">
                <div className="mb-2 flex justify-between text-sm">
                  <label htmlFor="threshold">임계값</label>
                  <span className="font-mono text-sky-300">{threshold}</span>
                </div>
                <input
                  id="threshold"
                  type="range"
                  min="0"
                  max="255"
                  value={threshold}
                  onChange={(event) =>
                    setThreshold(Number(event.target.value))
                  }
                  className="w-full accent-sky-500"
                />
              </div>
            )}

            <div className="mb-4">
              <div className="mb-2 flex justify-between text-sm">
                <label htmlFor="brightness">밝기</label>
                <span className="font-mono text-sky-300">{brightness}%</span>
              </div>
              <input
                id="brightness"
                type="range"
                min="50"
                max="150"
                value={brightness}
                onChange={(event) =>
                  setBrightness(Number(event.target.value))
                }
                disabled={!image}
                className="w-full accent-sky-500"
              />
            </div>

            <div>
              <div className="mb-2 flex justify-between text-sm">
                <label htmlFor="contrast">대비</label>
                <span className="font-mono text-sky-300">{contrast}%</span>
              </div>
              <input
                id="contrast"
                type="range"
                min="50"
                max="150"
                value={contrast}
                onChange={(event) =>
                  setContrast(Number(event.target.value))
                }
                disabled={!image}
                className="w-full accent-sky-500"
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold">4점 원근 크롭</h2>
              <input
                type="checkbox"
                checked={cropMode}
                onChange={(event) => {
                  setCropMode(event.target.checked);
                  setCompare(false);
                }}
                disabled={!image}
                className="h-4 w-4 accent-sky-500"
              />
            </div>

            <p className="text-xs leading-5 text-slate-400">
              활성화한 뒤 이미지의 네 모서리 핸들을 문서나 영역의 모서리에
              맞추세요. 아래 미리보기에서 원근 보정 결과를 확인할 수 있습니다.
            </p>

            {cropMode && (
              <button
                onClick={() => setCorners(INITIAL_CORNERS)}
                disabled={!image}
                className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                크롭 영역 초기화
              </button>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-4 font-semibold">내보내기</h2>

            <label className="mb-2 block text-sm" htmlFor="format">
              파일 형식
            </label>
            <select
              id="format"
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as ImageFormat)
              }
              className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>

            {format !== "png" && (
              <div className="mb-4">
                <div className="mb-2 flex justify-between text-sm">
                  <label htmlFor="quality">압축 품질</label>
                  <span className="font-mono text-sky-300">
                    {Math.round(quality * 100)}%
                  </span>
                </div>
                <input
                  id="quality"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={quality}
                  onChange={(event) =>
                    setQuality(Number(event.target.value))
                  }
                  className="w-full accent-sky-500"
                />
              </div>
            )}

            <button
              onClick={downloadImage}
              disabled={!image}
              className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              편집 이미지 다운로드
            </button>

            <button
              onClick={resetSettings}
              disabled={!image}
              className="mt-2 w-full rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              편집 설정 초기화
            </button>

            <p className="mt-3 text-xs leading-5 text-slate-500">
              크롭 모드에서는 원근 보정 결과를 내보냅니다. 미리보기는 처리
              속도를 위해 최대 1000px로 축소되며, 다운로드는 원본 해상도 기준으로
              처리됩니다.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
