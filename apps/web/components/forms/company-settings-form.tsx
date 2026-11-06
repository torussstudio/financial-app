import { useState } from "react";
import { ActionButton } from "../../components/action-button";
import { Field } from "../../components/ui";
export function CompanySettingsForm({ company, role, busy, onSave }: {
  company: any;
  role: string;
  busy: boolean;
  onSave: (values: Record<string, any>) => Promise<unknown>
}) {
  const [gstLogo, setGstLogo] = useState(company.gst_logo || "");
  const [nonGstLogo, setNonGstLogo] = useState(company.non_gst_logo || "");
  const [logoError, setLogoError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [logoLoading, setLogoLoading] = useState(false);
  const loadLogo = (file: File | undefined, setLogo: (value: string) => void) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLogoError("Choose a PNG, JPG, or WebP logo.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoError("Each logo must be 1 MB or smaller.");
      return;
    }
    setLogoError("");
    const reader = new FileReader();
    setLogoLoading(true);
    reader.onload = () => { setLogoError(""); setLogo(String(reader.result || "")); setLogoLoading(false); };
    reader.onerror = () => { setLogoError("Could not read that image. Please choose another file."); setLogoLoading(false); };
    reader.readAsDataURL(file);
  };
  return <form className="form-grid settings-form company-profile-form"
    onSubmit={async e => { e.preventDefault(); setSaveError(""); try {
    const values: Record<string, any> = Object.fromEntries(new FormData(e.currentTarget));
    values.gstLogo = gstLogo;
    values.nonGstLogo = nonGstLogo;
    // An unticked checkbox submits nothing, so send the setting explicitly.
    values.einvoiceEnabled = values.einvoiceEnabled === "on";
    if (!values.b2clThreshold) delete values.b2clThreshold;
    await onSave(values);
  }
  catch (error: any) { setSaveError(error?.message || "Company details could not be saved."); } }}>
    <h3 className="profile-section-title">GST document details <small>Used for GST invoices and other GST documents.</small></h3>
    <Field label="Company name" wide><input name="name" defaultValue={company.name} required/></Field>
    <Field label="Address line 1" wide>
      <input name="address" defaultValue={company.address || ""}/>
    </Field>
    <Field label="Address line 2 (optional)" wide>
      <input name="addressLine2" defaultValue={company.address_line2 || ""}/>
    </Field>
    <Field label="City"><input name="city" defaultValue={company.city || ""}/></Field>
    <Field label="State"><input name="stateName" defaultValue={company.state_name || ""}/></Field>
    <Field label="State code">
      <input name="stateCode" defaultValue={company.state_code} required pattern="[0-9]{2}"/>
    </Field>
    <Field label="PIN code">
      <input name="pinCode" defaultValue={company.pin_code || ""} inputMode="numeric"/>
    </Field>
    <Field label="GSTIN">
      <input name="gstin" defaultValue={company.gstin || ""} placeholder="Enter verified GSTIN"/>
    </Field>
    <Field label="Contact number">
      <input name="contactNumber"
    type="tel"
    defaultValue={company.contact_number || company.contact || company.phone || ""}/>
    </Field>
    <h3 className="profile-section-title">GST & compliance <small>TDS, exports, GSTR-1 and e-invoicing. Nothing here connects to a government portal.</small></h3>
    <Field label="TAN (optional)">
      <input name="tan" defaultValue={company.tan || ""} maxLength={10} pattern="[A-Za-z]{4}[0-9]{5}[A-Za-z]" title="4 letters, 5 digits, 1 letter (e.g. TVDA12345B)" autoCapitalize="characters" placeholder="e.g. TVDA12345B"/>
    </Field>
    <Field label="LUT / ARN number (exports without IGST)">
      <input name="lutNumber" defaultValue={company.lut_number || ""} maxLength={40} autoCapitalize="characters"/>
    </Field>
    <Field label="LUT valid from"><input name="lutValidFrom" type="date" defaultValue={company.lut_valid_from || ""}/></Field>
    <Field label="LUT valid to"><input name="lutValidTo" type="date" defaultValue={company.lut_valid_to || ""}/></Field>
    <Field label="B2CL threshold (₹)">
      <input name="b2clThreshold" type="number" min="1" step=".01" defaultValue={company.b2cl_threshold ? String(Number(company.b2cl_threshold)) : "250000"}/>
    </Field>
    <label className="check-field"><input type="checkbox" name="einvoiceEnabled" defaultChecked={Boolean(company.einvoice_enabled)}/> E-invoicing applicable (prepare IRP JSON for B2B invoices and record the IRN)</label>
    <div className="form-note wide">Inter-state B2C invoices above the B2CL threshold are reported invoice-wise in GSTR-1. The limit was reduced to ₹1,00,000 for invoices from 1 August 2024 (Notification 12/2024-CT) — confirm with your accountant and update it here. Live export invoices under LUT need the LUT number and are checked against its validity dates.</div>
    <h3 className="profile-section-title">GST bank details <small>Shown on GST documents when configured.</small>
    </h3>
    <Field label="Account holder name">
      <input name="accountHolderName" defaultValue={company.account_holder_name || ""}/>
    </Field>
    <Field label="Bank name"><input name="bankName" defaultValue={company.bank_name || ""}/></Field>
    <Field label="Account number">
      <input name="accountNumber" autoComplete="off" defaultValue={company.account_number || ""}/>
    </Field>
    <Field label="IFSC code">
      <input name="ifscCode" autoCapitalize="characters" defaultValue={company.ifsc_code || ""}/>
    </Field>
    <Field label="Branch name (optional)">
      <input name="branchName" defaultValue={company.branch_name || ""}/>
    </Field>
    <Field label="Legacy bank details" wide>
      <textarea name="bankDetails"
    defaultValue={company.bank_details || ""}
    placeholder="Existing free-text details for older documents"/>
    </Field>
    <h3 className="profile-section-title">Non-GST document details <small>Saved separately and filled into a document when Outside GST is selected.</small></h3>
    <Field label="Company name"><input name="nonGstName" defaultValue={company.non_gst_name || ""}/></Field>
    <Field label="Contact number"><input name="nonGstContactNumber" type="tel" defaultValue={company.non_gst_contact_number || ""}/></Field>
    <Field label="Address line 1" wide><input name="nonGstAddress" defaultValue={company.non_gst_address || ""}/></Field>
    <Field label="Address line 2" wide><input name="nonGstAddressLine2" defaultValue={company.non_gst_address_line2 || ""}/></Field>
    <Field label="City"><input name="nonGstCity" defaultValue={company.non_gst_city || ""}/></Field>
    <Field label="State"><input name="nonGstStateName" defaultValue={company.non_gst_state_name || ""}/></Field>
    <Field label="State code"><input name="nonGstStateCode" defaultValue={company.non_gst_state_code || ""} pattern="[0-9]{2}"/></Field>
    <Field label="PIN code"><input name="nonGstPinCode" defaultValue={company.non_gst_pin_code || ""} inputMode="numeric"/></Field>
    <Field label="Account holder name"><input name="nonGstAccountHolderName" defaultValue={company.non_gst_account_holder_name || ""}/></Field>
    <Field label="Bank name"><input name="nonGstBankName" defaultValue={company.non_gst_bank_name || ""}/></Field>
    <Field label="Account number"><input name="nonGstAccountNumber" autoComplete="off" defaultValue={company.non_gst_account_number || ""}/></Field>
    <Field label="IFSC code"><input name="nonGstIfscCode" autoCapitalize="characters" defaultValue={company.non_gst_ifsc_code || ""}/></Field>
    <Field label="Branch name"><input name="nonGstBranchName" defaultValue={company.non_gst_branch_name || ""}/></Field>
    <Field label="Additional bank details" wide><textarea name="nonGstBankDetails" defaultValue={company.non_gst_bank_details || ""}/></Field>
    <Field label="Document terms" wide><textarea name="terms" defaultValue={company.terms}/></Field>
    <h3 className="profile-section-title">Document logos <small>GST and non-GST documents can use separate logos. PNG, JPG, or WebP, up to 1 MB each.</small></h3>
    <Field label="GST document logo">
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => loadLogo(e.target.files?.[0], setGstLogo)}/>
      {gstLogo && <div className="company-logo-preview"><img src={gstLogo} alt="GST document logo preview"/><button className="link" type="button" onClick={() => { setGstLogo(""); setLogoError(""); }}>Remove logo</button></div>}
    </Field>
    <Field label="Non-GST document logo">
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => loadLogo(e.target.files?.[0], setNonGstLogo)}/>
      {nonGstLogo && <div className="company-logo-preview"><img src={nonGstLogo} alt="Non-GST document logo preview"/><button className="link" type="button" onClick={() => { setNonGstLogo(""); setLogoError(""); }}>Remove logo</button></div>}
    </Field>
    {logoError && <p className="error wide" role="alert">{logoError}</p>}
    {saveError && <p className="error wide" role="alert">{saveError}</p>}
    {logoLoading && <p className="fine wide">Loading logo…</p>}
    {role === "ADMIN" && <ActionButton className="btn primary" disabled={logoLoading || Boolean(logoError)} loading={busy} loadingText="Saving…">
      Save company details
    </ActionButton>}
  </form>;
}
