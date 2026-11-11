import { Link } from 'react-router-dom';
import { PHONE_VERIFICATION_NEEDED } from '../lib/vault';

/**
 * Shown on the sealed screen and on Home when her sealed match waits for a phone confirmation (W13;
 * counselor/PhoneVerify.tsx). A calm next step, never an error: her story is sealed either way.
 */
export function PhoneStepCard() {
  return (
    <div className="card soft stack" data-testid="phone-step-card">
      <p style={{ margin: 0 }}>{PHONE_VERIFICATION_NEEDED}</p>
      <div className="row">
        <Link className="btn btn-primary" to="/vault/matching/verify">
          Confirm a phone number
        </Link>
      </div>
    </div>
  );
}
