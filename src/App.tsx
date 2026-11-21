import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { isLocalMode, supabase } from "./lib/supabase.ts";
import { Confirm } from "./pages/Confirm.tsx";
import { Import } from "./pages/Import.tsx";
import { Login } from "./pages/Login.tsx";
import { Shelves } from "./pages/Shelves.tsx";
import { Stats } from "./pages/Stats.tsx";
import { Waiting } from "./pages/Waiting.tsx";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(isLocalMode ? null : undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // checking the stored session
  if (!isLocalMode && !session) return <Login />;

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">Reading</NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Shelves</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/import">Import</NavLink>
        </nav>
      </header>
      {isLocalMode && (
        <p className="banner">
          Local mode: books are saved in this browser only. Add Supabase keys to <code>.env.local</code> to sync and use the iPhone Shortcut.
        </p>
      )}
      <main>
        <Routes>
          <Route path="/" element={<Shelves />} />
          <Route path="/confirm/:id" element={<Confirm />} />
          <Route path="/waiting" element={<Waiting />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/import" element={<Import />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
