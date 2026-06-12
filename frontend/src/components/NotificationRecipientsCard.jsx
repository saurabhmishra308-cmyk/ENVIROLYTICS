import React, { useEffect, useState, useCallback } from 'react';
import { Mail, Plus, Trash2, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

const MAX = 4;

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
  const chipBg  = isDarkMode ? 'bg-gray-700'     : 'bg-gray-50';

  const fetchEmails = useCallback(async () => {
    try {
      const { data } = await api.get('/api/notifications/emails');
      setEmails(data?.emails || []);
      setProviderOn(!!data?.provider_configured);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load recipients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await fetchEmails(); })();
    return () => { cancelled = true; };
  }, [fetchEmails]);

  const persist = async (nextList) => {
    setSaving(true);
    try {
      const { data } = await api.put('/api/notifications/emails', { emails: nextList });
      setEmails(data?.emails || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const addEmail = async () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (emails.includes(v)) {
      toast.error('This email is already added.');
      return;
    }
    if (emails.length >= MAX) {
      toast.error(`You can add a maximum of ${MAX} recipients.`);
      return;
    }
    try {
      await persist([...emails, v]);
      setDraft('');
      toast.success('Recipient added.');
    } catch { /* toast already shown */ }
  };

  const removeEmail = async (e) => {
    try {
      await persist(emails.filter((x) => x !== e));
      toast.success('Recipient removed.');
    } catch { /* toast already shown */ }
  };

  const sendTest = async () => {
    if (emails.length === 0) {
      toast.error('Add at least one recipient first.');
      return;
    }
    setTesting(true);
    try {
      await api.post('/api/notifications/test');
      toast.success('Test email sent.');
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Test send failed');
    } finally {
      setTesting(false);
    }
  };

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
        <Badge
          data-testid="notification-provider-status"
          className={providerOn ? 'bg-emerald-600' : 'bg-gray-400'}
        >
          {providerOn ? (
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Email service live</span>
          ) : (
            <span className="inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Email service not configured</span>
          )}
        </Badge>
      </div>

      <div className="px-5 py-4 space-y-3">
        {/* Existing recipients */}
        {loading ? (
          <p className={`text-sm ${muted}`}>Loading…</p>
        ) : emails.length === 0 ? (
          <p className={`text-sm italic ${muted}`} data-testid="notification-empty">
            No recipients yet. Add up to {MAX} email addresses below.
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="notification-recipients-list">
            {emails.map((e) => (
              <li
                key={e}
                data-testid={`notification-recipient-${e}`}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${chipBg} border ${isDarkMode ? 'border-gray-600' : 'border-gray-200'}`}
              >
                <span className={`text-sm truncate ${text}`} title={e}>{e}</span>
                <button
                  type="button"
                  data-testid={`notification-remove-${e}`}
                  onClick={() => removeEmail(e)}
                  disabled={saving}
                  className="text-red-500 hover:text-red-700 disabled:opacity-50"
                  aria-label={`Remove ${e}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add form */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Input
            type="email"
            inputMode="email"
            placeholder="name@company.com"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addEmail(); } }}
            disabled={saving || emails.length >= MAX}
            data-testid="notification-email-input"
            className="flex-1"
          />
          <Button
            type="button"
            onClick={addEmail}
            disabled={saving || !draft || emails.length >= MAX}
            data-testid="notification-add-btn"
          >
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={sendTest}
            disabled={testing || emails.length === 0 || !providerOn}
            data-testid="notification-test-btn"
            title={!providerOn ? 'Configure RESEND_API_KEY first' : 'Send a test email'}
          >
            <Send className="h-4 w-4 mr-1" /> {testing ? 'Sending…' : 'Send test'}
          </Button>
        </div>

        <p className={`text-[11px] ${muted}`}>
          {emails.length} / {MAX} recipients used.
          {!providerOn && ' Set RESEND_API_KEY in backend/.env to enable actual sending.'}
        </p>
      </div>
    </section>
  );
};

export default NotificationRecipientsCard;
