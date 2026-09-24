#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/components src/theme
cat > src/App.tsx <<'TSX'
import { ThemeProvider } from "./theme/ThemeProvider";
import { Shell } from "./components/Shell";

export function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
TSX
cat > src/theme/ThemeProvider.tsx <<'TSX'
import { createContext, useState } from "react";
export const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  return <ThemeContext.Provider value={{ dark, toggle: () => setDark(!dark) }}>{children}</ThemeContext.Provider>;
}
TSX
cat > src/components/Shell.tsx <<'TSX'
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { Feed } from "./Feed";
export function Shell() {
  return (
    <>
      <TopBar />
      <Sidebar />
      <Feed />
    </>
  );
}
TSX
cat > src/components/TopBar.tsx <<'TSX'
import { useContext } from "react";
import { ThemeContext } from "../theme/ThemeProvider";
import { SearchBox } from "./SearchBox";
import { DarkModeSwitch } from "./DarkModeSwitch";
export function TopBar() {
  const { dark } = useContext(ThemeContext);
  return <header className={dark ? "dark" : ""}><SearchBox /><DarkModeSwitch /></header>;
}
TSX
cat > src/components/DarkModeSwitch.tsx <<'TSX'
import { useContext } from "react";
import { ThemeContext } from "../theme/ThemeProvider";
export function DarkModeSwitch() {
  const { dark, toggle } = useContext(ThemeContext);
  return <input type="checkbox" checked={dark} onChange={toggle} />;
}
TSX
cat > src/components/Sidebar.tsx <<'TSX'
import { useContext } from "react";
import { ThemeContext } from "../theme/ThemeProvider";
import { NavLinks } from "./NavLinks";
export function Sidebar() {
  const { dark } = useContext(ThemeContext);
  return <aside className={dark ? "dark" : ""}><NavLinks /></aside>;
}
TSX
cat > src/components/Feed.tsx <<'TSX'
import { PostCard } from "./PostCard";
import { CommentThread } from "./CommentThread";
export function Feed() {
  return <main><PostCard /><CommentThread /></main>;
}
TSX
for c in SearchBox NavLinks PostCard CommentThread; do
  printf 'export function %s() {\n  return <div />;\n}\n' "$c" > "src/components/$c.tsx"
done
