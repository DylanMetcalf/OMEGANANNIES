import Link from "next/link";
import { ActionForm, Submit } from "@/components/action-form";
import { registerFamilyAction } from "../actions";

export const metadata = { title: "Create a family account" };
export default function Register() {
  return (
    <>
      <p className="eyebrow">For families</p>
      <h1 className="mt-2 text-[28px]">Create your family account</h1>
      <p className="mt-2 text-muted">Request bookings, meet nannies, pay securely and message our team — all in one place.</p>
      <ActionForm action={registerFamilyAction} className="mt-8 space-y-4">
        <div><label className="label" htmlFor="name">Your full name</label><input id="name" name="name" autoComplete="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" aria-describedby="pw-hint" /><p id="pw-hint" className="mt-1 text-[12px] text-muted">At least 10 characters.</p></div>
        <div><label className="label" htmlFor="household">Household name</label><input id="household" name="household" placeholder="e.g. The Whitfield family" required className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="audience">You are</label><select id="audience" name="audience" className="input"><option value="visiting">Visiting Cape Town</option><option value="resident">South African resident</option></select></div>
          <div><label className="label" htmlFor="country">Country of residence</label><input id="country" name="country" autoComplete="country-name" className="input" /></div>
        </div>
        <label className="flex gap-2.5 text-[13px]"><input type="checkbox" name="privacy" required className="mt-0.5 h-4 w-4 accent-navy" /><span>I agree to Omega Nannies processing my and my children&rsquo;s information to provide childcare services, as described in the <a className="link" href="https://omeganannies.com/privacy">privacy notice</a> (POPIA).</span></label>
        <label className="flex gap-2.5 text-[13px] text-muted"><input type="checkbox" name="marketing" className="mt-0.5 h-4 w-4 accent-navy" /><span>Send me occasional news and offers (optional).</span></label>
        <Submit className="btn-primary w-full" pendingText="Creating account…">Create account</Submit>
      </ActionForm>
      <p className="mt-6 text-[14px] text-muted">Already registered? <Link className="link" href="/login">Sign in</Link></p>
    </>
  );
}
