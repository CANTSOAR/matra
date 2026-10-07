import { Link } from 'react-router-dom';
import { CreateAccountForm, SignInForm } from '../components/AuthForms';
import { PageTitle } from '../components/common';
import { IconFeather, IconHand, IconHeart, IconLock, IconShield } from '../components/icons';

export function CrisisResources() {
  return (
    <section className="card resources stack" aria-labelledby="crisis">
      <div className="row" style={{ gap: 14 }}>
        <span className="dot-icon sage">
          <IconHeart />
        </span>
        <h2 id="crisis" style={{ margin: 0 }}>
          If you need someone right now
        </h2>
      </div>
      <ul className="bullets">
        <li>
          If you’re in danger, call <a href="tel:911"><strong>911</strong></a>.
        </li>
        <li>
          National Sexual Assault Hotline — free, private, any time of day:{' '}
          <a href="tel:18006564673" style={{ whiteSpace: 'nowrap' }}><strong>1-800-656-4673</strong></a>
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
    <div className="stack-xl">
      <section className="hero">
        <div className="hero-art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">A private space, just for you</p>
        <h1 tabIndex={-1} data-autofocus data-testid="welcome-title">
          Tell it once. Keep it safe. <em>Decide what happens next.</em>
        </h1>
        <p className="lead">
          Matra is a quiet, locked place for what happened and anything you want to keep. Write it in your own words,
          at your own pace. Only you hold the key.
        </p>
        <div className="row">
          <Link className="btn btn-primary btn-large" to="/start" data-testid="get-started">
            Get started
          </Link>
          <Link className="btn btn-large" to="/signin" data-testid="welcome-signin">
            Sign in
          </Link>
        </div>
        <p className="hero-note small muted">
          <span>
            On a shared device? Our <Link to="/safety">safety tips</Link> can help. The <strong>Quick exit</strong> button
            — or pressing <kbd>Esc</kbd> three times — leaves right away.
          </span>
        </p>
      </section>

      <section aria-labelledby="what" className="stack-lg">
        <h2 id="what" className="visually-hidden">
          What Matra does
        </h2>
        <div className="promise-grid">
          <div className="promise">
            <span className="dot-icon">
              <IconLock />
            </span>
            <h3>Locked on your device</h3>
            <p>Everything is encrypted on your device before it’s saved. We can’t read it.</p>
          </div>
          <div className="promise">
            <span className="dot-icon warm">
              <IconFeather />
            </span>
            <h3>In your own words</h3>
            <p>Add to it whenever you’re ready. We never rewrite what you say.</p>
          </div>
          <div className="promise">
            <span className="dot-icon sage">
              <IconShield />
            </span>
            <h3>Sealed and dated</h3>
            <p>A tamper-evident seal and timestamp show your account hasn’t been changed.</p>
          </div>
          <div className="promise">
            <span className="dot-icon">
              <IconHand />
            </span>
            <h3>You decide</h3>
            <p>
              Make a summary for police or an advocate, or share with a verified volunteer or legal-aid attorney — only if you say yes.
            </p>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="not">
        <h2 id="not">Good to know</h2>
        <ul className="bullets">
          <li>
            <strong>This is not a police report.</strong> Nothing goes to police from here.
          </li>
          <li>
            <strong>This is not legal advice.</strong> An attorney can give you that.
          </li>
          <li>
            <strong>Nothing is sent anywhere without your yes</strong>, at that moment. You can take back access later.
          </li>
        </ul>
      </section>

      <CrisisResources />

      <p className="small muted" style={{ textAlign: 'center' }}>
        <Link to="/attorney" data-testid="attorney-link">I’m an attorney</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/counselor" data-testid="counselor-link">Legal options counselors</Link>
      </p>
    </div>
  );
}

export function SafetyTips() {
  return (
    <div className="stack-lg">
      <PageTitle
        eyebrow="Staying private"
        lead="A few small steps can make it harder for someone else to see that you used this site. Do what feels right for you."
      >
        Safety tips
      </PageTitle>
      <div className="grid-2">
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
          <p>This site never stores your story, keys or passphrase in the browser. The tab title only says “Notes”.</p>
        </section>
      </div>
      <section className="card stack">
        <h2>Think about your device</h2>
        <ul className="bullets">
          <li>If someone else can get into your phone or computer, think about using one they can’t — like a library computer or a trusted friend’s.</li>
          <li>Don’t let your browser save your passphrase if others can open your device.</li>
          <li>Some phones back up photos and screenshots on their own. Check your cloud photo settings if that matters for you.</li>
          <li>Spyware is possible on a device someone else set up. An advocate at 1-800-656-4673 can help you think it through.</li>
        </ul>
      </section>
      <section className="card stack">
        <h2>Leaving quickly</h2>
        <p>
          Press <strong>Quick exit</strong> at the top right, or press <kbd>Esc</kbd> three times. Your space locks, this page
          is replaced with a weather search, and the back button won’t bring it back.
        </p>
        <p>Your space also locks itself after 15 minutes without activity.</p>
      </section>
      <CrisisResources />
      <p>
        <Link className="back-link" to="/">← Back</Link>
      </p>
    </div>
  );
}

export function StartScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 620, margin: '0 auto' }}>
      <PageTitle eyebrow="Getting started" lead="It takes about a minute. You can stop at any time — nothing is saved until the end.">
        Create your private space
      </PageTitle>
      <CreateAccountForm role="survivor" />
    </div>
  );
}

export function SignInScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 520, margin: '0 auto' }}>
      <PageTitle lead="Take your time. Your passphrase unlocks your space on this device.">Welcome back</PageTitle>
      <SignInForm role="survivor" />
    </div>
  );
}

export function AttorneyLanding() {
  return (
    <div className="stack-lg" style={{ maxWidth: 680, margin: '0 auto' }}>
      <PageTitle
        eyebrow="Matra for legal professionals"
        lead="Receive a survivor’s file only with their explicit, revocable consent — end-to-end encrypted to your key."
      >
        For attorneys
      </PageTitle>
      <div className="card stack">
        <p>
          Survivors decide who sees their file. When one shares with you, their record is re-encrypted to your personal key
          on their device. Every time you open a file, it’s logged and visible to your client.
        </p>
        <p className="small muted">
          Matra is built on trust in both directions: survivors stay in control, and you receive a sealed, timestamped
          record you can verify.
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
      <p className="small muted" style={{ textAlign: 'center' }}>
        <Link to="/counselor" data-testid="counselor-link">Legal options counselors</Link>
      </p>
    </div>
  );
}

export function AttorneyRegisterScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 680, margin: '0 auto' }}>
      <PageTitle
        eyebrow="For attorneys"
        lead="Your private key is generated and kept on your device. We only store it encrypted under your passphrase."
      >
        Attorney registration
      </PageTitle>
      <CreateAccountForm role="attorney" />
    </div>
  );
}

export function AttorneySignInScreen() {
  return (
    <div className="stack-lg" style={{ maxWidth: 520, margin: '0 auto' }}>
      <PageTitle eyebrow="For attorneys">Attorney sign in</PageTitle>
      <SignInForm role="attorney" />
    </div>
  );
}
