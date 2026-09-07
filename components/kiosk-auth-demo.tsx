"use client";

import { FormEvent, useState } from "react";
import { KioskAuthState, MockCardScenario, mockCustomer } from "@/lib/kiosk/auth-state";

function ContactlessIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8.6 8.6a4.8 4.8 0 0 1 0 6.8" />
      <path d="M5.7 5.7a8.9 8.9 0 0 1 0 12.6" />
      <path d="M11.5 11.5a.7.7 0 1 1 1 1" />
      <path d="M15.4 8.6a4.8 4.8 0 0 0 0 6.8" />
      <path d="M18.3 5.7a8.9 8.9 0 0 0 0 12.6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function KioskAuthDemo() {
  const [state, setState] = useState<KioskAuthState>("idle");
  const [scenario, setScenario] = useState<MockCardScenario>("unregistered");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setState("idle");
    setEmail("");
    setPassword("");
    setMessage(null);
  }

  function simulateTap() {
    setState("reading");
    setMessage(null);

    window.setTimeout(() => {
      if (scenario === "registered") {
        setState("welcome");
        return;
      }
      if (scenario === "revoked") {
        setMessage("This card is no longer active. Please ask a member of staff for help.");
        setState("error");
        return;
      }
      setState("unregistered");
    }, 650);
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setState("linking");

    window.setTimeout(() => {
      setState("confirm-link");
    }, 650);
  }

  function confirmLink() {
    setPassword("");
    setState("welcome");
  }

  const waiting = state === "idle" || state === "reading";

  return (
    <div className="kiosk-stage">
      <header className="kiosk-brand">
        <div className="brand-mark" aria-hidden="true">CSS</div>
        <div>
          <p className="brand-name">Chelmsford Safety Supplies</p>
          <p className="brand-context">Trade counter kiosk</p>
        </div>
      </header>

      <main className="kiosk-main">
        {waiting ? (
          <section className="auth-panel auth-panel-centred" aria-live="polite">
            <p className="eyebrow">Customer sign in</p>
            <h1>{state === "reading" ? "Reading your card…" : "Tap your card to sign in"}</h1>
            <p className="lead">Use your CSS customer card for fast access to your account and trade pricing.</p>

            <button className="nfc-target" type="button" onClick={simulateTap} disabled={state === "reading"}>
              <span className="nfc-icon"><ContactlessIcon /></span>
              <span className="nfc-label">{state === "reading" ? "Hold card in place" : "Tap card here"}</span>
            </button>

            <p className="privacy-note">The kiosk automatically signs out after inactivity.</p>
          </section>
        ) : null}

        {state === "unregistered" || state === "linking" ? (
          <section className="auth-panel">
            <button className="text-button" type="button" onClick={reset}>← Back</button>
            <p className="eyebrow">Card not registered</p>
            <h1>Sign in once to link your card</h1>
            <p className="lead">Enter the email address and password you already use for your CSS account.</p>

            <form className="link-form" onSubmit={submitLink}>
              <label>
                <span>Email address</span>
                <span className="input-shell">
                  <span className="field-icon"><UserIcon /></span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="off"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={state === "linking"}
                    required
                  />
                </span>
              </label>

              <label>
                <span>Password</span>
                <span className="input-shell">
                  <span className="field-icon"><LockIcon /></span>
                  <input
                    type="password"
                    name="password"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={state === "linking"}
                    required
                  />
                </span>
              </label>

              <button className="primary-button" type="submit" disabled={state === "linking"}>
                {state === "linking" ? "Checking account…" : "Sign in & link card"}
              </button>
            </form>

            <p className="security-note">Your password is used only to verify your Magento customer account. It must never be stored on the kiosk or attached to the NFC card.</p>
          </section>
        ) : null}

        {state === "confirm-link" ? (
          <section className="auth-panel">
            <p className="eyebrow">Account found</p>
            <h1>Link this card?</h1>
            <div className="customer-card">
              <strong>{mockCustomer.firstName} {mockCustomer.lastName}</strong>
              <span>{email || mockCustomer.email}</span>
              <span>{mockCustomer.companyName}</span>
            </div>
            <p className="lead">Future taps of this card will sign in to this account on an authorised CSS kiosk.</p>
            <button className="primary-button" type="button" onClick={confirmLink}>Link this card to my account</button>
            <button className="secondary-button" type="button" onClick={reset}>Cancel</button>
          </section>
        ) : null}

        {state === "welcome" ? (
          <section className="auth-panel auth-panel-centred">
            <div className="success-badge">✓</div>
            <p className="eyebrow">Signed in</p>
            <h1>Welcome, {mockCustomer.firstName}</h1>
            <p className="lead">Your trade account is ready.</p>
            <div className="customer-card compact">
              <strong>{mockCustomer.companyName}</strong>
              <span>{email || mockCustomer.email}</span>
            </div>
            <button className="primary-button" type="button" onClick={() => setMessage("Catalogue workspace comes in K1.")}>Start shopping</button>
            <button className="secondary-button" type="button" onClick={reset}>Sign out</button>
            {message ? <p className="demo-message">{message}</p> : null}
          </section>
        ) : null}

        {state === "error" ? (
          <section className="auth-panel auth-panel-centred">
            <div className="error-badge">!</div>
            <p className="eyebrow">Card unavailable</p>
            <h1>We couldn’t sign you in</h1>
            <p className="lead">{message}</p>
            <button className="primary-button" type="button" onClick={reset}>Try another card</button>
          </section>
        ) : null}
      </main>

      <aside className="prototype-tools" aria-label="Prototype controls">
        <strong>Prototype NFC</strong>
        <span>Hardware bridge not connected yet.</span>
        <select value={scenario} onChange={(event) => setScenario(event.target.value as MockCardScenario)}>
          <option value="unregistered">Unknown card</option>
          <option value="registered">Registered card</option>
          <option value="revoked">Revoked card</option>
        </select>
        <button type="button" onClick={reset}>Reset demo</button>
      </aside>
    </div>
  );
}
