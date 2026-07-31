import { useEffect, useState } from 'react';
import api from '../lib/api';

// Module-level cache so every consumer shares one fetch per session.
let _cache = null;
let _promise = null;
const _listeners = new Set();

const fetchOnce = () => {
  if (_cache !== null) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = api
    .get('/api/auth/me/view-permissions')
    .then((r) => {
      _cache = r.data?.permissions || {};
      _listeners.forEach((cb) => cb(_cache));
      return _cache;
    })
    .catch(() => {
      _cache = {};
      _listeners.forEach((cb) => cb(_cache));
      return _cache;
    })
    .finally(() => { _promise = null; });
  return _promise;
};

// Reset the cache on logout — call from AuthGate/Login flow.
export const resetViewPermissions = () => {
  _cache = null;
  _promise = null;
  _listeners.forEach((cb) => cb(null));
};

export const useViewPermissions = () => {
  const [perms, setPerms] = useState(_cache);
  useEffect(() => {
    let cancelled = false;
    const listener = (next) => { if (!cancelled) setPerms(next); };
    _listeners.add(listener);
    if (_cache === null) fetchOnce();
    return () => { cancelled = true; _listeners.delete(listener); };
  }, []);
  return {
    loading: perms === null,
    permissions: perms || {},
    can: (key) => (perms == null ? true : Boolean(perms[key] ?? true)),
  };
};
