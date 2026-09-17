import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/pricing.js';
import { PROJECT_STATUSES, statusLabel, EVENT_TYPES } from '../lib/catalog.js';
import { Empty, Spinner } from '../components/ui.jsx';

/**
 * The business at a glance.
 *
 * Deliberately few charts: most of these numbers are single values or lists of
 * orders needing action, and a stat tile or a table reads faster than a plot.
 * Only three things here vary across a dimension worth seeing shape in - the
 * pipeline, monthly volume, and which cloth sells - so only those are drawn.
 *
 * One accent colour throughout. Eight shades for eight labelled stages would
 * encode nothing the label and the bar length do not already carry. Colour
 * changes only for status, and status always carries a word too.
 */
export default function Analytics({ onOpenProject }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.analytics.get().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="content"><div className="banner banner-danger">{error}</div></div>;
  if (!data) return <div className="content center" style={{ paddingTop: 80 }}><Spinner /></div>;

  const t = data.totals;
  const money = data.depositShortfall.reduce((s, o) => s + o.shortfall, 0);
  const legacy = data.legacy ?? { open: { orders: 0, total: 0 }, settledLikely: { orders: 0, total: 0 }, imported: 0 };
  const quotedCount = t.quoted > 0 ? Math.max(1, Math.round(t.quoted / (t.averageOrder || t.quoted))) : 0;

  return (
    <>
      <div className="topbar">
        <h1>Business</h1>
        <div className="spacer" />
        <span className="tiny faint">Updated {new Date(data.generatedAt).toLocaleString('en-ZA')}</span>
      </div>

      <div className="content wide">
        {/* Headline figures are values, not shapes - tiles, not charts. */}
        <div className="grid grid-4" style={{ marginBottom: 18 }}>
          <Stat label="Open orders" value={t.openOrders} sub={`${plural(t.suitsInProgress, 'suit')} in progress`} />
          <Stat label="Payments received" value={formatMoney(t.paid)} sub={`across ${plural(t.orders, 'order')}`} tone="good" />
          {/* Quoted figures only describe orders that carry a quote. Most of
              the imported history does not, so the tile says how many. */}
          <Stat
            label="Outstanding on quotes"
            value={formatMoney(t.outstanding)}
            sub={quotedCount ? `${plural(quotedCount, 'order')} quoted in the app` : 'no orders quoted yet'}
            tone={t.outstanding > 0 ? 'warn' : undefined}
          />
          <Stat label="Delivered" value={t.delivered} sub={`${plural(t.clients, 'client')} on file`} />
        </div>

        {/* Things that need doing today, before anything decorative. */}
        {(data.depositShortfall.length > 0 || data.overdue.length > 0 || data.alterations.overdue > 0) && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head"><h3>Needs attention</h3></div>
            <div className="card-pad">
              {data.depositShortfall.length > 0 && (
                <ActionTable
                  title={`Cutting started under the 50% deposit — ${formatMoney(money)} at risk`}
                  tone="critical"
                  rows={data.depositShortfall}
                  onOpen={onOpenProject}
                  columns={(o) => [statusLabel(o.status), `${formatMoney(o.paid)} of ${formatMoney(o.quoted * 0.5)}`, `${formatMoney(o.shortfall)} short`]}
                />
              )}
              {data.overdue.length > 0 && (
                <ActionTable
                  title={`${data.overdue.length} order${data.overdue.length === 1 ? '' : 's'} past the event date${data.overdue.length > 10 ? ' - showing the 10 oldest' : ''}`}
                  tone="serious"
                  rows={data.overdue.slice(0, 10)}
                  onOpen={onOpenProject}
                  columns={(o) => [
                    statusLabel(o.status),
                    'Event ' + o.event_date,
                    o.quoted > 0 ? formatMoney(o.outstanding) + ' due'
                      : o.legacy_balance > 0 ? formatMoney(o.legacy_balance) + ' on the sheet'
                      : o.fabric_name || 'not quoted',
                  ]}
                />
              )}
              {data.alterations.overdue > 0 && (
                <p className="small" style={{ margin: '10px 0 0' }}>
                  <span className="status-dot status-serious" /> {data.alterations.overdue} alteration
                  {data.alterations.overdue === 1 ? ' is' : 's are'} past their due date.
                </p>
              )}
            </div>
          </div>
        )}

        {legacy.imported > 0 && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h3>Carried over from the spreadsheet</h3>
              <div className="spacer" />
              <span className="tiny faint">{plural(legacy.imported, 'order')} imported</span>
            </div>
            <div className="card-pad">
              <div className="price-line">
                <span>
                  <strong>{formatMoney(legacy.open.total)}</strong> on {plural(legacy.open.orders, 'open order')}
                  <span className="tiny faint" style={{ display: 'block' }}>Worth confirming - these orders are not finished</span>
                </span>
                <span className="pill pill-warn">Check</span>
              </div>
              <div className="price-line">
                <span>
                  {formatMoney(legacy.settledLikely.total)} on {plural(legacy.settledLikely.orders, 'delivered order')}
                  <span className="tiny faint" style={{ display: 'block' }}>Almost certainly settled off-sheet; kept for the record</span>
                </span>
                <span className="pill pill-quiet">Historical</span>
              </div>
              <p className="tiny faint" style={{ margin: '10px 0 0' }}>
                The workbook's balance column recorded either what was owed or what had been paid,
                never both, so these figures are shown as they were written rather than folded into
                the totals above.
              </p>
            </div>
          </div>
        )}

        <div className="row" style={{ alignItems: 'flex-start' }}>
          {/* Ordered stages: horizontal bars, because the labels are words. */}
          <div style={{ flex: 2, minWidth: 460 }}>
            <div className="card">
              <div className="card-head">
                <h3>Pipeline</h3>
                <div className="spacer" />
                <span className="tiny faint">Orders at each stage, and what they are worth</span>
              </div>
              <div className="card-pad">
                <BarRows
                  rows={PROJECT_STATUSES.map((s) => ({
                    key: s.key,
                    label: s.label,
                    value: data.byStage[s.key]?.orders ?? 0,
                    note: data.byStage[s.key]
                      ? `${plural(data.byStage[s.key].suits, 'suit')} · ${formatMoney(data.byStage[s.key].quoted)}`
                      : '',
                  }))}
                  unit="order"
                />
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h3>Suits by event month</h3>
                <div className="spacer" />
                <span className="tiny faint">When the suits are needed</span>
              </div>
              <div className="card-pad">
                {data.monthly.length === 0
                  ? <Empty title="No orders yet" />
                  : <MonthBars rows={[...data.monthly].reverse()} />}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="card">
              <div className="card-head"><h3>Coming up</h3></div>
              <div className="card-pad">
                {data.dueSoon.length === 0
                  ? <p className="small faint" style={{ margin: 0 }}>Nothing scheduled.</p>
                  : data.dueSoon.map((o) => (
                      <div className="price-line clickable" key={o.id} onClick={() => onOpenProject(o.id)}>
                        <span>
                          <strong>{o.name} {o.surname}</strong>
                          <span className="tiny faint" style={{ display: 'block' }}>{statusLabel(o.status)}</span>
                        </span>
                        <span className="mono small">{o.event_date}</span>
                      </div>
                    ))}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head"><h3>Cloth</h3></div>
              <div className="card-pad">
                {data.topFabrics.length === 0
                  ? <p className="small faint" style={{ margin: 0 }}>No fabric recorded on any order yet.</p>
                  : <BarRows rows={data.topFabrics.map((f) => ({ key: f.value, label: f.value, value: f.orders, note: plural(f.suits, 'suit') }))} unit="order" />}
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head"><h3>Alterations &amp; extras</h3></div>
              <div className="card-pad">
                <div className="price-line"><span className="muted">Alteration income</span><span className="mono">{formatMoney(data.alterations.revenue)}</span></div>
                <div className="price-line"><span className="muted">Alterations open</span>
                  <span className="mono">{data.alterations.byStatus.filter((r) => !['collected', 'cancelled'].includes(r.status)).reduce((n, r) => n + r.n, 0)}</span></div>
                <div className="price-line"><span className="muted">Extras outstanding</span>
                  <span className="mono">{data.extras.filter((e) => !['delivered', 'cancelled'].includes(e.status)).reduce((n, e) => n + e.units, 0)}</span></div>
                {data.leadTime.averageDays !== null && (
                  <div className="price-line"><span className="muted">Average lead time</span>
                    <span className="mono">{Math.round(data.leadTime.averageDays)} days</span></div>
                )}
                <div className="price-line"><span className="muted">Busiest event</span>
                  <span className="small">{EVENT_TYPES.find((e) => e.key === data.topEvents[0]?.value)?.label ?? data.topEvents[0]?.value ?? '-'}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Stat({ label, value, sub, tone }) {
  return (
    <div className="card card-pad">
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{label}</div>
      <div className={`stat-value ${tone ? `stat-${tone}` : ''}`}>{value}</div>
      {sub && <div className="tiny faint">{sub}</div>}
    </div>
  );
}

/**
 * Horizontal bars with the value labelled on every row. With this few marks a
 * direct label beats a tooltip - the number is simply there, and it survives
 * printing and a screenshot.
 */
function BarRows({ rows, unit }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.key}>
          <div className="bar-label" title={r.label}>{r.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="bar-value">
            {r.value}
            {r.note && <span className="tiny faint" style={{ display: 'block' }}>{r.note}</span>}
          </div>
        </div>
      ))}
      {/* Naming the scale matters most when it is small: with one order at each
          stage every bar is full, which is true but looks like saturation. */}
      <div className="tiny faint" style={{ marginTop: 6 }}>
        Longest bar = {max} {unit}{max === 1 ? '' : 's'}.
      </div>
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.orders));
  return (
    <div className="month-bars">
      {rows.map((r, i) => {
        const [year, month] = r.month.split('-');
        // The run can cross a year end, and "12, 02, 03" with no year is a
        // trap - so the year is shown on the first bar and whenever it turns.
        const turned = i === 0 || rows[i - 1].month.slice(0, 4) !== year;
        return (
          <div className="month-col" key={r.month} title={`${r.month}: ${r.orders} orders, ${r.suits} suits`}>
            <div className="month-value">{r.orders || ''}</div>
            <div className="month-track">
              <div className="month-fill" style={{ height: `${(r.orders / max) * 100}%` }} />
            </div>
            <div className="month-label">
              {MONTH_NAMES[Number(month) - 1] ?? month}
              {turned && <span style={{ display: 'block', opacity: 0.7 }}>{year}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionTable({ title, tone, rows, columns, onOpen }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
        <span className={`status-dot status-${tone}`} /> {title}
      </div>
      <table className="table">
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => onOpen(o.id)}>
              <td style={{ fontWeight: 600 }}>{o.name} {o.surname}</td>
              {columns(o).map((c, i) => <td key={i} className={i === 0 ? 'muted' : 'mono small'}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
