import React, { useEffect, useState, useCallback } from 'react';
import { Mail, Plus, Trash2, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

const MAX = 4;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const logDev = (label, err) => {
  if (process.env.NODE_ENV === 'development') console.error(`[notifications:${label}]`, err);
};

// ---------- sub-components ----------
const ProviderBadge = ({ on }) => (
  <Badge
    data-testid="notification-provider-status"
    className={on ? 'bg-emerald-600' : 'bg-gray-400'}
  >
    {on ? (
      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Email service live</span>
    ) : (
      <span className="inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Email service not configured</span>
    )}
  </Badge>
);

const RecipientChip = ({ email, onRemove, isDarkMode, disabled }) => {
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const chipBg = isDarkMode ? 'bg-gray-700' : 'bg-gray-50';
  const border = isDarkMode ? 'border-gray-600' : 'border-gray-200';
  return (
    <li
      data-testid={`notification-recipient-${email}`}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${chipBg} border ${border}`}
    >
      <span className={`text-sm truncate ${text}`} title={email}>{email}</span>
      <button
        type="button"
        data-testid={`notification-remove-${email}`}
        onClick={onRemove}
        disabled={disabled}
        className="text-red-500 hover:text-red-700 disabled:opacity-50"
        aria-label={`Remove ${email}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
};

const RecipientList = ({ emails, loading, isDarkMode, onRemove, saving }) => {
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  if (loading) return <p className={`text-sm ${muted}`}>Loading…</p>;
  if (emails.length === 0) {
    return (
      <p className={`text-sm italic ${muted}`} data-testid="notification-empty">
        No recipients yet. Add up to {MAX} email addresses below.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="notification-recipients-list">
      {emails.map((e) => (
        <RecipientChip
          key={e}
          email={e}
          onRemove={() => onRemove(e)}
          isDarkMode={isDarkMode}
          disabled={saving}
        />
      ))}
    </ul>
  );
};

const AddRecipientForm = ({ draft, setDraft, onAdd, onTest, saving, testing, atMax, providerOn, hasRecipients }) => (
  <div className="flex flex-col sm:flex-row gap-2 pt-1">
    <Input
      type="email"
      inputMode="email"
      placeholder="name@company.com"
      value={draft}
      onChange={(ev) => setDraft(ev.target.value)}
      onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onAdd(); } }}
      disabled={saving || atMax}
      data-testid="notification-email-input"
      className="flex-1"
    />
    <Button
      type="button"
      onClick={onAdd}
      disabled={saving || !draft || atMax}
      data-testid="notification-add-btn"
    >
      <Plus className="h-4 w-4 mr-1" /> Add
    </Button>
    <Button
      type="button"
      variant="outline"
      onClick={onTest}
      disabled={testing || !hasRecipients || !providerOn}
      data-testid="notification-test-btn"
      title={!providerOn ? 'Configure RESEND_API_KEY first' : 'Send a test email'}
    >
      <Send className="h-4 w-4 mr-1" /> {testing ? 'Sending…' : 'Send test'}
    </Button>
  </div>
);

// ---------- main ----------
const NotificationRecipientsCard = ({ isDarkMode }) => {
  const [emails, setEmails] = useState([]);
  const [providerOn, setProviderOn] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const surface = isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const text    = isDarkMode ? 'text-white'      : 'text-gray-900';
  const muted   = isDarkMode ? 'text-gray-400'   : 'text-gray-600';

  const fetchEmails = useCallback(async () => {
    try {
      const { data } = await api.get('/api/notifications/emails');
      setEmails(data?.emails || []);
      setProviderOn(!!data?.provider_configured);
    } catch (e) {
      logDev('fetch', e);
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load recipients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await fetchEmails(); };
    run();
    return () => { cancelled = true; };
  }, [fetchEmails]);

  const persist = useCallback(async (nextList) => {
    setSaving(true);
    try {
      const { data } = await api.put('/api/notifications/emails', { emails: nextList });
      setEmails(data?.emails || []);
      return true;
    } catch (e) {
      logDev('persist', e);
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const validateNewEmail = useCallback((v) => {
    if (!v) return 'Please enter an email address.';
    if (!EMAIL_RE.test(v)) return 'Please enter a valid email address.';
    if (emails.includes(v)) return 'This email is already added.';
    if (emails.length >= MAX) return `You can add a maximum of ${MAX} recipients.`;
    return null;
  }, [emails]);

  const addEmail = useCallback(async () => {
    const v = draft.trim().toLowerCase();
    const err = validateNewEmail(v);
    if (err) { toast.error(err); return; }
    const ok = await persist([...emails, v]);
    if (ok) { setDraft(''); toast.success('Recipient added.'); }
  }, [draft, emails, persist, validateNewEmail]);

  const removeEmail = useCallback(async (e) => {
    const ok = await persist(emails.filter((x) => x !== e));
    if (ok) toast.success('Recipient removed.');
  }, [emails, persist]);

  const sendTest = useCallback(async () => {
    if (emails.length === 0) { toast.error('Add at least one recipient first.'); return; }
    setTesting(true);
    try {
      await api.post('/api/notifications/test');
      toast.success('Test email sent.');
    } catch (e) {
      logDev('test', e);
      toast.error(formatApiError(e?.response?.data?.detail) || 'Test send failed');
    } finally {
      setTesting(false);
    }
  }, [emails.length]);

  return (
    <section
      data-testid="notification-recipients-card"
      className={`rounded-xl border ${surface} shadow-sm`}
    >
      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-600">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${muted}`}>Admin · Notifications</p>
            <h3 className={`text-base font-semibold ${text}`}>Offline alert recipients</h3>
            <p className={`text-xs mt-0.5 ${muted}`}>
              Get an email when any IoT device has been silent for ≥ 2 hours. Up to {MAX} recipients.
            </p>
          </div>
        </div>
        <ProviderBadge on={providerOn} />
      </div>

      <div className="px-5 py-4 space-y-3">
        <RecipientList
          emails={emails}
          loading={loading}
          isDarkMode={isDarkMode}
          onRemove={removeEmail}
          saving={saving}
        />

        <AddRecipientForm
          draft={draft}
          setDraft={setDraft}
          onAdd={addEmail}
          onTest={sendTest}
          saving={saving}
          testing={testing}
          atMax={emails.length >= MAX}
          providerOn={providerOn}
          hasRecipients={emails.length > 0}
        />

        <p className={`text-[11px] ${muted}`}>
          {emails.length} / {MAX} recipients used.
          {!providerOn && ' Set RESEND_API_KEY in backend/.env to enable actual sending.'}
        </p>
      </div>
    </section>
  );
};

export default NotificationRecipientsCard;
