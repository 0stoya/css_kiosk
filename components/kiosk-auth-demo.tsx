"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CatalogueHome } from "@/components/catalogue-home";
import { KioskAuthState, mockCustomer } from "@/lib/kiosk/auth-state";
import {
  KIOSK_INACTIVITY_TIMEOUT_MS,
  KIOSK_INACTIVITY_TIMEOUT_SECONDS,
  KIOSK_WELCOME_DELAY_MS,
} from "@/lib/kiosk/timing";
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

type EmployeeEnrollmentSummary = {
  companyId: number;
  employeeId: number;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  expiresAt: string;
};

type EmployeeEnrollmentResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  enrollment?: EmployeeEnrollmentSummary;
  employee?: {
    employeeId: number;
    argoEmployeeId: number;
    argoEmployeeCreated: boolean;
  };
};

type DeviceTrustState = "enrolling" | "trusted" | "error";

type NativeRfidDetail = {
  type?: unknown;
  value?: unknown;
  source?: unknown;
  vendorId?: unknown;
  productId?: unknown;
  deviceName?: unknown;
  capturedAt?: unknown;
};

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
  const [employeeEnrollmentCode, setEmployeeEnrollmentCode] = useState("");
  const [employeeEnrollment, setEmployeeEnrollment] = useState<EmployeeEnrollmentSummary | null>(null);
  const simulatorRef = useRef<KioskNfcSimulator | null>(null);
  const deviceSignerRef = useRef<DevelopmentKioskDeviceSigner | null>(null);
  const stateRef = useRef<KioskAuthState>("idle");
  const employeeEnrollmentRef = useRef<EmployeeEnrollmentSummary | null>(null);
  const employeeEnrollmentCodeRef = useRef("");
  const showPrototypeTools = process.env.NODE_ENV !== "production";

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const signedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const signer = deviceSignerRef.current;
    if (!signer) throw new Error("Kiosk device signer is unavailable.");
    return signer.signedFetch(input, init);
  }, []);

  const clearLocalState = useCallback((nextState: KioskAuthState = "idle") => {
    stateRef.current = nextState;
    setState(nextState);
    setActiveCredential(null);
    setEmail("");
    setPassword("");
    setMessage(null);
    setFormError(null);
    setVerifiedCustomer(null);
    setLinkingCard(false);
    setEmployeeEnrollmentCode("");
    setEmployeeEnrollment(null);
    employeeEnrollmentCodeRef.current = "";
    employeeEnrollmentRef.current = null;
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

  const completeActiveEmployeeEnrollment = useCallback(
    async (credential: NfcCredential, customer: VerifiedKioskCustomer) => {
      const enrollment = employeeEnrollmentRef.current;
      const code = employeeEnrollmentCodeRef.current;
      if (!enrollment || !code) {
        setMessage("Employee enrollment is no longer active. Start again from the card screen.");
        setState("error");
        return false;
      }

      setMessage(null);
      setFormError(null);
      setState("reading");
      stateRef.current = "reading";

      try {
        const response = await signedFetch("/api/employee-enrollment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            code,
            credential,
          }),
        });
        const body = (await response.json()) as EmployeeEnrollmentResponse;

        if (!response.ok || !body.ok || !body.employee) {
          setMessage(body.error || "Employee RFID enrollment could not be completed.");
          setState("error");
          return false;
        }

        setVerifiedCustomer(customer);
        setEmail(customer.email);
        setMessage(
          body.employee.argoEmployeeCreated
            ? "RFID linked and the NEXT ARGO employee was created."
            : "RFID linked to the existing NEXT ARGO employee.",
        );
        setState("employee-enrollment-complete");
        stateRef.current = "employee-enrollment-complete";
        return true;
      } catch {
        setMessage("Employee RFID enrollment is unavailable right now.");
        setState("error");
        return false;
      }
    },
    [signedFetch],
  );

  useEffect(() => {
    if (!showPrototypeTools) return;

    const simulator = createKioskNfcSimulator();
    const deviceSigner = createDevelopmentKioskDeviceSigner();
    simulatorRef.current = simulator;
    deviceSignerRef.current = deviceSigner;
    let cancelled = false;
    let deviceReady = false;
    let resolvingCredential = false;
    let pendingNativeCredential: NfcCredential | null = null;

    async function resolveCredential(credential: NfcCredential) {
      if (resolvingCredential) return;
      resolvingCredential = true;
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

          if (employeeEnrollmentRef.current) {
            await completeActiveEmployeeEnrollment(credential, body.customer);
            return;
          }

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
      } finally {
        resolvingCredential = false;
      }
    }

    function handleNativeRfidCard(event: Event) {
      if (
        stateRef.current !== "idle" &&
        stateRef.current !== "employee-enrollment-ready"
      ) {
        return;
      }

      const detail = (event as CustomEvent<NativeRfidDetail>).detail;
      const value = typeof detail?.value === "string" ? detail.value.trim() : "";
      if (!/^\d{4,64}$/.test(value)) {
        setMessage("The card reader returned an invalid card value. Please try again.");
        setState("error");
        return;
      }

      const credential: NfcCredential = { type: "uid", value };
      if (!deviceReady) {
        pendingNativeCredential = credential;
        return;
      }

      void resolveCredential(credential);
    }

    window.addEventListener("css-kiosk:rfid-card", handleNativeRfidCard as EventListener);

    const removeCredentialHandler = simulator.onCredential((credential) => {
      if (
        stateRef.current !== "idle" &&
        stateRef.current !== "employee-enrollment-ready"
      ) {
        return;
      }
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
        deviceReady = true;
        setDeviceTrust("trusted");

        const queuedCredential = pendingNativeCredential;
        pendingNativeCredential = null;
        if (
          queuedCredential &&
          (stateRef.current === "idle" ||
            stateRef.current === "employee-enrollment-ready")
        ) {
          void resolveCredential(queuedCredential);
        }

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
      deviceReady = false;
      pendingNativeCredential = null;
      window.removeEventListener("css-kiosk:rfid-card", handleNativeRfidCard as EventListener);
      removeCredentialHandler();
      removeErrorHandler();
      void simulator.stop();
      simulatorRef.current = null;
      deviceSignerRef.current = null;
    };
  }, [completeActiveEmployeeEnrollment, showPrototypeTools, signedFetch]);

  function reset() {
    const signer = deviceSignerRef.current;
    if (signer && deviceTrust === "trusted") {
      void signer.signedFetch("/api/nfc/link", { method: "DELETE" }).catch(() => undefined);
    }
    clearLocalState("idle");
  }

  async function submitEmployeeEnrollmentCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deviceTrust !== "trusted") {
      setMessage("This kiosk is not trusted for Employee enrollment.");
      setState("error");
      return;
    }

    const code = employeeEnrollmentCode.trim().toUpperCase().replace(/[\s-]+/g, "");
    if (!code) return;

    setMessage(null);
    setFormError(null);

    try {
      const response = await signedFetch("/api/employee-enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup", code }),
      });
      const body = (await response.json()) as EmployeeEnrollmentResponse;

      if (!response.ok || !body.ok || !body.enrollment) {
        setFormError(body.error || "Employee enrollment code could not be found.");
        return;
      }

      employeeEnrollmentCodeRef.current = code;
      employeeEnrollmentRef.current = body.enrollment;
      setEmployeeEnrollmentCode(code);
      setEmployeeEnrollment(body.enrollment);
      setState("employee-enrollment-ready");
      stateRef.current = "employee-enrollment-ready";
    } catch {
      setFormError("Employee enrollment is unavailable right now.");
    }
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

    if (!activeCredential) {
      setMessage("Tap the RFID again before linking it.");
      setState("error");
      return;
    }

    setLinkingCard(true);
    setMessage(null);

    try {
      const response = await signedFetch("/api/nfc/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: activeCredential }),
      });
      const body = (await response.json()) as CustomerResponse;

      if (!response.ok || !body.ok || !body.customer) {
        setMessage(body.error || "This card could not be linked.");
        setState("error");
        return;
      }

      setVerifiedCustomer(body.customer);
      setEmail(body.customer.email);

      if (employeeEnrollmentRef.current && activeCredential) {
        await completeActiveEmployeeEnrollment(activeCredential, body.customer);
        return;
      }

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

  useEffect(() => {
    if (state !== "welcome" || !verifiedCustomer) return;
    if (showPrototypeTools && magentoResult !== "real") return;

    const timer = window.setTimeout(() => {
      setMessage(null);
      setState("catalogue");
    }, KIOSK_WELCOME_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [magentoResult, showPrototypeTools, state, verifiedCustomer]);

  useEffect(() => {
    if ((state !== "welcome" && state !== "catalogue") || !verifiedCustomer) {
      return;
    }

    let inactivityTimer: number | null = null;
    let lastActivityAt = Date.now();

    function clearInactivityTimer() {
      if (inactivityTimer !== null) {
        window.clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    }

    function scheduleInactivityCheck() {
      clearInactivityTimer();
      const elapsed = Date.now() - lastActivityAt;
      const remaining = Math.max(1, KIOSK_INACTIVITY_TIMEOUT_MS - elapsed);
      inactivityTimer = window.setTimeout(checkInactivity, remaining);
    }

    function checkInactivity() {
      if (Date.now() - lastActivityAt >= KIOSK_INACTIVITY_TIMEOUT_MS) {
        signOut();
        return;
      }

      scheduleInactivityCheck();
    }

    function markActivity() {
      lastActivityAt = Date.now();
      scheduleInactivityCheck();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkInactivity();
      }
    }

    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("touchstart", markActivity, { passive: true });
    window.addEventListener("wheel", markActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    scheduleInactivityCheck();

    return () => {
      clearInactivityTimer();
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("wheel", markActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [signOut, state, verifiedCustomer]);

  const enrollmentReading = state === "reading" && Boolean(employeeEnrollment);
  const waiting = state === "idle" || (state === "reading" && !employeeEnrollment);
  const displayFirstName = verifiedCustomer?.firstName || mockCustomer.firstName;
  const displayLastName = verifiedCustomer?.lastName || mockCustomer.lastName;
  const displayEmail = verifiedCustomer?.email || email || mockCustomer.email;
  const displayCompany = verifiedCustomer
    ? verifiedCustomer.company?.name || "Personal account"
    : mockCustomer.companyName;
  const displayCompanyReference = verifiedCustomer?.company?.reference || null;
  const companyCount = verifiedCustomer?.companies.length || 0;
  const catalogueActive = state === "catalogue" && Boolean(verifiedCustomer);

  return (
    <div className={`kiosk-stage${catalogueActive ? " kiosk-stage-catalogue" : ""}`}>
      {!catalogueActive ? (
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
      ) : null}

      <main className={`kiosk-main${catalogueActive ? " kiosk-main-catalogue" : ""}`}>
        {waiting ? (
          <section className="auth-panel auth-panel-centred" aria-live="polite">
            <p className="eyebrow">Customer sign in</p>
            <h1>{state === "reading" ? "Checking your card…" : "Tap your card to sign in"}</h1>
            <p className="lead">Use your CSS customer card for fast access to your account and trade pricing.</p>

            <div className={`nfc-target${state === "reading" ? " is-reading" : ""}`} role="status">
              <span className="nfc-icon"><ContactlessIcon /></span>
              <span className="nfc-label">{state === "reading" ? "Card detected" : "Hold card near the reader"}</span>
            </div>

            <p className="privacy-note">
              The kiosk automatically signs out after {KIOSK_INACTIVITY_TIMEOUT_SECONDS} seconds of inactivity.
            </p>
            {state === "idle" ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setMessage(null);
                  setFormError(null);
                  setState("employee-enrollment-code");
                }}
              >
                Employee RFID enrollment
              </button>
            ) : null}
          </section>
        ) : null}

        {state === "employee-enrollment-code" ? (
          <section className="auth-panel auth-panel-centred">
            <button className="text-button" type="button" onClick={reset}>← Back</button>
            <p className="eyebrow">Employee RFID enrollment</p>
            <h1>Enter the enrollment code</h1>
            <p className="lead">
              Start enrollment from the Employee record in CSS Admin, then enter the short-lived code shown there.
            </p>
            <form className="link-form" onSubmit={submitEmployeeEnrollmentCode}>
              <label>
                <span>Enrollment code</span>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  maxLength={10}
                  value={employeeEnrollmentCode}
                  onChange={(event) => setEmployeeEnrollmentCode(event.target.value.toUpperCase())}
                  placeholder="ABCD2345"
                  required
                />
              </label>
              {formError ? <p className="form-error" role="alert">{formError}</p> : null}
              <button className="primary-button" type="submit">Continue</button>
            </form>
          </section>
        ) : null}

        {(state === "employee-enrollment-ready" || enrollmentReading) && employeeEnrollment ? (
          <section className="auth-panel auth-panel-centred" aria-live="polite">
            <button className="text-button" type="button" onClick={reset}>← Cancel</button>
            <p className="eyebrow">Employee RFID enrollment</p>
            <h1>
              {enrollmentReading
                ? "Checking this RFID…"
                : `Tap ${employeeEnrollment.firstName} ${employeeEnrollment.lastName}'s RFID`}
            </h1>
            <div className="customer-card compact">
              <strong>{employeeEnrollment.firstName} {employeeEnrollment.lastName}</strong>
              <span>
                {employeeEnrollment.employeeCode || `Employee #${employeeEnrollment.employeeId}`}
              </span>
            </div>
            <div className={`nfc-target${enrollmentReading ? " is-reading" : ""}`} role="status">
              <span className="nfc-icon"><ContactlessIcon /></span>
              <span className="nfc-label">
                {enrollmentReading ? "Card detected" : "Hold the Employee RFID near the reader"}
              </span>
            </div>
            <p className="security-note">
              The raw RFID is used transiently for ARGO reconciliation. CSS stores only its credential hash and stable Employee IDs.
            </p>
          </section>
        ) : null}

        {state === "unregistered" || state === "linking" ? (
          <section className="auth-panel">
            <button className="text-button" type="button" onClick={reset}>← Back</button>
            <p className="eyebrow">
              {employeeEnrollment ? "Employee RFID enrollment" : "Card not registered"}
            </p>
            <h1>
              {employeeEnrollment
                ? "Sign in once to link this Employee RFID"
                : "Sign in once to link your card"}
            </h1>
            <p className="lead">
              {employeeEnrollment
                ? "Use this Employee's own CSS Magento account. Their password is only used to verify the account."
                : "Enter the email address and password you already use for your CSS account."}
            </p>

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
            <p className="lead">
              {employeeEnrollment
                ? "This verifies the Employee's own Magento account before the RFID is linked to their canonical Employee and ARGO identity."
                : "Future taps of this card will recognise this customer account on an authorised CSS kiosk."}
            </p>
            <button className="primary-button" type="button" onClick={() => void confirmLink()} disabled={linkingCard}>
              {linkingCard ? "Linking card…" : "Link this card to my account"}
            </button>
            <button className="secondary-button" type="button" onClick={reset} disabled={linkingCard}>Cancel</button>
          </section>
        ) : null}

        {state === "employee-enrollment-complete" && employeeEnrollment ? (
          <section className="auth-panel auth-panel-centred">
            <div className="success-badge">✓</div>
            <p className="eyebrow">Employee RFID enrolled</p>
            <h1>{employeeEnrollment.firstName} {employeeEnrollment.lastName}</h1>
            <p className="lead">
              This RFID now resolves the Employee's Magento account, canonical CSS Employee and NEXT ARGO employee.
            </p>
            <div className="customer-card compact">
              <strong>{employeeEnrollment.employeeCode || `Employee #${employeeEnrollment.employeeId}`}</strong>
              {message ? <span>{message}</span> : null}
            </div>
            <button className="primary-button" type="button" onClick={signOut}>
              Finish & return to card screen
            </button>
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
          <span>Development only · signed device simulator + physical Sycreader bridge</span>
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
