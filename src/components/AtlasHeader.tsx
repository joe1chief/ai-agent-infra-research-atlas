import { BookMarked, Languages, Moon, Search, Sun } from "lucide-react";
import { useApp } from "../App";
import { homePath } from "../lib/catalog";

export function AtlasHeader() {
  const { locale, setLocale, theme, setTheme, copy } = useApp();

  return (
    <header className="site-header">
      <a className="brand" href={homePath()} data-atlas-link aria-label={`${copy("brand")} · ${copy("navExplore")}`}>
        <span className="brand-glyph" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          <small>{copy("brandEyebrow")}</small>
          <strong>{copy("brand")}</strong>
        </span>
      </a>
      <nav className="main-nav" aria-label="Primary navigation">
        <a href={`${homePath()}#catalog`} data-atlas-link>
          {copy("navExplore")}
        </a>
        <a href={`${homePath()}#methodology`} data-atlas-link>
          {copy("navMethod")}
        </a>
      </nav>
      <div className="header-actions">
        <a className="icon-button desktop-only" href={`${homePath("?favorites=1")}#catalog`} data-atlas-link>
          <BookMarked size={17} />
          <span>{copy("favorites")}</span>
        </a>
        <a className="icon-button compact-search" href={`${homePath()}#catalog`} data-atlas-link aria-label={copy("search")}>
          <Search size={18} />
        </a>
        <button
          className="icon-button"
          type="button"
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          aria-label={copy("language")}
          title={copy("language")}
        >
          <Languages size={18} />
          <span className="desktop-only">{locale === "zh" ? "EN" : "中"}</span>
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={copy("theme")}
          title={copy("theme")}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
