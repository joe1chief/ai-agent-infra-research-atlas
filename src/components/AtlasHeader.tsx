import { BookMarked, Github, Languages, Moon, Search, Sun } from "lucide-react";
import { useApp } from "../App";
import { homePath } from "../lib/catalog";

export function AtlasHeader() {
  const { locale, setLocale, theme, setTheme, copy } = useApp();

  return (
    <header className="site-header">
      <div className="header-left">
        <a className="brand" href={homePath()} data-atlas-link aria-label={`${copy("brand")} · ${copy("navExplore")}`}>
          <span className="brand-glyph" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="brand-titles">
            <span className="brand-top-row">
              <small>{copy("brandEyebrow")}</small>
              <span className="live-status-pill">
                <span className="live-status-dot" />
                <span>2025–2026</span>
              </span>
            </span>
            <strong>{copy("brand")}</strong>
          </span>
        </a>
      </div>

      <nav className="main-nav" aria-label="Primary navigation">
        <a href={`${homePath()}#catalog`} data-atlas-link>
          {copy("navExplore")}
        </a>
        <a href={`${homePath()}#stack-heading`} data-atlas-link>
          {copy("stackMap")}
        </a>
        <a href={`${homePath()}#methodology`} data-atlas-link>
          {copy("navMethod")}
        </a>
      </nav>

      <div className="header-actions">
        <a className="icon-button header-search-button desktop-only" href={`${homePath()}#catalog`} data-atlas-link>
          <Search size={15} />
          <span>{copy("search").split("、")[0]}</span>
          <kbd className="header-kbd">⌘K</kbd>
        </a>
        <a className="icon-button compact-search mobile-only" href={`${homePath()}#catalog`} data-atlas-link aria-label={copy("search")}>
          <Search size={16} />
        </a>
        <a className="icon-button desktop-only" href={`${homePath("?favorites=1")}#catalog`} data-atlas-link>
          <BookMarked size={16} />
          <span>{copy("favorites")}</span>
        </a>
        <a
          className="icon-button github-link desktop-only"
          href="https://github.com/joe1chief/ai-agent-infra-research-atlas"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub Repository"
          title="GitHub Repository"
        >
          <Github size={16} />
        </a>
        <button
          className="icon-button toggle-button"
          type="button"
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          aria-label={copy("language")}
          title={copy("language")}
        >
          <Languages size={16} />
          <span>{locale === "zh" ? "EN" : "中"}</span>
        </button>
        <button
          className="icon-button toggle-button"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={copy("theme")}
          title={copy("theme")}
        >
          {theme === "dark" ? <Sun size={16} className="sun-icon" /> : <Moon size={16} className="moon-icon" />}
        </button>
      </div>
    </header>
  );
}
