"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CatalogueHome } from "@/components/catalogue-home";
import { KioskAuthState, mockCustomer } from "@/lib/kiosk/auth-state";
import {
  createDevelopmentKioskDeviceSigner,
  type DevelopmentKioskDeviceSigner,
} from "@/lib/kiosk/device-simulator";
import type { NfcCredential } from "@/lib/kiosk/nfc-reader";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";
import {
  createKioskNfcSimulator,
  KioskNfcSimulator,
  SimulatedCardFixture,
  SimulatedMagentoResult,
} from "@/lib/kiosk/simulator";

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

type CustomerResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  customer?: VerifiedKioskCustomer;
};

type ResolveCardResponse = CustomerResponse & {
  status?: "registered" | "unregistered" | "revoked";
};

type DeviceTrustState = "enrolling" | "trusted" | "error";

export function KioskAuthDemo() {
  const [state, setState] = useState<KioskAuthState>("idle");
  const [cardFixture, setCardFixture] = useState<SimulatedCardFixture>("unregistered");
  const [magentoResult, setMagentoResult] = useState<SimulatedMagentoResult>("real");
  const [readerAvailable, setReaderAvailable] = useState(true);
  const [deviceTrust, setDeviceTrust] = useState<DeviceTrustState>("enrolling");
  const [activeCredential, setActiveCredential] = useState<NfcCredential | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [verifiedCustomer, setVerifiedCustomer] = useState<VerifiedKioskCustomer | null>(null);
  const [linkingCard, setLinkingCard] = useState(false);
  const simulatorRef = useRef<KioskNfcSimulator | null>(null);
  const deviceSignerRef = useRef<DevelopmentKioskDeviceSigner | null>(null);
  const showPrototypeTools = process.env.NODE_ENV !== "production";

  const signedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const signer = deviceSignerRef.current;
    if (!signer) throw new Error("Kiosk device signer is unavailable.");
    return signer.signedFetch(input, init);
  }, []);

  const clearLocalState = useCallback((nextState: KioskAuthState = "idle") => {
    setState(nextState);
    setActiveCredential(null);
    setEmail("");
    setPassword("");
    setMessage(null);
    setFormError(null);
    setVerifiedCustomer(null);
    setLinkingCard(false);
  }, []);

  const signOut = useCallback(() => {
    const signer = deviceSignerRef.current;
    if (signer && deviceTrust === "trusted") {
      void signer.signedFetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
      void signer.signedFetch("/api/nfc/link", { method: "DELETE" }).catch(() => undefined);
    }
    clearLocalState("idle");
  }, [clearLocalState, deviceTrust]);

  const sessionExpired = useCallback((sessionMessage: string) => {
    setVerifiedCustomer(null);
    setMessage(sessionMessage);
    setState("error");
  }, []);

  useEffect(() => {
    if (!showPrototypeTools) return;

    const simulator = createKioskNfcSimulator();
    const deviceSigner = createDevelopmentKioskDeviceSigner();
    simulatorRef.current = simulator;
    deviceSignerRef.current = deviceSigner;
    let cancelled = false;

    async function resolveCredential(credential: NfcCredential) {
      setActiveCredential(credential);
      setState("reading");
      setMessage(null);
      setFormError(null);
      setVerifiedCustomer(null);

      try {
        const response = await signedFetch("/api/nfc/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        const body = (await response.json()) as ResolveCardResponse;

        if (!response.ok || !body.ok) {
          setMessage(body.error || "Card lookup is unavailable right now.");
          setState("error");
          return;
        }

        if (body.status === "registered" && body.customer) {
          setVerifiedCustomer(body.customer);
          setEmail(body.customer.email);
          setState("welcome");
          return;
        }

        if (body.status === "unregistered") {
          setState("unregistered");
          return;
        }

        if (body.status === "revoked") {
          setMessage("This card is no longer active. Please ask a member of staff for help.");
          setState("error");
          return;
        }

        setMessage("This card could not be recognised.");
        setState("error");
      } catch {
        setMessage("Card lookup is unavailable right now. Please try again.");
        setState("error");
      }
    }

    const removeCredentialHandler = simulator.onCredential((credential) => {
      void resolveCredential(credential);
    });

    const removeErrorHandler = simulator.onError((error) => {
      setMessage(error.message);
      setState("error");
    });

    async function startSimulator() {
      try {
        await deviceSigner.enroll();
        const statusResponse = await deviceSigner.signedFetch("/api/device/status");
        if (!statusResponse.ok) throw new Error("Kiosk device trust check failed.");

        if (cancelled) return;
        setDeviceTrust("trusted");
        await simulator.start();
      } catch {
        if (cancelled) return;
        setDeviceTrust("error");
        setMessage("The kiosk device could not establish a trusted connection.");
        setState("error");
      }
    }

    void startSimulator();

    return () => {
      cancelled = true;
      removeCredentialHandler();
      removeErrorHandler();
      void simulator.stop();
      simulatorRef.current = null;
      deviceSignerRef.current = null;
    };
  }, [showPrototypeTools, signedFetch]);

  function reset() {
    const signer = deviceSignerRef.current;
    if (signer && deviceTrust === "trusted") {
      void signer.signedFetch("/api/nfc/link", { method: "DELETE" }).catch(() => undefined);
    }
    clearLocalState("idle");
  }

  function presentSimulatedCard() {
    if (!showPrototypeTools || deviceTrust !== "trusted") return;
    setMessage(null);
    setFormError(null);
    simulatorRef.current?.presentCard(cardFixture);
  }

  function changeReaderAvailability(available: boolean) {
    setReaderAvailable(available);
    simulatorRef.current?.setAvailable(available);
  }

  async function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submittedEmail = email.trim();
    const submittedPassword = password;
    if (!submittedEmail || !submittedPassword) return;

    setPassword("");
    setFormError(null);
    setMessage(null);
    setState("linking");

    if (showPrototypeTools && magentoResult !== "real") {
      window.setTimeout(() => {
        if (magentoResult === "invalid-credentials") {
          setFormError("Email address or password was not recognised. Please try again.");
          setState("unregistered");
          return;
        }

        if (magentoResult === "unavailable") {
          setMessage("We cannot reach the customer account service right now. Please try again shortly.");
          setState("error");
          return;
        }

        setVerifiedCustomer(null);
        setState("confirm-link");
      }, 650);
      return;
    }

    if (!activeCredential) {
      setFormError("Tap the card again before signing in.");
      setState("unregistered");
      return;
    }

    if (!deviceSignerRef.current || deviceTrust !== "trusted") {
      setMessage("This kiosk is not trusted for customer sign in.");
      setState("error");
      return;
    }

    try {
      const response = await signedFetch("/api/auth/verify-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: submittedEmail,
          password: submittedPassword,
          credential: activeCredential,
        }),
      });

      const body = (await response.json()) as CustomerResponse;

      if (!response.ok || !body.ok || !body.customer) {
        const errorMessage = body.error || "Customer sign in could not be completed.";
        if (response.status === 400 || response.status === 401) {
          setFormError(errorMessage);
          setState("unregistered");
          return;
        }

        setMessage(errorMessage);
        setState("error");
        return;
      }

      setVerifiedCustomer(body.customer);
      setEmail(body.customer.email);
      setState("confirm-link");
    } catch {
      setMessage("We cannot reach the customer account service right now. Please try again shortly.");
      setState("error");
    }
  }

  async function confirmLink() {
    if (showPrototypeTools && magentoResult !== "real") {
      setState("welcome");
      return;
    }

    if (!deviceSignerRef.current || deviceTrust !== "trusted") {
      setMessage("This kiosk is not trusted for card linking.");
      setState("error");
      return;
    }

    setLinkingCard(true);
    setMessage(null);

    try {
      const response = await signedFetch("/api/nfc/link", { method: "POST" });
      const body = (await response.json()) as CustomerResponse;

      if (!response.ok || !body.ok || !body.customer) {
        setMessage(body.error || "This card could not be linked.");
        setState("error");
        return;
      }

      setVerifiedCustomer(body.customer);
      setEmail(body.customer.email);
      setState("welcome");
    } catch {
      setMessage("Card linking is unavailable right now. Please try again.");
      setState("error");
    } finally {
      setLinkingCard(false);
    }
  }

  function continueToCatalogue() {
    if (showPrototypeTools && magentoResult !== "real") {
      setMessage("Choose Real Magento in the simulator to test the authenticated catalogue.");
      return;
    }

    if (!verifiedCustomer) {
      setMessage("Your authenticated customer session is unavailable. Tap your card again.");
      setState("error");
      return;
    }

    setMessage(null);
    setState("catalogue");
  }

  const waiting = state === "idle" || state === "reading";
  const displayFirstName = verifiedCustomer?.firstName || mockCustomer.firstName;
  const displayLastName = verifiedCustomer?.lastName || mockCustomer.lastName;
  const displayEmail = verifiedCustomer?.email || email || mockCustomer.email;
  const displayCompany = verifiedCustomer
    ? verifiedCustomer.company?.name || "Personal account"
    : mockCustomer.companyName;
  const displayCompanyReference = verifiedCustomer?.company?.reference || null;
  const companyCount = verifiedCustomer?.companies.length || 0;

  return (
    <div className="kiosk-stage">
      <header className="kiosk-brand">
        <Image
          className="brand-logo"
          src="/css-logo.png"
          alt="Chelmsford Safety Supplies"
          width={2222}
          height={514}
          sizes="420px"
          priority
        />
        <p className="brand-context">Trade counter kiosk</p>
      </header>

      <main className="kiosk-main">
        {waiting ? (
          <section className="auth-panel auth-panel-centred" aria-live="polite">
            <p className="eyebrow">Customer sign in</p>
            <h1>{state === "reading" ? "Checking your card…" : "Tap your card to sign in"}</h1>
            <p className="lead">Use your CSS customer card for fast access to your account and trade pricing.</p>

            <div className={`nfc-target${state === "reading" ? " is-reading" : ""}`} role="status">
              <span className="nfc-icon"><ContactlessIcon /></span>
              <span className="nfc-label">{state === "reading" ? "Card detected" : "Hold card near the reader"}</span>
            </div>

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

              {formError ? <p className="form-error" role="alert">{formError}</p> : null}

              <button className="primary-button" type="submit" disabled={state === "linking"}>
                {state === "linking" ? "Checking account…" : "Sign in & link card"}
              </button>
            </form>

            <p className="security-note">Your password is used only to verify your Magento customer account. It is cleared immediately after submission and is never written to the NFC card.</p>
          </section>
        ) : null}

        {state === "confirm-link" ? (
          <section className="auth-panel">
            <p className="eyebrow">Account found</p>
            <h1>Link this card?</h1>
            <div className="customer-card">
              <strong>{displayFirstName} {displayLastName}</strong>
              <span>{displayEmail}</span>
              <span>{displayCompany}</span>
              {displayCompanyReference ? <span>Account {displayCompanyReference}</span> : null}
              {companyCount > 1 ? <span>{companyCount} company accounts available</span> : null}
            </div>
            <p className="lead">Future taps of this card will recognise this customer account on an authorised CSS kiosk.</p>
            <button className="primary-button" type="button" onClick={() => void confirmLink()} disabled={linkingCard}>
              {linkingCard ? "Linking card…" : "Link this card to my account"}
            </button>
            <button className="secondary-button" type="button" onClick={reset} disabled={linkingCard}>Cancel</button>
          </section>
        ) : null}

        {state === "welcome" ? (
          <section className="auth-panel auth-panel-centred">
            <div className="success-badge">✓</div>
            <p className="eyebrow">Card recognised</p>
            <h1>Welcome, {displayFirstName}</h1>
            <p className="lead">Your trade account has been recognised.</p>
            <div className="customer-card compact">
              <strong>{displayCompany}</strong>
              <span>{displayEmail}</span>
              {displayCompanyReference ? <span>Account {displayCompanyReference}</span> : null}
            </div>
            <button className="primary-button" type="button" onClick={continueToCatalogue}>Continue to catalogue</button>
            <button className="secondary-button" type="button" onClick={signOut}>Sign out</button>
            {message ? <p className="demo-message">{message}</p> : null}
          </section>
        ) : null}

        {state === "catalogue" && verifiedCustomer ? (
          <CatalogueHome
            customer={verifiedCustomer}
            signedFetch={signedFetch}
            onSignOut={signOut}
            onSessionExpired={sessionExpired}
          />
        ) : null}

        {state === "error" ? (
          <section className="auth-panel auth-panel-centred">
            <div className="error-badge">!</div>
            <p className="eyebrow">Unable to continue</p>
            <h1>We couldn’t sign you in</h1>
            <p className="lead">{message}</p>
            <button className="primary-button" type="button" onClick={reset}>Return to card screen</button>
          </section>
        ) : null}
      </main>

      {showPrototypeTools && state !== "catalogue" ? (
        <aside className="prototype-tools" aria-label="Kiosk simulator controls">
          <strong>Kiosk simulator</strong>
          <span>Development only · signed device + Android NFC reader simulated</span>
          <span>Device trust: {deviceTrust === "trusted" ? "Trusted" : deviceTrust === "error" ? "Failed" : "Enrolling…"}</span>

          <label>
            Reader
            <select
              value={readerAvailable ? "ready" : "unavailable"}
              onChange={(event) => changeReaderAvailability(event.target.value === "ready")}
            >
              <option value="ready">Ready</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>

          <label>
            Card
            <select value={cardFixture} onChange={(event) => setCardFixture(event.target.value as SimulatedCardFixture)}>
              <option value="unregistered">Unknown / linkable card</option>
              <option value="registered">Fixture: registered card</option>
              <option value="revoked">Fixture: revoked card</option>
              <option value="read-error">Read error</option>
            </select>
          </label>

          <button type="button" onClick={presentSimulatedCard} disabled={state === "reading" || deviceTrust !== "trusted"}>Present card</button>

          <label>
            Magento auth
            <select value={magentoResult} onChange={(event) => setMagentoResult(event.target.value as SimulatedMagentoResult)}>
              <option value="real">Real Magento</option>
              <option value="success">Fixture: success</option>
              <option value="invalid-credentials">Fixture: invalid credentials</option>
              <option value="unavailable">Fixture: service unavailable</option>
            </select>
          </label>

          <button type="button" onClick={reset}>Reset kiosk</button>
        </aside>
      ) : null}
    </div>
  );
}
