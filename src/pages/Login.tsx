import { useState } from "react";
import { supabase } from "../lib/supabase.ts";

export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Come back to the page that asked for sign-in (e.g. a confirmation link from the Shortcut).
    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="app">
      <div className="page-head" style={{ marginTop: 64 }}>
        <h1>Reading</h1>
        <p>Sign in with the email on your Supabase account.</p>
      </div>
      {sent ? (
        <p className="card">Check your email for a sign-in link. Open it on this device.</p>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <label>
            Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={busy}>Send sign-in link</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}
