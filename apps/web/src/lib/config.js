import { useEffect, useState } from 'react';
import { api } from './api';

const EMPTY = { featureFlags: {}, settings: {} };

let configPromise = null;

/** Loads /v1/config once per page load. Falls back to all flags off if the API is unreachable. */
function loadConfig() {
  configPromise ??= api('/v1/config').catch((err) => {
    console.warn('Could not load site config; using defaults', err);
    return EMPTY;
  });
  return configPromise;
}

export function useConfig() {
  const [state, setState] = useState({ ...EMPTY, loading: true });

  useEffect(() => {
    let active = true;
    loadConfig().then((config) => {
      if (active) setState({ ...config, loading: false });
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    ...state,
    isEnabled: (flag) => state.featureFlags[flag] === true,
  };
}
