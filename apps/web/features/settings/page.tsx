import { Users, ShieldCheck, LockKeyhole, } from "lucide-react";
import { CompanySettingsForm } from "../../components/forms/company-settings-form";
import { ActionButton } from "../../components/action-button";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function SettingsPage({ ctx }: Props) {
  const { page, data, day, pretty, busy, fail, notify, open, perform, users, setUsers, api, session, Badge, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "settings" && <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div><h2>Company profile</h2><p>One company, one set of accounts</p></div>
          <Badge tone="blue">GST registered</Badge>
        </div>
        <CompanySettingsForm company={data.company}
    role={session.user.role}
    busy={busy}
    onSave={values => perform("company", values, "PATCH", {
      title: "Company details saved",
      description: "New documents will use the updated details. Issued documents keep the copy they were issued with."
    }, "Couldn't save company details", true)}/>
      </section>
      <div>
        <section className="panel control-card">
          <LockKeyhole size={22}/>
          <h2>Accounting period lock</h2>
          <p>
            {data.company.closed_through ? "Entries are locked through " + day(data.company.closed_through) : "No accounting periods are currently locked."}
          </p>
          {session.user.role === "ADMIN" && <button className="btn" onClick={() => open("close")}>Manage lock</button>}
        </section>
        <section className="panel control-card">
          <Users size={22}/>
          <h2>Team access</h2>
          <p>Admin, accountant and viewer permissions are checked by the API.</p>
          {session.user.role === "ADMIN" && <><button className="btn" onClick={() => open("user")}>Add user</button><ActionButton className="link" onClick={() => api("users").then(setUsers).catch(fail("Couldn't load team members"))}>View users</ActionButton>{users.map((u: Row) => <div className="user-row" key={u.id}>
              <strong>{u.name}</strong>
              <small>{u.email} · {pretty(u.role)}</small>
            </div>)}</>}
        </section>
        <section className="panel control-card">
          <ShieldCheck size={22}/>
          <h2>Development build</h2>
          <p>
            {data.company.demo ? "This database contains sample accounts. Printed documents are watermarked." : "Live invoice issuance stays gated until company tax rules and required integrations are validated."}
          </p>
          <small>INR · Asia/Kolkata · Accrual accounting</small>
        </section>
      </div>
    </div>}</>;
}
