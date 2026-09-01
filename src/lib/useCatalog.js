import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { buildSteps } from './catalog.js';

/**
 * The effective catalog: what ships in `catalog.js`, plus whatever the shop
 * has added of its own.
 *
 * Loaded once at the top of the app and passed down, so the builder, the
 * quote, the spec sheet and the render prompt are all working from the same
 * list. Nothing downstream needs to know which parts are built in.
 */
export function useCatalog() {
  const [custom, setCustom] = useState({ categories: [], items: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setCustom(await api.catalog.list());
    } catch {
      /* an unreadable custom catalog must not stop the built-in one working */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const steps = useMemo(
    () => buildSteps(custom.categories, custom.items),
    [custom.categories, custom.items]
  );

  return { steps, categories: custom.categories, items: custom.items, loading, reload };
}
