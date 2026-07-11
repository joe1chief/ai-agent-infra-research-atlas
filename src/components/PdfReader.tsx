import { ChevronLeft, ChevronRight, ExternalLink, FileWarning, LoaderCircle, Maximize2, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../App";

export function PdfReader({ url }: { url?: string }) {
  const { copy, locale } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setStatus("loading");
    setPage(1);
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const proxy = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (!cancelled) {
          setDocumentProxy(proxy);
          setStatus("ready");
        } else {
          await proxy.destroy();
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!documentProxy || !canvasRef.current || status !== "ready") return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    void documentProxy.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
      void renderTask.promise.catch((error: unknown) => {
        if (error instanceof Error && error.name === "RenderingCancelledException") return;
        setStatus("fallback");
      });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [documentProxy, page, scale, status]);

  useEffect(() => () => void documentProxy?.destroy(), [documentProxy]);

  if (!url) {
    return <div className="pdf-unavailable"><FileWarning size={28} /><p>{copy("pdfUnavailable")}</p></div>;
  }

  if (status === "fallback") {
    return (
      <div className="native-pdf-fallback">
        <iframe src={url} title={copy("pdfReader")} loading="lazy" />
        <a href={url} target="_blank" rel="noreferrer">{copy("openPdf")}<ExternalLink size={15} /></a>
      </div>
    );
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <div>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label={copy("previousPage")}><ChevronLeft size={17} /></button>
          <span>{copy("page")} <strong>{page}</strong> {copy("of")} {documentProxy?.numPages || "—"}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(documentProxy?.numPages || value, value + 1))} disabled={!documentProxy || page >= documentProxy.numPages} aria-label={copy("nextPage")}><ChevronRight size={17} /></button>
        </div>
        <div>
          <button type="button" onClick={() => setScale((value) => Math.max(0.65, value - 0.15))} aria-label={copy("zoomOut")}><Minus size={16} /></button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((value) => Math.min(2.25, value + 0.15))} aria-label={copy("zoomIn")}><Plus size={16} /></button>
          <a href={url} target="_blank" rel="noreferrer" aria-label={copy("openPdf")}><Maximize2 size={16} /></a>
        </div>
      </div>
      <div className="pdf-canvas-shell">
        {status === "loading" && <div className="pdf-loading"><LoaderCircle size={24} /><span>{locale === "zh" ? "正在加载 PDF…" : "Loading PDF…"}</span></div>}
        <canvas ref={canvasRef} aria-label={`${copy("pdfReader")} · ${copy("page")} ${page}`} />
      </div>
    </div>
  );
}
