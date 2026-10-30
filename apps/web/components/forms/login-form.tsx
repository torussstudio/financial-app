import { ArrowRight, ArrowUpRight } from "lucide-react";
import { ActionButton } from "../action-button";
import { Field } from "../ui";
export function LoginForm({ error, busy, demoLogin, onLogin, onDemo }: {
  error: string;
  busy: boolean;
  demoLogin: boolean;
  onLogin: (form: Record<string, FormDataEntryValue>) => void;
  onDemo: () => void;
}) {
  return <div>
    <span className="eyebrow">WELCOME BACK</span>
    <h2>Sign in to your accounts</h2>
    <p className="muted">A clearer picture starts here.</p>
    {error && <div role="alert" className="error">{error}</div>}
    <form onSubmit={e => {
    e.preventDefault();
    onLogin(Object.fromEntries(new FormData(e.currentTarget)));
  }}>
      <Field label="Email address">
        <input name="email" type="email" autoComplete="username" required placeholder="you@company.com"/>
      </Field>
      <Field label="Password">
        <input name="password"
    type="password"
    autoComplete="current-password"
    required
    placeholder="Enter your password"/>
      </Field>
      <ActionButton loading={busy} loadingText="Signing in…" className="btn primary full">
        {busy ? "Signing in…" : "Sign in"}
        <ArrowRight size={17}/>
      </ActionButton>
    </form>
    {demoLogin && <><div className="or"><span>or explore the first build</span></div>
      <ActionButton className="btn full" loading={busy} loadingText="Opening…" onClick={onDemo}>Open demo workspace <ArrowUpRight size={17}/>
      </ActionButton>
      <p className="fine">Demonstration data only. Changes stay in this development workspace.</p>
    </>}
  </div>;
}
