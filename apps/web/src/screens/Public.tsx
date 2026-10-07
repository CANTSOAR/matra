import { Link } from 'react-router-dom';
import { CreateAccountForm, SignInForm } from '../components/AuthForms';
import { PageTitle } from '../components/common';

export function CrisisResources() {
  return (
    <section className="card resources stack" aria-labelledby="crisis">
      <h2 id="crisis">If you need help right now</h2>
      <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
        <li>
          In immediate danger: call <a href="tel:911"><strong>911</strong></a>.
        </li>
        <li>
          National Sexual Assault Hotline (free, confidential, 24/7):{' '}
          <a href="tel:18006564673"><strong>1-800-656-4673</strong></a>
        </li>
        <li>
          Chat online with a trained advocate:{' '}
          <a href="https://online.rainn.org" target="_blank" rel="noreferrer noopener">online.rainn.org</a>
        </li>
      </ul>
    </section>
  );
}

export function Welcome() {
  return (
    <div className="stack-lg">
      <section className="hero stack">
        <h1 tabIndex={-1} data-autofocus>
          Tell it once. Keep it safe. Decide what happens next.
        </h1>
        <p className="lead">
          Matra is a private, locked vault for your account of what happened and any evidence you have. You tell
          your story once, in your own words and at your own pace.
        </p>
        <div className="row">
          <Link className="btn btn-primary" to="/start">
            Get started
          </Link>
          <Link className="btn" to="/signin">
            Sign in
          </Link>
        </div>
        <p className="small muted">
          Using a shared device? Read our <Link to="/safety">safety tips</Link> first. The <strong>Quick exit</strong>{' '}
          button (or pressing <kbd>Esc</kbd> three times) leaves instantly.
        </p>
      </section>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="what">
          <h2 id="what">What it is</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }} className="stack">
            <li>A vault that locks everything on your device before it’s saved. We can’t read it.</li>
            <li>A tamper-evident seal and timestamp, so you can show your account hasn’t been changed.</li>
            <li>A way to prepare a clear brief you can bring to police — if and when you choose.</li>
            <li>A way to share with a verified pro-bono attorney, only when you say yes.</li>
          </ul>
        </section>
        <section className="card stack" aria-labelledby="not">
          <h2 id="not">What it is not</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }} className="stack">
            <li>
              <strong>Not a police report.</strong> Nothing goes to police from here.
            </li>
            <li>
              <strong>Not legal advice.</strong> An attorney can give you that.
            </li>
            <li>
              <strong>Nothing is sent anywhere without your yes</strong>, at that moment. You can take back access later.
            </li>
          </ul>
        </section>
      </div>

      <CrisisResources />

      <p className="small muted">
        <Link to="/attorney">I’m an attorney</Link>
      </p>
    </div>
  );
}

export function SafetyTips() {
  return (
    <div className="stack-lg">
      <PageTitle lead="Small steps that make it harder for someone else to find out you used this site.">Safety tips</PageTitle>
      <section className="card stack">
        <h2>Use a private window</h2>
        <p>
          Open this site in a private or incognito window (Chrome: “New Incognito window”; Safari: “New Private Window”;
          Firefox: “New private window”). When you close it, the browser forgets the pages you visited.
        </p>
      </section>
      <section className="card stack">
        <h2>Clear your history</h2>
        <p>
          If you didn’t use a private window, you can delete this site from your browsing history afterwards. Deleting
          only this site is less noticeable than clearing everything.
        </p>
        <p>
          This site never stores your story, keys or passphrase in the browser. The tab title shows only “Notes”.
        </p>
      </section>
      <section className="card stack">
        <h2>Think about your device</h2>
        <ul style={{ paddingLeft: 18, margin: 0 }} className="stack">
          <li>If someone else has access to your phone or computer, consider using a device they don’t — a library or a trusted friend’s.</li>
          <li>Don’t let your browser save your passphrase if others can open your device.</li>
          <li>Some phones back up photos and screenshots automatically. Check your cloud photo settings if that matters for you.</li>
          <li>Spyware is possible on devices someone else set up. An advocate at 1-800-656-4673 can help you think it through.</li>
        </ul>
      </section>
      <section className="card stack">
        <h2>Leaving quickly</h2>
        <p>
          Press the <strong>Quick exit</strong> button at the top right, or press <kbd>Esc</kbd> three times. Your vault
          locks, this page is replaced with a weather search, and the back button won’t bring it back.
        </p>
        <p>Your vault also locks itself after 15 minutes without activity.</p>
      </section>
      <CrisisResources />
      <p>
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}

export function StartScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 600, margin: '0 auto' }}>
      <PageTitle lead="This takes about a minute. You can stop at any time.">Create your private vault</PageTitle>
      <CreateAccountForm role="survivor" />
    </div>
  );
}

export function SignInScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 520, margin: '0 auto' }}>
      <PageTitle lead="Your passphrase unlocks your vault on this device.">Welcome back</PageTitle>
      <SignInForm role="survivor" />
    </div>
  );
}

export function AttorneyLanding() {
  return (
    <div className="stack-lg" style={{ maxWidth: 640, margin: '0 auto' }}>
      <PageTitle lead="Receive survivor files only with their explicit, revocable consent — end-to-end encrypted to your key.">
        For attorneys
      </PageTitle>
      <div className="card stack">
        <p>
          Survivors decide who sees their file. When one shares with you, their record is re-encrypted to your personal key
          on their device. Every time you open a file, it’s logged and visible to your client.
        </p>
        <div className="row">
          <Link className="btn btn-primary" to="/attorney/register">
            Register as an attorney
          </Link>
          <Link className="btn" to="/attorney/signin">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AttorneyRegisterScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 640, margin: '0 auto' }}>
      <PageTitle lead="Your private key is generated and kept on your device; we only store it encrypted under your passphrase.">
        Attorney registration
      </PageTitle>
      <CreateAccountForm role="attorney" />
    </div>
  );
}

export function AttorneySignInScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 520, margin: '0 auto' }}>
      <PageTitle>Attorney sign in</PageTitle>
      <SignInForm role="attorney" />
    </div>
  );
}
