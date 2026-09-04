import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AtlasHeader } from "./components/AtlasHeader";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { t, type CopyKey } from "./lib/i18n";
import { homePath, routePath } from "./lib/catalog";
import type { Locale, Theme } from "./types";

const HomePage = lazy(() => import("./pages/HomePage"));
const PaperPage = lazy(() => import("./pages/PaperPage"));

interface AppContextValue {
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  copy: (key: CopyKey) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within App");
  return context;
}

function LoadingScreen() {
  const { copy } = useApp();
  return (
    <main className="loading-screen" id="main-content">
      <div className="atlas-loader" aria-hidden="true">
        {Array.from({ length: 13 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <p>{copy("loading")}</p>
    </main>
  );
}

export default function App() {
  const browserLocale: Locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const browserTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const [locale, setLocale] = useLocalStorage<Locale>("infra-atlas:locale", browserLocale);
  const [theme, setTheme] = useLocalStorage<Theme>("infra-atlas:theme", browserTheme);
  const [path, setPath] = useState(routePath);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute("content", theme === "dark" ? "#090a0f" : "#f8fafc");
  }, [locale, theme]);

  useEffect(() => {
    const onPopState = () => setPath(routePath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((href: string) => {
    window.history.pushState({}, "", href);
    setPath(routePath());
    const hash = new URL(href, window.location.origin).hash;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (hash) {
      window.setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-atlas-link]");
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (anchor.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(anchor.href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  const value = useMemo<AppContextValue>(
    () => ({ locale, theme, setLocale, setTheme, copy: (key) => t(locale, key) }),
    [locale, setLocale, setTheme, theme],
  );
  const paperMatch = path.match(/^\/paper\/([^/]+)\/?$/);

  return (
    <AppContext.Provider value={value}>
      <a className="skip-link" href="#main-content">
        {t(locale, "skip")}
      </a>
      <div className="site-shell">
        <AtlasHeader />
        <Suspense fallback={<LoadingScreen />}>
          {paperMatch ? <PaperPage slug={decodeURIComponent(paperMatch[1])} /> : <HomePage />}
        </Suspense>
        <footer className="site-footer">
          <div className="section-shell footer-inner">
            <div className="footer-brand-col">
              <div className="footer-mark" aria-hidden="true">
                <span className="mark-ai">AI</span>
                <i className="mark-divider" />
                <span className="mark-ag">AG</span>
              </div>
              <p className="footer-tagline">
                {locale === "zh"
                  ? "AI Infra 与 Agent Infra 双语证据优先研究图谱。"
                  : "Bilingual, evidence-first research atlas for AI & Agent Infrastructure."}
              </p>
              <p className="footer-license">MIT / CC BY 4.0 · 2025–2026</p>
            </div>

            <div className="footer-links-col">
              <a href={`${homePath()}#catalog`} data-atlas-link>
                {t(locale, "navExplore")}
              </a>
              <a href={`${homePath()}#stack-heading`} data-atlas-link>
                {t(locale, "stackMap")}
              </a>
              <a href={`${homePath()}#methodology`} data-atlas-link>
                {t(locale, "navMethod")}
              </a>
              <a href="https://github.com/joe1chief/ai-agent-infra-research-atlas" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </div>

            <div className="footer-action-col">
              <button
                type="button"
                className="back-to-top-btn"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                aria-label={locale === "zh" ? "回到顶部" : "Back to top"}
              >
                <span>{locale === "zh" ? "返回顶部" : "Back to Top"}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m18 15-6-6-6 6"/>
                </svg>
              </button>
              <p className="footer-motto">
                {locale === "zh" ? "证据优先 · 人工策展 · 持续更新" : "Evidence first · Human curated · Continuously updated"}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </AppContext.Provider>
  );
}
