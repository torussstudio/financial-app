import { LoginForm } from "../../components/forms/login-form";

export function LoginScreen(props: Parameters<typeof LoginForm>[0]) {
  return <div className="login-page"><div className="login-story">
    <div className="brand"><div className="logo-mark">l<span>.</span></div>ledgerdesk</div>
    <div><span className="eyebrow">LESS ADMIN. MORE CLARITY.</span><h1>Your business,<br/>in balance.</h1>
      <p>One workspace for your documents, daily accounts and the decisions ahead.</p>
      <div className="login-orbit"><div>₹<small>Everything adds up.</small></div></div>
    </div><small>Company accounts · Built around your workflow</small>
  </div><div className="login-form"><LoginForm {...props}/></div></div>;
}
