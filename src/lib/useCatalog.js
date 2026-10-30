import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { buildSteps } from './catalog.js';
import { withPriceList } from './priceList.js';

/**
 * The effective catalog: what ships in `catalog.js`, plus whatever the shop
 * has added of its own, priced from the shop's own price list.
 *
 * Loaded once at the top of the app and passed down, so the builder, the
 * quote, the spec sheet and the render prompt are all working from the same
 * list. Nothing downstream needs to know which parts are built in.
 */
export function useCatalog() {
  const [custom, setCustom] = useState({ categories: [], items: [], options: [] });
  // The shop's own wording for built-in options, set from Settings > Price list.
  const [labels, setLabels] = useState({});
  // The shop's price list, kept in its database (see lib/priceList.js).
  const [priceList, setPriceList] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setCustom(await api.catalog.list());
    } catch {
      /* an unreadable custom catalog must not stop the built-in one working */
    }
    try {
      setPriceList((await api.settings.get({ key: 'priceList', fallback: null })) ?? null);
    } catch {
      /* an unreadable list prices nothing: every suit says it has no price yet */
    }
    try {
      setLabels((await api.settings.get({ key: 'labelOverrides', fallback: {} })) ?? {});
    } catch {
      /* nor can unreadable wording - the built-in labels stand */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const steps = useMemo(
    () => withPriceList(buildSteps(custom.categories, custom.items, custom.options, labels), priceList),
    [custom.categories, custom.items, custom.options, labels, priceList]
  );

  return {
    steps,
    categories: custom.categories,
    items: custom.items,
    options: custom.options ?? [],
    labels,
    loading,
    reload,
  };
}
